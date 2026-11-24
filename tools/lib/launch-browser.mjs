// 通常建议复用这个启动入口；项目可根据兼容性证据调整，并记录原因。
// 来源：stv1024/my-assistant-team tools/browser-launcher/，版本 2026-11-01.2。
// 默认使用配套 Headless Shell。本机验证未触发 Windows 账户验证，升级后可复查。
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, rmdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function gpuArgs(platform = process.platform) {
  return platform === 'win32'
    ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11']
    : ['--enable-gpu'];
}
export const GPU_ARGS = Object.freeze(gpuArgs());

/** 返回 Playwright Browser。headless:false 显式选择专用持久 Chrome 配置。 */
export async function launchBrowser({ gpu = false, args = [], headless = true, profile, lockTimeout, ...options } = {}) {
  args = args.filter(arg => process.platform === 'win32' || arg !== '--use-angle=d3d11');
  for (const key of ['channel', 'executablePath', 'ignoreDefaultArgs']) {
    if (options[key] !== undefined) throw new Error(`launchBrowser 的默认 Shell 模式不接受 ${key}；完整浏览器可用 launchFullChrome。`);
  }
  if (!headless) {
    const { context } = await launchFullChrome({ ...options, headed: true, gpu, args, profile, lockTimeout });
    return context.browser();
  }
  try {
    return await chromium.launch({ ...options, headless: true, args: [...(gpu ? GPU_ARGS : []), ...args] });
  } catch (error) {
    if (!/Executable doesn't exist|is not found/i.test(error.message)) throw error;
    throw new Error('找不到配套 Headless Shell。请在项目目录运行：node node_modules/playwright-core/cli.js install chromium --only-shell', { cause: error });
  }
}

/** 完整 Chrome 例外：首次初始化或密码变更仍可能产生验证失败。 */
export async function launchFullChrome({ headed = true, gpu = false, args = [], profile = defaultProfile(), lockTimeout = 120000, ...options } = {}) {
  args = args.filter(arg => process.platform === 'win32' || arg !== '--use-angle=d3d11');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(profile)) throw new Error('profile 请使用 1–80 个字母、数字、点、下划线或连字符，以字母或数字开头。');
  if (!Number.isFinite(lockTimeout) || lockTimeout < 0) throw new Error('lockTimeout 应为非负毫秒数。');
  const state = process.platform === 'win32' ? (process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local')) : (process.env.XDG_STATE_HOME ?? path.join(homedir(), '.local', 'state'));
  const dir = path.join(state, 'agent-browser', profile);
  mkdirSync(dir, { recursive: true });
  const release = await lockProfile(dir, lockTimeout);
  try {
    const context = await chromium.launchPersistentContext(dir, { ...options, channel: 'chrome', headless: !headed, args: [...(gpu ? GPU_ARGS : []), ...args] });
    context.once('close', release);
    return { context, close: () => context.close() };
  } catch (error) {
    release();
    throw error;
  }
}

async function lockProfile(dir, timeout) {
  // 原子 mkdir；不自动抢占“疑似过期”的锁，以免删除刚由另一进程创建的锁。
  const lock = `${dir}.lock`;
  const deadline = Date.now() + timeout;
  for (;;) {
    try { mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`专用 Chrome 配置正在使用或上次异常退出：${lock}。确认相关测试和 Chrome 已退出后，可手动清理该锁目录。`);
      await new Promise(resolve => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))));
    }
  }
  const owner = path.join(lock, 'owner.json');
  try { writeFileSync(owner, JSON.stringify({ pid: process.pid, created: new Date().toISOString() })); }
  catch (error) { rmdirSync(lock); throw error; }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { unlinkSync(owner); rmdirSync(lock); }
    catch (error) { console.warn(`Chrome 已关闭，但锁目录清理失败：${lock}: ${error.message}`); }
  };
}

function defaultProfile() {
  // 按模块所在项目定位，不受启动脚本时 cwd 影响；同一项目的 worktree 共用名称。
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const name = String(pkg.name ?? path.basename(dir)).replace(/[^a-zA-Z0-9_.-]/g, '_');
      return `test-${name}`.slice(0, 80);
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) return 'test-browser';
    dir = parent;
  }
}
