import { PhotoDef, nearestOnLine, photoSpecies } from './photoPet';
import { cactusSounds, catSounds, crocodileSounds, dogSounds, hedgehogSounds, orcaSounds, rabbitSounds, tigerSounds } from './voices';

/**
 * 写实物种清单。坐标都是抠图后的图片像素（素材见 public/pets/<id>/）。
 * 标注方法见 docs/写实素材管线.md 第 3 节。
 */

const near = (x: number, y: number, cx: number, cy: number, r: number) => Math.hypot(x - cx, y - cy) < r;

// ---------- 猫 ----------

const catTail: [number, number][] = [
  [742, 166],
  [810, 160],
  [870, 180],
  [925, 216],
  [964, 266],
  [985, 330],
  [980, 400],
  [950, 450],
  [905, 478],
];

export const cat: PhotoDef = {
  id: 'cat',
  name: '猫',
  coats: [
    { id: 'orange', name: '橘猫', swatch: ['#e9974a', '#c9712a'], sheen: 0.14 },
    { id: 'black', name: '黑猫', swatch: ['#1d1a1b', '#3a3436'], sheen: 0.2 },
    { id: 'calico', name: '三花', swatch: ['#f6f1ea', '#d9812f', '#2b2526'], sheen: 0.1 },
    { id: 'tuxedo', name: '奶牛猫', swatch: ['#1d1a1b', '#f4f1ec'], sheen: 0.18 },
    { id: 'white', name: '白猫', swatch: ['#f7f5f2', '#d9d3cc'], sheen: 0.06 },
    { id: 'gray', name: '银虎斑', swatch: ['#a7a9ad', '#3d3f44'], sheen: 0.12 },
  ],
  rig: {
    nose: { x: 25, y: 192 },
    neck: { x: 305, y: 190 },
    spine: 192,
    skull: [262, 394],
    head: { x: [230, 408], half: [106, 170] },
    chest: { x: 408, rx: 192, ry: 220 },
    ears: [
      { base: { x: 168, y: 102 }, c: { x: 140, y: 82 } },
      { base: { x: 162, y: 262 }, c: { x: 134, y: 278 } },
    ],
    tail: catTail,
  },
  scale: 1,
  ground: 'rug',
  material: 'fur',
  zone: (x, y) => {
    if (near(x, y, 140, 82, 34) || near(x, y, 134, 278, 34)) return 'ear';
    if (y > 300 && x < 290) return 'paw';
    if (x < 300) return x < 75 ? 'face' : Math.abs(y - 185) > 70 ? 'cheek' : 'head';
    const t = nearestOnLine(catTail, x, y);
    if (t.d < 32 && t.s > 20) return 'tail';
    return x > 630 ? 'rump' : Math.abs(y - 205) > 125 ? 'side' : 'back';
  },
  temper: {
    prefs: { head: 1.1, cheek: 1.35, face: 0.25, ear: 0.5, back: 0.9, side: 0.5, rump: 1.0, tail: -0.7, paw: -0.15 },
    scratch: ['cheek', 'head', 'rump'],
  },
  voice: catSounds,
  icon: [0, 20, 330],
};

// ---------- 狗（柴犬） ----------

