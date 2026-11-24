import { Spring, Spring2, clamp } from './math';

/**
 * 软体形变器：以 (x, y) 为中心、半径 r 的高斯区域内的点，整体偏移 off。
 * off 由阻尼弹簧驱动，手离开后会带回弹地复位，产生"果冻感"。
 */
export class Deformer {
  x = 0;
  y = 0;
  r = 60;
  tx = 0;
  ty = 0;
  /** 俯视按压时表面向四周摊开的量 */
  ts = 0;
  active = false;
  off = new Spring2(0, 0, 5.5, 0.42);
  spread = new Spring(0, 6, 0.45);
  step(dt: number): void {
    this.off.step(this.active ? this.tx : 0, this.active ? this.ty : 0, dt);
    this.spread.step(this.active ? this.ts : 0, dt);
  }
  get idle(): boolean {
    const o = this.off;
    return !this.active && Math.abs(o.x.value) + Math.abs(o.y.value) + Math.abs(this.spread.value) < 0.04 && Math.abs(o.x.velocity) + Math.abs(o.y.velocity) + Math.abs(this.spread.velocity) < 0.4;
  }
}

export class Warp {
  list: Deformer[] = [];
  private current: Deformer | null = null;

  /** 手接触某点时调用；tx/ty 为目标偏移（世界单位）。 */
  press(x: number, y: number, r: number, tx: number, ty: number, spread = 0): void {
    let d = this.current;
    if (!d) {
      d = new Deformer();
      this.list.push(d);
      if (this.list.length > 4) this.list.shift();
      this.current = d;
    }
    d.x = x;
    d.y = y;
    d.r = r;
    d.tx = tx;
    d.ty = ty;
    d.ts = spread;
    d.active = true;
  }
  release(): void {
    if (this.current) this.current.active = false;
    this.current = null;
  }
  /** 一次性冲击，例如拍一下。 */
  poke(x: number, y: number, r: number, vx: number, vy: number, spread = 0): void {
    const d = new Deformer();
    d.x = x;
    d.y = y;
    d.r = r;
    d.off.x.kick(vx);
    d.off.y.kick(vy);
    d.spread.kick(spread);
    this.list.push(d);
    if (this.list.length > 5) this.list.splice(this.list.indexOf(this.current!) === 0 ? 1 : 0, 1);
  }
  step(dt: number): void {
    for (const d of this.list) d.step(dt);
    this.list = this.list.filter(d => d === this.current || !d.idle);
  }
  /** 把世界坐标点按形变器位移；k 为该部件受影响的倍数。 */
  apply(x: number, y: number, k: number, out: { x: number; y: number }): void {
    let ox = 0,
      oy = 0;
    for (const d of this.list) {
      const dx = x - d.x,
        dy = y - d.y;
      const r2 = d.r * d.r;
      const q = (dx * dx + dy * dy) / r2;
      if (q > 6) continue;
      const w = Math.exp(-q);
      const sp = (d.spread.value * w) / d.r;
      ox += d.off.x.value * w + dx * sp;
      oy += d.off.y.value * w + dy * sp;
    }
    out.x = x + ox * k;
    out.y = y + oy * k;
  }
  /** 当前总形变强度，用于阴影等。 */
  get energy(): number {
    let e = 0;
    for (const d of this.list) e += Math.hypot(d.off.x.value, d.off.y.value);
    return clamp(e / 20);
  }
}
