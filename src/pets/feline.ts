import { Bed, sfx } from '../audio/synth';
import { Bounds } from '../engine/part';
import { Spring, TAU, clamp, follow, rng } from '../engine/math';
import { Backdrop } from './backdrop';
import { catVoice, purrBed } from './felineVoice';
import { Blink, Every, Gaze, Mood, drawBlush, drawCatMouth, drawEye, softBlob, speedLike, stripe } from './kit';
import { ProneRig, ProneSpec } from './prone';
import { Contact, Creature, Frame, Fx, View } from './types';

/** 花斑：u/v 是相对部件中心、按半径归一化的坐标。 */
export interface Patch {
  part: 'body' | 'head' | 'ear';
  color: string;
  u: number;
  v: number;
  ru: number;
  rv: number;
  rot?: number;
}

export interface FelineCoat {
  id: string;
  name: string;
  swatch: string[];
  base: string;
  light: string;
  stripes?: 'tabby' | 'tiger';
  stripe?: string;
  patches?: Patch[];
  muzzle?: boolean;
  socks?: boolean;
  rings?: boolean;
  tailTip?: string;
  iris?: string;
  nose: string;
  earInner: string;
  whisker?: string;
  /** 耳背白斑（老虎） */
  earSpot?: boolean;
}

type State = 'idle' | 'grab' | 'swat' | 'doze' | 'yawn' | 'sneeze';

export interface FelineOptions {
  big: boolean;
  pitch: number;
  rug: (g: CanvasRenderingContext2D, area: Bounds) => void;
  /** 哈欠间隔（秒） */
  yawnEvery?: [number, number];
}

/** 根据毛色生成俯视花纹绘制函数。 */
export function felineLook(spec: Omit<ProneSpec, 'look'>, c: FelineCoat): ProneSpec {
  const B = spec.body,
    H = spec.head;
  const tiger = c.stripes === 'tiger';
  return {
    ...spec,
    look: {
      base: c.base,
      light: c.light,
      tailTip: c.tailTip,
      ring: c.rings ? c.stripe : undefined,
      ringMix: tiger ? 0.95 : 0.6,
      ringFreq: tiger ? 0.075 : 0.06,
      socks: c.socks,
      earInner: c.earInner,
      muzzle: c.muzzle,
      paintBody: g => {
        for (const p of c.patches ?? []) if (p.part === 'body') softBlob(g, B.x + p.u * B.rx, p.v * B.ry, p.ru * B.rx, p.rv * B.ry, p.color, p.rot ?? 0, 4);
        if (!c.stripes) return;
        const rand = rng(tiger ? 13 : 11);
        // 背脊中线
        if (!tiger) stripe(g, [[B.x - B.rx * 0.7, 0], [B.x, 2], [B.x + B.rx * 0.85, 4]], 11, c.stripe!, 4);
        const n = tiger ? 12 : 9;
        for (let i = 0; i < n; i++) {
          const x = B.x - B.rx * 0.62 + (i / (n - 1)) * B.rx * 1.45 + (rand() - 0.5) * 10;
          for (const side of [-1, 1]) {
            const pts: [number, number][] = [];
            const reach = 0.55 + rand() * 0.5;
            const start = tiger ? 0.05 + rand() * 0.12 : 0.12;
            for (let k = 0; k <= 7; k++) {
              const t = k / 7;
              const v = start + (reach - start) * t;
              pts.push([x + t * t * (tiger ? 18 : 26) + Math.sin(t * 4 + i) * 4, side * v * B.ry * 1.15]);
            }
            stripe(g, pts, tiger ? 15 + rand() * 9 : 12 + rand() * 4, c.stripe!, tiger ? 1.2 : 2.5);
          }
        }
      },
      paintHead: g => {
        for (const p of c.patches ?? []) if (p.part === 'head') softBlob(g, H.x + p.u * H.rx, H.y + p.v * H.ry, p.ru * H.rx, p.rv * H.ry, p.color, p.rot ?? 0, 4);
        if (!c.stripes) return;
        const w = tiger ? 8 : 7;
        // 额头纹：从眼睛上方向后脑延伸
        for (const k of [-1, 0, 1]) {
          const y = H.y + k * H.ry * 0.17;
          stripe(g, [[H.x - H.rx * 0.38, y * 0.8], [H.x, y], [H.x + H.rx * 0.55, y * 1.35]], w, c.stripe!, 1.2);
        }
        for (const side of [-1, 1])
          for (let k = 0; k < (tiger ? 3 : 2); k++) {
            const x = H.x - H.rx * (0.15 - k * 0.28);
            stripe(g, [[x, H.y + side * H.ry * 0.62], [x + 6, H.y + side * H.ry * 0.82], [x + 14, H.y + side * H.ry * 1.0]], w * 0.9, c.stripe!, 1.2);
          }
        if (tiger) {
          softBlob(g, H.x - H.rx * 0.5, H.y - H.ry * 0.34, H.rx * 0.13, H.ry * 0.1, c.light, 0, 3);
          softBlob(g, H.x - H.rx * 0.5, H.y + H.ry * 0.34, H.rx * 0.13, H.ry * 0.1, c.light, 0, 3);
          softBlob(g, H.x - H.rx * 0.55, H.y - H.ry * 0.75, H.rx * 0.3, H.ry * 0.22, c.light, 0, 6);
          softBlob(g, H.x - H.rx * 0.55, H.y + H.ry * 0.75, H.rx * 0.3, H.ry * 0.22, c.light, 0, 6);
        }
      },
      paintEar: (g, side, b) => {
        for (const p of c.patches ?? []) if (p.part === 'ear' && Math.sign(p.v) === side) softBlob(g, b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, p.color, 0, 2);
        if (c.earSpot) softBlob(g, b.x + b.w * 0.5, b.y + b.h * 0.5, b.w * 0.18, b.h * 0.16, '#fff8ec', 0, 2);
      },
    },
  };
}