export const dog: PhotoDef = {
  id: 'dog',
  name: '狗',
  coats: [
    { id: 'shiba', name: '赤柴', swatch: ['#d9803a', '#f3e2c8'], sheen: 0.12 },
    { id: 'sesame', name: '胡麻柴', swatch: ['#a5622e', '#2a1d16'], sheen: 0.14 },
    { id: 'blacktan', name: '黑柴', swatch: ['#1f1a18', '#c98a4a'], sheen: 0.2 },
    { id: 'cream', name: '白柴', swatch: ['#f1e3cc', '#e3c9a2'], sheen: 0.06 },
  ],
  rig: {
    nose: { x: 78, y: 185 },
    neck: { x: 330, y: 188 },
    spine: 190,
    skull: [270, 380],
    head: { x: [240, 400], half: [110, 170] },
    chest: { x: 440, rx: 200, ry: 170 },
    ears: [
      { base: { x: 262, y: 95 }, c: { x: 245, y: 55 } },
      { base: { x: 255, y: 215 }, c: { x: 248, y: 245 } },
    ],
  },
  scale: 1.15,
  ground: 'rug',
  material: 'short',
  zone: (x, y) => {
    if (near(x, y, 245, 55, 42) || near(x, y, 248, 245, 42)) return 'ear';
    if (x < 175 && (y < 140 || y > 235)) return 'paw';
    if (x < 165) return 'face';
    if (x < 360) return Math.abs(y - 185) > 80 ? 'cheek' : 'head';
    if (near(x, y, 880, 175, 95)) return 'tail';
    return x > 690 ? 'rump' : Math.abs(y - 190) > 120 ? 'side' : 'back';
  },
  temper: {
    prefs: { face: 0.4, head: 1.2, cheek: 1.2, ear: 1.1, paw: -0.1, back: 1.0, side: 0.9, rump: 1.1, tail: -0.3 },
    speed: [50, 900, 2000],
    grain: 0.6,
    scratch: ['ear', 'head', 'cheek', 'rump', 'side'],
  },
  voice: dogSounds,
  icon: [60, 30, 330],
};

// ---------- 兔子 ----------

export const rabbit: PhotoDef = {
  id: 'rabbit',
  name: '兔子',
  coats: [
    { id: 'chestnut', name: '栗色', swatch: ['#b06a35', '#6b4a33'], sheen: 0.1 },
    { id: 'white', name: '白色', swatch: ['#f7f5f2', '#e6dfd8'], sheen: 0.05 },
    { id: 'broken', name: '花色', swatch: ['#f5f0ea', '#d9822f'], sheen: 0.08 },
    { id: 'gray', name: '蓝灰', swatch: ['#8d9096', '#5f6268'], sheen: 0.12 },
    { id: 'black', name: '黑色', swatch: ['#1b1a1c', '#3a3638'], sheen: 0.2 },
  ],
  rig: {
    nose: { x: 22, y: 240 },
    neck: { x: 300, y: 235 },
    spine: 240,
    skull: [200, 320],
    head: { x: [190, 340], half: [150, 230] },
    chest: { x: 520, rx: 260, ry: 230 },
    ears: [
      { base: { x: 290, y: 95 }, c: { x: 220, y: 75 } },
      { base: { x: 225, y: 290 }, c: { x: 215, y: 380 } },
    ],
  },
  scale: 0.8,
  ground: 'rug',
  material: 'fur',
  give: 1.15,
  settle: 1.6,
  zone: (x, y) => {
    if (near(x, y, 220, 75, 60) || near(x, y, 215, 380, 70)) return 'ear';
    if (x < 90) return 'face';
    if (x < 300) return Math.abs(y - 235) > 90 ? 'cheek' : 'head';
    if (near(x, y, 950, 235, 50)) return 'tail';
    return x > 760 ? 'rump' : Math.abs(y - 240) > 160 ? 'side' : 'back';
  },
  temper: {
    prefs: { face: 0.3, head: 1.3, cheek: 1.1, ear: 0.2, back: 1.0, side: 0.5, rump: -0.2, tail: -0.4 },
    speed: [30, 500, 1200],
    scratch: ['head', 'cheek'],
  },
  voice: rabbitSounds,
  icon: [0, 60, 360],
};

// ---------- 刺猬 ----------

