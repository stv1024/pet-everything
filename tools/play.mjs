// 脚本化手势 + 截图，用于检查手感和反应。
// 用法：node tools/play.mjs <脚本.json> <输出目录>
// 脚本：{ "url": "...", "size": [w,h,dpr], "steps": [ ["move",x,y], ["drag",x0,y0,x1,y1,steps,repeat], ["down"], ["up"],
//         ["sweep",x0,y0,x1,y1,ms,down?]（页面内移动，不阻塞）, ["wait",ms], ["shot",name,[x,y,w,h]?], ["eval","js"] ] }，坐标为世界坐标，clip 也是世界坐标。
import { launchBrowser } from './lib/launch-browser.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [file, out = '.tmp/play'] = process.argv.slice(2);
const script = JSON.parse(readFileSync(file, 'utf8'));
mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ gpu: true });
const errors = [];
try {
  const [w, h, dpr] = script.size ?? [1280, 800, 1];
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: !!script.touch });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(script.url ?? 'http://127.0.0.1:5188/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const S = (x, y) => page.evaluate(([x, y]) => { const v = window.__pet.view, c = Math.cos(v.rot), s = Math.sin(v.rot); return [v.ox + (x * c - y * s) * v.scale, v.oy + (x * s + y * c) * v.scale, v.scale]; }, [x, y]);
  for (const st of script.steps) {
    const [op, ...a] = st;
    if (op === 'move') { const [x, y] = await S(a[0], a[1]); await page.mouse.move(x, y, { steps: a[2] ?? 1 }); }
    else if (op === 'drag') {
      const [x0, y0, x1, y1, steps = 12, rep = 1] = a;
      for (let r = 0; r < rep; r++) {
        const [p, q] = await S(x0, y0), [u, v] = await S(x1, y1);
        if (r === 0) await page.mouse.move(p, q);
        await page.mouse.move(u, v, { steps });
        if (rep > 1) await page.mouse.move(p, q, { steps });
      }
    }
    else if (op === 'scratch') {
      const [x, y, amp = 20, n = 20] = a;
      const [p, q, s] = await S(x, y);
      for (let i = 0; i < n; i++) { await page.mouse.move(p + (i % 2 ? amp : -amp) * s, q + (i % 3) * 2, { steps: 2 }); }
    }
    else if (op === 'glide') {
      // 按真实时间移动：glide x0 y0 x1 y1 毫秒 [往返次数]
      const [x0, y0, x1, y1, ms = 600, rep = 1] = a;
      const [p, q] = await S(x0, y0), [u, v] = await S(x1, y1);
      await page.mouse.move(p, q);
      for (let r = 0; r < rep; r++) {
        const n = Math.max(2, Math.round(ms / 16));
        for (let i = 1; i <= n; i++) {
          const t = r % 2 ? 1 - i / n : i / n;
          await page.mouse.move(p + (u - p) * t, q + (v - q) * t);
          await page.waitForTimeout(16);
        }
      }
    }
    else if (op === 'sweep') {
      // 页面内合成的指针移动，不阻塞后续步骤，便于在移动中途截图：sweep x0 y0 x1 y1 毫秒 [down]
      const [x0, y0, x1, y1, ms = 600, down = 0] = a;
      const [p, q] = await S(x0, y0), [u, v] = await S(x1, y1);
      await page.evaluate(([p, q, u, v, ms, down]) => {
        const st = document.getElementById('stage');
        const ev = (type, x, y) => st.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerType: 'mouse', bubbles: true, isPrimary: true, buttons: down ? 1 : 0, pressure: down ? 0.5 : 0 }));
        ev('pointerenter', p, q);
        ev('pointermove', p, q);
        if (down) ev('pointerdown', p, q);
        const t0 = performance.now();
        const tick = now => {
          const t = Math.min(1, (now - t0) / ms), k = t * t * (3 - 2 * t);
          ev('pointermove', p + (u - p) * k, q + (v - q) * k);
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, [p, q, u, v, ms, down]);
    }
    else if (op === 'down') await page.mouse.down();
    else if (op === 'up') await page.mouse.up();
    else if (op === 'click') { const [x, y] = await S(a[0], a[1]); await page.mouse.click(x, y); }
    else if (op === 'wait') await page.waitForTimeout(a[0]);
    else if (op === 'key') await page.keyboard.press(a[0]);
    else if (op === 'eval') console.log(op, JSON.stringify(await page.evaluate(a[0])));
    else if (op === 'shot') {
      let clip;
      if (a[1]) { const [x, y, s] = await S(a[1][0], a[1][1]); clip = { x, y, width: a[1][2] * s, height: a[1][3] * s }; }
      await page.screenshot({ path: `${out}/${a[0]}.png`, clip });
    }
  }
} finally {
  await browser.close();
}
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
