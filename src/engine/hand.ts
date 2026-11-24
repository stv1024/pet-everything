import { Spring, Spring2, clamp, follow } from './math';

/**
 * 卡通手（手背朝上），手臂从屏幕下方伸进来。全部用代码绘制。
 * 局部坐标：掌心在原点，手指朝 -y。单位是世界单位。
 */
interface Finger {
  x: number;
  y: number;
  a: number;
  len: number;
  w: number;
  lag: Spring;
}

const SKIN = '#f6c7a4';
const SKIN_DARK = '#e6a582';
const LINE = '#a8684c';
const NAIL = '#fde3d3';

export class Hand {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** 0=贴着表面，1=悬空 */
  lift = new Spring(1, 7, 0.75);
  /** 额外按压（鼠标按下） */
  press = new Spring(0, 9, 0.7);
  /** 被刺/被咬时的抽手偏移 */
  recoil = new Spring2(0, 0, 3.2, 0.55);
  /** 手腕左右摆 */
  tilt = new Spring(0, 5, 0.6);
  /** 手指张开程度 */
  spread = new Spring(0, 6, 0.5);
  /** 抖动（被抓住） */
  shiver = 0;
  size = 1;
  visible = false;
  alpha = 0;
  /** 写实手：照片、掌心锚点（图片像素）、缩放 */
  photo: { img: HTMLImageElement; ax: number; ay: number; scale: number } | null = null;
  /** 袖子颜色 */
  sleeve = '#7f9cc9';
  cuff = '#6884b4';
  private fingers: Finger[];
  private thumb: Finger;
  private time = 0;

  constructor() {
    const f = (x: number, y: number, a: number, len: number, w: number, hz: number): Finger => ({ x, y, a, len, w, lag: new Spring(0, hz, 0.5) });
    this.fingers = [f(-25, -22, -0.2, 40, 16.5, 5.2), f(-8.5, -27, -0.06, 48, 17.5, 4.6), f(8.5, -26, 0.06, 46, 17, 4.9), f(24, -20, 0.2, 36, 15, 5.6)];
    this.thumb = f(-33, 8, -1.05, 36, 19, 4.4);
  }

  /** 设置目标点并推进动画。touching：是否贴在动物身上；pressing：是否额外按压。 */
  step(dt: number, tx: number, ty: number, touching: boolean, pressing: number): void {
    this.time += dt;
    this.recoil.step(0, 0, dt);
    const nx = follow(this.x, tx, dt, 0.028),
      ny = follow(this.y, ty, dt, 0.028);
    const ivx = (nx - this.x) / Math.max(dt, 1e-4),
      ivy = (ny - this.y) / Math.max(dt, 1e-4);
    this.vx = follow(this.vx, ivx, dt, 0.045);
    this.vy = follow(this.vy, ivy, dt, 0.045);
    this.x = nx;
    this.y = ny;
    this.lift.step(touching ? 0 : 1, dt);
    this.press.step(pressing, dt);
    this.tilt.step(clamp(this.vx / 2600, -0.3, 0.3), dt);
    this.spread.step(touching ? 0.6 + 0.4 * pressing : 0, dt);
    const sideways = clamp(this.vx / 900, -1.5, 1.5);
    const along = clamp(this.vy / 900, -1.5, 1.5);
    for (const [i, fg] of [...this.fingers, this.thumb].entries()) {
      fg.lag.step(-sideways * (0.08 + i * 0.012) + along * 0.02, dt);
    }
    this.alpha = follow(this.alpha, this.visible ? 1 : 0, dt, 0.08);
  }


  /** 实际绘制位置（含抽手偏移和抖动）。 */
  get drawX(): number {
    return this.x + this.recoil.x.value + (this.shiver ? Math.sin(this.time * 70) * this.shiver * 4 : 0);
  }
  get drawY(): number {
    return this.y + this.recoil.y.value + (this.shiver ? Math.cos(this.time * 63) * this.shiver * 3 : 0);
  }

