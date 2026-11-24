// WebP 编解码（借助 ffmpeg 的 libwebp）。
// 运行时素材（public/pets/）用有损 WebP，质量 90；带透明通道时 alpha 无损保存。
// 原始生图（assets/raw/）用无损 WebP，抠图前再解码成 PNG（pngjs 只认 PNG）。
import { execFileSync } from 'node:child_process';

const ff = (args) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

/** PNG/JPG → WebP。lossless 为 true 时无损；否则有损（alpha 仍无损）。 */
export function toWebp(src, dst, { lossless = false, quality = 90, alpha = true } = {}) {
  const enc = lossless ? ['-lossless', '1'] : ['-lossless', '0', '-quality', String(quality), ...(alpha ? ['-pix_fmt', 'yuva420p'] : [])];
  ff(['-i', src, '-c:v', 'libwebp', ...enc, '-compression_level', '6', dst]);
}

/** WebP → PNG（RGBA）。 */
export function fromWebp(src, dstPng) {
  ff(['-i', src, '-pix_fmt', 'rgba', dstPng]);
}
