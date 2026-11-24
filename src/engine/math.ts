export interface Vec {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;

export const clamp = (x: number, a = 0, b = 1): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (t: number): number => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
/** 帧率无关的指数趋近：tau 秒后走完约 63%。 */
export const follow = (a: number, b: number, dt: number, tau: number): number =>
  tau <= 0 ? b : a + (b - a) * -Math.expm1(-dt / tau);
export const len = (x: number, y: number): number => Math.hypot(x, y);
export const angleLerp = (a: number, b: number, t: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
};

/** 可复现的伪随机数（mulberry32）。 */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 阻尼弹簧。freq 为固有频率（Hz），damping 为阻尼比（1=临界阻尼，<1 会回弹）。
 * 内部分步积分，大 dt 也稳定。
 */
export class Spring {
  value: number;
  velocity = 0;
  constructor(
    value = 0,
    public freq = 4,
    public damping = 0.6,
  ) {
    this.value = value;
  }
  step(target: number, dt: number): number {
    const w = TAU * this.freq;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = w * w * (target - this.value) - 2 * this.damping * w * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  kick(v: number): void {
    this.velocity += v;
  }
}

export class Spring2 {
  x: Spring;
  y: Spring;
  constructor(x = 0, y = 0, freq = 4, damping = 0.6) {
    this.x = new Spring(x, freq, damping);
    this.y = new Spring(y, freq, damping);
  }
  step(tx: number, ty: number, dt: number): void {
    this.x.step(tx, dt);
    this.y.step(ty, dt);
  }
  get vx(): number {
    return this.x.value;
  }
  get vy(): number {
    return this.y.value;
  }
}

export function pointInPolygon(px: number, py: number, xs: Float32Array | number[], ys: Float32Array | number[], n: number): boolean {
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = ys[i],
      yj = ys[j];
    if (yi > py !== yj > py) {
      const xi = xs[i],
        xj = xs[j];
      if (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** 点到多边形边界的最近距离。 */
export function distanceToPolygon(px: number, py: number, xs: Float32Array | number[], ys: Float32Array | number[], n: number): number {
  let best = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = xs[j],
      ay = ys[j],
      bx = xs[i],
      by = ys[i];
    const dx = bx - ax,
      dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2);
    const ex = ax + dx * t - px,
      ey = ay + dy * t - py;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** 椭圆轮廓点（局部坐标）。 */
export function ellipse(cx: number, cy: number, rx: number, ry: number, n = 40, rot = 0): Vec[] {
  const out: Vec[] = [];
  const c = Math.cos(rot),
    s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const x = Math.cos(a) * rx,
      y = Math.sin(a) * ry;
    out.push({ x: cx + x * c - y * s, y: cy + x * s + y * c });
  }
  return out;
}

/**
 * 用极坐标半径函数生成轮廓，便于做"上平下圆"等不规则形状。
 * r(a) 返回该角度方向的半径倍数。
 */
export function radial(cx: number, cy: number, rx: number, ry: number, r: (a: number) => number, n = 48): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = r(a);
    out.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k });
  }
  return out;
}

/** 闭合的平滑曲线（Catmull-Rom 转贝塞尔）。 */
export function smoothClosedPath(g: CanvasRenderingContext2D | Path2D, xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, tension = 1): void {
  if (n < 3) return;
  const k = tension / 6;
  g.moveTo(xs[0], ys[0]);
  for (let i = 0; i < n; i++) {
    const i0 = (i - 1 + n) % n,
      i2 = (i + 1) % n,
      i3 = (i + 2) % n;
    const c1x = xs[i] + (xs[i2] - xs[i0]) * k;
    const c1y = ys[i] + (ys[i2] - ys[i0]) * k;
    const c2x = xs[i2] - (xs[i3] - xs[i]) * k;
    const c2y = ys[i2] - (ys[i3] - ys[i]) * k;
    g.bezierCurveTo(c1x, c1y, c2x, c2y, xs[i2], ys[i2]);
  }
  g.closePath();
}