  kick(dx: number, dy: number): void {
    this.recoil.x.kick(dx);
    this.recoil.y.kick(dy);
  }

  private shapes(curl: number, spread: number): { finger: Path2D; palm: Path2D; m: DOMMatrix }[] {
    const out: { finger: Path2D; palm: Path2D; m: DOMMatrix }[] = [];
    for (const f of [...this.fingers, this.thumb]) {
      const isThumb = f === this.thumb;
      const a = f.a * (1 + spread * (isThumb ? 0.18 : 0.9)) + f.lag.value;
      const L = f.len * (1 - curl * (isThumb ? 0.1 : 0.16));
      const p = new Path2D();
      p.roundRect(-f.w / 2, -L, f.w, L + 14, f.w / 2);
      const m = new DOMMatrix().translateSelf(f.x * (1 + spread * 0.05), f.y).rotateSelf((a * 180) / Math.PI);
      out.push({ finger: p, palm: p, m });
    }
    return out;
  }

  private palm(): Path2D {
    const p = new Path2D();
    p.moveTo(-26, 46);
    p.bezierCurveTo(-34, 24, -40, 0, -36, -18);
    p.bezierCurveTo(-33, -34, 33, -36, 36, -20);
    p.bezierCurveTo(40, -2, 36, 26, 27, 46);
    p.closePath();
    return p;
  }

