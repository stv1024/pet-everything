import { Material } from '../audio/engine';
import { Chain, seedChain } from '../engine/chain';
import { Warp } from '../engine/deform';
import { FurField, Touch, partHost, seedPart } from '../engine/fur';
import { Bounds, Part, Painter } from '../engine/part';
import { Spring, TAU, Vec, clamp, smooth } from '../engine/math';
import { furNoise, groundShadow, hex, shade, softBlob } from './kit';
import { Contact } from './types';

/**
 * 俯视视角、趴着的四足动物骨架：头朝左（-x），尾巴在右。
 * 猫、老虎、狗共用这套几何、毛发与摆位；各物种的"脑子"驱动 ctrl 里的控制量。
 */

export interface ProneLook {
  base: string;
  /** 口鼻、胸口等浅色 */
  light: string;
  /** 尾尖颜色 */
  tailTip?: string;
  /** 尾巴环纹颜色 */
  ring?: string;
  ringMix?: number;
  ringFreq?: number;
  /** 四只爪子用浅色 */
  socks?: boolean;
  earInner: string;
  /** 额外的花纹：在部件局部坐标里画 */
  paintBody?: Painter;
  paintHead?: Painter;
  paintEar?: (g: CanvasRenderingContext2D, side: -1 | 1, b: Bounds) => void;
  /** 浅色口鼻 */
  muzzle?: boolean;
}

export interface ProneSpec {
  look: ProneLook;
  material: Material;
  body: { x: number; rx: number; ry: number; shoulder: number; haunch: number; curve: number };
  head: { x: number; y: number; rx: number; ry: number; muzzle: number; snout?: number };
  ears: { kind: 'pointed' | 'round' | 'floppy'; size: number; base: number; tip: number; width?: number };
  tail: { length: number; radius: number; taper: number; rest: number[]; root: number; freq?: number; fluff?: number };
  paws: { x: number; y: number; rx: number; ry: number };
  fur: { spacing: number; length: [number, number]; width: number; edge?: number };
  face: { x: number; squash: number; scale: number };
}

/** 脑子可以改的控制量。 */
export class ProneCtrl {
  headX = new Spring(0, 3.2, 0.72);
  headY = new Spring(0, 3.2, 0.72);
  headRot = new Spring(0, 2.6, 0.62);
  ear = [new Spring(0, 5.5, 0.28), new Spring(0, 5.5, 0.28)];
  /** 臀部抬起（离镜头更近而变大） */
  rump = new Spring(0, 4, 0.6);
  /** 呼吸相位速度倍数 */
  breathRate = 1;
  breathDepth = 1;
  /** 前爪偏移（世界坐标增量）与旋转 */
  paw: { x: number; y: number; rot: number }[] = [
    { x: 0, y: 0, rot: 0 },
    { x: 0, y: 0, rot: 0 },
  ];
  /** 前爪画在手上方（抱手） */
  pawsOver = false;
  /** 尾巴每节额外角度 */
  tail: number[] = [];
}

const tmp = { x: 0, y: 0 };

export class ProneRig {
  readonly frame: Bounds;
  readonly body: Part;
  readonly head: Part;
  readonly ears: Part[];
  readonly paws: Part[];
  readonly tail: Chain;
  readonly ctrl = new ProneCtrl();
  readonly furs: FurField[];
  readonly bodyFur: FurField;
  readonly headFur: FurField;
  private pawFurs: FurField[];
  private earFurs: FurField[];
  private tailFur: FurField;
  private earBase: Vec[] = [];
  private pawRest: Vec[];
  private t = 0;
  /** 脸部中心的形变位移 */
  readonly faceShift = { x: 0, y: 0 };

