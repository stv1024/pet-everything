import { Bounds } from '../engine/part';
import { Spring, TAU, clamp, follow, rng } from '../engine/math';
import { Frame } from './types';

/** 速度偏好：在 [lo, hi] 内为 1，过慢/过快逐渐下降，太快为负。 */
export function speedLike(speed: number, lo: number, hi: number, rough = hi * 2.2): number {
  if (speed < lo) return 0.25 + 0.75 * (speed / lo);
  if (speed <= hi) return 1;
  if (speed <= rough) return 1 - (speed - hi) / (rough - hi);
  return -clamp((speed - rough) / rough, 0, 1);
}

/**
 * 心情：joy（开心）与 annoy（烦躁）。物种给出每个时刻的抚摸评分 score（正=喜欢，负=讨厌）。
 */
export class Mood {
  joy = 0;
  annoy = 0;
  /** 连续接触时长 */
  touchTime = 0;
  /** 离开时长 */
  awayTime = 10;
  zone = '';
  zoneTime = 0;
  /** 0..1 的"被抚摸"强度，平滑过的 */
  petting = 0;
  constructor(
    public joyRate = 0.18,
    public annoyRate = 0.9,
    public joyDecay = 30,
    public annoyDecay = 4,
  ) {}

  update(f: Frame, score: number): void {
    const dt = f.dt;
    const c = f.contact;
    if (c && f.hand.touching) {
      this.touchTime += dt;
      this.awayTime = 0;
      if (c.zone !== this.zone) {
        this.zone = c.zone;
        this.zoneTime = 0;
      }
      this.zoneTime += dt;
      if (score > 0) {
        this.joy = clamp(this.joy + score * this.joyRate * dt * (1.15 - this.joy));
        this.annoy = Math.max(0, this.annoy - score * dt * 0.6);
      } else if (score < 0) {
        this.annoy = clamp(this.annoy - score * this.annoyRate * dt);
        this.joy = Math.max(0, this.joy + score * dt * 0.05);
      }
    } else {
      this.touchTime = 0;
      this.zone = '';
      this.zoneTime = 0;
      this.awayTime += dt;
    }
    this.joy *= Math.exp(-dt / this.joyDecay);
    this.annoy *= Math.exp(-dt / this.annoyDecay);
    const active = c && f.hand.touching ? clamp(f.hand.speed / 260) : 0;
    this.petting = follow(this.petting, active, dt, active > this.petting ? 0.15 : 0.6);
  }
}

/** 随机眨眼。 */
export class Blink {
  private next = 2 + Math.random() * 3;
  private t = 0;
  value = 1;
  step(dt: number, allow = true): number {
    this.t += dt;
    if (this.t > this.next && allow) {
      const k = this.t - this.next;
      this.value = k < 0.06 ? 1 - k / 0.06 : k < 0.14 ? (k - 0.06) / 0.08 : 1;
      if (k > 0.14) {
        this.t = 0;
        this.next = 1.8 + Math.random() * 4 + (Math.random() < 0.2 ? -1.5 : 0);
        this.value = 1;
      }
    } else this.value = 1;
    return this.value;
  }
}

/** 眼睛看向目标，带弹簧。 */
export class Gaze {
  x = new Spring(0, 3, 0.8);
  y = new Spring(0, 3, 0.8);
  private wanderT = 0;
  private wx = 0;
  private wy = 0;
  step(dt: number, f: Frame, eyeX: number, eyeY: number, range = 400): void {
    this.wanderT -= dt;
    if (this.wanderT < 0) {
      this.wanderT = 1.5 + Math.random() * 3;
      this.wx = (Math.random() - 0.5) * 0.8;
      this.wy = (Math.random() - 0.5) * 0.5;
    }
    let tx = this.wx,
      ty = this.wy;
    if (f.hand.present) {
      tx = clamp((f.hand.x - eyeX) / range, -1, 1);
      ty = clamp((f.hand.y - eyeY) / range, -1, 1);
    }
    this.x.step(tx, dt);
    this.y.step(ty, dt);
  }
}

export interface EyeOpts {
  /** 0 闭 .. 1 睁 */
  open: number;
  /** 0..1 开心眯眼（^ ^） */
  happy: number;
  lookX: number;
  lookY: number;
  color?: string;
  /** 0..1 惊吓：瞳孔变小、眼白出现 */
  shock?: number;
  /** 0..1 生气：上眼睑斜压 */
  angry?: number;
  /** 左眼 -1 / 右眼 1，决定生气眼睑方向 */
  side?: number;
  /** 虹膜颜色（写实些的动物用） */
  iris?: string;
  /** 生气眼睑的颜色（脸部毛色） */
  lid?: string;
}