export const hedgehog: PhotoDef = {
  id: 'hedgehog',
  name: '刺猬',
  coats: [
    { id: 'pepper', name: '椒盐色', swatch: ['#e8d8bc', '#5a3f2c'], sheen: 0.06 },
    { id: 'cinnamon', name: '肉桂色', swatch: ['#e9d2b4', '#b9773f'], sheen: 0.06 },
    { id: 'albino', name: '白化', swatch: ['#f6f2ec', '#e8b4b8'], sheen: 0.04 },
  ],
  rig: {
    nose: { x: 25, y: 285 },
    neck: { x: 235, y: 280 },
    spine: 280,
    skull: [150, 260],
    head: { x: [170, 260], half: [130, 200] },
    chest: { x: 500, rx: 300, ry: 230 },
    ears: [
      { base: { x: 215, y: 135 }, c: { x: 195, y: 120 } },
      { base: { x: 225, y: 390 }, c: { x: 215, y: 405 } },
    ],
  },
  scale: 0.5,
  ground: 'rug',
  material: 'spine',
  give: 0.4,
  settle: 0.5,
  zone: (x, y) => {
    if (x < 120) return 'face';
    if (x < 215 && Math.abs(y - 280) < 170) return 'head';
    return 'spines';
  },
  temper: {
    prefs: { face: -0.3, head: 0.5, spines: 0.8 },
    speed: [30, 400, 900],
    grain: 1.5,
  },
  voice: hedgehogSounds,
  // 逆着刺摸会扎出血；用力按也会扎，但慢一些
  spiky: { press: 0.6, against: 3.0, rub: 0, zones: ['spines'] },
  icon: [0, 110, 360],
};

// ---------- 老虎 ----------

const tigerTail: [number, number][] = [
  [800, 115],
  [870, 130],
  [920, 170],
  [955, 230],
  [965, 300],
  [945, 350],
  [900, 385],
  [860, 395],
];

export const tiger: PhotoDef = {
  id: 'tiger',
  name: '老虎',
  coats: [
    { id: 'bengal', name: '孟加拉虎', swatch: ['#e08a32', '#1d1a1b'], sheen: 0.12 },
    { id: 'white', name: '白虎', swatch: ['#f1efe9', '#3b3633'], sheen: 0.06 },
    { id: 'golden', name: '金虎', swatch: ['#e9b36a', '#b5773b'], sheen: 0.1 },
  ],
  rig: {
    nose: { x: 105, y: 150 },
    neck: { x: 330, y: 155 },
    spine: 160,
    skull: [260, 380],
    head: { x: [250, 400], half: [100, 160] },
    chest: { x: 430, rx: 200, ry: 160 },
    ears: [
      { base: { x: 245, y: 75 }, c: { x: 228, y: 55 } },
      { base: { x: 245, y: 180 }, c: { x: 228, y: 198 } },
    ],
    tail: tigerTail,
  },
  scale: 2.8,
  ground: 'grass',
  material: 'fur',
  give: 0.9,
  zone: (x, y) => {
    if (near(x, y, 228, 55, 35) || near(x, y, 228, 198, 35)) return 'ear';
    if (x < 120) return 'paw';
    if (x < 330) return x < 165 ? 'face' : Math.abs(y - 150) > 70 ? 'cheek' : 'head';
    const t = nearestOnLine(tigerTail, x, y);
    if (t.d < 30) return 'tail';
    return x > 620 ? 'rump' : Math.abs(y - 160) > 110 ? 'side' : 'back';
  },
  temper: {
    prefs: { head: 1.2, cheek: 1.3, ear: 0.6, paw: -0.2, face: 0.2, back: 1.0, side: 0.7, rump: 0.9, tail: -0.6 },
    speed: [40, 800, 1800],
    scratch: ['cheek', 'head'],
  },
  voice: tigerSounds,
  icon: [20, 0, 380],
};

// ---------- 鳄鱼 ----------

