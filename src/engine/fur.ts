import { Warp } from './deform';
import { Part } from './part';
import { Vec, clamp, pointInPolygon, rng } from './math';

/** 手对毛发的作用：世界坐标。 */
export interface Touch {
  active: boolean;
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  /** 0..1 */
  p: number;
}

/** 毛发所依附的坐标系（刚性部件或尾巴链）。 */
export interface FurHost {
  give: number;
  visible: boolean;
  alpha: number;
  toWorld(lx: number, ly: number, out: Vec): void;
  angleAt(lx: number, ly: number): number;
}

export interface StrandSeed {
  x: number;
  y: number;
  /** 局部坐标中的静止朝向 */
  angle: number;
  /** 外法线朝向（用于刺猬炸刺），默认同 angle */
  out?: number;
  len: number;
  r: number;
  g: number;
  b: number;
}

export interface FurStyle {
  width: number;
  kind?: 'fur' | 'spine';
  /** 弹簧固有频率 Hz */
  freq?: number;
  damping?: number;
  /** 被手带动的幅度 */
  drag?: number;
  /** 逆毛后乱毛的程度；0 表示不会乱 */
  ruffle?: number;
  /** 刺尖颜色 */
  tip?: string;
  /** 每帧之后绘制的透明度 */
  alpha?: number;
}

const tmp = { x: 0, y: 0 };

export class FurField {
  readonly n: number;
  private lx: Float32Array;
  private ly: Float32Array;
  private ang: Float32Array;
  private outAng: Float32Array;
  private len: Float32Array;
  private jitter: Float32Array;
  private bx: Float32Array;
  private by: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private rx: Float32Array;
  private ry: Float32Array;
  private px: Float32Array;
  private py: Float32Array;
  private cx: Float32Array;
  private cy: Float32Array;
  private tx: Float32Array;
  private ty: Float32Array;
  private rm: Float32Array;
  private buckets: { color: string; idx: Uint16Array }[];
  style: Required<FurStyle>;
  /** 0..1，刺猬炸刺时刺朝外法线竖起 */
  bristle = 0;
  /** 乱毛总量（0..1 左右），给动物脑子判断"被逆毛了" */
  messiness = 0;
  /** 逆毛处的反光颜色（像丝绒被逆着摸时发亮） */
  sheen = '#fff6e6';

  constructor(
    public host: FurHost,
    seeds: StrandSeed[],
    style: FurStyle,
  ) {
    this.style = {
      kind: 'fur',
      freq: 4.5,
      damping: 0.32,
      drag: 0.9,
      ruffle: 1,
      tip: '#fff',
      alpha: 0.92,
      ...style,
    };
    const n = (this.n = seeds.length);
    const f = () => new Float32Array(n);
    this.lx = f();
    this.ly = f();
    this.ang = f();
    this.outAng = f();
    this.len = f();
    this.jitter = f();
    this.bx = f();
    this.by = f();
    this.vx = f();
    this.vy = f();
    this.rx = f();
    this.ry = f();
    this.px = f();
    this.py = f();
    this.cx = f();
    this.cy = f();
    this.tx = f();
    this.ty = f();
    this.rm = f();
    const rand = rng(n * 7919 + 17);
    const groups = new Map<string, { r: number; g: number; b: number; list: number[] }>();
    seeds.forEach((s, i) => {
      this.lx[i] = s.x;
      this.ly[i] = s.y;
      this.ang[i] = s.angle;
      this.outAng[i] = s.out ?? s.angle;
      this.len[i] = s.len;
      this.jitter[i] = (rand() - 0.5) * 1.6;
      const key = `${s.r >> 4},${s.g >> 4},${s.b >> 4}`;
      let gr = groups.get(key);
      if (!gr) groups.set(key, (gr = { r: 0, g: 0, b: 0, list: [] }));
      gr.r += s.r;
      gr.g += s.g;
      gr.b += s.b;
      gr.list.push(i);
    });
    this.buckets = [...groups.values()].map(g => {
      const k = g.list.length;
      return {
        color: `rgb(${Math.round(g.r / k)},${Math.round(g.g / k)},${Math.round(g.b / k)})`,
        idx: Uint16Array.from(g.list),
      };
    });
  }

  /** 立即把乱毛梳顺（换动物、复位时用）。 */
  reset(): void {
    this.bx.fill(0);
    this.by.fill(0);
    this.vx.fill(0);
    this.vy.fill(0);
    this.rx.fill(0);
    this.ry.fill(0);
    this.messiness = 0;
  }