export class Feline implements Creature {
  readonly frame: Bounds;
  private rig: ProneRig;
  private mood = new Mood(0.2, 1.0, 40, 5);
  private blink = new Blink();
  private gaze = new Gaze();
  private mouth = new Spring(0, 8, 0.7);
  private whisk = new Spring(0, 6, 0.4);
  private happyEyes = new Spring(0, 5, 0.9);
  private openEyes = new Spring(1, 6, 0.9);
  private state: State = 'idle';
  private stateT = 0;
  private cooldown = 0;
  private over = 0;
  private hearts = new Every(0.65);
  private zzz = new Every(1.5);
  private purr: Bed | null = null;
  private wasTouching = false;
  private awayBefore = 10;
  private lastMeow = -20;
  private nextYawn = 14 + Math.random() * 10;
  private t = 0;
  private backdrop: Backdrop;

  constructor(
    private fx: Fx,
    spec: ProneSpec,
    private coat: FelineCoat,
    private o: FelineOptions,
  ) {
    this.rig = new ProneRig(spec);
    this.frame = this.rig.frame;
    this.backdrop = new Backdrop((g, area) => o.rug(g, area));
  }

  get joy(): number {
    return this.mood.joy;
  }

  attachAudio(): void {
    if (!this.purr) this.purr = purrBed(this.fx.au, this.o.big ? 1.9 : 1);
  }

  dispose(): void {
    this.purr?.stop();
    this.purr = null;
  }

  hit(x: number, y: number): Contact | null {
    return this.rig.hit(x, y);
  }

  private score(f: Frame): number {
    const c = f.contact;
    if (!c) return 0;
    const h = f.hand;
    const pref: Record<string, number> = { head: 1, cheek: 1.35, face: 0.2, ear: 0.5, back: 0.9, side: 0.55, rump: 1.0, tail: -0.7, paw: -0.15 };
    let s = pref[c.zone] ?? 0;
    if (h.speed < 30) return s > 0 ? 0.3 : s * 0.5;
    s *= speedLike(h.speed, 50, 750, 1700);
    if (c.grain !== undefined && (c.zone === 'back' || c.zone === 'side' || c.zone === 'tail') && h.speed > 80) {
      const along = (h.vx * Math.cos(c.grain) + h.vy * Math.sin(c.grain)) / h.speed;
      if (along > 0.3) s += 0.4;
      else if (along < -0.3) s -= 1.1;
    }
    if (h.scratch > 0.4 && (c.zone === 'cheek' || c.zone === 'head' || c.zone === 'rump')) s += 1.3 * h.scratch;
    if (this.rig.bodyFur.messiness > 0.3) s -= 0.4;
    return s;
  }

