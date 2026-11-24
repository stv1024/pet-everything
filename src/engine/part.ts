import { Warp } from './deform';
import { Vec, distanceToPolygon, pointInPolygon, smoothClosedPath } from './math';

/** 仿射变换，与 canvas setTransform 的参数一致。 */
export class Affine {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  /** world = T(x,y) · R(rot) · S(sx,sy) · T(-px,-py) · local */
  set(x: number, y: number, rot = 0, sx = 1, sy = 1, px = 0, py = 0): this {
    const cos = Math.cos(rot),
      sin = Math.sin(rot);
    this.a = cos * sx;
    this.b = sin * sx;
    this.c = -sin * sy;
    this.d = cos * sy;
    this.e = x - (this.a * px + this.c * py);
    this.f = y - (this.b * px + this.d * py);
    return this;
  }
  /** this = parent · this */
  premul(p: Affine): this {
    const { a, b, c, d, e, f } = this;
    this.a = p.a * a + p.c * b;
    this.b = p.b * a + p.d * b;
    this.c = p.a * c + p.c * d;
    this.d = p.b * c + p.d * d;
    this.e = p.a * e + p.c * f + p.e;
    this.f = p.b * e + p.d * f + p.f;
    return this;
  }
  copy(o: Affine): this {
    this.a = o.a;
    this.b = o.b;
    this.c = o.c;
    this.d = o.d;
    this.e = o.e;
    this.f = o.f;
    return this;
  }
  x(x: number, y: number): number {
    return this.a * x + this.c * y + this.e;
  }
  y(x: number, y: number): number {
    return this.b * x + this.d * y + this.f;
  }
  get rotation(): number {
    return Math.atan2(this.b, this.a);
  }
  /** 世界坐标 → 局部坐标 */
  invert(x: number, y: number, out: Vec): Vec {
    const det = this.a * this.d - this.b * this.c || 1e-9;
    const dx = x - this.e,
      dy = y - this.f;
    out.x = (this.d * dx - this.c * dy) / det;
    out.y = (-this.b * dx + this.a * dy) / det;
    return out;
  }
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boundsOf(pts: Vec[], pad = 0): Bounds {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

/** 沿法线外扩轮廓。 */
export function expand(pts: Vec[], pad: number): Vec[] {
  const n = pts.length;
  // 轮廓方向：用面积符号判断顺/逆时针，保证法线朝外
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i],
      q = pts[(i + 1) % n];
    area += p.x * q.y - q.x * p.y;
  }
  const sign = area > 0 ? 1 : -1;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n],
      b = pts[(i + 1) % n];
    const tx = b.x - a.x,
      ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    return { x: p.x + (sign * ty * pad) / l, y: p.y - (sign * tx * pad) / l };
  });
}

export function outlinePath(pts: Vec[]): Path2D {
  const p = new Path2D();
  smoothClosedPath(
    p,
    pts.map(v => v.x),
    pts.map(v => v.y),
    pts.length,
  );
  return p;
}

export type Painter = (g: CanvasRenderingContext2D, outline: Path2D, b: Bounds) => void;

export const TEXTURE_SCALE = 2;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export interface PartOptions {
  outline: Vec[];
  /** 可抚摸区域名；不填则不参与命中。 */
  zone?: string;
  paint: Painter;
  /** 形变影响系数。 */
  give?: number;
  /** 纹理外扩，避免形变后边缘露底。 */
  pad?: number;
  /** 轮廓描边颜色（插画风格的硬边动物用）。 */
  stroke?: string;
  strokeWidth?: number;
}

/**
 * 一个刚性部件：静止轮廓 + 预渲染纹理。每帧由 m（局部→世界）摆位，
 * 再经 Warp 形变得到实际轮廓；纹理按 m 绘制并裁剪到形变后的轮廓里。
 */
export class Part {
  m = new Affine();
  zone?: string;
  give: number;
  readonly local: Vec[];
  readonly n: number;
  readonly wx: Float32Array;
  readonly wy: Float32Array;
  texture: HTMLCanvasElement;
  pixels: Uint8ClampedArray;
  tb: Bounds;
  stroke?: string;
  strokeWidth: number;
  visible = true;
  alpha = 1;

  constructor(o: PartOptions) {
    this.local = o.outline;
    this.n = o.outline.length;
    this.zone = o.zone;
    this.give = o.give ?? 1;
    this.stroke = o.stroke;
    this.strokeWidth = o.strokeWidth ?? 3;
    this.wx = new Float32Array(this.n);
    this.wy = new Float32Array(this.n);
    const pad = o.pad ?? 14;
    const tb = (this.tb = boundsOf(o.outline, pad + 2));
    const c = (this.texture = makeCanvas(tb.w * TEXTURE_SCALE, tb.h * TEXTURE_SCALE));
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.scale(TEXTURE_SCALE, TEXTURE_SCALE);
    g.translate(-tb.x, -tb.y);
    g.save();
    g.clip(outlinePath(expand(o.outline, pad)));
    o.paint(g, outlinePath(o.outline), boundsOf(o.outline));
    g.restore();
    this.pixels = g.getImageData(0, 0, c.width, c.height).data;
  }

  /** 读取纹理在局部坐标处的颜色。 */
  sample(x: number, y: number): [number, number, number, number] {
    const tb = this.tb,
      c = this.texture;
    const px = Math.min(c.width - 1, Math.max(0, Math.round((x - tb.x) * TEXTURE_SCALE)));
    const py = Math.min(c.height - 1, Math.max(0, Math.round((y - tb.y) * TEXTURE_SCALE)));
    const i = (py * c.width + px) * 4;
    const d = this.pixels;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  update(warp: Warp): void {
    const m = this.m,
      out = { x: 0, y: 0 };
    for (let i = 0; i < this.n; i++) {
      const p = this.local[i];
      warp.apply(m.x(p.x, p.y), m.y(p.x, p.y), this.give, out);
      this.wx[i] = out.x;
      this.wy[i] = out.y;
    }
  }

  path(g: CanvasRenderingContext2D): void {
    g.beginPath();
    smoothClosedPath(g, this.wx, this.wy, this.n);
  }

  draw(g: CanvasRenderingContext2D): void {
    if (!this.visible) return;
    g.save();
    if (this.alpha < 1) g.globalAlpha *= this.alpha;
    this.path(g);
    g.clip();
    const m = this.m;
    g.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    const tb = this.tb;
    g.drawImage(this.texture, tb.x, tb.y, tb.w, tb.h);
    g.restore();
    if (this.stroke) {
      g.save();
      if (this.alpha < 1) g.globalAlpha *= this.alpha;
      this.path(g);
      g.strokeStyle = this.stroke;
      g.lineWidth = this.strokeWidth;
      g.lineJoin = 'round';
      g.stroke();
      g.restore();
    }
  }

  contains(x: number, y: number, margin = 0): boolean {
    if (!this.visible) return false;
    if (pointInPolygon(x, y, this.wx, this.wy, this.n)) return true;
    return margin > 0 && distanceToPolygon(x, y, this.wx, this.wy, this.n) < margin;
  }

  /** 世界坐标的轮廓中心（粗略）。 */
  center(): Vec {
    let x = 0,
      y = 0;
    for (let i = 0; i < this.n; i++) {
      x += this.wx[i];
      y += this.wy[i];
    }
    return { x: x / this.n, y: y / this.n };
  }
}
