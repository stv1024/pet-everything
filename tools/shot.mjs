// 本地截图：启动 vite 预览后，用 Headless Shell 截图并模拟抚摸。
// 用法：node tools/shot.mjs <url> <输出目录> [场景名...]
import { launchBrowser } from './lib/launch-browser.mjs';
import { mkdirSync } from 'node:fs';

const [url = 'http://127.0.0.1:5188/', out = '.tmp/shots', ...scenes] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ gpu: true });
const errors = [];
try {
  const sizes = scenes.includes('mobile') ? [['mobile', 390, 844, 3]] : [['desk', 1280, 800, 1]];
  for (const [name, w, h, dpr] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${name}-idle.png` });
    // 世界坐标 → 屏幕坐标
    const toScreen = (x, y) => page.evaluate(([x, y]) => { const v = window.__pet.view; return [v.ox + x * v.scale, v.oy + y * v.scale]; }, [x, y]);
    const strokes = JSON.parse(process.env.STROKES ?? '[[-80,0,160,10],[-200,-70,-140,-60]]');
    for (let k = 0; k < 6; k++) {
      for (const [x0, y0, x1, y1] of strokes) {
        const [a, b] = await toScreen(x0, y0), [c, d] = await toScreen(x1, y1);
        await page.mouse.move(a, b);
        await page.mouse.move(c, d, { steps: 12 });
      }
    }
    await page.screenshot({ path: `${out}/${name}-stroke.png` });
    if (process.env.HOLD) {
      await page.waitForTimeout(Number(process.env.HOLD));
      await page.screenshot({ path: `${out}/${name}-hold.png` });
    }
    const info = await page.evaluate(() => ({ joy: window.__pet.joy }));
    console.log(name, JSON.stringify(info));
    await page.close();
  }
} finally {
  await browser.close();
}
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