  update(f: Frame): void {
    const dt = f.dt;
    this.t += dt;
    const h = f.hand,
      au = this.fx.au,
      fx = this.fx,
      rig = this.rig,
      ctrl = rig.ctrl,
      S = rig.spec;
    const big = this.o.big,
      pitch = this.o.pitch;
    const touching = !!f.contact && h.touching;
    if (touching && !this.wasTouching) this.awayBefore = this.mood.awayTime;
    const score = this.state === 'doze' ? 0.6 : this.score(f);
    this.mood.update(f, score);
    const mood = this.mood;
    const zone = f.contact?.zone ?? '';
    const headZone = zone === 'head' || zone === 'cheek' || zone === 'face' || zone === 'ear';
    const headC = { x: S.head.x, y: S.head.y };
    this.stateT += dt;
    this.cooldown -= dt;
    const say = (fn: () => void) => au.ready && fn();
    const greet = () => say(() => (big ? catVoice.chuff(au) : catVoice.chirp(au, pitch)));

    // 过度刺激：撸太快、太久会被抱住咬手（猫的真实习性）
    if (touching && zone !== 'tail') this.over += dt * (h.speed > 1100 ? 0.45 : h.scratch > 0.5 && zone !== 'cheek' && zone !== 'head' ? 0.3 : 0.012);
    else this.over = Math.max(0, this.over - dt * 0.2);

    if (touching && !this.wasTouching) {
      if (this.state === 'doze') {
        this.enter('idle');
        say(() => (big ? catVoice.chuff(au) : catVoice.chirp(au, pitch * 0.9)));
      } else if (this.awayBefore > 2.5 && this.state === 'idle') greet();
    }
    if (h.tap && this.state === 'idle' && headZone) {
      this.happyEyes.kick(30);
      say(() => (big ? catVoice.chuff(au) : catVoice.chirp(au, pitch * 1.1)));
      fx.particles.heart(h.x, h.y - 30, 14);
      mood.joy = clamp(mood.joy + 0.04);
    }
    switch (this.state) {
      case 'idle':
        if (touching && this.over > 1 && this.cooldown <= 0) {
          this.enter('grab');
          say(() => (big ? catVoice.growl(au, 2, 0.4) : catVoice.meow(au, pitch * 1.2, 0.6)));
        } else if (mood.annoy > 0.8 && this.cooldown <= 0) {
          this.enter('swat');
          say(() => catVoice.hiss(au, big ? 2 : 1));
        } else if (mood.annoy > 0.45 && this.cooldown <= 0 && touching) {
          say(() => catVoice.growl(au, big ? 2.2 : 1));
          fx.particles.emit('anger', headC.x + 40, headC.y - S.head.ry * 1.1, { size: 22, max: 1, color: '#e8445a', vy: -20 });
          this.cooldown = 2.2;
        } else if (touching && zone === 'face' && mood.zoneTime > 1.6 && this.cooldown <= 0) {
          this.enter('sneeze');
        } else if (!touching && mood.awayTime > 3 && mood.joy > 0.72) {
          this.enter('doze');
        } else if (this.t > this.nextYawn && mood.joy > (big ? 0.2 : 0.55) && (big || !touching)) {
          this.enter('yawn');
          say(() => catVoice.yawn(au, big ? 1.8 : 1));
        }
        if (touching && mood.joy > 0.62 && this.t - this.lastMeow > 14 && score > 0.6 && Math.random() < dt * 0.3) {
          this.lastMeow = this.t;
          say(() => (big ? catVoice.chuff(au) : catVoice.meow(au, pitch, 0.8)));
        }
        break;
      case 'grab':
        fx.hand.shiver = 1;
        if (Math.floor(this.stateT / 0.14) !== Math.floor((this.stateT - dt) / 0.14)) say(() => sfx.thump(au, 0.1, 1.8));
        if (this.stateT > 1.9 || !h.present) {
          fx.hand.shiver = 0;
          fx.hand.kick(0, 420);
          this.enter('idle');
          this.cooldown = 6;
          this.over = 0;
          mood.annoy = Math.max(0, mood.annoy - 0.2);
          greet();
        }
        break;
      case 'swat':
        if (this.stateT > 0.2 && this.stateT - dt <= 0.2 && h.present) {
          fx.hand.kick(-260, 520);
          fx.shake(0.25);
          fx.vibrate(30);
          say(() => catVoice.swat(au));
          fx.particles.burst('star', h.x, h.y, 5, { color: '#ffd24a', speed: 220, size: 9, max: 0.6 });
        }
        if (this.stateT > 0.7) {
          this.enter('idle');
          mood.annoy = 0.35;
          this.cooldown = 3;
        }
        break;
      case 'sneeze':
        if (this.stateT > 0.55 && this.stateT - dt <= 0.55) {
          say(() => {
            sfx.whoosh(au, 0.12);
            catVoice.chirp(au, pitch * 1.4);
          });
          fx.particles.burst('puff', rig.faceCenter.x - 50, rig.faceCenter.y, 6, { color: 'rgba(255,255,255,0.7)', speed: 160, up: Math.PI, spread: 1.2, size: 10, max: 0.6, drag: 3 });
          fx.hand.kick(-200, 0);
        }
        if (this.stateT > 1) {
          this.enter('idle');
          this.cooldown = 2;
        }
        break;
      case 'doze':
        if (this.zzz.tick(dt, true)) fx.particles.emit('z', headC.x + 10, headC.y - S.head.ry * 1.1, { vx: 25, vy: -40, size: 13, max: 2.2, color: 'rgba(90,110,160,0.8)', text: 'z', drag: 0.2 });
        mood.joy = Math.max(mood.joy, 0.6);
        break;
      case 'yawn':
        if (big && this.stateT > 0.45 && this.stateT - dt <= 0.45 && h.present) {
          // 大猫的哈欠很吓人：手会缩一下
          const d = Math.hypot(h.x - headC.x, h.y - headC.y);
          if (d < 360) {
            fx.hand.kick(Math.sign(h.x - headC.x || 1) * 260, 360);
            fx.particles.emit('text', headC.x - 30, headC.y - S.head.ry * 1.3, { text: '!', size: 34, color: '#ff8a3d', max: 0.8, vy: -30 });
            fx.vibrate(20);
          }
        }
        if (this.stateT > 1.6) {
          this.enter('idle');
          const [a, b] = this.o.yawnEvery ?? [25, 50];
          this.nextYawn = this.t + a + Math.random() * (b - a);
        }
        break;
    }

    if (this.hearts.tick(dt, touching && mood.joy > 0.42 && score > 0.5)) {
      fx.particles.heart(h.x + (Math.random() - 0.5) * 40, h.y - 40, 12 + mood.joy * 6);
      if (Math.random() < 0.35) say(() => sfx.pop(au, 1.6 + Math.random() * 0.3, 0.05));
    }

    if (this.purr) {
      let level = 0;
      if (this.state === 'doze') level = 0.3;
      else if (mood.joy > 0.18) level = (0.2 + 0.8 * mood.joy) * (0.45 + 0.55 * mood.petting) * clamp((mood.joy - 0.18) / 0.15);
      if (this.state === 'swat' || mood.annoy > 0.5) level = 0;
      this.purr.set(level * (big ? 0.85 : 0.7), level > this.purr.level ? 0.25 : 0.6);
      this.purr.rate(this.state === 'doze' ? 0.85 : 1);
    }

    // ---------- 表情 ----------
    const joy = mood.joy,
      annoy = mood.annoy;
    const dozing = this.state === 'doze';
    const yawnK = this.state === 'yawn' ? Math.sin(clamp(this.stateT / 1.5) * Math.PI) : 0;
    const sneezeK = this.state === 'sneeze' ? (this.stateT < 0.55 ? this.stateT / 0.55 : 0) : 0;
    this.blink.step(dt, !dozing);
    this.openEyes.step(dozing || sneezeK > 0.4 ? 0 : yawnK > 0.3 ? 0.1 : (1 - 0.4 * clamp((joy - 0.45) / 0.4)) * (annoy > 0.5 ? 0.85 : 1), dt);
    this.happyEyes.step((joy > 0.82 && mood.petting > 0.35) || this.state === 'grab' ? 1 : 0, dt);
    this.mouth.step(this.state === 'swat' ? 0.9 : this.state === 'grab' ? 0.7 : yawnK * 1.6, dt);
    this.whisk.step(annoy > 0.4 ? -1 : h.present && !touching ? 0.6 : 0, dt);
    this.gaze.step(dt, f, headC.x, headC.y, 380);

    // ---------- 头 ----------
    let tx = 0,
      ty = 0,
      tr = 0;
    const toHand = Math.atan2(h.y - headC.y, h.x - headC.x);
    const facing = Math.atan2(Math.sin(toHand - Math.PI), Math.cos(toHand - Math.PI));
    if (h.present && this.state === 'idle' && !dozing) tr = clamp(facing * 0.25, -0.28, 0.28);
    if (touching && headZone && this.state === 'idle') {
      tx = clamp((h.x - headC.x) * 0.05, -10, 10);
      ty = clamp((h.y - headC.y) * 0.08, -12, 12);
      tr += clamp(h.vy / 2600, -0.12, 0.12);
    }
    if (this.state === 'grab' && h.present) {
      tx = clamp((h.x - headC.x) * 0.15, -24, 30);
      ty = clamp((h.y - headC.y) * 0.15, -24, 24);
      tr = clamp(facing * 0.5, -0.5, 0.5) + Math.sin(this.stateT * 20) * 0.05;
    }
    if (this.state === 'swat') tr = -0.15;
    if (sneezeK > 0) tx = -sneezeK * 8;
    if (this.state === 'sneeze' && this.stateT > 0.55) tx = -14 * Math.exp(-(this.stateT - 0.55) * 8);
    if (dozing) {
      tr = 0.18;
      tx = 6;
    }
    if (yawnK > 0) tr -= yawnK * 0.1;
    ctrl.headX.step(tx, dt);
    ctrl.headY.step(ty, dt);
    ctrl.headRot.step(tr, dt);

    // ---------- 耳朵 ----------
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      // flat 为正：耳尖朝后贴平
      let flat = annoy > 0.4 ? 0.6 * clamp((annoy - 0.4) / 0.3) : h.present && !touching ? -0.08 : 0;
      if (dozing) flat = 0.15;
      if (touching) {
        const ec = rig.ears[i].center();
        const d = Math.hypot(h.x - ec.x, h.y - ec.y);
        if (d < 75) flat += 0.75 * (1 - d / 75) * (0.6 + 0.4 * h.pressure);
      }
      if (Math.random() < dt * 0.12) ctrl.ear[i].kick((Math.random() < 0.5 ? 1 : -1) * 6);
      ctrl.ear[i].step(-side * flat, dt);
    }

