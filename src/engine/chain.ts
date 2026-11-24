import { Warp } from './deform';
import { FurHost, StrandSeed } from './fur';
import { Spring, Vec, clamp, rng } from './math';

/**
 * 尾巴等柔性链。局部坐标 (s, t)：s 为沿链距离，t∈[-1,1] 为横向（乘以半径）。
 */
export class Chain implements FurHost {
  readonly count: number;
  readonly seg: number;
  readonly length: number;
  rootX = 0;
  rootY = 0;
  rootAngle = 0;
  rest: number[];
  joints: Spring[];
  /** 每节额外目标角（摆尾、被抓等）。 */
  extra: number[];
  px: Float32Array;
  py: Float32Array;
  ang: Float32Array;
  give = 1;
  visible = true;
  alpha = 1;
  zone?: string;
  private lx: Float32Array;
  private ly: Float32Array;
  private rxs: Float32Array;
  private rys: Float32Array;

  constructor(
    length: number,
    rest: number[],
    public radius: (s: number) => number,
    freq = 2.6,
    damping = 0.45,
  ) {
    this.count = rest.length;
    this.length = length;
    this.seg = length / this.count;
    this.rest = rest.slice();
    this.joints = rest.map(r => new Spring(r, freq, damping));
    this.extra = rest.map(() => 0);
    const n = this.count + 1;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.ang = new Float32Array(n);
    this.lx = new Float32Array(n * 2);
    this.ly = new Float32Array(n * 2);
    this.rxs = new Float32Array(n * 2);
    this.rys = new Float32Array(n * 2);
  }

  step(dt: number): void {
    for (let i = 0; i < this.count; i++) this.joints[i].step(this.rest[i] + this.extra[i], dt);
    this.solve();
  }

  solve(): void {
    let x = this.rootX,
      y = this.rootY,
      a = this.rootAngle;
    this.px[0] = x;
    this.py[0] = y;
    for (let i = 0; i < this.count; i++) {
      a += this.joints[i].value;
      this.ang[i] = a;
      x += Math.cos(a) * this.seg;
      y += Math.sin(a) * this.seg;
      this.px[i + 1] = x;
      this.py[i + 1] = y;
    }
    this.ang[this.count] = a;
  }

  private locate(s: number): { i: number; f: number } {
    const u = clamp(s / this.seg, 0, this.count - 1e-6);
    const i = Math.floor(u);
    return { i, f: u - i };
  }

  toWorld(s: number, t: number, out: Vec): void {
    const { i, f } = this.locate(s);
    const x = this.px[i] + (this.px[i + 1] - this.px[i]) * f;
    const y = this.py[i] + (this.py[i + 1] - this.py[i]) * f;
    const a = this.angleAt(s);
    const r = this.radius(s) * t;
    out.x = x - Math.sin(a) * r;
    out.y = y + Math.cos(a) * r;
  }

  angleAt(s: number): number {
    const { i, f } = this.locate(s);
    const a0 = i === 0 ? this.ang[0] : (this.ang[i - 1] + this.ang[i]) / 2;
    const a1 = (this.ang[i] + this.ang[i + 1]) / 2;
    return a0 + (a1 - a0) * f;
  }

  /** 计算形变后的左右轮廓。 */
  update(warp: Warp): void {
    const n = this.count + 1,
      o = { x: 0, y: 0 };
    for (let k = 0; k < n; k++) {
      const s = (k / this.count) * this.length;
      this.toWorld(s, -1, o);
      warp.apply(o.x, o.y, this.give, o);
      this.lx[k] = o.x;
      this.ly[k] = o.y;
      this.toWorld(s, 1, o);
      warp.apply(o.x, o.y, this.give, o);
      this.rxs[k] = o.x;
      this.rys[k] = o.y;
    }
  }

