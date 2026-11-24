import { Spring, clamp, follow } from './math';

/**
 * 手掌接触形变：俯视写实动物（PhotoSkin 网格）被手摸时皮肤怎么动、明暗怎么变。
 *
 * 手掌下是一块沿手方向的椭圆"接触斑"：
 * - 剪切（shear）：皮肤被手拖着走，手停下后像弹簧一样弹回；
 * - 压缩（compression）：斑内往下陷，向中心收、略向下移，背光一侧变暗；
 * - 肩（shoulder）：斑外一圈被挤得鼓起，迎光一侧变亮；
 * - 皮褶（bank）：手前进方向的前方堆起一道，迎光面亮；
 * - 托起（lift）：按住不动一会儿，周围微微隆起迎合手掌；
 * - 跟随（tissue）：前半身整体随拖动轻微平移；
 * - 光泽（trail）和梳痕（comb）：手经过后留下短暂的顺毛/逆毛光泽和皮肤位移，1 秒内恢复。
 *
 * 内部长度单位为 U 像素（约为猫身长的 1.4 倍），这样各种系数和体型无关。
 * 光从左上方来。
 */

export interface PressPad {
  /** 图片像素 */
  x: number;
  y: number;
  /** 半径（像素） */
  r: number;
  /** 0..1，指腹在毛上的覆盖程度 */
  cover: number;
}

export interface PressInput {
  /** 接触中心（图片像素） */
  x: number;
  y: number;
  /** 手的速度（图片像素/秒） */
  vx: number;
  vy: number;
  /** 手的轴向：指尖 → 掌根（单位向量） */
  axisX: number;
  axisY: number;
  /** 接触斑半长、半宽（像素） */
  length: number;
  width: number;
  /** 0..1 */
  pressure: number;
  /** 0..1：接触处是头骨，皮肤滑动少 */
  skull: number;
  tail: boolean;
  pads: PressPad[];
}

export interface PressVertices {
  /** 静止位置（图片像素） */
  x: Float32Array;
  y: Float32Array;
  /** 皮肤可滑动量（头骨上少） */
  travel: Float32Array;
  /** 胸背软组织（跟随拖动） */
  chest: Float32Array;
  /** 头部权重 */
  head: Float32Array;
  /** 毛流方向（单位向量） */
  furX: Float32Array;
  furY: Float32Array;
}

const bell = (x: number, y: number) => Math.exp(-x * x - y * y);
const smoothstep = (a: number, b: number, x: number) => {
  const f = clamp((x - a) / (b - a));
  return f * f * (3 - 2 * f);
};

export class SkinPress {
  /** 接触中心、轴向、尺寸（单位 U） */
  x = 0;
  y = 0;
  axisX = 0;
  axisY = 1;
  length = 0.044;
  width = 0.05;
  dirX = 1;
  dirY = 0;
  /** 手在滑动的程度 0..1 */
  glide = 0;
  /** 按住的时间（秒） */
  held = 0;
  active = false;
  /** 按在头骨上的程度（头会被轻轻压歪） */
  head = 0;
  shearX = new Spring(0, 4.9, 0.81);
  shearY = new Spring(0, 4.9, 0.81);
  shoulderX = 0;
  shoulderY = 0;
  load = new Spring(0, 4.35, 0.83);
  bulk = new Spring(0, 2.65, 0.9);
  lift = new Spring(0, 2.75, 0.87);
  private pads: PressPad[] = [];
  /** 每个顶点：光泽、梳痕 */
  private trail: Float32Array;
  private combX: Float32Array;
  private combY: Float32Array;
  /** 输出：顶点位移（像素）与明暗 */
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  readonly shade: Float32Array;
  readonly gloss: Float32Array;

  private o: { combTravel: number; combRelax: number; trailFade: number; give: number };

  constructor(
    private v: PressVertices,
    /** 每个参考单位多少图片像素 */
    readonly U: number,
    /** give：皮肤柔软度（猫为 1；鳞片、仙人球很小），同时缩放拖动和下陷 */
    o: Partial<{ combTravel: number; combRelax: number; trailFade: number; give: number }> = {},
  ) {
    this.o = { combTravel: 0.46, combRelax: 0.43, trailFade: 0.84, give: 1, ...o };
    const n = v.x.length;
    this.trail = new Float32Array(n);
    this.combX = new Float32Array(n);
    this.combY = new Float32Array(n);
    this.dx = new Float32Array(n);
    this.dy = new Float32Array(n);
    this.shade = new Float32Array(n);
    this.gloss = new Float32Array(n);
  }

