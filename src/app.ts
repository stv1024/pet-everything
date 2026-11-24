import { AudioEngine } from './audio/engine';
import { ContactSound } from './audio/contact';
import { Warp } from './engine/deform';
import { Hand } from './engine/hand';
import { Particles } from './engine/particles';
import { Spring2, clamp, follow } from './engine/math';
import { Touch } from './engine/fur';
import { GLLayer } from './engine/gl/layer';
import { Contact, Creature, Frame, Fx, HandState, Species, View, applyCamera, toWorld } from './pets/types';

/** 指针状态（CSS 像素）。 */
interface Pointer {
  x: number;
  y: number;
  type: string;
  present: boolean;
  down: boolean;
  pressure: number;
  downAt: number;
  downX: number;
  downY: number;
  moved: number;
}

const TOUCH_LIFT = 30;
const TOP_SPACE = 70;
const DOCK_SPACE = 150;

export class App {
  readonly au = new AudioEngine();
  readonly particles = new Particles();
  readonly hand = new Hand();
  readonly warp = new Warp();
  readonly fx: Fx;
  creature: Creature | null = null;
  species: Species | null = null;
  view: View = { w: 1, h: 1, dpr: 1, scale: 1, ox: 0, oy: 0, rot: 0, t: 0 };
  /** 0..1 */
  joy = 0;
  /** 自动抚摸（键盘） */
  auto = false;
  /** 背景层（2D）；中间是 GL 层；前景层（2D）画手和粒子 */
  private g: CanvasRenderingContext2D;
  private top: HTMLCanvasElement;
  /** 地面污渍层（2D，CSS multiply 叠在背景上，在动物下面）。背景画布上直接 drawImage 会走慢路径掉帧 */
  private stain: HTMLCanvasElement;
  private gs: CanvasRenderingContext2D;
  private stainUsed = false;
  private gt: CanvasRenderingContext2D;
  private gl: GLLayer;
  private contactSound: ContactSound | null = null;
  private pointer: Pointer = { x: 0, y: 0, type: 'mouse', present: false, down: false, pressure: 0.5, downAt: 0, downX: 0, downY: 0, moved: 0 };
  private shakeOff = new Spring2(0, 0, 9, 0.35);
  private time = 0;
  private last = 0;
  private tapPending = false;
  private scratchLevel = 0;
  private reversals: number[] = [];
  private lastSignX = 0;
  private lastSignY = 0;
  private trail: { t: number; x: number; y: number }[] = [];
  private autoT = 0;
  private wasTouching = false;
  private camScale = 0;
  private camX = 0;
  private camY = 0;