    // ---------- 抬臀 ----------
    ctrl.rump.step(touching && zone === 'rump' && h.speed > 40 ? 1 : 0, dt);

    // ---------- 尾巴 ----------
    const tail = rig.tail;
    const lash = annoy > 0.3 ? 0.2 * clamp((annoy - 0.3) / 0.4) : 0;
    const swayRate = annoy > 0.3 ? 7 : dozing ? 0.7 : 1.4;
    const raise = ctrl.rump.value;
    for (let i = 0; i < tail.count; i++) {
      const w = i / tail.count;
      ctrl.tail[i] = Math.sin(this.t * swayRate - i * 0.45) * (0.035 + lash) * w * w * 2.4 - tail.rest[i] * 0.55 * raise + (raise > 0.3 ? Math.sin(this.t * 30 + i) * 0.02 * raise : 0);
    }
    if (touching && zone === 'tail') {
      const n = tail.nearest(h.x, h.y);
      const a = tail.angleAt(n.s);
      const perp = (-Math.sin(a) * h.vx + Math.cos(a) * h.vy) * dt;
      const k0 = Math.floor((n.s / tail.length) * tail.count);
      for (let i = Math.max(0, k0 - 3); i < tail.count; i++) tail.joints[i].kick(perp * 0.06 * (i >= k0 ? 1 : 0.4));
    }