  /** 推进状态，并算出每个顶点的位移和明暗。 */
  step(dt: number, input: PressInput | null): void {
    const U = this.U;
    const p = input ? clamp(input.pressure) : 0;
    const active = p > 0.025 && !!input;
    const skull = active && !input!.tail ? input!.skull : 0;
    const compliance = 1 - 0.34 * skull;
    const give = this.o.give;
    const transfer = (input?.tail ? 0.16 : compliance) * give;
    let pullX = 0,
      pullY = 0;
    if (active) {
      const i = input!;
      this.held += dt;
      this.x = i.x / U;
      this.y = i.y / U;
      this.axisX = i.axisX;
      this.axisY = i.axisY;
      this.length = i.length / U;
      this.width = i.width / U;
      this.pads = i.pads;
      const vx = clamp(i.vx / U, -0.9, 0.9),
        vy = clamp(i.vy / U, -0.9, 0.9);
      const speed = Math.hypot(vx, vy);
      const moving = Math.tanh(6.6 * speed);
      if (speed > 0.006) {
        this.dirX = vx / speed;
        this.dirY = vy / speed;
      }
      this.glide = follow(this.glide, moving, dt, 0.071);
      pullX = 0.04 * moving * this.dirX * p * transfer;
      pullY = 0.04 * moving * this.dirY * p * transfer;
    } else {
      this.held = 0;
      this.glide = follow(this.glide, 0, dt, 0.13);
    }
    this.shearX.step(pullX, dt);
    this.shearY.step(pullY, dt);
    const shoulder = input?.tail ? 0 : 1;
    this.shoulderX = follow(this.shoulderX, pullX * 0.42 * shoulder, dt, 0.19);
    this.shoulderY = follow(this.shoulderY, pullY * 0.38 * shoulder, dt, 0.21);
    this.active = active;
    this.head = follow(this.head, p * skull, dt, active ? 0.17 : 0.43);
    // 硬的东西几乎不下陷，只留一点手掌压住的明暗
    const catLoad = (input?.tail ? 0.38 : compliance) * (0.1 + 0.9 * give);
    this.load.step(active ? catLoad * (0.77 * Math.pow(p, 0.75) + 0.23 * smoothstep(0.56, 1, p)) : 0, dt);
    this.bulk.step(active ? catLoad * p : 0, dt);
    this.lift.step(active ? catLoad * smoothstep(0.19, 0.78, this.held) * Math.sqrt(p) : 0, dt);

    // ---------- 每个顶点 ----------
    const v = this.v;
    const fade = Math.exp(-dt / this.o.trailFade),
      relax = Math.exp(-dt / this.o.combRelax);
    const deposit = -Math.expm1(-dt * (13 + 15 * this.glide));
    const load = this.load.value,
      bulk = this.bulk.value,
      lift = this.lift.value;
    const sx = this.shearX.value,
      sy = this.shearY.value;
    const { axisX, axisY, dirX, dirY, glide } = this;
    const len = this.length,
      wid = this.width;
    const pressing = load > 0.001 || lift > 0.001;
    const marking = active && glide > 0.035;
    const pads = this.pads;
    const ct = this.o.combTravel;
    for (let k = 0; k < v.x.length; k++) {
      const ux = v.x[k] / U,
        uy = v.y[k] / U;
      const x = ux - this.x,
        y = uy - this.y;
      const travel = v.travel[k],
        chest = v.chest[k],
        hw = v.head[k];
      // 顺毛 +1，逆毛 -1
      const withGrain = glide * clamp(dirX * v.furX[k] + dirY * v.furY[k], -1, 1);
      let trail = this.trail[k] * fade,
        cx = this.combX[k] * relax,
        cy = this.combY[k] * relax;
      if (marking && Math.abs(x) < 0.2 && Math.abs(y) < 0.18) {
        const a = (x * axisX + y * axisY) / (len + 0.02),
          b = (-x * axisY + y * axisX) / (wid + 0.014);
        const set = deposit * bell(a, b);
        trail += (withGrain * load * 1.65 - trail) * set;
        cx += (sx * ct - cx) * set;
        cy += (sy * ct - cy) * set;
      }
      this.trail[k] = trail;
      this.combX[k] = cx;
      this.combY[k] = cy;
      let dx = travel * chest * this.shoulderX * (0.42 + 0.58 * hw) + travel * cx,
        dy = travel * chest * this.shoulderY * (0.47 + 0.53 * hw) + travel * cy;
      let shade = 0,
        gloss = trail;
      if (pressing && Math.abs(x) < 0.3 && Math.abs(y) < 0.3) {
        const along = x * axisX + y * axisY,
          across = -x * axisY + y * axisX;
        const patch = bell(along / (len + 0.045), across / (wid + 0.018));
        const broad = bell(along / 0.162, across / 0.136);
        const front = x * dirX + y * dirY,
          side = -x * dirY + y * dirX;
        const bank = glide * bell((front - 0.068) / 0.04, side / (wid + 0.02));
        let fingers = 0;
        if (Math.abs(x) < 0.13 && Math.abs(y) < 0.13)
          for (const pd of pads) {
            const r = pd.r / U;
            const fx = (ux - pd.x / U) / r,
              fy = (uy - pd.y / U) / r;
            if (Math.abs(fx) > 2 || Math.abs(fy) > 2) continue;
            fingers = Math.max(fingers, pd.cover * bell(fx, fy));
          }
        const compression = 0.65 * patch + 0.35 * fingers;
        const grip = 0.8 * patch + 0.24 * fingers + 0.47 * bank;
        const shoulder = broad * (1 - compression);
        // 斑内往中心收、略向下（压下去离镜头更远）；斑外鼓起；按久了托起
        const pressX = grip * sx + compression * load * (-0.003 - 0.15 * x) + 0.003 * broad * lift + shoulder * bulk * 0.11 * x;
        const pressY = grip * sy + compression * load * (0.026 - 0.21 * y) + broad * (0.0055 * bulk - 0.0086 * lift) + shoulder * bulk * 0.1 * y;
        dx += travel * pressX;
        dy += travel * pressY;
        const lightSide = clamp((-0.8 * x - 0.6 * y) / 0.078, -1.1, 1.1);
        shade = load * (patch * (-0.15 - 0.29 * lightSide) - 0.072 * fingers + shoulder * 0.105 * lightSide + bank * (0.23 + 0.16 * lightSide));
        gloss += patch * withGrain * 0.34 + 0.15 * bank;
      }
      this.dx[k] = dx * U;
      this.dy[k] = dy * U;
      this.shade[k] = shade;
      this.gloss[k] = gloss;
    }
  }

  reset(): void {
    this.trail.fill(0);
    this.combX.fill(0);
    this.combY.fill(0);
    for (const s of [this.shearX, this.shearY, this.load, this.bulk, this.lift]) {
      s.value = 0;
      s.velocity = 0;
    }
    this.shoulderX = this.shoulderY = this.glide = this.head = this.held = 0;
  }
}
