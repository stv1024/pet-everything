// 检查一键入口的编码和换行符，保证能在文件管理器里双击运行：
//   打开游戏.bat           只用 ASCII，每行 CRLF
//   tools/launcher.bat     GBK 编码，每行 CRLF（cmd.exe 遇到只有 LF 的批处理会错行：注释被当成命令执行）
// 用写文件工具「另存」或在 Git Bash 里 sed -i 改过后，换行符可能变成 LF；git 提交时会规范化换行符，git status 看不出来。
// 用法（仓库根目录）：node tools/check-launchers.mjs [--fix]   --fix 把换行符改回 CRLF（不改编码）
import { readFileSync, writeFileSync } from 'node:fs';

const FIX = process.argv.includes('--fix');
const FILES = [
  { file: '打开游戏.bat', ascii: true },
  { file: 'tools/launcher.bat', ascii: false },
];
let bad = 0;
for (const { file, ascii } of FILES) {
  const buf = readFileSync(file);
  const problems = [];
  let lf = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x0a && (i === 0 || buf[i - 1] !== 0x0d)) lf++;
  if (lf) problems.push(`${lf} 行只有 LF，需要 CRLF`);
  if (ascii && buf.some(b => b > 0x7f)) problems.push('含非 ASCII 字符');
  // GBK 文件不应是 UTF-8：UTF-8 的中文是 3 字节 0xE0-0xEF 开头，按 GBK 解码会乱
  if (!ascii && new TextDecoder('utf-8', { fatal: false }).decode(buf).includes('本文件')) problems.push('看起来是 UTF-8，需要 GBK');
  if (problems.length && FIX && lf) {
    const text = buf.toString('latin1').replace(/\r?\n/g, '\r\n');
    writeFileSync(file, Buffer.from(text, 'latin1'));
    console.log(`已修正换行符：${file}`);
  }
  if (problems.length) {
    bad++;
    console.log(`${file}：${problems.join('；')}`);
  } else console.log(`OK ${file}`);
}
process.exit(bad && !FIX ? 1 : 0);