  constructor(readonly spec: ProneSpec) {
    const L = spec.look;
    const B = spec.body,
      H = spec.head;

    // ---------- 身体 ----------
    const pts: Vec[] = [];
    const N = 72;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const co = Math.cos(a),
        si = Math.sin(a);
      const ux = Math.sign(co) * Math.abs(co) ** 0.85;
      const taper = 1 - B.shoulder * smooth(clamp(-ux * 1.25));
      const hip = 1 + B.haunch * Math.exp(-(((ux - 0.5) / 0.28) ** 2));
      const x = B.x + B.rx * ux;
      const y = B.ry * Math.sign(si) * Math.abs(si) ** 0.9 * taper * hip + B.curve * B.ry * (ux * ux - 0.4);
      pts.push({ x, y });
    }
    const grainBody = (x: number, y: number) => {
      const u = (x - B.x) / B.rx;
      const v = (y - B.curve * B.ry * (u * u - 0.4)) / B.ry;
      return Math.atan2(v * 0.95, 1 - Math.max(0, -u - 0.75) * 2);
    };
    this.body = new Part({
      outline: pts,
      zone: 'body',
      pad: 16,
      paint: (g, o, b) => {
        g.fillStyle = L.base;
        g.fillRect(b.x - 40, b.y - 40, b.w + 80, b.h + 80);
        L.paintBody?.(g, o, b);
        // 大腿轮廓（两侧）
        g.save();
        g.strokeStyle = 'rgba(60,30,20,0.15)';
        g.lineWidth = 4;
        g.filter = 'blur(2px)';
        for (const s of [-1, 1]) {
          g.beginPath();
          g.ellipse(B.x + B.rx * 0.52, s * B.ry * 0.62, B.rx * 0.36, B.ry * 0.42, 0, s > 0 ? Math.PI * 1.1 : Math.PI * 0.4, s > 0 ? Math.PI * 1.6 : Math.PI * 0.9);
          g.stroke();
        }
        g.restore();
        furNoise(g, b, grainBody, { seed: 2, len: 9, n: Math.round((b.w * b.h) / 14), dark: 'rgba(40,20,10,0.11)', light: 'rgba(255,250,240,0.13)' });
        // 背脊受光、两侧渐暗
        const sg = g.createLinearGradient(0, b.y, 0, b.y + b.h);
        sg.addColorStop(0, 'rgba(40,20,10,0.30)');
        sg.addColorStop(0.3, 'rgba(255,250,240,0.10)');
        sg.addColorStop(0.45, 'rgba(255,250,240,0.18)');
        sg.addColorStop(0.62, 'rgba(255,250,240,0)');
        sg.addColorStop(1, 'rgba(40,20,10,0.38)');
        g.fillStyle = sg;
        g.fillRect(b.x - 40, b.y - 40, b.w + 80, b.h + 80);
        shade(g, b, { light: 0.12, dark: 0.22, lx: 0.4, ly: 0.35 });
      },
    });

