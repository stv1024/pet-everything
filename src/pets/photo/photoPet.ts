import { AudioEngine, Material } from '../../audio/engine';
import { Bed } from '../../audio/synth';
import { GLLayer, loadImage } from '../../engine/gl/layer';
import { PhotoSkin } from '../../engine/gl/skin';
import { Bounds } from '../../engine/part';
import { TAU, clamp, follow, smooth } from '../../engine/math';
import { PressInput, SkinPress } from '../../engine/skinPress';
import { Mood, speedLike } from '../kit';
import { Contact, Creature, Frame, Fx, Species, View } from '../types';
import { drop, groundSplat, smear } from './blood';
import { Ground, GroundKind } from './grounds';

/**
 * 写实物种的通用实现：AI 生成的俯视照片 + WebGL 网格（PhotoSkin）+ 手掌接触形变（SkinPress）。
 * 动物自己不动（只有呼吸）；反应靠接触形变和声音。
 * 物种只需提供：素材、骨架标注（Rig）、材质参数、命中区域、喜好（Temper）和声音（PetVoice）。
 */

export interface P {
  x: number;
  y: number;
}

export interface Coat {
  id: string;
  name: string;
  swatch: string[];
  /** 逆毛反光亮度，无毛为 0 */
  sheen?: number;
}

/** 骨架标注（抠图后的图片像素）。动物头朝左、脊线大致水平。 */
export interface Rig {
  nose: P;
  /** 头绕它轻轻歪的枢轴 */
  neck: P;
  /** 脊线（身体中线）的 y */
  spine: number;
  /** 头骨 → 身体的 x 过渡范围：头骨上皮肤滑得少 */
  skull: [number, number];
  /** 头部权重：x 过渡范围，离脊线的距离过渡范围 */
  head: { x: [number, number]; half: [number, number] };
  /** 胸背软组织（跟随拖动、呼吸起伏）的中心 x 与半径 */
  chest: { x: number; rx: number; ry: number };
  /** 耳朵：根部（转轴）和中心；手压在附近时向后压平 */
  ears?: { base: P; c: P }[];
  /** 尾巴折线（毛流先验沿尾巴） */
  tail?: [number, number][];
}

export interface Temper {
  /** 各区域喜好，正为喜欢 */
  prefs: Record<string, number>;
  /** 手速喜好：speedLike(speed, lo, hi, max) */
  speed?: [number, number, number];
  /** 逆毛扣分，0 为不在乎 */
  grain?: number;
  /** 喜欢被挠的区域 */
  scratch?: string[];
}

export interface PetVoice {
  /** 持续声（呼噜、喘气），音量由 bedLevel 决定 */
  bed?(au: AudioEngine): Bed;
  bedLevel?(joy: number, petting: number, annoy: number): number;
  /** 手刚放上来（离开过一阵） */
  greet?(au: AudioEngine): void;
  /** 轻拍 */
  tap?(au: AudioEngine, zone: string): void;
  /** 开心时偶尔 */
  happy?(au: AudioEngine): void;
  /** 不满 */
  grumble?(au: AudioEngine): void;
  /** 生气 */
  angry?(au: AudioEngine): void;
  /** 扎手时动物的反应（刺猬喷气） */
  prickled?(au: AudioEngine): void;
}

/** 扎手：按压 / 逆刺 / 摩擦时"疼痛"累积，满 1 时手被扎得缩回、发抖、冒血珠。单位：每秒。 */
export interface Spiky {
  press: number;
  against: number;
  rub: number;
  /** 只在这些区域扎手，缺省为全部 */
  zones?: string[];
}

export interface PhotoDef {
  /** 素材目录：public/pets/<id>/<coat>.webp */
  id: string;
  name: string;
  coats: Coat[];
  rig: Rig;
  /** 世界单位 / 图片像素（猫为 1）。决定动物相对手的大小 */
  scale: number;
  ground: GroundKind;
  material: Material;
  /** 个别区域的材质（例如花盆） */
  materialOf?: (zone: string) => Material | undefined;
  /** 有没有毛（没有毛就不做炸毛） */
  fur?: boolean;
  /** 皮肤柔软度，猫为 1；硬的东西（鳞片、仙人球）小 */
  give?: number;
  /** 炸毛落回的时间（秒） */
  settle?: number;
  /** 影子浓度倍数 */
  shadow?: number;
  /** 呼吸幅度倍数，0 为不呼吸 */
  breath?: number;
  /** 网格单元大小（图片像素） */
  cell?: number;
  /** 毛流先验方向；缺省为头部从鼻尖向外、身体朝后、尾巴沿尾巴 */
  prior?: (px: number, py: number) => [number, number];
  /** 命中区域 */
  zone(px: number, py: number): string;
  temper: Temper;
  voice: PetVoice;
  spiky?: Spiky;
  /** 头像：从第一种毛色图片里取的正方形区域（图片像素） */
  icon: [number, number, number];
}

