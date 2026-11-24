// 发布到 Cloudflare。用法（仓库根目录）：
//   node tools/deploy.mjs main   构建（带作者链接）→ Worker 静态资源，自定义域名 pet-everything.stv1024.asia（见 wrangler.jsonc）
//   node tools/deploy.mjs anon   构建（--mode anon：不带作者链接）→ Cloudflare Pages 临时地址 <项目名>.pages.dev
// anon 版的 Pages 项目名写在 .env.local 的 CF_PAGES_PROJECT（不入库，临时地址不和本仓库公开关联）。
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = {};
try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
} catch {
  /* 没有 .env.local */
}
const run = cmd => execSync(cmd, { stdio: 'inherit' });
const which = process.argv[2];
if (which === 'main') {
  run('npm run build');
  run('npx wrangler deploy');
} else if (which === 'anon') {
  const project = process.env.CF_PAGES_PROJECT || env.CF_PAGES_PROJECT;
  if (!project) throw new Error('缺少 CF_PAGES_PROJECT（写在 .env.local）');
  run('npx tsc --noEmit');
  run('npx vite build --mode anon --outDir dist-anon --emptyOutDir');
  const leaked = execSync('git grep -n -I -e stv1024 -e github.com -e x.com --no-index -- dist-anon || true').toString().trim();
  if (leaked) throw new Error(`anon 版里还有作者信息：\n${leaked}`);
  run(`npx wrangler pages deploy dist-anon --project-name ${project} --branch main --commit-dirty=true`);
} else {
  console.log('用法：node tools/deploy.mjs main|anon');
  process.exit(1);
}
