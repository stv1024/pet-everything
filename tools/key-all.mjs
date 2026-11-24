// 按 assets/keying.json 批量抠图。用法：node tools/key-all.mjs [名字过滤]
// 原图 assets/raw/<名字>.webp（无损）或 .png → 抠图（tools/key-green.mjs）→ public/pets/<输出>.webp（有损，alpha 无损）。
// 只处理原图存在的条目；过滤串匹配原图名或输出路径。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fromWebp, toWebp } from './lib/webp.mjs';

const filter = process.argv[2] ?? '';
const tmp = '.tmp/keying';
mkdirSync(tmp, { recursive: true });
const { groups } = JSON.parse(readFileSync('assets/keying.json', 'utf8'));
for (const g of groups)
  for (const [raw, out] of Object.entries(g.items)) {
    if (filter && !raw.includes(filter) && !out.includes(filter)) continue;
    let src = `assets/raw/${raw}.png`;
    if (existsSync(`assets/raw/${raw}.webp`)) {
      src = `${tmp}/${raw}.raw.png`;
      fromWebp(`assets/raw/${raw}.webp`, src);
    } else if (!existsSync(src)) {
      console.log(`跳过 ${raw}（没有原图）`);
      continue;
    }
    const keyed = `${tmp}/${raw}.keyed.png`;
    const env = { ...process.env, ...(g.crop ? { CROP: g.crop } : {}), ...(g.key ? { KEY: g.key } : {}) };
    const args = ['tools/key-green.mjs', src, keyed, String(g.pad ?? 16), ...(g.choke ? [String(g.choke)] : [])];
    process.stdout.write(execFileSync(process.execPath, args, { env }));
    const dst = `public/pets/${out}.webp`;
    mkdirSync(path.dirname(dst), { recursive: true });
    toWebp(keyed, dst);
    rmSync(keyed);
    if (src.startsWith(tmp)) rmSync(src);
    console.log(`  → ${dst}`);
  }
