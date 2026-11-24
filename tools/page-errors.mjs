// 打开页面并打印页面错误和控制台输出。用法：node tools/page-errors.mjs <url>
import { launchBrowser } from './lib/launch-browser.mjs';
const b = await launchBrowser({ gpu: true });
const p = await b.newPage();
p.on('pageerror', e => console.log('PAGEERROR', e.stack || String(e)));
p.on('console', m => console.log('CONSOLE', m.type(), m.text()));
await p.goto(process.argv[2], { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await b.close();
