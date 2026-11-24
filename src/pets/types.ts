import { AudioEngine, Material } from '../audio/engine';
import { Warp } from '../engine/deform';
import { Hand } from '../engine/hand';
import { Bounds } from '../engine/part';
import { Particles } from '../engine/particles';
import { Touch } from '../engine/fur';
import { Vec } from '../engine/math';

/** 屏幕与世界坐标的映射。竖屏时镜头旋转 90°，动物竖着趴。 */
export interface View {
  /** CSS 像素 */
  w: number;
  h: number;
  dpr: number;
  /** 世界 → CSS 像素：s = o + R(rot) · p · scale */
  scale: number;
  ox: number;
  oy: number;
  rot: number;
  t: number;
}

export function toScreen(v: View, x: number, y: number): Vec {
  const c = Math.cos(v.rot),
    s = Math.sin(v.rot);
  return { x: v.ox + (x * c - y * s) * v.scale, y: v.oy + (x * s + y * c) * v.scale };
}

export function toWorld(v: View, sx: number, sy: number): Vec {
  const c = Math.cos(v.rot),
    s = Math.sin(v.rot);
  const dx = (sx - v.ox) / v.scale,
    dy = (sy - v.oy) / v.scale;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** 把画布变换设为世界坐标。 */
export function applyCamera(g: CanvasRenderingContext2D, v: View): void {
  const k = v.dpr * v.scale,
    c = Math.cos(v.rot),
    s = Math.sin(v.rot);
  g.setTransform(k * c, k * s, -k * s, k * c, v.dpr * v.ox, v.dpr * v.oy);
}

/** 屏幕可见区域对应的世界范围（外接矩形）。 */
export function visibleWorld(v: View, pad = 0): Bounds {
  const pts = [toWorld(v, 0, 0), toWorld(v, v.w, 0), toWorld(v, 0, v.h), toWorld(v, v.w, v.h)];
  const xs = pts.map(p => p.x),
    ys = pts.map(p => p.y);
  const x0 = Math.min(...xs) - pad,
    y0 = Math.min(...ys) - pad;
  return { x: x0, y: y0, w: Math.max(...xs) + pad - x0, h: Math.max(...ys) + pad - y0 };
}

export interface Contact {
  zone: string;
  material: Material;
  /** 接触处毛的朝向（世界角度），无毛为 undefined */
  grain?: number;
  /** 按压时表面凹陷方向（单位向量），默认向下 */
  dent?: [number, number];
}

export interface HandState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  /** 指针在舞台上 */
  present: boolean;
  /** 贴在动物身上 */
  touching: boolean;
  /** 0..1 */
  pressure: number;
  /** 本帧轻拍 */
  tap: boolean;
  /** 0..1 挠痒（小范围快速来回） */
  scratch: number;
}

export interface Fx {
  au: AudioEngine;
  particles: Particles;
  hand: Hand;
  warp: Warp;
  shake(amount: number): void;
  vibrate(pattern: number | number[]): void;
}

export interface Frame {
  t: number;
  dt: number;
  hand: HandState;
  contact: Contact | null;
  /** 给毛发用的手部作用 */
  touch: Touch;
}

export interface Creature {
  /** 镜头要框住的世界范围 */
  readonly frame: Bounds;
  /** 0..1，开心程度（驱动呼噜等持续声；调试时读 window.__pet.joy） */
  readonly joy: number;
  /** 手的大小（缺省按 frame 宽度估算）。写实物种固定手的大小，动物的大小由图片比例决定 */
  readonly handSize?: number;
  hit(x: number, y: number): Contact | null;
  update(f: Frame): void;
  background(g: CanvasRenderingContext2D, v: View): void;
  draw(g: CanvasRenderingContext2D, v: View): void;
  /** 画在手上面的东西（例如抓住手的爪子、合上的嘴） */
  drawOver?(g: CanvasRenderingContext2D, v: View): void;
  /** 音频就绪后创建持续声 */
  attachAudio?(): void;
  dispose(): void;
}

export interface Variant {
  id: string;
  name: string;
  /** 色块，用于选择按钮 */
  swatch: string[];
}

export interface Species {
  id: string;
  name: string;
  variants?: Variant[];
  /** 画头像（在 0..1 的正方形中央） */
  icon(g: CanvasRenderingContext2D, size: number): void;
  create(fx: Fx, variant?: string): Creature;
}
