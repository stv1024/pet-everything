import './style.css';
import { App } from './app';
import { sfx } from './audio/synth';
import { species } from './pets/registry';
import { Species } from './pets/types';

const STORE = 'pet-everything-choice';

const stage = document.getElementById('stage')!;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const petsEl = document.getElementById('pets')!;
const variantsEl = document.getElementById('variants')!;
const soundBtn = document.getElementById('sound')!;
const fullBtn = document.getElementById('full')!;
const status = document.getElementById('status')!;

const app = new App(stage, canvas);

// ---------- 作者链接（左上角） ----------
// 构建时用 VITE_LINKS=off 关掉（Cloudflare 临时地址那一版）：整段代码和地址都不会进打包结果。
if (import.meta.env.VITE_LINKS !== 'off') {
  const corner = document.createElement('div');
  corner.className = 'corner top-left';
  const links: [string, string, string][] = [
    ['GitHub', 'https://github.com/stv1024/pet-everything', 'M12 2.2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2.2Z'],
    ['X', 'https://x.com/stv1024', 'M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77L17.75 3Zm-1.08 16.18h1.7L7.4 4.73H5.58l11.09 14.45Z'],
  ];
  for (const [name, href, d] of links) {
    const a = document.createElement('a');
    a.className = 'icon-button brand';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = name;
    a.setAttribute('aria-label', name);
    a.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
    corner.append(a);
  }
  document.querySelector('.corner.top-right')!.before(corner);
}

interface Choice {
  pet: string;
  variants: Record<string, string>;
}
function readChoice(): Choice {
  try {
    const c = JSON.parse(localStorage.getItem(STORE) ?? '');
    if (c && typeof c.pet === 'string') return { pet: c.pet, variants: c.variants ?? {} };
  } catch {
    /* ignore */
  }
  return { pet: species[0].id, variants: {} };
}
const choice = readChoice();
const params = new URLSearchParams(location.search);
if (params.get('pet') && species.some(s => s.id === params.get('pet'))) choice.pet = params.get('pet')!;
if (params.get('v')) choice.variants[choice.pet] = params.get('v')!;

function save(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(choice));
  } catch {
    /* ignore */
  }
}

// ---------- 动物按钮 ----------
const buttons = new Map<string, HTMLButtonElement>();
for (const sp of species) {
  const b = document.createElement('button');
  b.className = 'pet';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', sp.name);
  b.title = sp.name;
  const c = document.createElement('canvas');
  const px = Math.round(68 * Math.min(2, devicePixelRatio || 1));
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  sp.icon(g, px);
  b.append(c);
  b.addEventListener('click', () => {
    app.au.unlock();
    select(sp, true);
  });
  petsEl.append(b);
  buttons.set(sp.id, b);
}

function renderVariants(sp: Species): void {
  variantsEl.replaceChildren();
  if (!sp.variants || sp.variants.length < 2) return;
  const current = choice.variants[sp.id] ?? sp.variants[0].id;
  for (const v of sp.variants) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', v.name);
    b.setAttribute('aria-checked', String(v.id === current));
    b.title = v.name;
    const stops = v.swatch.length === 1 ? v.swatch[0] : `conic-gradient(from 210deg, ${v.swatch.map((c, i) => `${c} ${(i / v.swatch.length) * 100}% ${((i + 1) / v.swatch.length) * 100}%`).join(', ')})`;
    b.style.background = stops;
    b.addEventListener('click', () => {
      app.au.unlock();
      choice.variants[sp.id] = v.id;
      save();
      select(sp, true);
    });
    variantsEl.append(b);
  }
}

let currentId = '';
function select(sp: Species, byUser = false): void {
  const variant = choice.variants[sp.id];
  app.setSpecies(sp, variant);
  if (byUser && app.au.ready) sfx.pop(app.au, 1, 0.12);
  currentId = sp.id;
  choice.pet = sp.id;
  save();
  for (const [id, b] of buttons) b.setAttribute('aria-checked', String(id === sp.id));
  buttons.get(sp.id)?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: byUser ? 'smooth' : 'auto' });
  renderVariants(sp);
  const vname = sp.variants?.find(v => v.id === (variant ?? sp.variants![0].id))?.name;
  status.textContent = vname && vname !== sp.name ? `${sp.name}：${vname}` : sp.name;
  const url = new URL(location.href);
  url.searchParams.set('pet', sp.id);
  if (variant) url.searchParams.set('v', variant);
  else url.searchParams.delete('v');
  history.replaceState(null, '', url);
}

select(species.find(s => s.id === choice.pet) ?? species[0]);

// ---------- 声音 ----------
function syncSound(): void {
  soundBtn.setAttribute('aria-checked', String(!app.au.muted));
  soundBtn.classList.toggle('locked', !app.au.muted && !app.au.ready);
}
app.au.onChange(syncSound);
syncSound();
soundBtn.addEventListener('click', () => {
  if (!app.au.ready) {
    app.au.unlock();
    if (app.au.muted) app.au.setMuted(false);
  } else app.au.setMuted(!app.au.muted);
  syncSound();
});
// 任意点击都解锁声音
window.addEventListener('pointerdown', () => app.au.unlock(), { capture: true });
window.addEventListener('keydown', () => app.au.unlock(), { capture: true });

// ---------- 全屏 ----------
fullBtn.addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
});
document.addEventListener('fullscreenchange', () => fullBtn.setAttribute('aria-pressed', String(!!document.fullscreenElement)));
if (!document.documentElement.requestFullscreen) fullBtn.hidden = true;

// ---------- 键盘 ----------
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
  const i = species.findIndex(s => s.id === currentId);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + species.length) % species.length;
    select(species[n], true);
    e.preventDefault();
  } else if (e.key === ' ' || e.key === 'Enter') {
    app.auto = true;
    e.preventDefault();
  } else if (e.key.toLowerCase() === 'm') {
    app.au.setMuted(!app.au.muted);
  } else if (e.key.toLowerCase() === 'f') {
    fullBtn.click();
  }
});
window.addEventListener('keyup', e => {
  if (e.key === ' ' || e.key === 'Enter') app.auto = false;
});

// 调试与自动化测试入口
(window as unknown as { __pet: App }).__pet = app;