    // ---------- 前爪 ----------
    ctrl.pawsOver = this.state === 'grab';
    const P = S.paws;
    for (let i = 0; i < 2; i++) {
      const p = ctrl.paw[i];
      const side = i === 0 ? -1 : 1;
      const restY = side * P.y + S.head.y * 0.3;
      let px = 0,
        py = 0,
        pr = 0;
      if (this.state === 'grab' && h.present) {
        px = h.x + 26 - P.x;
        py = h.y + side * 34 - restY;
        pr = -side * 0.5;
      } else if (this.state === 'swat' && i === 1) {
        const k = Math.sin(clamp(this.stateT / 0.5) * Math.PI);
        px = (h.present ? clamp(h.x - P.x, -60, 220) : 60) * k;
        py = (h.present ? clamp(h.y - restY, -80, 200) : 80) * k;
        pr = -0.6 * k;
      } else if (joy > 0.85 && touching) {
        // 踩奶
        px = -Math.max(0, Math.sin(this.t * 4.2 + i * Math.PI)) * 9;
      }
      p.x = follow(p.x, px, dt, 0.06);
      p.y = follow(p.y, py, dt, 0.06);
      p.rot = follow(p.rot, pr, dt, 0.08);
    }
    ctrl.breathRate = dozing ? 0.75 : 1;
    ctrl.breathDepth = dozing ? 1.5 : 1;