    // ---------- 头 ----------
    const headPts: Vec[] = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU;
      // da：与"正前方"（-x）的夹角
      const da = Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI));
      const f = Math.exp(-((da / 0.7) ** 2));
      const cheek = Math.exp(-(((Math.abs(da) - 1.1) / 0.35) ** 2));
      const r = 1 - H.muzzle * f + 0.06 * cheek;
      let x = Math.cos(a) * H.rx * r;
      const y = Math.sin(a) * H.ry * r;
      if (H.snout) x -= H.snout * Math.exp(-((da / 0.42) ** 2)) * H.rx;
      headPts.push({ x: H.x + x, y: H.y + y });
    }
    const nose = { x: H.x - H.rx * (1 + (H.snout ?? 0) - H.muzzle), y: H.y };
    const grainHead = (x: number, y: number) => Math.atan2(y - nose.y, x - nose.x);
    this.head = new Part({
      outline: headPts,
      zone: 'head',
      pad: 14,
      paint: (g, o, b) => {
        g.fillStyle = L.base;
        g.fillRect(b.x - 30, b.y - 30, b.w + 60, b.h + 60);
        if (L.muzzle) softBlob(g, nose.x + H.rx * 0.32, H.y, H.rx * 0.34, H.ry * 0.42, L.light, 0, 7);
        L.paintHead?.(g, o, b);
        furNoise(g, b, grainHead, { seed: 4, len: 7, dark: 'rgba(40,20,10,0.10)', light: 'rgba(255,250,240,0.12)' });
        shade(g, b, { light: 0.3, dark: 0.3, lx: 0.45, ly: 0.3 });
      },
    });

    // ---------- 耳朵 ----------
    const E = spec.ears;
    const R = (H.rx + H.ry) / 2;
    this.ears = [-1, 1].map(side => {
      const ba = side * E.base;
      const bx = H.x + Math.cos(ba) * H.rx * 0.82,
        by = H.y + Math.sin(ba) * H.ry * 0.82;
      this.earBase.push({ x: bx, y: by });
      const ta = side * E.tip;
      const dx = Math.cos(ta),
        dy = Math.sin(ta);
      const len = R * E.size,
        wid = R * (E.width ?? 0.62);
      const px = -dy,
        py = dx;
      let outline: Vec[];
      if (E.kind === 'pointed') {
        outline = [
          { x: bx - px * wid * 0.5 - dx * 8, y: by - py * wid * 0.5 - dy * 8 },
          { x: bx - px * wid * 0.38 + dx * len * 0.5, y: by - py * wid * 0.38 + dy * len * 0.5 },
          { x: bx - px * 6 + dx * len * 0.95, y: by - py * 6 + dy * len * 0.95 },
          { x: bx + dx * len, y: by + dy * len },
          { x: bx + px * 6 + dx * len * 0.95, y: by + py * 6 + dy * len * 0.95 },
          { x: bx + px * wid * 0.38 + dx * len * 0.5, y: by + py * wid * 0.38 + dy * len * 0.5 },
          { x: bx + px * wid * 0.5 - dx * 8, y: by + py * wid * 0.5 - dy * 8 },
        ];
      } else {
        const n = 26;
        outline = [];
        const rl = E.kind === 'floppy' ? len * 0.55 : len * 0.5;
        const rw = wid * 0.5;
        const cxx = bx + dx * rl * 0.8,
          cyy = by + dy * rl * 0.8;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          const k = E.kind === 'floppy' ? 1 + 0.25 * Math.cos(a) : 1;
          const ax = Math.cos(a) * rl * k,
            ay = Math.sin(a) * rw * (E.kind === 'floppy' ? 1 - 0.25 * Math.cos(a) : 1);
          outline.push({ x: cxx + ax * dx - ay * dy, y: cyy + ax * dy + ay * dx });
        }
      }
      if (side > 0) outline.reverse();
      return new Part({
        outline,
        zone: 'ear',
        pad: 8,
        give: 0.6,
        paint: (g, _o, b) => {
          g.fillStyle = L.base;
          g.fillRect(b.x - 20, b.y - 20, b.w + 40, b.h + 40);
          if (E.kind !== 'floppy') {
            g.save();
            g.filter = 'blur(3px)';
            g.fillStyle = L.earInner;
            g.beginPath();
            const k = E.kind === 'pointed' ? 0.62 : 0.45;
            g.moveTo(bx - px * wid * 0.3 * k * 1.4, by - py * wid * 0.3 * k * 1.4);
            g.quadraticCurveTo(bx + dx * len * 0.7 - px * 4, by + dy * len * 0.7 - py * 4, bx + dx * len * 0.82 * (k + 0.2), by + dy * len * 0.82 * (k + 0.2));
            g.quadraticCurveTo(bx + dx * len * 0.7 + px * 4, by + dy * len * 0.7 + py * 4, bx + px * wid * 0.3 * k * 1.4, by + py * wid * 0.3 * k * 1.4);
            g.closePath();
            g.fill();
            g.restore();
          }
          L.paintEar?.(g, side as -1 | 1, b);
          shade(g, b, { light: 0.2, dark: 0.3, ly: 0.2 });
        },
      });
    });

    // ---------- 前爪 ----------
    const P = spec.paws;
    this.pawRest = [-1, 1].map(s => ({ x: P.x, y: s * P.y + H.y * 0.3 }));
    this.paws = this.pawRest.map(
      (p, i) =>
        new Part({
          outline: Array.from({ length: 28 }, (_, k) => {
            const a = (k / 28) * TAU;
            const front = Math.cos(a) < 0 ? 1 : 0.92;
            return { x: p.x + Math.cos(a) * P.rx * front, y: p.y + Math.sin(a) * P.ry };
          }),
          zone: 'paw',
          pad: 8,
          paint: (g, _o, b) => {
            g.fillStyle = L.socks ? L.light : L.base;
            g.fillRect(b.x - 20, b.y - 20, b.w + 40, b.h + 40);
            g.strokeStyle = 'rgba(70,40,30,0.32)';
            g.lineWidth = 2;
            g.lineCap = 'round';
            for (const k of [-0.42, 0, 0.42]) {
              g.beginPath();
              g.moveTo(p.x - P.rx * 0.95, p.y + k * P.ry);
              g.lineTo(p.x - P.rx * 0.6, p.y + k * P.ry * 0.9);
              g.stroke();
            }
            shade(g, b, { light: 0.25, dark: 0.3, lx: 0.3, ly: i ? 0.2 : 0.3 });
          },
        }),
    );

    // ---------- 尾巴 ----------
    const T = spec.tail;
    this.tail = new Chain(T.length, T.rest, s => T.radius * (1 - T.taper * (s / T.length) ** 1.5), T.freq ?? 2.4, 0.42);
    this.tail.zone = 'tail';
    this.tail.give = 0.8;
    this.ctrl.tail = T.rest.map(() => 0);
    const base = hex(L.base),
      ringC = hex(L.ring ?? L.base),
      tipC = hex(L.tailTip ?? L.base);
    const mix = L.ringMix ?? 0.6;
    const freq = L.ringFreq ?? 0.06;
    const lerp3 = (a: number[], b: number[], k: number): [number, number, number] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const fl = spec.fur;
    this.tailFur = new FurField(
      this.tail,
      seedChain(this.tail, {
        spacing: fl.spacing * 0.8,
        length: [fl.length[0] * (T.fluff ?? 1), fl.length[1] * 1.1 * (T.fluff ?? 1)],
        splay: 0.6,
        color: (s, t) => {
          let c: [number, number, number] = [base[0], base[1], base[2]];
          if (L.ring && Math.sin(s * freq) > 0.3) c = lerp3(c, ringC, mix);
          if (L.tailTip && s > T.length * 0.82) c = [tipC[0], tipC[1], tipC[2]];
          const k = 1 + 0.12 * (0.3 - Math.abs(t));
          return [c[0] * k, c[1] * k, c[2] * k];
        },
      }),
      { width: fl.width, freq: 3.5, damping: 0.3 },
    );

    // ---------- 毛 ----------
    const edge = fl.edge ?? 1.15;
    this.bodyFur = new FurField(
      partHost(this.body),
      seedPart(this.body, {
        spacing: fl.spacing,
        length: fl.length,
        grain: grainBody,
        edge: { spacing: fl.spacing * 0.5, length: [fl.length[0] * edge * 0.9, fl.length[1] * edge], outward: 0.5 },
        seed: 21,
      }),
      { width: fl.width },
    );
    const F = spec.face;
    const faceC = { x: H.x + F.x * H.rx, y: H.y };
    const faceMask = (x: number, y: number) => {
      const dx = (x - faceC.x) / (H.rx * 0.42),
        dy = (y - faceC.y) / (H.ry * 0.62);
      return dx * dx + dy * dy < 1 ? 0.1 : 1;
    };
    this.headFur = new FurField(
      partHost(this.head),
      seedPart(this.head, {
        spacing: fl.spacing * 0.9,
        length: [fl.length[0] * 0.7, fl.length[1] * 0.8],
        grain: grainHead,
        mask: faceMask,
        edge: { spacing: fl.spacing * 0.5, length: [fl.length[0] * 0.8, fl.length[1] * edge * 0.9], outward: 0.65 },
        seed: 23,
      }),
      { width: fl.width * 0.95 },
    );
    this.pawFurs = this.paws.map(
      (p, i) =>
        new FurField(
          partHost(p),
          seedPart(p, { spacing: fl.spacing * 0.85, length: [fl.length[0] * 0.45, fl.length[1] * 0.55], grain: () => Math.PI, edge: { spacing: fl.spacing * 0.6, length: [3, 6], outward: 0.6 }, seed: 31 + i }),
          { width: fl.width * 0.9, ruffle: 0.4 },
        ),
    );
    this.earFurs = this.ears.map(
      (p, i) =>
        new FurField(
          partHost(p),
          seedPart(p, {
            spacing: spec.ears.kind === 'floppy' ? fl.spacing : 100,
            length: [4, 7],
            grain: () => (i ? 1 : -1) * spec.ears.tip,
            edge: { spacing: 4, length: [3, spec.ears.kind === 'floppy' ? 9 : 6], outward: 0.8, inset: 1.5 },
            seed: 41 + i,
          }),
          { width: fl.width * 0.8, ruffle: 0, freq: 6 },
        ),
    );
    this.furs = [this.tailFur, this.bodyFur, ...this.pawFurs, ...this.earFurs, this.headFur];

    // 镜头框
    const tailReach = T.length * 0.55;
    const x0 = Math.min(H.x - H.rx * (1.2 + (H.snout ?? 0)), P.x - P.rx * 1.3);
    const x1 = B.x + B.rx + tailReach * 0.5;
    const y1 = Math.max(B.ry * (1 + B.haunch) + T.radius * 2.4 + 20, H.y + H.ry * 1.6);
    const y0 = Math.min(-B.ry * (1 + B.haunch) - 20, H.y - H.ry - R * E.size * 0.9);
    this.frame = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  get faceCenter(): Vec {
    const H = this.spec.head;
    return { x: H.x + this.spec.face.x * H.rx, y: H.y };
  }

  update(dt: number, warp: Warp, touch: Touch): void {
    this.t += dt;
    const c = this.ctrl,
      S = this.spec,
      B = S.body,
      H = S.head;
    const breath = Math.sin(this.t * TAU * (c.breathRate / 3)) * c.breathDepth;
    const rump = c.rump.value;
    // 身体：呼吸时左右胀缩，抬臀时后半身变大
    const pivot = B.x - B.rx * 0.6;
    this.body.m.set(pivot, 0, 0, 1 + 0.004 * breath + rump * 0.04, 1 + 0.02 * breath + rump * 0.06, pivot, 0);
    this.body.update(warp);
    // 头：绕后脑勺（脖子）转
    const neck = { x: H.x + H.rx * 0.65, y: H.y };
    this.head.m.set(neck.x + c.headX.value, neck.y + c.headY.value, c.headRot.value, 1 + 0.006 * breath, 1 + 0.006 * breath, neck.x, neck.y);
    this.head.update(warp);
    for (let i = 0; i < 2; i++) {
      const b = this.earBase[i];
      this.ears[i].m.set(b.x, b.y, c.ear[i].value, 1, 1, b.x, b.y).premul(this.head.m);
      this.ears[i].update(warp);
    }
    for (let i = 0; i < 2; i++) {
      const r = this.pawRest[i],
        p = c.paw[i];
      this.paws[i].m.set(r.x + p.x, r.y + p.y, p.rot, 1, 1, r.x, r.y);
      this.paws[i].update(warp);
    }
    const T = S.tail;
    const rx = B.x + B.rx * 0.9,
      ry = B.curve * B.ry * 0.6 + B.ry * 0.12;
    this.tail.rootX = this.body.m.x(rx, ry);
    this.tail.rootY = this.body.m.y(rx, ry);
    this.tail.rootAngle = T.root;
    for (let i = 0; i < this.tail.count; i++) this.tail.extra[i] = c.tail[i] ?? 0;
    this.tail.step(dt);
    this.tail.update(warp);
    const fc = this.faceCenter;
    const wx = this.head.m.x(fc.x, fc.y),
      wy = this.head.m.y(fc.x, fc.y);
    warp.apply(wx, wy, 0.7, tmp);
    this.faceShift.x = tmp.x - wx;
    this.faceShift.y = tmp.y - wy;
    for (const f of this.furs) f.update(dt, warp, touch);
  }

  /** 命中测试：返回区域名。 */
  hit(x: number, y: number): Contact | null {
    const S = this.spec,
      H = S.head,
      B = S.body;
    const mat = S.material;
    if (this.head.contains(x, y, 5)) {
      const l = this.head.m.invert(x, y, { x: 0, y: 0 });
      const u = (l.x - H.x) / H.rx,
        v = (l.y - H.y) / H.ry;
      const zone = u < -0.42 ? 'face' : Math.abs(v) > 0.5 && u < 0.25 ? 'cheek' : 'head';
      const fc = this.faceCenter;
      return { zone, material: mat, grain: Math.atan2(l.y - fc.y, l.x - (fc.x - H.rx * 0.3)) + this.head.m.rotation };
    }
    for (const e of this.ears) if (e.contains(x, y, 3)) return { zone: 'ear', material: mat };
    for (const p of this.paws) if (p.contains(x, y, 3)) return { zone: 'paw', material: mat, grain: Math.PI };
    if (this.body.contains(x, y, 6)) {
      const l = this.body.m.invert(x, y, { x: 0, y: 0 });
      const u = (l.x - B.x) / B.rx,
        v = (l.y - B.curve * B.ry * (u * u - 0.4)) / B.ry;
      const zone = u > 0.5 ? 'rump' : Math.abs(v) > 0.62 ? 'side' : 'back';
      return { zone, material: mat, grain: Math.atan2(v * 0.95, 1) };
    }
    if (this.tail.contains(x, y, 5)) {
      const n = this.tail.nearest(x, y);
      return { zone: 'tail', material: mat, grain: this.tail.angleAt(n.s) };
    }
    return null;
  }

  drawShadow(g: CanvasRenderingContext2D): void {
    const B = this.spec.body,
      H = this.spec.head;
    groundShadow(g, B.x + 10, 14, B.rx * 1.12, B.ry * 1.25, 0.28);
    groundShadow(g, H.x - 6, H.y + 12, H.rx * 1.15, H.ry * 1.1, 0.22);
  }

  draw(g: CanvasRenderingContext2D, tailFill: string): void {
    this.drawShadow(g);
    this.tail.draw(g, tailFill);
    this.tailFur.draw(g);
    this.body.draw(g);
    this.bodyFur.draw(g);
    if (!this.ctrl.pawsOver) this.drawPaws(g);
    for (let i = 0; i < 2; i++) {
      this.ears[i].draw(g);
      this.earFurs[i].draw(g);
    }
    this.head.draw(g);
    this.headFur.draw(g);
  }

  drawPaws(g: CanvasRenderingContext2D): void {
    for (let i = 0; i < 2; i++) {
      this.paws[i].draw(g);
      this.pawFurs[i].draw(g);
    }
  }

  /** 进入脸部坐标系：原点在脸中心，+y 指向鼻子（世界 -x），按俯视透视压扁。 */
  faceFrame(g: CanvasRenderingContext2D): void {
    const m = this.head.m;
    const fc = this.faceCenter;
    g.translate(this.faceShift.x, this.faceShift.y);
    g.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    g.translate(fc.x, fc.y);
    g.rotate(Math.PI / 2);
    g.scale(this.spec.face.scale, this.spec.face.scale * this.spec.face.squash);
  }

  resetFur(): void {
    for (const f of this.furs) f.reset();
  }
}
