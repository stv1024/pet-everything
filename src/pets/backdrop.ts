import { makeCanvas } from '../engine/part';
import { Bounds } from '../engine/part';
import { View, applyCamera, visibleWorld } from './types';

/**
 * 静态背景缓存：镜头不变时只画一次，之后每帧直接贴图。
 * painter 在世界坐标里画，area 是需要覆盖的世界范围。
 */
export class Backdrop {
  private canvas: HTMLCanvasElement | null = null;
  private key = '';
  private ox = 0;
  private oy = 0;
  private edge = '#000';

  constructor(private painter: (g: CanvasRenderingContext2D, area: Bounds, v: View) => void) {}

  draw(g: CanvasRenderingContext2D, v: View): void {
    const key = `${v.w}|${v.h}|${v.dpr}|${v.scale.toFixed(4)}|${v.rot}`;
    if (key !== this.key || !this.canvas) {
      this.key = key;
      const c = (this.canvas ??= makeCanvas(1, 1));
      c.width = Math.round(v.w * v.dpr);
      c.height = Math.round(v.h * v.dpr);
      const bg = c.getContext('2d')!;
      applyCamera(bg, v);
      this.painter(bg, visibleWorld(v, 120 / v.scale), v);
      this.ox = v.ox;
      this.oy = v.oy;
      const d = bg.getImageData(0, 0, 1, 1).data;
      this.edge = `rgb(${d[0]},${d[1]},${d[2]})`;
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (v.ox !== this.ox || v.oy !== this.oy) {
      g.fillStyle = this.edge;
      g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    }
    g.drawImage(this.canvas, Math.round((v.ox - this.ox) * v.dpr), Math.round((v.oy - this.oy) * v.dpr));
    g.restore();
  }
}