  draw(g: CanvasRenderingContext2D, rootX: number, rootY: number): void {
    if (this.alpha < 0.01) return;
    if (this.photo) {
      this.drawPhoto(g, rootX, rootY);
      return;
    }
    const lift = clamp(this.lift.value, -0.2, 1.3),
      press = clamp(this.press.value, 0, 1.2);
    const x = this.drawX,
      y = this.drawY;
    const ang = Math.atan2(y - rootY, x - rootX) + Math.PI / 2 + this.tilt.value;
    const s = this.size * (1 + 0.07 * lift - 0.035 * press);
    const curl = clamp(0.5 * lift + 0.15 - 0.25 * press, 0, 1);
    const spread = clamp(this.spread.value, 0, 1.2);
    const fingers = this.shapes(curl, spread);
    const palm = this.palm();
    // 袖子：从手腕到屏幕外
    const wristY = 50;
    const armLen = Math.hypot(x - rootX, y - rootY) / s + 40;
    const sleeve = new Path2D();
    sleeve.moveTo(-30, wristY + 6);
    sleeve.lineTo(-44, armLen);
    sleeve.lineTo(44, armLen);
    sleeve.lineTo(30, wristY + 6);
    sleeve.closePath();
    const wrist = new Path2D();
    wrist.roundRect(-27, 20, 54, 48, 18);
    const cuff = new Path2D();
    cuff.roundRect(-36, wristY + 6, 72, 26, 10);

    const all = new Path2D();
    for (const f of fingers) all.addPath(f.finger, f.m);
    all.addPath(palm);
    all.addPath(wrist);
    all.addPath(sleeve);
    all.addPath(cuff);

    g.save();
    g.globalAlpha *= this.alpha;
    // 阴影：悬空时更远更虚
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.scale(s, s);
    // 阴影：把形状平移到画面外，用 shadowOffset 投回来，避免重叠部分阴影叠加
    const far = 30000;
    const T = g.getTransform();
    const p0 = T.transformPoint({ x: 0, y: 0 }),
      p1 = T.transformPoint({ x: 0, y: -far });
    const unit = Math.hypot(T.a, T.b) / s;
    const sdx = (8 + 26 * lift) * s * unit,
      sdy = (10 + 32 * lift) * s * unit;
    g.translate(0, -far);
    g.shadowOffsetX = p0.x - p1.x + sdx;
    g.shadowOffsetY = p0.y - p1.y + sdy;
    g.shadowBlur = (6 + 22 * lift) * s * unit;
    g.shadowColor = `rgba(70,35,20,${0.3 - 0.12 * clamp(lift)})`;
    g.fillStyle = '#000';
    g.fill(all);
    g.restore();

    g.translate(x, y);
    g.rotate(ang);
    g.scale(s, s);
    g.lineJoin = 'round';
    // 描边层
    g.strokeStyle = LINE;
    g.lineWidth = 4.4;
    g.stroke(sleeve);
    g.stroke(cuff);
    for (const f of fingers) {
      g.save();
      g.setTransform(g.getTransform().multiply(f.m));
      g.stroke(f.finger);
      g.restore();
    }
    g.stroke(palm);
    g.stroke(wrist);
    // 填充层
    g.fillStyle = this.sleeve;
    g.fill(sleeve);
    g.fillStyle = SKIN;
    g.fill(wrist);
    const grad = g.createLinearGradient(-40, -40, 40, 50);
    grad.addColorStop(0, '#fbd6b9');
    grad.addColorStop(1, SKIN);
    for (const f of fingers) {
      g.save();
      g.setTransform(g.getTransform().multiply(f.m));
      g.fillStyle = grad;
      g.fill(f.finger);
      g.restore();
    }
    g.fillStyle = grad;
    g.fill(palm);
    // 袖口
    g.fillStyle = this.cuff;
    g.fill(cuff);
    g.strokeStyle = LINE;
    g.lineWidth = 2.2;
    g.stroke(cuff);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 2;
    for (let i = -28; i <= 28; i += 8) {
      g.beginPath();
      g.moveTo(i, wristY + 10);
      g.lineTo(i, wristY + 28);
      g.stroke();
    }
    // 指甲与指节
    for (const [i, f] of fingers.entries()) {
      const fd = i < 4 ? this.fingers[i] : this.thumb;
      const L = fd.len * (1 - curl * (i === 4 ? 0.1 : 0.16));
      g.save();
      g.setTransform(g.getTransform().multiply(f.m));
      g.fillStyle = NAIL;
      g.beginPath();
      g.ellipse(0, -L + fd.w * 0.62, fd.w * 0.3, fd.w * 0.36, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = SKIN_DARK;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(-fd.w * 0.22, -L * 0.45);
      g.quadraticCurveTo(0, -L * 0.45 - 2.5, fd.w * 0.22, -L * 0.45);
      g.stroke();
      g.restore();
    }
    g.strokeStyle = SKIN_DARK;
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(-18, -14);
    g.quadraticCurveTo(-4, -20, 16, -14);
    g.stroke();
    g.restore();
  }

  /** 预渲染缓存：按设备像素尺寸画好的手臂和两张预模糊的影子 */
  private sprite: { key: string; arm: HTMLCanvasElement; near: HTMLCanvasElement; far: HTMLCanvasElement; k: number; pad: number } | null = null;
  /** 最近一次绘制时手的朝向（0 = 指尖朝上），给接触模型用 */
  angle = 0;

  /** 手掌受力中心（世界坐标）：照片手在掌心偏指根处，卡通手就是原点。 */
  contactPoint(): { x: number; y: number } {
    return this.photo ? this.photoPoint(277, 265) : { x: this.x, y: this.y };
  }

  /** 照片手：手图上的像素点 → 世界坐标（按最近一次绘制的朝向和大小）。 */
  photoPoint(px: number, py: number): { x: number; y: number } {
    const ph = this.photo;
    if (!ph) return { x: this.drawX, y: this.drawY };
    const s = ph.scale * this.size * (1 + 0.06 * clamp(this.lift.value, -0.2, 1.3) - 0.03 * clamp(this.press.value, 0, 1.2));
    const lx = (px - ph.ax) * s,
      ly = (py - ph.ay) * s;
    const c = Math.cos(this.angle),
      sn = Math.sin(this.angle);
    return { x: this.drawX + lx * c - ly * sn, y: this.drawY + lx * sn + ly * c };
  }

  private spriteOf(ph: { img: HTMLImageElement; ax: number; ay: number }, k: number): NonNullable<Hand['sprite']> {
    const key = `${ph.img.src}|${k.toFixed(3)}`;
    if (this.sprite?.key === key) return this.sprite;
    const img = ph.img;
    const iw = img.naturalWidth,
      ih = img.naturalHeight;
    // 袖子：把袖子中段一截针织纹重复拼接，长度够伸出屏幕即可
    const extra = 2200;
    const W = Math.ceil(iw * k),
      H = Math.ceil((ih + extra) * k);
    const arm = document.createElement('canvas');
    arm.width = W;
    arm.height = H;
    const g = arm.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.scale(k, k);
    const band = 120,
      top = ih - band - 8;
    for (let y = ih - 12; y < ih + extra; y += band - 4) g.drawImage(img, 0, top, iw, band, 0, y, iw, band);
    g.drawImage(img, 0, 0);
    // 影子：缩小到 1/4 再模糊，绘制时放大，开销很小
    const shadow = (blur: number) => {
      const q = 0.25,
        pad = Math.ceil(blur * 2);
      const c = document.createElement('canvas');
      c.width = Math.ceil(W * q) + pad * 2;
      c.height = Math.ceil(H * q) + pad * 2;
      const sg = c.getContext('2d')!;
      sg.filter = `blur(${blur}px)`;
      sg.drawImage(arm, pad, pad, W * q, H * q);
      sg.filter = 'none';
      sg.globalCompositeOperation = 'source-in';
      sg.fillStyle = 'rgb(45,25,10)';
      sg.fillRect(0, 0, c.width, c.height);
      return c;
    };
    const near = shadow(2.5),
      far = shadow(9);
    this.sprite = { key, arm, near, far, k, pad: 0 };
    return this.sprite;
  }

  /** 照片手：沿手臂方向旋转，悬空时放大、影子变远变虚。 */
  private drawPhoto(g: CanvasRenderingContext2D, rootX: number, rootY: number): void {
    const ph = this.photo!;
    const lift = clamp(this.lift.value, -0.2, 1.3),
      press = clamp(this.press.value, 0, 1.2);
    const x = this.drawX,
      y = this.drawY;
    const ang = Math.atan2(y - rootY, x - rootX) + Math.PI / 2 + this.tilt.value;
    this.angle = ang;
    const T0 = g.getTransform();
    const unit = Math.hypot(T0.a, T0.b);
    const base = ph.scale * this.size * unit;
    const sp = this.spriteOf(ph, Math.round(base * 40) / 40);
    const s = (ph.scale * this.size * (1 + 0.06 * lift - 0.03 * press) * unit) / sp.k;
    // 设备坐标下画：先影子（光从左上方来），再手
    const p = T0.transformPoint({ x, y });
    const camRot = Math.atan2(T0.b, T0.a);
    const devAng = ang + camRot;
    const ax = ph.ax * sp.k,
      ay = ph.ay * sp.k;
    const lag = clamp(this.fingers[1].lag.value, -0.25, 0.25);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha *= this.alpha;
    const L = clamp(lift);
    const sdx = (6 + 26 * L) * base,
      sdy = (9 + 34 * L) * base;
    for (const [img, a] of [
      [sp.near, (1 - L) * 0.3],
      [sp.far, 0.22 + 0.1 * L],
    ] as const) {
      if (a <= 0.01) continue;
      g.save();
      g.globalAlpha *= a;
      g.translate(p.x + sdx, p.y + sdy);
      g.rotate(devAng);
      g.transform(1, 0, lag * 0.35, 1, 0, 0);
      g.scale(s * 4, s * 4);
      const pad = (img.width - sp.arm.width * 0.25) / 2;
      g.drawImage(img, -ax * 0.25 - pad, -ay * 0.25 - pad);
      g.restore();
    }
    g.translate(p.x, p.y);
    g.rotate(devAng);
    g.transform(1, 0, lag * 0.35, 1, 0, 0);
    g.scale(s, s);
    g.drawImage(sp.arm, -ax, -ay);
    g.restore();
  }
}