    rig.update(dt, fx.warp, f.touch);
    this.wasTouching = touching;
  }

  private enter(s: State): void {
    this.state = s;
    this.stateT = 0;
  }

  background(g: CanvasRenderingContext2D, v: View): void {
    this.backdrop.draw(g, v);
  }

  draw(g: CanvasRenderingContext2D): void {
    this.rig.draw(g, this.coat.base);
    this.drawFace(g);
  }

  drawOver(g: CanvasRenderingContext2D): void {
    if (this.rig.ctrl.pawsOver) this.rig.drawPaws(g);
  }

  private drawFace(g: CanvasRenderingContext2D): void {
    const c = this.coat,
      big = this.o.big;
    const mood = this.mood;
    g.save();
    this.rig.faceFrame(g);
    // 脸部坐标：+y 指向鼻子
    const open = this.openEyes.value * this.blink.value;
    const ex = big ? 30 : 31;
    for (const side of [-1, 1]) {
      drawEye(g, side * ex, -16, big ? 11 : 13.5, big ? 13 : 17, {
        open,
        happy: this.happyEyes.value,
        lookX: -this.gaze.y.value,
        lookY: this.gaze.x.value * -0.5,
        iris: c.iris,
        shock: this.state === 'swat' ? 0.6 : 0,
        angry: clamp((mood.annoy - 0.35) / 0.4),
        side,
        lid: c.base,
      });
    }
    drawBlush(g, -48, 14, 17, 12, clamp(mood.joy * 1.2));
    drawBlush(g, 48, 14, 17, 12, clamp(mood.joy * 1.2));
    const ny = big ? 34 : 30;
    const nw = big ? 12 : 8.5;
    g.fillStyle = c.nose;
    g.beginPath();
    g.moveTo(-nw, ny - nw * 0.45);
    g.quadraticCurveTo(0, ny - nw * 0.8, nw, ny - nw * 0.45);
    g.quadraticCurveTo(nw * 0.3, ny + nw * 0.6, 0, ny + nw * 0.65);
    g.quadraticCurveTo(-nw * 0.3, ny + nw * 0.6, -nw, ny - nw * 0.45);
    g.fill();
    const mo = clamp(this.mouth.value, 0, 1.6);
    const mw = big ? 19 : 14,
      my = ny + nw * 0.65;
    drawCatMouth(g, 0, my, mw, mo, big ? '#3a2418' : '#6a4238', '#b8404e', mood.joy);
    if (mo > 0.35) {
      // 獠牙
      g.fillStyle = '#fffaf0';
      const fl = mw * (big ? 0.75 : 0.35) * clamp(mo / 1.2);
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(side * mw * 0.42, my + 1);
        g.lineTo(side * mw * 0.3, my + 1 + fl);
        g.lineTo(side * mw * 0.16, my + 1);
        g.closePath();
        g.fill();
      }
    }
    g.strokeStyle = c.whisker ?? 'rgba(255,255,255,0.85)';
    g.lineWidth = 1.5;
    g.lineCap = 'round';
    const wk = this.whisk.value;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const x0 = side * (big ? 22 : 16),
          y0 = ny + 6 + k * 5;
        const L = (big ? 80 : 66) - k * 6;
        const a = (k - 1) * 0.22 - wk * 0.15 + Math.sin(this.t * 2 + k) * 0.02;
        g.beginPath();
        g.moveTo(x0, y0);
        g.quadraticCurveTo(x0 + side * L * 0.55, y0 + Math.sin(a) * L * 0.5 - 4, x0 + side * L * Math.cos(a), y0 + Math.sin(a) * L + 8);
        g.stroke();
      }
    }
    g.restore();
  }
}

