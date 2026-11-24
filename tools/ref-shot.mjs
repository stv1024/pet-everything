// 截取参考站点的界面，仅用于研究交互。用法：node tools/ref-shot.mjs <输出目录>
import { launchBrowser } from './lib/launch-browser.mjs';
const out = process.argv[2] ?? '.tmp/ref-shots';
const browser = await launchBrowser({ gpu: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('https://pet-the-cat.pages.dev/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#stage[data-ready="true"]', { timeout: 30000 });
  await page.screenshot({ path: `${out}/01-idle.png` });
  const box = await page.locator('#stage').boundingBox();
  const cx = box.x + box.width * 0.35, cy = box.y + box.height * 0.5;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 30; i++) await page.mouse.move(cx + i * 12, cy + Math.sin(i / 3) * 10, { steps: 2 });
  await page.screenshot({ path: `${out}/02-stroke.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/03-mobile.png` });
} finally { await browser.close(); }