  update(dt: number, warp: Warp, touch: Touch): void {
    const host = this.host;
    if (!host.visible) return;
    const st = this.style;
    const w0 = Math.PI * 2 * st.freq;
    const kk = w0 * w0,
      cc = 2 * st.damping * w0;
    const spine = st.kind === 'spine';
    const speed = Math.hypot(touch.vx, touch.vy);
    const ux = speed > 1 ? touch.vx / speed : 0,
      uy = speed > 1 ? touch.vy / speed : 0;
    const pull = Math.min(1, speed / 520) * st.drag;
    const r2 = touch.r * touch.r;
    const ruffleDecay = Math.exp(-dt / 14);
    const h = Math.min(dt, 1 / 30);
    let mess = 0;
    for (let i = 0; i < this.n; i++) {
      host.toWorld(this.lx[i], this.ly[i], tmp);
      warp.apply(tmp.x, tmp.y, host.give, tmp);
      const X = tmp.x,
        Y = tmp.y;
      const a = this.ang[i] + (this.outAng[i] - this.ang[i]) * this.bristle + host.angleAt(this.lx[i], this.ly[i]);
      const dx = Math.cos(a),
        dy = Math.sin(a);
      let tgx = 0,
        tgy = 0,
        flat = 1;
      if (touch.active) {
        const ex = X - touch.x,
          ey = Y - touch.y;
        const q = (ex * ex + ey * ey) / r2;
        if (q < 4) {
          const w = Math.exp(-q * 1.2) * touch.p;
          const d = Math.sqrt(ex * ex + ey * ey) || 1;
          if (spine) {
            tgx = (ux * pull * 0.25 + (ex / d) * 0.08) * w;
            tgy = (uy * pull * 0.25 + (ey / d) * 0.08) * w;
            flat = 1 - 0.18 * w;
          } else {
            tgx = (ux * pull + (ex / d) * 0.3) * w;
            tgy = (uy * pull + (ey / d) * 0.3) * w;
            flat = 1 - 0.32 * w;
            if (st.ruffle > 0 && speed > 50 && w > 0.15) {
              const along = ux * dx + uy * dy;
              if (along < -0.25) {
                const j = this.jitter[i];
                const c = Math.cos(j),
                  s = Math.sin(j);
                const k = w * dt * 3.2 * st.ruffle * Math.min(1, speed / 400);
                this.rx[i] += (ux * c - uy * s) * k * 2 - dx * k * 0.5;
                this.ry[i] += (ux * s + uy * c) * k * 2 - dy * k * 0.5;
              } else if (along > 0.3) {
                const s = Math.exp(-dt * w * 7 * along);
                this.rx[i] *= s;
                this.ry[i] *= s;
              }
            }
          }
        }
      }
      // 乱毛：衰减并限幅
      let rx = this.rx[i] * ruffleDecay,
        ry = this.ry[i] * ruffleDecay;
      const rl = Math.hypot(rx, ry);
      if (rl > 1.1) {
        rx *= 1.1 / rl;
        ry *= 1.1 / rl;
      }
      this.rx[i] = rx;
      this.ry[i] = ry;
      this.rm[i] = Math.min(1.1, rl);
      mess += rl;
      // 弹簧：弯曲量 b 追随目标
      let bvx = this.vx[i] + (kk * (tgx - this.bx[i]) - cc * this.vx[i]) * h;
      let bvy = this.vy[i] + (kk * (tgy - this.by[i]) - cc * this.vy[i]) * h;
      this.vx[i] = bvx;
      this.vy[i] = bvy;
      const bx = (this.bx[i] += bvx * h);
      const by = (this.by[i] += bvy * h);
      const L = this.len[i] * flat;
      let ox = dx + bx + rx,
        oy = dy + by + ry;
      const ol = Math.hypot(ox, oy) || 1;
      const lim = clamp(ol, 0.4, 1.35);
      ox = (ox / ol) * lim;
      oy = (oy / ol) * lim;
      this.px[i] = X;
      this.py[i] = Y;
      this.cx[i] = X + (dx * 0.5 + (bx + rx) * 0.12) * L;
      this.cy[i] = Y + (dy * 0.5 + (by + ry) * 0.12) * L;
      this.tx[i] = X + ox * L;
      this.ty[i] = Y + oy * L;
    }
    this.messiness = mess / Math.max(1, this.n);
  }

  draw(g: CanvasRenderingContext2D): void {
    const host = this.host;
    if (!host.visible) return;
    const st = this.style;
    g.save();
    g.globalAlpha *= st.alpha * host.alpha;
    g.lineCap = 'round';
    g.lineWidth = st.width;
    for (const b of this.buckets) {
      g.beginPath();
      const idx = b.idx;
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        g.moveTo(this.px[i], this.py[i]);
        g.quadraticCurveTo(this.cx[i], this.cy[i], this.tx[i], this.ty[i]);
      }
      g.strokeStyle = b.color;
      g.stroke();
    }
    if (this.messiness > 0.004 && st.kind !== 'spine') {
      // 逆毛反光：乱掉的毛露出更亮的一面，越乱越亮
      for (const [lo, hi, a] of [
        [0.3, 0.65, 0.2],
        [0.65, 9, 0.38],
      ]) {
        g.beginPath();
        let any = false;
        for (let i = 0; i < this.n; i++) {
          const r = this.rm[i];
          if (r < lo || r >= hi) continue;
          any = true;
          g.moveTo((this.px[i] + this.tx[i]) * 0.5, (this.py[i] + this.ty[i]) * 0.5);
          g.lineTo(this.tx[i], this.ty[i]);
        }
        if (!any) continue;
        g.globalAlpha = st.alpha * host.alpha * a;
        g.strokeStyle = this.sheen;
        g.lineWidth = st.width * 0.85;
        g.stroke();
      }
      g.globalAlpha = st.alpha * host.alpha;
    }
    if (st.kind === 'spine') {
      g.beginPath();
      for (let i = 0; i < this.n; i++) {
        const sx = this.px[i] + (this.tx[i] - this.px[i]) * 0.62,
          sy = this.py[i] + (this.ty[i] - this.py[i]) * 0.62;
        g.moveTo(sx, sy);
        g.lineTo(this.tx[i], this.ty[i]);
      }
      g.strokeStyle = st.tip;
      g.lineWidth = st.width * 0.8;
      g.stroke();
    }
    g.restore();
  }
}