  constructor(
    private stage: HTMLElement,
    private canvas: HTMLCanvasElement,
  ) {
    this.g = canvas.getContext('2d', { alpha: false })!;
    this.gl = GLLayer.get();
    this.top = document.createElement('canvas');
    this.top.setAttribute('aria-hidden', 'true');
    this.stain = document.createElement('canvas');
    this.stain.setAttribute('aria-hidden', 'true');
    this.stain.className = 'stain-layer';
    this.gs = this.stain.getContext('2d')!;
    canvas.after(this.stain, this.gl.canvas, this.top);
    this.gt = this.top.getContext('2d')!;
    this.fx = {
      au: this.au,
      particles: this.particles,
      hand: this.hand,
      warp: this.warp,
      shake: (a: number) => {
        const ang = Math.random() * Math.PI * 2;
        this.shakeOff.x.kick(Math.cos(ang) * a * 60);
        this.shakeOff.y.kick(Math.sin(ang) * a * 60);
      },
      vibrate: (p: number | number[]) => {
        if (this.pointer.type === 'touch' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(p);
          } catch {
            /* ignore */
          }
        }
      },
    };
    this.au.whenReady(au => {
      this.contactSound = new ContactSound(au);
      this.creature?.attachAudio?.();
    });
    this.bindInput();
    new ResizeObserver(() => this.resize()).observe(stage);
    this.resize();
    document.addEventListener('visibilitychange', () => {
      this.au.suspend(document.hidden);
      this.last = 0;
    });
    requestAnimationFrame(this.frame);
  }

  setSpecies(sp: Species, variant?: string): void {
    this.creature?.dispose();
    this.species = sp;
    this.warp.list.length = 0;
    this.warp.release();
    this.particles.list.length = 0;
    this.creature = sp.create(this.fx, variant);
    if (this.au.ctx) this.creature.attachAudio?.();
    this.camScale = 0;
    this.resize();
  }

  private resize(): void {
    const r = this.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(r.width * dpr)),
      h = Math.max(1, Math.round(r.height * dpr));
    for (const cv of [this.canvas, this.stain, this.top])
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
    this.view.w = r.width;
    this.view.h = r.height;
    this.view.dpr = dpr;
    this.layout(true);
  }

  private layout(snap = false): void {
    const c = this.creature;
    if (!c) return;
    const v = this.view;
    const f = c.frame;
    const top = Math.min(TOP_SPACE, v.h * 0.1),
      bottom = Math.min(DOCK_SPACE, v.h * 0.18);
    const availW = v.w * 0.9,
      availH = Math.max(120, v.h - top - bottom);
    // 竖屏且横着放太小时，镜头转 90°：动物竖着趴、头朝向玩家（屏幕下方），脸是正的
    const flat = Math.min(availW / f.w, availH / f.h);
    const turned = Math.min(availW / f.h, availH / f.w);
    const rot = turned > flat * 1.25 ? -Math.PI / 2 : 0;
    const scale = rot ? turned : flat;
    const cx = f.x + f.w / 2,
      cy = f.y + f.h / 2;
    const cs = Math.cos(rot),
      sn = Math.sin(rot);
    const sx = v.w / 2 - (cx * cs - cy * sn) * scale;
    const sy = top + availH / 2 - (cx * sn + cy * cs) * scale;
    if (snap || this.camScale === 0 || rot !== v.rot) {
      this.camScale = scale;
      this.camX = sx;
      this.camY = sy;
    }
    v.rot = rot;
    v.scale = this.camScale;
    v.ox = this.camX + this.shakeOff.x.value;
    v.oy = this.camY + this.shakeOff.y.value;
  }

  private bindInput(): void {
    const st = this.stage;
    const p = this.pointer;
    const read = (e: PointerEvent) => {
      const r = st.getBoundingClientRect();
      p.x = e.clientX - r.left;
      p.y = e.clientY - r.top;
      p.type = e.pointerType;
      const sensed = e.pointerType === 'pen' || (e.pointerType === 'touch' && e.pressure > 0 && Math.abs(e.pressure - 0.5) > 0.02);
      p.pressure = sensed ? clamp(e.pressure * 1.1) : e.pointerType === 'mouse' ? 0.55 : 0.8;
      if (p.down) p.moved = Math.max(p.moved, Math.hypot(p.x - p.downX, p.y - p.downY));
    };
    // 鼠标靠近界面控件时：收起手、显示系统光标，方便点按
    const ui = () => Array.from(document.querySelectorAll<HTMLElement>('.pets, .variants:not(:empty), .icon-button'));
    const nearUI = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return false;
      const m = 40;
      return ui().some(el => {
        const r = el.getBoundingClientRect();
        return e.clientX > r.left - m && e.clientX < r.right + m && e.clientY > r.top - m && e.clientY < r.bottom + m;
      });
    };
    const hover = (e: PointerEvent) => {
      const near = nearUI(e) && !p.down;
      st.classList.toggle('near-ui', near);
      p.present = !near;
    };
    st.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' && !p.down) return;
      read(e);
      hover(e);
      this.auto = false;
    });
    st.addEventListener('pointerenter', e => {
      if (e.pointerType === 'mouse') {
        read(e);
        hover(e);
      }
    });
    st.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse') {
        p.present = false;
        p.down = false;
      }
    });
    st.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      this.au.unlock();
      read(e);
      p.present = true;
      p.down = true;
      p.downAt = performance.now();
      p.downX = p.x;
      p.downY = p.y;
      p.moved = 0;
      this.auto = false;
      if (e.pointerType !== 'mouse') {
        try {
          st.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        // 手指一落下就把手放到位，避免从远处滑过来
        const w = toWorld(this.view, p.x, p.y - TOUCH_LIFT);
        this.hand.x = w.x;
        this.hand.y = w.y;
      }
      st.focus({ preventScroll: true });
      e.preventDefault();
    });
    const up = (e: PointerEvent) => {
      if (!p.down) return;
      const quick = performance.now() - p.downAt < 260 && p.moved < 10;
      if (quick) this.tapPending = true;
      p.down = false;
      if (e.pointerType !== 'mouse') p.present = false;
    };
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', e => {
      p.down = false;
      if (e.pointerType !== 'mouse') p.present = false;
    });
    window.addEventListener('blur', () => {
      p.down = false;
      this.auto = false;
    });
    st.addEventListener('contextmenu', e => e.preventDefault());
  }

  /** 性能统计：最近若干帧 step / render 的平均耗时（毫秒） */
  readonly perf = { step: 0, render: 0, frame: 0 };
  private frame = (ms: number): void => {
    requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.05, (ms - this.last) / 1000) : 1 / 60;
    this.perf.frame += ((ms - this.last) - this.perf.frame) * 0.05;
    this.last = ms;
    if (document.hidden) return;
    this.time += dt;
    const t0 = performance.now();
    this.step(dt);
    const t1 = performance.now();
    this.render();
    const t2 = performance.now();
    this.perf.step += (t1 - t0 - this.perf.step) * 0.05;
    this.perf.render += (t2 - t1 - this.perf.render) * 0.05;
  };

  private step(dt: number): void {
    const c = this.creature;
    if (!c) return;
    const v = this.view;
    v.t = this.time;
    this.shakeOff.step(0, 0, dt);
    this.layout();
    const p = this.pointer;
    const hand = this.hand;
    const size = c.handSize ?? clamp(c.frame.w / 640, 0.75, 1.25);
    hand.size = size;

    // 目标点
    let present = p.present;
    const target = toWorld(v, p.x, p.y - (p.type === 'touch' ? TOUCH_LIFT : 0));
    let tx = target.x,
      ty = target.y;
    if (this.auto) {
      this.autoT += dt;
      const f = c.frame;
      const k = 0.5 - 0.5 * Math.cos(this.autoT * 1.6);
      tx = f.x + f.w * (0.3 + 0.38 * k);
      ty = f.y + f.h * (0.42 + 0.03 * Math.sin(this.autoT * 1.6));
      present = true;
    }
    hand.visible = present;
    // 先用上一帧位置判断接触
    const cp = hand.contactPoint();
    const probe = present ? c.hit(cp.x, cp.y) : null;
    const contact: Contact | null = probe;
    const touching = !!contact && present && (p.type === 'mouse' || p.down || this.auto);
    const pressing = p.down && p.type === 'mouse' ? 1 : p.type !== 'mouse' && p.down ? clamp((p.pressure - 0.5) * 1.6, 0, 1) : 0;
    if (!present && !this.auto) {
      // 手离开：朝屏幕下方退出
      const out = toWorld(v, p.x, v.h + 200);
      tx = hand.x + (out.x - hand.x) * 0.08;
      ty = hand.y + (out.y - hand.y) * 0.08;
    }
    hand.step(dt, tx, ty, touching, pressing);
    const pressure = touching ? (this.auto ? 0.7 : p.type === 'mouse' ? (p.down ? 1 : 0.55) : p.pressure) : 0;
    const speed = Math.hypot(hand.vx, hand.vy);

    // 挠痒检测：小范围内快速来回
    const now = this.time;
    this.trail.push({ t: now, x: hand.x, y: hand.y });
    while (this.trail.length && now - this.trail[0].t > 0.7) this.trail.shift();
    const sx = Math.sign(hand.vx) * (Math.abs(hand.vx) > 140 ? 1 : 0),
      sy = Math.sign(hand.vy) * (Math.abs(hand.vy) > 140 ? 1 : 0);
    if (sx && sx !== this.lastSignX) {
      if (this.lastSignX) this.reversals.push(now);
      this.lastSignX = sx;
    }
    if (sy && sy !== this.lastSignY) {
      if (this.lastSignY) this.reversals.push(now);
      this.lastSignY = sy;
    }
    this.reversals = this.reversals.filter(t => now - t < 0.7);
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const q of this.trail) {
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y);
      y1 = Math.max(y1, q.y);
    }
    const small = Math.max(x1 - x0, y1 - y0) < 110 * size;
    const scratching = touching && small && this.reversals.length >= 3;
    this.scratchLevel = follow(this.scratchLevel, scratching ? 1 : 0, dt, scratching ? 0.12 : 0.25);

    // 软体形变
    if (touching) {
      // 俯视按压：皮毛向四周摊开，并被手带着滑一点
      const spread = 4 + 7 * pressure;
      this.warp.press(hand.x, hand.y, 55 * size, clamp(hand.vx * 0.014, -12, 12), clamp(hand.vy * 0.014, -12, 12), spread);
    } else this.warp.release();
    const tap = this.tapPending && touching;
    if (this.tapPending) {
      this.tapPending = false;
      if (tap) {
        this.warp.poke(hand.x, hand.y, 60 * size, 0, 0, 220);
        hand.press.kick(14);
      }
    }
    this.warp.step(dt);

    const hs: HandState = {
      x: hand.x,
      y: hand.y,
      vx: hand.vx,
      vy: hand.vy,
      speed,
      present,
      touching,
      pressure,
      tap,
      scratch: this.scratchLevel,
    };
    const touch: Touch = { active: touching, x: hand.x, y: hand.y, r: 46 * size, vx: hand.vx, vy: hand.vy, p: pressure };
    const fr: Frame = { t: this.time, dt, hand: hs, contact: touching ? contact : null, touch };
    c.update(fr);
    this.particles.step(dt);
    if (this.contactSound) {
      if (touching && contact) this.contactSound.update(dt, contact.material, speed, pressure, true);
      else if (this.wasTouching) this.contactSound.silence();
    }
    this.wasTouching = touching;
    this.joy = c.joy;
  }

  private render(): void {
    const g = this.g,
      v = this.view,
      c = this.creature;
    if (!c) return;
    applyCamera(g, v);
    c.background(g, v);
    const gs = this.gs;
    if (c.drawStains || this.stainUsed) {
      gs.setTransform(1, 0, 0, 1, 0, 0);
      gs.clearRect(0, 0, this.stain.width, this.stain.height);
      applyCamera(gs, v);
      this.stainUsed = c.drawStains?.(gs, v) ?? false;
    }
    const gl = this.gl,
      wasGL = gl.used;
    gl.used = false;
    c.draw(g, v);
    if (wasGL && !gl.used) gl.clear();
    const t = this.gt;
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.clearRect(0, 0, this.top.width, this.top.height);
    applyCamera(t, v);
    // 手臂从屏幕下方伸进来
    const sw = v.w * 0.5 + (this.pointer.x - v.w * 0.5) * 0.35 + v.w * 0.12;
    const root = toWorld(v, sw, v.h + 380 * v.scale);
    this.hand.draw(t, root.x, root.y);
    c.drawOver?.(t, v);
    this.particles.draw(t);
  }
}