/** 参考单位（世界单位）：接触形变的长度系数按它换算。手的大小固定，所以它也固定。 */
const U_WORLD = 1150;
/** 照片手的大小（与猫的比例） */
const HAND_SIZE = 1.25;

/**
 * 照片手上的接触点（手图像素）：掌心、四个指腹、拇指。
 * 手图 465×1008，手背朝上的右手；受力中心 (277, 265) 作为锚点，跟随指针。
 */
const PADS = [
  { x: 285, y: 400, r: 56, w: 1 },
  { x: 208, y: 95, r: 26, w: 0.25 },
  { x: 270, y: 60, r: 26, w: 0.25 },
  { x: 333, y: 100, r: 26, w: 0.25 },
  { x: 398, y: 195, r: 24, w: 0.25 },
  { x: 50, y: 380, r: 26, w: 0.15 },
];

const base = import.meta.env.BASE_URL;
const handImage = loadImage(`${base}pets/hand-open.webp`);
const ss = (a: number, b: number, x: number) => smooth((x - a) / (b - a));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class PhotoPet implements Creature {
  frame: Bounds;
  readonly handSize = HAND_SIZE;
  protected skin: PhotoSkin | null = null;
  protected press: SkinPress | null = null;
  private ground: Ground;
  private ready = false;
  private fade = 0;
  private W = 1000;
  private H = 500;
  /** 图片左上角的世界坐标 */
  private ox = 0;
  private oy = 0;
  private readonly k: number;
  private wHead!: Float32Array;
  private wChest!: Float32Array;
  private wEar: Float32Array[] = [];
  protected mood = new Mood(0.2, 1.0, 40, 5);
  private dozing = false;
  private cooldown = 0;
  private bed: Bed | null = null;
  private wasTouching = false;
  private awayBefore = 10;
  private lastHappy = -20;
  private t = 0;
  private pain = 0;
  private painCool = 0;
  /** 接触中心（图片像素） */
  private contact = { x: 0, y: 0, on: false };
  /** 本帧手上各接触点（图片像素）：0 为掌心，1..4 为四指，5 为拇指 */
  private pads: { x: number; y: number; cover: number }[] = [];
  /** 刚被扎破的手指：几秒内拖过的地方会留下血痕 */
  private bloody = { pads: [] as number[], last: [] as { x: number; y: number; ink: number }[] };
  /** 手被扎破后还在流血的程度（1 → 0，约 15 秒止住），以及哪几个接触点（PADS 下标）在流血 */
  private bleeding = { level: 0, pads: [] as number[], next: 0 };
  /** 滴在地面上的血（世界坐标） */
  private drips: { x: number; y: number; img: ImageBitmap | null; size: number; rot: number; age: number }[] = [];

  constructor(
    protected fx: Fx,
    readonly def: PhotoDef,
    readonly coat: Coat,
  ) {
    this.k = def.scale;
    this.ground = new Ground(def.ground);
    this.frame = this.makeFrame();
    void this.load();
  }

  private makeFrame(): Bounds {
    const w = this.W * this.k,
      h = this.H * this.k;
    return { x: -w / 2 - 50, y: -h / 2 - 40, w: w + 100, h: h + 80 };
  }

  get joy(): number {
    return this.mood.joy;
  }

  private async load(): Promise<void> {
    const d = this.def,
      r = d.rig;
    const [img, hand] = await Promise.all([loadImage(`${base}pets/${d.id}/${this.coat.id}.webp`), handImage, this.ground.load()]);
    this.W = img.naturalWidth;
    this.H = img.naturalHeight;
    this.ox = (-this.W / 2) * this.k;
    this.oy = (-this.H / 2) * this.k;
    this.frame = this.makeFrame();
    this.fx.hand.photo = { img: hand, ax: 277, ay: 265, scale: 0.3 };
    const skin = new PhotoSkin({
      image: img,
      x: this.ox,
      y: this.oy,
      scale: this.k,
      cell: d.cell ?? 13,
      prior: d.prior ?? ((x, y) => this.prior(x, y)),
      sheen: this.coat.sheen ?? 0,
      settle: d.settle ?? 0.92,
      shadow: d.shadow ?? 1,
    });
    this.skin = skin;
    const n = skin.n;
    this.wHead = new Float32Array(n);
    this.wChest = new Float32Array(n);
    this.wEar = (r.ears ?? []).map(() => new Float32Array(n));
    const travel = new Float32Array(n),
      furX = new Float32Array(n),
      furY = new Float32Array(n);
    const f: [number, number] = [0, 0];
    for (let i = 0; i < n; i++) {
      const x = skin.ix[i],
        y = skin.iy[i];
      const skull = 1 - ss(r.skull[0], r.skull[1], x);
      travel[i] = 1 - 0.34 * skull;
      this.wHead[i] = (1 - ss(r.head.x[0], r.head.x[1], x)) * (1 - ss(r.head.half[0], r.head.half[1], Math.abs(y - r.spine)));
      this.wChest[i] = Math.exp(-(((x - r.chest.x) / r.chest.rx) ** 2) - ((y - r.spine) / r.chest.ry) ** 2);
      (r.ears ?? []).forEach((e, k) => (this.wEar[k][i] = Math.exp(-(((x - e.c.x) / 53) ** 2) - ((y - e.c.y) / 55) ** 2)));
      skin.furSmooth(x, y, f);
      furX[i] = f[0];
      furY[i] = f[1];
    }
    this.press = new SkinPress({ x: skin.ix, y: skin.iy, travel, chest: this.wChest, head: this.wHead, furX, furY }, U_WORLD / this.k, { give: d.give ?? 1 });
    this.ready = true;
  }

  /** 默认毛流先验：头部从鼻尖向外；身体朝后、两侧略向外；尾巴沿尾巴。 */
  private prior(px: number, py: number): [number, number] {
    const r = this.def.rig;
    const hx = px - r.nose.x,
      hy = py - r.nose.y;
    const hl = Math.hypot(hx, hy) || 1;
    const head = smooth((r.neck.x + 15 - px) / 90);
    let bx = 1,
      by = ((py - r.spine) / 200) * 0.9;
    const bl = Math.hypot(bx, by);
    bx /= bl;
    by /= bl;
    let x = (hx / hl) * head + bx * (1 - head),
      y = (hy / hl) * head + by * (1 - head);
    if (r.tail) {
      const near = nearestOnLine(r.tail, px, py);
      const tw = (1 - smooth((near.d - 30) / 25)) * smooth(near.s / 40);
      x = x * (1 - tw) + Math.cos(near.a) * tw;
      y = y * (1 - tw) + Math.sin(near.a) * tw;
    }
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  }

  attachAudio(): void {
    if (!this.bed && this.def.voice.bed) this.bed = this.def.voice.bed(this.fx.au);
  }

  dispose(): void {
    this.bed?.stop();
    this.bed = null;
    this.fx.hand.photo = null;
    this.fx.hand.shiver = 0;
  }

  /** 世界坐标 → 图片像素（静止姿态）。 */
  protected toImage(x: number, y: number): P {
    return { x: (x - this.ox) / this.k, y: (y - this.oy) / this.k };
  }

  hit(x: number, y: number): Contact | null {
    if (!this.skin) return null;
    const p = this.toImage(x, y);
    if (this.skin.alphaAt(p.x, p.y) < 90) return null;
    const [fx, fy] = this.skin.furAt(p.x, p.y);
    const zone = this.def.zone(p.x, p.y);
    return { zone, material: this.def.materialOf?.(zone) ?? this.def.material, grain: Math.atan2(fy, fx) };
  }

  private score(f: Frame): number {
    const c = f.contact;
    if (!c) return 0;
    const h = f.hand,
      tp = this.def.temper;
    let s = tp.prefs[c.zone] ?? 0;
    if (h.speed < 30) return s > 0 ? 0.3 : s * 0.5;
    const [lo, hi, max] = tp.speed ?? [50, 750, 1700];
    s *= speedLike(h.speed, lo, hi, max);
    const gw = tp.grain ?? 1;
    if (gw && c.grain !== undefined && h.speed > 80) {
      const along = (h.vx * Math.cos(c.grain) + h.vy * Math.sin(c.grain)) / h.speed;
      if (along > 0.3) s += 0.4 * gw;
      else if (along < -0.3) s -= 1.1 * gw;
    }
    if (h.scratch > 0.4 && tp.scratch?.includes(c.zone)) s += 1.3 * h.scratch;
    if (gw && (this.skin?.messiness ?? 0) > 0.25) s -= 0.4 * gw;
    return s;
  }

  update(f: Frame): void {
    const dt = f.dt;
    this.t += dt;
    if (!this.ready || !this.skin || !this.press) return;
    this.fade = follow(this.fade, 1, dt, 0.15);
    const h = f.hand,
      au = this.fx.au,
      v = this.def.voice;
    const touching = !!f.contact && h.touching;
    if (touching && !this.wasTouching) this.awayBefore = this.mood.awayTime;
    const score = this.dozing ? 0.6 : this.score(f);
    this.mood.update(f, score);
    const mood = this.mood;
    const zone = f.contact?.zone ?? '';
    const say = (fn?: (au: AudioEngine) => void) => au.ready && fn?.(au);
    this.cooldown -= dt;

    if (touching && !this.wasTouching) {
      if (this.dozing || this.awayBefore > 2.5) say(v.greet);
      this.dozing = false;
    }
    if (h.tap) {
      // 轻拍：皮肤被拍下去再弹起
      this.press.load.kick(5);
      this.press.bulk.kick(3);
      if (touching && au.ready) v.tap?.(au, zone);
      mood.joy = clamp(mood.joy + 0.02);
    }
    if (mood.annoy > 0.8 && this.cooldown <= 0) {
      say(v.angry);
      this.cooldown = 3;
      mood.annoy = 0.4;
    } else if (mood.annoy > 0.45 && this.cooldown <= 0 && touching) {
      say(v.grumble);
      this.cooldown = 2.2;
    } else if (!touching && mood.awayTime > 3 && mood.joy > 0.72) this.dozing = true;
    if (touching && mood.joy > 0.62 && this.t - this.lastHappy > 12 && score > 0.6 && Math.random() < dt * 0.3) {
      this.lastHappy = this.t;
      say(v.happy);
    }
    if (this.dozing) mood.joy = Math.max(mood.joy, 0.6);
    if (this.bed) {
      let level = v.bedLevel ? v.bedLevel(mood.joy, mood.petting, mood.annoy) : 0;
      if (this.dozing) level = Math.max(level * 0.5, 0.2);
      this.bed.set(level, level > this.bed.level ? 0.25 : 0.6);
      this.bed.rate(this.dozing ? 0.85 : 1);
    }

    this.spikes(f, touching, zone);
    this.press.step(dt, this.contactInput(f));
    this.smearBlood(touching);
    this.drip(f);
    this.pose();
    const c = this.contact;
    if (this.def.fur !== false) this.skin.stroke(dt, { ...f.touch, active: f.touch.active && c.on }, c.x, c.y, h.vx / this.k, h.vy / this.k, (46 * HAND_SIZE) / this.k);
    this.wasTouching = touching;
  }

  /** 扎手：疼痛累积到 1，手缩回并发抖。 */
  private spikes(f: Frame, touching: boolean, zone: string): void {
    const sp = this.def.spiky,
      dt = f.dt,
      hand = this.fx.hand;
    this.painCool -= dt;
    if (hand.shiver > 0) hand.shiver = Math.max(0, hand.shiver - dt * 1.6);
    if (!sp) return;
    const h = f.hand;
    let rate = 0;
    if (touching && (!sp.zones || sp.zones.includes(zone))) {
      const fast = clamp(h.speed / 600);
      rate += sp.press * clamp((h.pressure - 0.7) / 0.3) + sp.rub * fast;
      const g = f.contact?.grain;
      if (g !== undefined && h.speed > 60) rate += sp.against * clamp(-(h.vx * Math.cos(g) + h.vy * Math.sin(g)) / h.speed) * fast;
    }
    this.pain = rate > 0 ? this.pain + rate * dt : Math.max(0, this.pain - dt * 0.8);
    if (this.pain >= 1 && this.painCool <= 0) {
      this.pain = 0;
      this.painCool = 0.9;
      // 手被扎得往回缩（朝手腕方向）
      const a = hand.angle;
      hand.kick(-Math.sin(a) * 260, Math.cos(a) * 260);
      hand.shiver = 0.9;
      this.bleed();
      this.fx.vibrate([20, 30, 20]);
      const au = this.fx.au;
      if (au.ready) this.def.voice.prickled?.(au);
      this.mood.annoy = clamp(this.mood.annoy + 0.15);
    }
  }

  /** 被扎出血：血滴落在手按着的地方（动物/物品表面），并让这几根手指几秒内带着血。 */
  private bleed(): void {
    const skin = this.skin!,
      k = this.k;
    const on = this.pads.map((p, i) => (p.cover ? i : -1)).filter(i => i > 0);
    if (!on.length && !this.contact.on) return;
    const n = 1 + Math.floor(Math.random() * 3);
    const picked: number[] = [];
    for (let i = 0; i < n && on.length; i++) picked.push(on.splice(Math.floor(Math.random() * on.length), 1)[0]);
    const spots = picked.length ? picked.map(i => this.pads[i]) : [this.contact];
    for (const p of spots) {
      // 血滴半径 3–7 世界单位（约 2–5 毫米）
      const r = (3 + Math.random() * 4) / k;
      const x = p.x + ((Math.random() - 0.5) * 10) / k,
        y = p.y + ((Math.random() - 0.5) * 10) / k;
      skin.paintStain(g => drop(g, x, y, r), x - r * 2.6, y - r * 2.6, x + r * 2.6, y + r * 2.6);
    }
    this.bloody = { pads: picked, last: picked.map(i => ({ x: this.pads[i].x, y: this.pads[i].y, ink: 1 })) };
    const wounds = picked.length ? picked : [1 + Math.floor(Math.random() * 4)];
    this.bleeding = { level: Math.min(1, this.bleeding.level + 0.6), pads: [...new Set([...this.bleeding.pads, ...wounds])].slice(-4), next: Math.min(this.bleeding.next, 0.4) };
  }

  /** 带血的手指继续摸：留下断续、逐渐变淡的血痕。每根手指的血约拖 70 世界单位就蹭光了。 */
  private smearBlood(touching: boolean): void {
    const b = this.bloody;
    if (!b.pads.length) return;
    const k = this.k,
      w = 5 / k;
    b.pads.forEach((pi, j) => {
      const p = this.pads[pi],
        q = b.last[j];
      if (!p || q.ink <= 0) return;
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      if (touching && p.cover && dist > 1 && dist < 200 / k) {
        const a = q.ink;
        q.ink -= (dist * k) / 70;
        const x0 = Math.min(p.x, q.x) - w,
          y0 = Math.min(p.y, q.y) - w,
          x1 = Math.max(p.x, q.x) + w,
          y1 = Math.max(p.y, q.y) + w;
        this.skin!.paintStain(g => smear(g, q.x, q.y, p.x, p.y, w, a), x0, y0, x1, y1);
      }
      q.x = p.x;
      q.y = p.y;
    });
    if (b.last.every(q => q.ink <= 0)) b.pads = [];
  }

  /** 流血的手悬在地面上方时，不时有血滴落到地面上（落在伤口正下方）。 */
  private drip(f: Frame): void {
    const b = this.bleeding,
      dt = f.dt;
    for (const d of this.drips) d.age += dt;
    if (b.level <= 0) return;
    b.level = Math.max(0, b.level - dt / 15);
    b.next -= dt;
    if (b.next > 0) return;
    // 越来越少：刚扎破时约半秒一滴，快止住时几秒一滴
    b.next = rnd(0.35, 1.1) / Math.max(0.15, b.level);
    if (!f.hand.present || f.contact) return;
    const hand = this.fx.hand;
    const pad = PADS[b.pads[Math.floor(Math.random() * b.pads.length)] ?? 0];
    const w = hand.photoPoint(pad.x + rnd(-18, 18), pad.y + rnd(-18, 18));
    // 也不滴在动物/物品身上（这里只管地面）
    if (this.hit(w.x, w.y)) return;
    const r = rnd(5, 9) * (0.6 + 0.4 * b.level);
    const sp = groundSplat(r);
    // 小画布在 Chrome 里是软件渲染，每帧画都要重新上传 GPU，会掉帧；转成 ImageBitmap 只上传一次
    const d = { x: w.x, y: w.y, img: null as ImageBitmap | null, size: sp.size, rot: Math.random() * Math.PI * 2, age: 0 };
    void createImageBitmap(sp.canvas).then(bmp => (d.img = bmp));
    this.drips.push(d);
    if (this.drips.length > 150) this.drips.shift()?.img?.close();
  }

  /** 由照片手的指腹位置算出接触斑（图片像素）。 */
  private contactInput(f: Frame): PressInput | null {
    const h = f.hand,
      hand = this.fx.hand,
      skin = this.skin!,
      k = this.k;
    const touching = !!f.contact && h.touching;
    const pts = PADS.map(p => {
      const w = hand.photoPoint(p.x, p.y);
      const q = this.toImage(w.x, w.y);
      return { x: q.x, y: q.y, r: (p.r * 0.3 * hand.size) / k, w: p.w, cover: skin.alphaAt(q.x, q.y) > 110 ? 1 : 0 };
    });
    this.pads = pts;
    let total = 0,
      cx = 0,
      cy = 0;
    for (const p of pts) {
      const w = p.w * p.cover;
      total += w;
      cx += w * p.x;
      cy += w * p.y;
    }
    if (total < 0.1 || !touching) {
      this.contact.on = false;
      return null;
    }
    cx /= total;
    cy /= total;
    this.contact.x = cx;
    this.contact.y = cy;
    this.contact.on = true;
    const palm = pts[0],
      mx = (pts[2].x + pts[3].x) / 2,
      my = (pts[2].y + pts[3].y) / 2;
    const ax = palm.x - mx,
      ay = palm.y - my;
    const dist = Math.max(1, Math.hypot(ax, ay));
    const span = Math.hypot(pts[4].x - pts[1].x, pts[4].y - pts[1].y);
    const U = U_WORLD / k,
      r = this.def.rig;
    // 悬停约 0.89，按下为 1（原作手放上去就是 0.9）
    const pressure = (0.75 + 0.25 * clamp(h.pressure)) * Math.min(1, Math.sqrt(total / 1.5));
    return {
      x: cx,
      y: cy,
      vx: h.vx / k,
      vy: h.vy / k,
      axisX: ax / dist,
      axisY: ay / dist,
      length: clamp(dist * 0.51, 0.03 * U, 0.066 * U),
      width: clamp(span * 0.43, 0.035 * U, 0.079 * U),
      pressure,
      skull: 1 - ss(r.skull[0], r.skull[1], cx),
      tail: f.contact?.zone === 'tail',
      pads: pts.slice(1).filter(p => p.cover > 0),
    };
  }

  /** 顶点 = 静止位置 + 呼吸 + 头被压歪 + 耳朵被压 + 接触形变。 */
  private pose(): void {
    const skin = this.skin!,
      press = this.press!,
      r = this.def.rig;
    const U = press.U;
    const t = this.t * (this.dozing ? 0.75 : 1);
    const breath = (Math.sin(t * 1.66 - 0.22) + 0.115 * Math.sin(t * 3.32 - 0.51)) * (this.def.breath ?? 1);
    // 头：压在头上时往按的一侧轻轻歪，并随拖动略转
    const px = press.x * U,
      py = press.y * U;
    const ang = 0.044 * press.head * clamp((py - r.spine) / (0.064 * U), -1, 1) + press.shoulderY * 1.09 + 0.004 * breath;
    const hc = Math.cos(ang) - 1,
      hs = Math.sin(ang);
    const hpx = 0.0015 * U * press.head,
      hpy = 0.0009 * U * press.head;
    // 耳朵：手压在耳朵附近时向后压平（上耳顺时针，下耳逆时针）
    const ears = (r.ears ?? []).map(e => {
      const near = Math.exp(-(((px - e.c.x) / (0.067 * U)) ** 2) - ((py - e.c.y) / (0.1 * U)) ** 2);
      return { base: e.base, turn: (e.c.y < r.spine ? 0.18 : -0.15) * press.head * near };
    });
    const light = skin.light,
      k = this.k;
    for (let i = 0; i < skin.n; i++) {
      const x = skin.ix[i],
        y = skin.iy[i];
      const ch = this.wChest[i],
        wh = this.wHead[i];
      let dx = press.dx[i] + (x - r.chest.x) * ch * breath * 0.007,
        dy = press.dy[i] + (y - r.spine) * ch * breath * 0.023;
      if (wh > 0.001) {
        const rx = x - r.neck.x,
          ry = y - r.spine;
        dx += wh * (rx * hc - ry * hs - hpx);
        dy += wh * (rx * hs + ry * hc - hpy);
      }
      for (let e = 0; e < ears.length; e++) {
        const w = this.wEar[e][i] * ears[e].turn;
        if (Math.abs(w) < 1e-4) continue;
        dx += (ears[e].base.y - y) * w;
        dy += (x - ears[e].base.x) * w;
      }
      skin.px[i] = this.ox + (x + dx) * k;
      skin.py[i] = this.oy + (y + dy) * k;
      light[i * 2] = press.shade[i] + 0.018 * ch * breath;
      light[i * 2 + 1] = press.gloss[i];
    }
    skin.commit();
  }

  background(g: CanvasRenderingContext2D, v: View): void {
    this.ground.draw(g, v);
  }

  /** 滴在地面上的血：画在污渍层，浏览器用 multiply 叠到地面上，地面纹理会透出来。刚落下时从小变大。 */
  drawStains(g: CanvasRenderingContext2D): boolean {
    let any = false;
    for (const d of this.drips) {
      if (!d.img) continue;
      const k = d.age < 0.12 ? 0.55 + 0.45 * (d.age / 0.12) : 1;
      const s = d.size * k;
      g.save();
      g.translate(d.x, d.y);
      g.rotate(d.rot);
      g.drawImage(d.img, -s / 2, -s / 2, s, s);
      g.restore();
      any = true;
    }
    return any;
  }

  draw(_g: CanvasRenderingContext2D, v: View): void {
    if (!this.ready || !this.skin) return;
    GLLayer.get().begin(v, 1);
    this.ground.drawGL(v);
    this.skin.draw(GLLayer.viewMatrix(v), this.fade);
  }
}