/** 让 Part 成为 FurHost。 */
export function partHost(part: Part): FurHost {
  return {
    get give() {
      return part.give;
    },
    get visible() {
      return part.visible;
    },
    get alpha() {
      return part.alpha;
    },
    toWorld(lx, ly, out) {
      out.x = part.m.x(lx, ly);
      out.y = part.m.y(lx, ly);
    },
    angleAt() {
      return part.m.rotation;
    },
  };
}

export interface SeedOptions {
  spacing: number;
  length: [number, number];
  grain: (x: number, y: number) => number;
  /** 0..1，返回该点长毛的概率（例如脸部留空） */
  mask?: (x: number, y: number) => number;
  /** 边缘绒毛 */
  edge?: { spacing: number; length: [number, number]; outward?: number; inset?: number };
  /** 颜色明暗随机幅度 */
  tone?: number;
  seed?: number;
  /** 指定颜色（不从纹理取色） */
  color?: (x: number, y: number) => [number, number, number];
}

/** 在部件轮廓内按抖动网格撒毛。 */
export function seedPart(part: Part, o: SeedOptions): StrandSeed[] {
  const rand = rng(o.seed ?? 1);
  const xs = part.local.map(p => p.x),
    ys = part.local.map(p => p.y);
  const n = part.n;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of part.local) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const out: StrandSeed[] = [];
  const tone = o.tone ?? 0.05;
  const colorAt = (x: number, y: number): [number, number, number] => {
    if (o.color) return o.color(x, y);
    const [r, g, b] = part.sample(x, y);
    return [r, g, b];
  };
  const push = (x: number, y: number, angle: number, len: number, outA?: number) => {
    const [r, g, b] = colorAt(x, y);
    const k = 1 + (rand() - 0.45) * 2 * tone;
    out.push({
      x,
      y,
      angle,
      out: outA,
      len,
      r: clamp(r * k, 0, 255),
      g: clamp(g * k, 0, 255),
      b: clamp(b * k, 0, 255),
    });
  };
  const s = o.spacing;
  for (let y = y0; y <= y1; y += s * 0.86) {
    for (let x = x0; x <= x1; x += s) {
      const px = x + (rand() - 0.5) * s,
        py = y + (rand() - 0.5) * s;
      if (!pointInPolygon(px, py, xs, ys, n)) continue;
      if (o.mask && rand() > o.mask(px, py)) continue;
      const a = o.grain(px, py) + (rand() - 0.5) * 0.35;
      const len = o.length[0] + (o.length[1] - o.length[0]) * rand();
      push(px, py, a, len, a);
    }
  }
  if (o.edge) {
    const e = o.edge;
    let area = 0;
    for (let i = 0; i < n; i++) area += xs[i] * ys[(i + 1) % n] - xs[(i + 1) % n] * ys[i];
    const sign = area > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const ax = xs[i],
        ay = ys[i],
        bx = xs[(i + 1) % n],
        by = ys[(i + 1) % n];
      const seg = Math.hypot(bx - ax, by - ay);
      const cnt = Math.max(1, Math.round(seg / e.spacing));
      const nx = (sign * (by - ay)) / (seg || 1),
        ny = (-sign * (bx - ax)) / (seg || 1);
      for (let k = 0; k < cnt; k++) {
        const t = (k + rand()) / cnt;
        const inset = (e.inset ?? 3) + rand() * 2;
        const px = ax + (bx - ax) * t - nx * inset,
          py = ay + (by - ay) * t - ny * inset;
        if (o.mask && rand() > o.mask(px, py)) continue;
        const g = o.grain(px, py);
        const outA = Math.atan2(ny, nx);
        const w = e.outward ?? 0.6;
        const a = Math.atan2(Math.sin(g) * (1 - w) + ny * w, Math.cos(g) * (1 - w) + nx * w) + (rand() - 0.5) * 0.4;
        const len = e.length[0] + (e.length[1] - e.length[0]) * rand();
        push(px, py, a, len, outA);
      }
    }
  }
  return out;
}
