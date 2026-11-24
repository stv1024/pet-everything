// 用 TokenRouter v2 的 Task API 生图。
// 用法：node tools/gen-image.mjs --out <文件.webp|.png> --prompt <文本 | @文件> [--ref <参考图>]... [--model gpt|gemini]
// --out 为 .webp 时存成无损 WebP（assets/raw/ 的约定）；参考图可以是 .webp（先转成 PNG 再上传）。
// 接口地址和 Key 从环境变量 OWTOKENROUTER_BASE_URL、OWTOKENROUTER_API_KEY 读取；也可以写在仓库根目录的 .env.local
// （不入库）。每次生成会写一个同名 .json，只记录提示词、参考图和模型；任务 ID 和费用只打印在终端。
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fromWebp, toWebp } from './lib/webp.mjs';

// .env.local：每行 NAME=value，环境变量优先
try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* 没有 .env.local */
}
const BASE = process.env.OWTOKENROUTER_BASE_URL?.replace(/\/$/, '');
const KEY = process.env.OWTOKENROUTER_API_KEY;
if (!BASE || !KEY) throw new Error('缺少环境变量 OWTOKENROUTER_BASE_URL 或 OWTOKENROUTER_API_KEY（可写在 .env.local）');

const SERVICES = {
  gpt: { service: 'tencent-vod/gpt-image-2.6', text: 'tencent-vod--gpt-image-2.6--text', ref: 'tencent-vod--gpt-image-2.6--reference' },
  gemini: { service: 'tencent-vod/gemini-3-pro-image', text: 'tencent-vod--gemini-3-pro-image--baseline', ref: 'tencent-vod--gemini-3-pro-image--storage_input_url' },
};

const args = process.argv.slice(2);
const opt = { refs: [] };
for (let i = 0; i < args.length; i++) {
  const k = args[i];
  if (k === '--ref') opt.refs.push(args[++i]);
  else opt[k.replace(/^--/, '')] = args[++i];
}
if (!opt.out || !opt.prompt) throw new Error('需要 --out 和 --prompt');
const prompt = opt.prompt.startsWith('@') ? readFileSync(opt.prompt.slice(1), 'utf8').trim() : opt.prompt;
const svc = SERVICES[opt.model ?? 'gpt'];

const auth = { Authorization: `Bearer ${KEY}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 网络错误、排队已满（429）、服务端 5xx 时重试。创建任务带固定幂等键，重试不会重复扣费。
async function api(method, url, body, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    let r, text;
    try {
      r = await fetch(BASE + url, {
        method,
        headers: { ...auth, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      text = await r.text();
    } catch (e) {
      if (attempt >= 8) throw e;
      console.error(`网络错误，${attempt * 5}s 后重试：${e.cause?.code ?? e.message}`);
      await sleep(attempt * 5000);
      continue;
    }
    if (r.ok) return JSON.parse(text);
    if ((r.status === 429 || r.status >= 500) && attempt < 12) {
      console.error(`${r.status}，${Math.min(60, attempt * 10)}s 后重试：${text.slice(0, 120)}`);
      await sleep(Math.min(60, attempt * 10) * 1000);
      continue;
    }
    throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 500)}`);
  }
}

async function upload(file) {
  if (file.endsWith('.webp')) {
    const png = path.join('.tmp', `ref-${path.basename(file, '.webp')}.png`);
    mkdirSync('.tmp', { recursive: true });
    fromWebp(file, png);
    file = png;
  }
  const buf = readFileSync(file);
  const md5 = createHash('md5').update(buf).digest('base64');
  const mime = file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'image/png';
  const ticket = await api('POST', '/v1/files', { filename: path.basename(file), bytes: buf.length, mime_type: mime, content_md5: md5 });
  const h = ticket.upload.headers;
  const put = await fetch(ticket.upload.url, {
    method: 'PUT',
    headers: { 'Content-Type': h['content-type'], 'Content-MD5': h['content-md5'], 'Content-Length': h['content-length'], 'If-None-Match': h['if-none-match'] },
    body: buf,
  });
  if (!put.ok) throw new Error(`上传失败 ${put.status}: ${await put.text()}`);
  const ready = await api('POST', `/v1/files/${ticket.id}/complete`, {});
  if (ready.status !== 'ready') throw new Error(`文件未就绪：${JSON.stringify(ready)}`);
  return ticket.id;
}

const inputs = [];
for (const r of opt.refs) inputs.push({ file_id: await upload(r), role: 'reference_image' });
const body = { service_id: svc.service, profile_id: inputs.length ? svc.ref : svc.text, parameters: { prompt }, ...(inputs.length ? { inputs } : {}) };
let task = await api('POST', '/v1/tasks?wait=30', body, { 'Idempotency-Key': randomUUID() }); // 同一次运行的重试共用这个键
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'submission_unknown', 'materialization_failed']);
const t0 = Date.now();
while (!terminal.has(task.state)) {
  if (Date.now() - t0 > 10 * 60 * 1000) throw new Error(`超时：${task.id} ${task.state}`);
  await new Promise(r => setTimeout(r, 4000));
  task = await api('GET', `/v1/tasks/${task.id}`);
}
const seconds = Math.round((Date.now() - t0) / 1000);
if (task.state !== 'succeeded') {
  console.error('生成失败', JSON.stringify({ task: task.id, state: task.state, error: task.error }, null, 2));
  process.exit(1);
}
// 记录文件会入库：只写提示词、参考图和模型，不写任务 ID、计费等接口内部数据
mkdirSync(path.dirname(opt.out), { recursive: true });
writeFileSync(opt.out.replace(/\.\w+$/, '.json'), JSON.stringify({ prompt, refs: opt.refs, model: body.service_id }, null, 2) + '\n');
const out = task.outputs[0];
const r = await fetch(`${BASE}/v1/tasks/${task.id}/artifacts/${out.id}`, { headers: auth });
if (!r.ok) throw new Error(`下载失败 ${r.status}`);
const bytes = Buffer.from(await r.arrayBuffer());
if (opt.out.endsWith('.webp')) {
  const png = opt.out.replace(/\.webp$/, '.download.png');
  writeFileSync(png, bytes);
  toWebp(png, opt.out, { lossless: true });
  rmSync(png);
} else writeFileSync(opt.out, bytes);
console.log(`OK ${opt.out} ${statSync(opt.out).size} bytes, ${seconds}s, task=${task.id}, billing=${JSON.stringify(task.billing?.total_nano_cny ?? task.billing)}`);
