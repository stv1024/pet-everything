// 绿幕抠图：纯绿背景 → 透明 PNG，并去除边缘绿色溢色、裁到主体外接框加边距。
// 用法：node tools/key-green.mjs <输入.png> <输出.png> [边距像素=24] [收边=0..0.6]
// 收边（choke）把半透明边缘往里收，适合皮肤这类边缘有绿幕反光的素材。
// 环境变量 CROP=x,y,w,h 时用固定裁剪框，让同一姿势的多张图坐标完全一致。
// 环境变量 KEY=magenta 时抠品红幕（#FF00FF），用于本身是绿色的主体（鳄鱼、仙人球）。
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output, padArg, chokeArg] = process.argv;
const pad = Number(padArg ?? 24);
const choke = Number(chokeArg ?? 0);
const src = PNG.sync.read(readFileSync(input));
const { width: w, height: h, data } = src;
const magenta = process.env.KEY === 'magenta';
// 背景色优势：背景约 255，主体为负
const keyness = magenta ? (r, g, b) => Math.min(r, b) - g : (r, g, b) => g - (r + b) / 2;
const a = new Float32Array(w * h);
for (let i = 0; i < w * h; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  const green = keyness(r, g, b);
  let alpha = 1 - (green - 14) / (190 - 14);
  alpha = Math.max(0, Math.min(1, alpha));
  if (choke > 0) alpha = Math.max(0, Math.min(1, (alpha - choke) / (1 - choke)));
  a[i] = alpha;
}
// 去掉孤立噪点：alpha 很低的像素直接清零
let x0 = w, y0 = h, x1 = 0, y1 = 0;
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (a[i] < 0.04) a[i] = 0;
    if (a[i] > 0.5) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
if (process.env.CROP) {
  const [cx, cy, cw, ch] = process.env.CROP.split(',').map(Number);
  x0 = cx; y0 = cy; x1 = cx + cw - 1; y1 = cy + ch - 1;
}
const ow = x1 - x0 + 1, oh = y1 - y0 + 1;
const out = new PNG({ width: ow, height: oh });
// 先取不透明像素的颜色（去溢色），再把颜色从内部向半透明边缘扩散，消除绿边
const col = new Float32Array(ow * oh * 3);
const valid = new Uint8Array(ow * oh);
for (let y = 0; y < oh; y++)
  for (let x = 0; x < ow; x++) {
    const si = (y + y0) * w + (x + x0), di = y * ow + x;
    let r = data[si * 4], g = data[si * 4 + 1], b = data[si * 4 + 2];
    // 去溢色：绿幕时绿色不超过红蓝平均值太多；品红幕时红、蓝不同时比绿高太多
    const green = keyness(r, g, b);
    if (magenta) {
      const over = Math.min(r, b) - g - 8;
      if (over > 0) { r -= over; b -= over; }
    } else {
      const cap = (r + b) / 2 + 8;
      if (g > cap) g = cap;
    }
    col[di * 3] = r; col[di * 3 + 1] = g; col[di * 3 + 2] = b;
    valid[di] = a[si] >= 0.985 && green < 6 ? 1 : 0;
  }
for (let pass = 0; pass < 12; pass++) {
  const next = valid.slice();
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const di = y * ow + x;
      if (valid[di]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= ow || yy >= oh) continue;
          const k = yy * ow + xx;
          if (!valid[k]) continue;
          r += col[k * 3]; g += col[k * 3 + 1]; b += col[k * 3 + 2]; n++;
        }
      if (n) { col[di * 3] = r / n; col[di * 3 + 1] = g / n; col[di * 3 + 2] = b / n; next[di] = 1; }
    }
  valid.set(next);
}
for (let y = 0; y < oh; y++)
  for (let x = 0; x < ow; x++) {
    const si = (y + y0) * w + (x + x0), di = y * ow + x;
    out.data[di * 4] = col[di * 3]; out.data[di * 4 + 1] = col[di * 3 + 1]; out.data[di * 4 + 2] = col[di * 3 + 2];
    out.data[di * 4 + 3] = Math.round(a[si] * 255);
  }
writeFileSync(output, PNG.sync.write(out));
console.log(`OK ${output} ${ow}x${oh} (crop ${x0},${y0})`);