export const crocodile: PhotoDef = {
  id: 'crocodile',
  name: '鳄鱼',
  coats: [{ id: 'nile', name: '尼罗鳄', swatch: ['#8a8a4a', '#3b3a26'] }],
  rig: {
    nose: { x: 20, y: 175 },
    neck: { x: 280, y: 175 },
    spine: 175,
    skull: [240, 320],
    head: { x: [230, 330], half: [60, 100] },
    chest: { x: 450, rx: 200, ry: 110 },
  },
  scale: 3.2,
  ground: 'sand',
  material: 'scale',
  fur: false,
  // 硬度：仙人球 > 鳄鱼 > 虎鲸 > 刺猬 > 带毛的动物
  give: 0.1,
  breath: 0.3,
  zone: (x, y) => {
    if (x < 180) return 'snout';
    if (x < 290) return 'head';
    if (near(x, y, 200, 60, 75) || near(x, y, 200, 290, 75) || near(x, y, 630, 50, 75) || near(x, y, 630, 300, 75)) return 'leg';
    if (x > 680) return 'tail';
    return Math.abs(y - 175) > 80 ? 'side' : 'back';
  },
  temper: {
    prefs: { snout: -0.4, head: 0.8, leg: 0.1, back: 0.9, side: 0.6, tail: 0.3 },
    speed: [20, 600, 1400],
    grain: 0,
    scratch: ['head', 'back'],
  },
  voice: crocodileSounds,
  icon: [0, 20, 320],
};

// ---------- 虎鲸 ----------

export const orca: PhotoDef = {
  id: 'orca',
  name: '虎鲸',
  coats: [{ id: 'wild', name: '虎鲸', swatch: ['#1b1c20', '#f2f2f0'] }],
  rig: {
    nose: { x: 15, y: 290 },
    neck: { x: 230, y: 290 },
    spine: 290,
    skull: [180, 260],
    head: { x: [180, 300], half: [90, 130] },
    chest: { x: 420, rx: 260, ry: 130 },
  },
  scale: 3.6,
  ground: 'water',
  material: 'skin',
  fur: false,
  give: 0.3,
  breath: 0.5,
  shadow: 0.55,
  zone: (x, y) => {
    if (x < 200) return 'head';
    if (x > 180 && x < 380 && Math.abs(y - 290) > 115) return 'flipper';
    if (Math.abs(x - 530) < 95 && Math.abs(y - 287) < 22) return 'fin';
    if (x > 820) return 'fluke';
    return Math.abs(y - 290) > 75 ? 'side' : 'back';
  },
  temper: {
    prefs: { head: 1.1, back: 1.0, side: 0.9, flipper: 0.6, fin: 0.3, fluke: 0.4 },
    speed: [30, 700, 1600],
    grain: 0,
    scratch: ['head', 'back', 'side'],
  },
  voice: orcaSounds,
  icon: [0, 120, 380],
};

// ---------- 仙人球（金琥） ----------

const CX = 472,
  CY = 452;

export const cactus: PhotoDef = {
  id: 'cactus',
  name: '仙人球',
  coats: [
    { id: 'golden', name: '金琥', swatch: ['#4f7d3a', '#e9cf5a'] },
    { id: 'flower', name: '开花', swatch: ['#4f7d3a', '#f5d020'] },
  ],
  rig: {
    nose: { x: CX, y: CY },
    neck: { x: CX, y: CY },
    spine: CY,
    skull: [-20, -10],
    head: { x: [-20, -10], half: [0, 1] },
    chest: { x: CX, rx: 380, ry: 380 },
  },
  scale: 0.55,
  ground: 'rug',
  material: 'spine',
  materialOf: zone => (zone === 'pot' ? 'scale' : undefined),
  fur: false,
  give: 0.03,
  breath: 0,
  // 刺从球顶向四周辐射
  prior: (x, y) => {
    const dx = x - CX,
      dy = y - CY,
      l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  },
  zone: (x, y) => {
    const d = Math.hypot(x - CX, y - CY - 40);
    if (d > 420) return 'pot';
    return Math.hypot(x - CX, y - CY) < 95 ? 'crown' : 'spines';
  },
  temper: {
    prefs: { crown: 0.6, spines: 0.2, pot: 0.4 },
    speed: [10, 250, 600],
    grain: 0,
  },
  voice: cactusSounds,
  spiky: { press: 3.5, against: 0, rub: 1.8, zones: ['spines', 'crown'] },
  icon: [140, 120, 660],
};

export const photoSpeciesList = [cat, dog, rabbit, hedgehog, tiger, crocodile, orca, cactus].map(d => photoSpecies(d));
