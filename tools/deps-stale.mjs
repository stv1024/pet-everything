// 一键入口（tools/launcher.bat）用它判断要不要 npm install。
// 只检查 node_modules 在不在不够：拉了新代码、package.json 加了依赖时，旧的 node_modules 还在。
// npm 每次安装完会写 node_modules/.package-lock.json；它比 package.json、package-lock.json 旧，或者不存在，就说明依赖过期了。
// 用法（仓库根目录）：node tools/deps-stale.mjs
//   退出码 0：依赖是最新的；1：没有 node_modules；2：依赖过期。
//   不打印任何内容：Windows 的 cmd 窗口是 GBK 代码页，node 输出的中文会乱码，提示文字由启动脚本自己写。
import { statSync } from 'node:fs';

const mtime = file => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

const installed = mtime('node_modules/.package-lock.json');
if (installed === null) process.exit(1);
const stale = ['package.json', 'package-lock.json'].some(f => (mtime(f) ?? 0) > installed);
process.exit(stale ? 2 : 0);