export function nearestOnLine(p: [number, number][], x: number, y: number): { k: number; d: number; s: number; a: number } {
  let best = Infinity,
    bk = 0,
    bs = 0,
    ba = 0,
    acc = 0;
  for (let k = 0; k < p.length - 1; k++) {
    const ax = p[k][0],
      ay = p[k][1],
      bx = p[k + 1][0],
      by = p[k + 1][1];
    const dx = bx - ax,
      dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2);
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best) {
      best = d;
      bk = k;
      ba = Math.atan2(dy, dx);
      bs = acc + Math.sqrt(l2) * t;
    }
    acc += Math.sqrt(l2);
  }
  return { k: bk, d: best, s: bs, a: ba };
}

/** 由 PhotoDef 生成 Species（底部栏按钮、毛色色块、头像）。 */
export function photoSpecies(def: PhotoDef, make?: (fx: Fx, coat: Coat) => Creature): Species {
  return {
    id: def.id,
    name: def.name,
    variants: def.coats.length > 1 ? def.coats.map(c => ({ id: c.id, name: c.name, swatch: c.swatch })) : undefined,
    icon: (g, size) => {
      const img = new Image();
      img.onload = () => {
        const [x, y, s] = def.icon;
        g.save();
        g.beginPath();
        g.arc(size / 2, size / 2, size / 2, 0, TAU);
        g.clip();
        g.fillStyle = '#efe4d4';
        g.fillRect(0, 0, size, size);
        g.drawImage(img, x, y, s, s, 0, 0, size, size);
        g.restore();
      };
      img.src = `${base}pets/${def.id}/${def.coats[0].id}.webp`;
    },
    create: (fx, variant) => {
      const coat = def.coats.find(c => c.id === variant) ?? def.coats[0];
      return make ? make(fx, coat) : new PhotoPet(fx, def, coat);
    },
  };
}
