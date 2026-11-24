// 把一张均匀材质照片做成可无缝平铺的贴图。
// 用法：node tools/make-tile.mjs <输入.webp|.png> <输出.webp|.png> [边缘过渡宽度比例=0.22] [边长=768]
// 输出 .webp 时缩到给定边长并存成有损 WebP（运行时素材的约定）。
// 做法：原图 A 与"错开半张"的 B 混合。边缘处用 B（B 的边缘来自 A 的内部，天然连续），
// 中间用 A（A 的内部连续），之间平滑过渡。适合草地、沙地、水面、地毯这类没有大结构的材质。
import { PNG } from 'pngjs';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fromWebp, toWebp } from './lib/webp.mjs';

const [, , input, output, bandArg, sizeArg] = process.argv;
const band = Number(bandArg ?? 0.22);
mkdirSync('.tmp', { recursive: true });
let inPng = input;
if (input.endsWith('.webp')) {
  inPng = '.tmp/make-tile-in.png';
  fromWebp(input, inPng);
}
const src = PNG.sync.read(readFileSync(inPng));
const { width: w, height: h, data } = src;
const out = new PNG({ width: w, height: h });
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    // 到最近边缘的距离（比例）
    const ex = Math.min(x, w - 1 - x) / w,
      ey = Math.min(y, h - 1 - y) / h;
    const m = smooth(ex / band) * smooth(ey / band);
    const i = (y * w + x) * 4;
    const j = (((y + h / 2) % h) * w + ((x + w / 2) % w)) * 4;
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(data[i + c] * m + data[j + c] * (1 - m));
    out.data[i + 3] = 255;
  }
if (output.endsWith('.webp')) {
  const size = Number(sizeArg ?? 768);
  const tmp = '.tmp/make-tile-out.png';
  writeFileSync(tmp, PNG.sync.write(out));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', tmp, '-vf', `scale=${size}:${size}`, '.tmp/make-tile-scaled.png']);
  toWebp('.tmp/make-tile-scaled.png', output, { quality: 85, alpha: false });
  for (const f of [tmp, '.tmp/make-tile-scaled.png']) rmSync(f);
} else writeFileSync(output, PNG.sync.write(out));
if (inPng !== input) rmSync(inPng);
console.log(`OK ${output}`);