  path(g: CanvasRenderingContext2D): void {
    const n = this.count + 1;
    g.beginPath();
    g.moveTo(this.lx[0], this.ly[0]);
    for (let k = 1; k < n; k++) {
      const mx = (this.lx[k - 1] + this.lx[k]) / 2,
        my = (this.ly[k - 1] + this.ly[k]) / 2;
      g.quadraticCurveTo(this.lx[k - 1], this.ly[k - 1], mx, my);
    }
    // 圆头尾尖
    const ex = this.px[n - 1],
      ey = this.py[n - 1];
    const tip = this.radius(this.length);
    const a = this.ang[this.count];
    g.lineTo(this.lx[n - 1], this.ly[n - 1]);
    g.quadraticCurveTo(ex + Math.cos(a) * tip * 1.6, ey + Math.sin(a) * tip * 1.6, this.rxs[n - 1], this.rys[n - 1]);
    for (let k = n - 1; k > 0; k--) {
      const mx = (this.rxs[k] + this.rxs[k - 1]) / 2,
        my = (this.rys[k] + this.rys[k - 1]) / 2;
      g.quadraticCurveTo(this.rxs[k], this.rys[k], mx, my);
    }
    g.lineTo(this.rxs[0], this.rys[0]);
    g.closePath();
  }

  draw(g: CanvasRenderingContext2D, fill: string | CanvasGradient, stroke?: string, width = 3): void {
    if (!this.visible) return;
    g.save();
    g.globalAlpha *= this.alpha;
    this.path(g);
    g.fillStyle = fill;
    g.fill();
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = width;
      g.lineJoin = 'round';
      g.stroke();
    }
    g.restore();
  }

  /** 返回最近点的 s 与距离（未形变的骨架）。 */
  nearest(x: number, y: number): { s: number; d: number; r: number } {
    let best = Infinity,
      bs = 0;
    for (let i = 0; i < this.count; i++) {
      const ax = this.px[i],
        ay = this.py[i],
        bx = this.px[i + 1],
        by = this.py[i + 1];
      const dx = bx - ax,
        dy = by - ay;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1));
      const ex = ax + dx * t - x,
        ey = ay + dy * t - y;
      const d = ex * ex + ey * ey;
      if (d < best) {
        best = d;
        bs = (i + t) * this.seg;
      }
    }
    return { s: bs, d: Math.sqrt(best), r: this.radius(bs) };
  }

  contains(x: number, y: number, margin = 0): boolean {
    if (!this.visible) return false;
    const n = this.nearest(x, y);
    return n.d < n.r + margin;
  }
}

export function seedChain(
  chain: Chain,
  o: {
    spacing: number;
    length: [number, number];
    color: (s: number, t: number) => [number, number, number];
    tone?: number;
    seed?: number;
    /** 毛相对尾轴的外张角度 */
    splay?: number;
  },
): StrandSeed[] {
  const rand = rng(o.seed ?? 3);
  const out: StrandSeed[] = [];
  const tone = o.tone ?? 0.08;
  const splay = o.splay ?? 0.5;
  for (let s = 0; s < chain.length; s += o.spacing * 0.7) {
    const r = chain.radius(s);
    const across = Math.max(2, Math.round((2 * r) / o.spacing) + 1);
    for (let k = 0; k <= across; k++) {
      const t = clamp(-1 + (2 * (k + rand() * 0.8)) / across, -1, 1) * 0.92;
      const ss = s + rand() * o.spacing * 0.6;
      const [cr, cg, cb] = o.color(ss, t);
      const m = 1 + (rand() - 0.45) * 2 * tone;
      const angle = t * splay + (rand() - 0.5) * 0.3;
      out.push({
        x: ss,
        y: t,
        angle,
        out: Math.sign(t || 1) * 1.4,
        len: o.length[0] + (o.length[1] - o.length[0]) * rand(),
        r: clamp(cr * m, 0, 255),
        g: clamp(cg * m, 0, 255),
        b: clamp(cb * m, 0, 255),
      });
    }
  }
  return out;
}