/** 可爱风格的大眼睛。 */
export function drawEye(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, o: EyeOpts): void {
  const color = o.color ?? '#2a1c1a';
  const happy = clamp(o.happy);
  const open = clamp(o.open);
  const lw = Math.max(rx * 0.32, 2.2);
  if (happy > 0.55 || open < 0.14) {
    // ^ ^ 或 ‿ ‿
    g.save();
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.lineCap = 'round';
    g.beginPath();
    if (happy > 0.55) {
      g.moveTo(x - rx * 0.95, y + ry * 0.2);
      g.quadraticCurveTo(x, y - ry * 0.75, x + rx * 0.95, y + ry * 0.2);
    } else {
      g.moveTo(x - rx * 0.95, y - ry * 0.05);
      g.quadraticCurveTo(x, y + ry * 0.55, x + rx * 0.95, y - ry * 0.05);
    }
    g.stroke();
    g.restore();
    return;
  }
  const squash = 1 - happy * 1.2;
  const h = ry * clamp(squash) * (0.25 + 0.75 * open);
  const cy = y + (ry - h) * 0.5;
  g.save();
  g.beginPath();
  g.ellipse(x, cy, rx, h, 0, 0, TAU);
  g.clip();
  const shock = clamp(o.shock ?? 0);
  if (o.iris || shock > 0) {
    g.fillStyle = '#fffaf4';
    g.fill();
  }
  const lx = o.lookX * rx * 0.28,
    ly = o.lookY * h * 0.22;
  if (o.iris) {
    g.beginPath();
    g.ellipse(x + lx, cy + ly, rx * 0.86, h * 0.92, 0, 0, TAU);
    g.fillStyle = o.iris;
    g.fill();
    g.beginPath();
    g.ellipse(x + lx, cy + ly, rx * (0.5 - 0.3 * shock), h * (0.75 - 0.35 * shock), 0, 0, TAU);
    g.fillStyle = color;
    g.fill();
  } else {
    const k = 1 - 0.45 * shock;
    g.beginPath();
    g.ellipse(x + lx, cy + ly, rx * k, h * k, 0, 0, TAU);
    g.fillStyle = color;
    g.fill();
  }
  // 高光
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.ellipse(x + lx - rx * 0.32, cy + ly - h * 0.38, rx * 0.3, h * 0.26, -0.4, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(x + lx + rx * 0.3, cy + ly + h * 0.32, rx * 0.13, 0, TAU);
  g.fill();
  // 生气：斜眼睑
  const angry = clamp(o.angry ?? 0);
  if (angry > 0.02) {
    const side = o.side ?? 1;
    g.beginPath();
    g.moveTo(x - rx * 1.2, cy - h * 1.2);
    g.lineTo(x + rx * 1.2, cy - h * 1.2);
    g.lineTo(x + rx * 1.2, cy - h * (1.2 - 1.1 * angry * (side > 0 ? 1.4 : 0.3)));
    g.lineTo(x - rx * 1.2, cy - h * (1.2 - 1.1 * angry * (side > 0 ? 0.3 : 1.4)));
    g.closePath();
    g.fillStyle = o.lid ?? '#000';
    g.fill();
  }
  g.restore();
  if (open < 1 && o.iris) {
    // 写实眼睑线
    g.save();
    g.strokeStyle = color;
    g.lineWidth = lw * 0.5;
    g.beginPath();
    g.ellipse(x, cy, rx, h, 0, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.restore();
  }
}

export function drawBlush(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, amount: number, color = '255,120,140'): void {
  if (amount < 0.02) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, rx);
  gr.addColorStop(0, `rgba(${color},${0.55 * amount})`);
  gr.addColorStop(1, `rgba(${color},0)`);
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  g.translate(-x, -y);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, rx, 0, TAU);
  g.fill();
  g.restore();
}

/** 猫科的 ω 嘴。open>0 时张嘴。 */
export function drawCatMouth(g: CanvasRenderingContext2D, x: number, y: number, w: number, open: number, line = '#5a3a32', inside = '#c94f5e', smile = 0): void {
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = line;
  g.lineWidth = Math.max(2, w * 0.14);
  if (open > 0.05) {
    const h = w * 0.9 * open;
    g.beginPath();
    g.moveTo(x - w * 0.55, y + w * 0.05);
    g.quadraticCurveTo(x, y - w * 0.15, x + w * 0.55, y + w * 0.05);
    g.quadraticCurveTo(x + w * 0.5, y + h, x, y + h * 1.1);
    g.quadraticCurveTo(x - w * 0.5, y + h, x - w * 0.55, y + w * 0.05);
    g.closePath();
    g.fillStyle = inside;
    g.fill();
    g.stroke();
    g.beginPath();
    g.ellipse(x, y + h * 0.85, w * 0.3, h * 0.25, 0, Math.PI, TAU);
    g.fillStyle = '#ff8fa0';
    g.fill();
  }
  const lift = smile * w * 0.2;
  g.beginPath();
  g.moveTo(x - w * 0.62, y - lift);
  g.quadraticCurveTo(x - w * 0.32, y + w * 0.38, x, y);
  g.quadraticCurveTo(x + w * 0.32, y + w * 0.38, x + w * 0.62, y - lift);
  g.stroke();
  g.restore();
}

