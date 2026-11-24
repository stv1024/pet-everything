import { View } from '../../pets/types';

/**
 * 共享的 WebGL2 画布。它是舞台里的一层，夹在背景画布和前景画布（手、粒子）之间，
 * 由浏览器合成。不要每帧把它 drawImage 到 2D 画布上：那样要同步 GPU，帧率掉得很厉害。
 */
export class GLLayer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  private static inst: GLLayer | null = null;

  static get(): GLLayer {
    return (GLLayer.inst ??= new GLLayer());
  }

  /** 本帧是否画过；没画的帧由 App 清空 */
  used = false;
  private opacity = 1;

  private constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) throw new Error('WebGL2 不可用');
    this.gl = gl;
  }

  /** 按视图大小准备画布并清空。 */
  begin(v: View, opacity = 1): void {
    this.used = true;
    if (opacity !== this.opacity) {
      this.opacity = opacity;
      this.canvas.style.opacity = String(opacity);
    }
    const w = Math.max(1, Math.round(v.w * v.dpr)),
      h = Math.max(1, Math.round(v.h * v.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const gl = this.gl;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** 世界坐标 → 裁剪坐标的 3x3 矩阵（列主序）。 */
  static viewMatrix(v: View): Float32Array {
    const W = Math.max(1, Math.round(v.w * v.dpr)),
      H = Math.max(1, Math.round(v.h * v.dpr));
    const k = v.dpr * v.scale,
      c = Math.cos(v.rot),
      s = Math.sin(v.rot);
    // 设备像素：px = k*(c*x - s*y) + dpr*ox；py = k*(s*x + c*y) + dpr*oy
    const ax = (2 / W) * k * c,
      bx = (2 / W) * -k * s,
      tx = (2 / W) * v.dpr * v.ox - 1;
    const ay = (-2 / H) * k * s,
      by = (-2 / H) * k * c,
      ty = 1 - (2 / H) * v.dpr * v.oy;
    return new Float32Array([ax, ay, 0, bx, by, 0, tx, ty, 1]);
  }

  /** 没有物种用 GL 的帧：清空一次即可。 */
  clear(): void {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

export function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败：${url}`));
    img.src = url;
  });
}