export function felineIcon(g: CanvasRenderingContext2D, size: number, c: FelineCoat, big = false): void {
  const s = size / 100;
  g.save();
  g.scale(s, s);
  const cx = 50,
    cy = 56;
  g.fillStyle = c.base;
  for (const side of [-1, 1]) {
    g.beginPath();
    if (big) g.arc(cx + side * 25, cy - 26, 11, 0, TAU);
    else {
      g.moveTo(cx + side * 10, cy - 28);
      g.lineTo(cx + side * 32, cy - 44);
      g.lineTo(cx + side * 34, cy - 12);
    }
    g.fill();
  }
  g.beginPath();
  g.ellipse(cx, cy, 34, 29, 0, 0, TAU);
  g.fill();
  if (c.patches) {
    g.save();
    g.clip();
    c.patches
      .filter(p => p.part === 'head')
      .forEach((p, i) => {
        g.fillStyle = p.color;
        g.beginPath();
        g.ellipse(cx + (i ? 15 : -15), cy - 15, 20, 16, 0, 0, TAU);
        g.fill();
      });
    g.restore();
  }
  if (c.stripes) {
    g.strokeStyle = c.stripe!;
    g.lineWidth = 3.2;
    g.lineCap = 'round';
    for (const dx of [-7, 0, 7]) {
      g.beginPath();
      g.moveTo(cx + dx, cy - 27);
      g.lineTo(cx + dx * 1.2, cy - 17);
      g.stroke();
    }
  }
  if (c.muzzle) {
    g.fillStyle = c.light;
    g.beginPath();
    g.ellipse(cx, cy + 12, 15, 11, 0, 0, TAU);
    g.fill();
  }
  for (const side of [-1, 1]) {
    if (c.iris) {
      g.fillStyle = c.iris;
      g.beginPath();
      g.ellipse(cx + side * 13, cy - 1, 5.5, 6.5, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#1d1414';
      g.beginPath();
      g.ellipse(cx + side * 13, cy - 1, 2.6, 5, 0, 0, TAU);
      g.fill();
    } else {
      g.fillStyle = '#2a1c1a';
      g.beginPath();
      g.ellipse(cx + side * 13, cy - 1, 4.8, 6, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(cx + side * 13 - 1.5, cy - 3, 1.7, 0, TAU);
      g.fill();
    }
  }
  g.fillStyle = c.nose;
  g.beginPath();
  g.ellipse(cx, cy + 8, big ? 5 : 3.5, big ? 3.5 : 2.6, 0, 0, TAU);
  g.fill();
  g.restore();
}