/** 椭圆地面阴影。 */
export function groundShadow(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha = 0.22): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, rx);
  gr.addColorStop(0, `rgba(60,40,30,${alpha})`);
  gr.addColorStop(0.6, `rgba(60,40,30,${alpha * 0.6})`);
  gr.addColorStop(1, 'rgba(60,40,30,0)');
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, rx, 0, TAU);
  g.fill();
  g.restore();
}

// ---------- 纹理绘制工具（建纹理时用一次） ----------

/** 立体明暗：顶部受光、底部和边缘发暗。 */
export function shade(g: CanvasRenderingContext2D, b: Bounds, o: { light?: number; dark?: number; lx?: number; ly?: number; rim?: number } = {}): void {
  const cx = b.x + b.w * (o.lx ?? 0.38),
    cy = b.y + b.h * (o.ly ?? 0.25);
  const r = Math.max(b.w, b.h) * 0.85;
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  gr.addColorStop(0, `rgba(255,250,240,${o.light ?? 0.28})`);
  gr.addColorStop(0.45, 'rgba(255,250,240,0)');
  gr.addColorStop(0.75, 'rgba(40,20,10,0)');
  gr.addColorStop(1, `rgba(40,20,10,${o.dark ?? 0.32})`);
  g.fillStyle = gr;
  g.fillRect(b.x - 40, b.y - 40, b.w + 80, b.h + 80);
}

/** 底部暗边（物体下缘的反光不足）。 */
export function underShade(g: CanvasRenderingContext2D, b: Bounds, alpha = 0.22, from = 0.55): void {
  const gr = g.createLinearGradient(0, b.y + b.h * from, 0, b.y + b.h + 10);
  gr.addColorStop(0, 'rgba(50,25,15,0)');
  gr.addColorStop(1, `rgba(50,25,15,${alpha})`);
  g.fillStyle = gr;
  g.fillRect(b.x - 40, b.y - 40, b.w + 80, b.h + 80);
}

/** 细碎毛刷纹理，让平涂有绒感。 */
export function furNoise(g: CanvasRenderingContext2D, b: Bounds, grain: (x: number, y: number) => number, o: { n?: number; len?: number; alpha?: number; seed?: number; light?: string; dark?: string } = {}): void {
  const rand = rng(o.seed ?? 5);
  const n = o.n ?? Math.round((b.w * b.h) / 18);
  const len = o.len ?? 7;
  g.save();
  g.lineCap = 'round';
  g.lineWidth = 1.2;
  for (const [color, sign] of [
    [o.dark ?? 'rgba(60,30,15,0.10)', 0],
    [o.light ?? 'rgba(255,250,240,0.10)', 1],
  ] as const) {
    g.strokeStyle = color;
    g.beginPath();
    for (let i = 0; i < n / 2; i++) {
      const x = b.x + rand() * b.w,
        y = b.y + rand() * b.h;
      const a = grain(x, y) + (rand() - 0.5) * 0.5;
      const l = len * (0.5 + rand());
      const ox = sign ? 0.6 : 0;
      g.moveTo(x + ox, y);
      g.lineTo(x + ox + Math.cos(a) * l, y + Math.sin(a) * l);
    }
    g.stroke();
  }
  g.restore();
}

/** 柔和色块（斑纹）。 */
export function softBlob(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, rot = 0, blur = 6): void {
  g.save();
  g.filter = `blur(${blur}px)`;
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, TAU);
  g.fill();
  g.restore();
}

/** 条纹（虎斑）。pts 为一条笔画的点列，宽度从中间向两端收细。 */
export function stripe(g: CanvasRenderingContext2D, pts: [number, number][], width: number, color: string, blur = 1.5): void {
  if (pts.length < 2) return;
  g.save();
  g.filter = `blur(${blur}px)`;
  g.fillStyle = color;
  const left: [number, number][] = [],
    right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)],
      b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const t = i / (pts.length - 1);
    const w = width * Math.sin(Math.PI * (0.08 + 0.84 * t)) * 0.5;
    left.push([pts[i][0] - (dy / l) * w, pts[i][1] + (dx / l) * w]);
    right.push([pts[i][0] + (dy / l) * w, pts[i][1] - (dx / l) * w]);
  }
  g.beginPath();
  g.moveTo(left[0][0], left[0][1]);
  for (const p of left) g.lineTo(p[0], p[1]);
  for (const p of right.reverse()) g.lineTo(p[0], p[1]);
  g.closePath();
  g.fill();
  g.restore();
}

/** 解析 #rrggbb 或 rgb()/rgba() 颜色。 */
export const hex = (c: string): [number, number, number] => {
  if (c.startsWith('#')) {
    const v = parseInt(c.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return [m[0], m[1], m[2]];
};

/** 冒爱心等节奏器：每隔 interval 秒触发一次。 */
export class Every {
  private t = 0;
  constructor(public interval: number) {}
  tick(dt: number, active: boolean): boolean {
    if (!active) {
      this.t = Math.min(this.t, this.interval * 0.5);
      return false;
    }
    this.t += dt;
    if (this.t >= this.interval) {
      this.t = 0;
      return true;
    }
    return false;
  }
}
