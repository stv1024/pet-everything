// 一键入口（tools/launcher.bat）用它：本仓库的 dev server 已经开着时，只打开浏览器，不再开第二个。
// 用法（仓库根目录）：node tools/dev-open.mjs [路径]
//   退出码 0：找到了，已在浏览器打开并打印地址
//   退出码 1：端口 5188 上没有服务
//   退出码 2：端口 5188 被别的程序占用（vite.config.ts 里 strictPort，dev server 起不来）
// 判断"是不是本仓库"：首页标题含「万物皆可撸」。
import { spawn } from 'node:child_process';

const PORT = 5188;
const url = `http://127.0.0.1:${PORT}${process.argv[2] || '/'}`;

function openUrl(u) {
  // 和 vite 的 --open 一样认 BROWSER 环境变量：none 表示不打开（测试用）
  if ((process.env.BROWSER || '').toLowerCase() === 'none') return;
  // 不用 `cmd /c start`：cmd 会在 & 处把地址截断
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', u]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [u]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

let html;
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(1500) });
  html = await res.text();
} catch {
  process.exit(1);
}
if (!html.includes('万物皆可撸')) process.exit(2);
openUrl(url);
console.log(url);
