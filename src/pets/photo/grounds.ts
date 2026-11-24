import { loadImage } from '../../engine/gl/layer';
import { WaterPlane } from '../../engine/gl/water';
import { View, visibleWorld } from '../types';

/**
 * 写实背景：小尺寸可平铺照片（public/pets/<kind>.webp）在世界坐标里重复铺开，再加窗光明暗。
 * 水面在 GL 层里画（WaterPlane：两层错开、缓慢漂移的同一贴图），2D 背景只铺底色。
 */
export type GroundKind = 'rug' | 'grass' | 'sand' | 'water' | 'steel';

const SPEC: Record<GroundKind, { file: string; tile: number; light: [string, string] }> = {
  rug: { file: 'rug.webp', tile: 460, light: ['rgba(255,236,200,0.22)', 'rgba(60,35,15,0.28)'] },
  grass: { file: 'grass.webp', tile: 560, light: ['rgba(255,245,200,0.18)', 'rgba(10,30,5,0.3)'] },
  sand: { file: 'sand.webp', tile: 700, light: ['rgba(255,240,210,0.2)', 'rgba(60,40,20,0.25)'] },
  water: { file: 'water.webp', tile: 900, light: ['rgba(220,255,255,0.16)', 'rgba(0,25,40,0.35)'] },
  steel: { file: 'steel.webp', tile: 520, light: ['rgba(255,170,110,0.14)', 'rgba(0,0,0,0.4)'] },
};

const base = import.meta.env.BASE_URL;
const cache = new Map<string, Promise<HTMLImageElement>>();

export class Ground {
  private img: HTMLImageElement | null = null;
  private pat: CanvasPattern | null = null;
  private patCtx: CanvasRenderingContext2D | null = null;
  private water: WaterPlane | null = null;

  constructor(readonly kind: GroundKind) {}

  async load(): Promise<void> {
    const f = SPEC[this.kind].file;
    if (!cache.has(f)) cache.set(f, loadImage(`${base}pets/${f}`));
    this.img = await cache.get(f)!;
    if (this.kind === 'water') this.water = new WaterPlane(this.img, SPEC.water.tile);
  }

  /** 画在 GL 层最底下的部分（水面）。在 GLLayer.begin() 之后、动物之前调用。 */
  drawGL(v: View): void {
    this.water?.draw(v);
  }

  draw(g: CanvasRenderingContext2D, v: View): void {
    const a = visibleWorld(v, 40),
      s = SPEC[this.kind];
    if (!this.img) {
      g.fillStyle = '#e9dcc8';
      g.fillRect(a.x, a.y, a.w, a.h);
      return;
    }
    if (this.water) {
      // 水面在 GL 层里画，这里只铺底色
      g.fillStyle = '#0d4f5c';
      g.fillRect(a.x, a.y, a.w, a.h);
      return;
    }
    if (!this.pat || this.patCtx !== g) {
      this.pat = g.createPattern(this.img, 'repeat');
      this.patCtx = g;
    }
    this.pat!.setTransform(new DOMMatrix().scale(s.tile / this.img.naturalWidth));
    g.fillStyle = this.pat!;
    g.fillRect(a.x, a.y, a.w, a.h);
    // 光从左上方来
    const cx = a.x + a.w * 0.1,
      cy = a.y + a.h * 0.05;
    const lg = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(a.w, a.h) * 1.1);
    lg.addColorStop(0, s.light[0]);
    lg.addColorStop(0.55, 'rgba(0,0,0,0)');
    lg.addColorStop(1, s.light[1]);
    g.fillStyle = lg;
    g.fillRect(a.x, a.y, a.w, a.h);
  }
}
