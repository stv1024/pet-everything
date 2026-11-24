import { Touch } from '../fur';
import { clamp } from '../math';
import { GLLayer, compile } from './layer';

/**
 * 写实"皮"：一张抠好图的照片贴在网格上。
 * - 网格顶点每帧由调用者摆位（呼吸、手的接触形变），写入 px/py 后调用 commit()。
 * - 每个顶点还带两个明暗量（light）：shade 为凹陷/隆起的明暗，trail 为顺毛/逆毛的光泽。
 * - 毛流方向场：从照片明暗的结构张量算出，再用物种给的"先验方向"定正反。
 * - 炸毛场（nap）：逆毛抚过的地方毛尖被掀起，变亮、变乱，约 1 秒后落回。
 * - 血渍层（stain）：半分辨率的 2D 画布，画在照片上、随网格形变；用照片明暗调制，像渗进了毛里。
 */

const VS = `#version 300 es
in vec2 aPos;
in vec2 aUV;
in vec2 aLight;
uniform mat3 uView;
uniform vec2 uOffset;
out vec2 vUV;
out vec2 vLight;
void main() {
  vec3 p = uView * vec3(aPos + uOffset, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vUV = aUV;
  vLight = aLight;
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec2 vLight;
uniform sampler2D uTex;
uniform sampler2D uFur;
uniform sampler2D uNap;
uniform vec2 uTexel;
uniform float uSheen;
uniform sampler2D uShadow;
uniform float uMode;
uniform float uShadowAlpha;
uniform float uAlpha;
uniform sampler2D uStain;
out vec4 frag;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  if (uMode > 0.5) {
    float a = texture(uShadow, vUV).a * uShadowAlpha * uAlpha;
    frag = vec4(vec3(0.16, 0.09, 0.04) * a, a);
    return;
  }
  vec2 nap = texture(uNap, vUV).xy * 2.0 - 1.0;
  vec2 fur = texture(uFur, vUV).xy * 2.0 - 1.0;
  float along = dot(nap, fur);
  // 逆着推最乱，横着推也会乱一点，顺着推则更顺滑
  float against = clamp((length(nap) * 0.6 - along) / 1.6, 0.0, 1.0);
  float sleek = max(0.0, along);
  // 逆毛：毛尖被掀起，取样点沿推动方向偏移并加一点抖动，看起来乱
  vec2 cell = floor(vUV / uTexel / 3.0);
  vec2 jitter = vec2(hash(cell), hash(cell + 17.0)) * 2.0 - 1.0;
  vec2 uv = vUV - nap * uTexel * 4.0 + jitter * uTexel * 3.0 * against;
  vec4 s = texture(uTex, uv);
  vec4 base = texture(uTex, vUV);
  // 颜色取偏移处（去预乘），轮廓仍用原处 alpha，避免边缘跟着抖
  // 只在内部（两处都不透明）用偏移取样，边缘保持原样，避免除以小 alpha 放大误差
  float inner = smoothstep(0.75, 0.98, min(s.a, base.a));
  vec4 c = mix(base, vec4(s.rgb / max(s.a, 0.001) * base.a, base.a), inner);
  // 逆毛反光（露出浅色底绒），顺毛略深更有光泽
  vec3 col = c.rgb + vec3(uSheen) * against * c.a;
  col *= 1.0 - 0.08 * sleek;
  // 接触明暗：凹陷背光处暗、迎光处亮；trail 为刚抚过的毛的光泽，细毛（亮于周围的像素）反光更多
  float shade = vLight.x, trail = vLight.y;
  float lum = dot(c.rgb, vec3(0.3, 0.59, 0.11));
  float blur = dot(textureLod(uTex, vUV, 3.0).rgb, vec3(0.3, 0.59, 0.11));
  float fib = clamp((lum - blur) * 5.0, -1.0, 1.0);
  col = col * (1.0 + 0.92 * shade)
      + c.a * vec3(1.0, 0.96, 0.9) * (0.073 * shade - 0.027 * trail + abs(trail) * (0.012 + 0.032 * fib) + 0.015 * max(-trail, 0.0) * max(fib, 0.0));
  // 血渍：保留照片的明暗细节（毛丝、刺），只把颜色换成血色
  vec4 st = texture(uStain, vUV);
  if (st.a > 0.002) {
    float detail = clamp(lum / max(blur, 0.04), 0.55, 1.5);
    vec3 blood = st.rgb * mix(1.0, detail, 0.7);
    col = mix(col, blood * c.a, st.a * smoothstep(0.3, 0.9, c.a));
  }
  frag = vec4(clamp(col, vec3(0.0), vec3(c.a)), c.a) * uAlpha;
}`;

export interface SkinOptions {
  image: HTMLImageElement;
  /** 图片左上角在世界坐标的位置 */
  x: number;
  y: number;
  /** 世界单位 / 图片像素 */
  scale: number;
  /** 网格单元大小（图片像素） */
  cell?: number;
  /** 毛流先验方向（图片坐标），用于确定方向正反和低纹理区域 */
  prior: (px: number, py: number) => [number, number];
  /** 逆毛反光亮度 */
  sheen?: number;
  /** 投影模糊（图片像素） */
  shadowBlur?: number;
  /** 炸毛落回的时间常数（秒），短毛约 0.9，长毛约 2 */
  settle?: number;
  /** 影子浓度倍数 */
  shadow?: number;
}

export class PhotoSkin {
  readonly w: number;
  readonly h: number;
  readonly cols: number;
  readonly rows: number;
  readonly n: number;
  /** 顶点的静止位置（图片像素） */
  readonly ix: Float32Array;
  readonly iy: Float32Array;
  /** 顶点当前世界坐标，调用者写入 */
  readonly px: Float32Array;
  readonly py: Float32Array;
  /** 每个顶点的明暗（shade, trail），调用者写入 */
  readonly light: Float32Array;
  readonly x0: number;
  readonly y0: number;
  readonly scale: number;
  /** 低分辨率 alpha（命中测试用） */
  private alpha: Uint8Array;
  private aw: number;
  private ah: number;
  /** 毛流方向场与倒毛场（同分辨率网格） */
  private gw: number;
  private gh: number;
  private gs: number;
  private fur: Float32Array;
  private nap: Float32Array;
  private napBytes: Uint8Array;
  private napDirty = true;
  /** 平均逆毛程度 */
  messiness = 0;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private posBuf: WebGLBuffer;
  private posData: Float32Array;
  private lightBuf: WebGLBuffer;
  private count: number;
  private tex: WebGLTexture;
  private furTex: WebGLTexture;
  private napTex: WebGLTexture;
  private shadowTex: WebGLTexture;
  private sheen: number;
  private settle: number;
  /** 血渍层：第一次画时才创建 */
  private stain: { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D; tex: WebGLTexture; dirty: number[] | null } | null = null;
  private emptyTex: WebGLTexture;
  private shadow: number;

  constructor(o: SkinOptions) {
    const layer = GLLayer.get();
    const gl = (this.gl = layer.gl);
    const img = o.image;
    this.w = img.naturalWidth;
    this.h = img.naturalHeight;
    this.x0 = o.x;
    this.y0 = o.y;
    this.scale = o.scale;
    this.sheen = o.sheen ?? 0.14;
    this.settle = o.settle ?? 0.92;
    this.shadow = o.shadow ?? 1;
    const cell = o.cell ?? 14;
    this.cols = Math.ceil(this.w / cell);
    this.rows = Math.ceil(this.h / cell);
    const nv = (this.n = (this.cols + 1) * (this.rows + 1));
    this.ix = new Float32Array(nv);
    this.iy = new Float32Array(nv);
    this.px = new Float32Array(nv);
    this.py = new Float32Array(nv);
    this.light = new Float32Array(nv * 2);
    for (let r = 0; r <= this.rows; r++)
      for (let c = 0; c <= this.cols; c++) {
        const i = r * (this.cols + 1) + c;
        this.ix[i] = Math.min(this.w, c * cell);
        this.iy[i] = Math.min(this.h, r * cell);
        this.px[i] = o.x + this.ix[i] * o.scale;
        this.py[i] = o.y + this.iy[i] * o.scale;
      }

    // 像素数据
    const cv = document.createElement('canvas');
    cv.width = this.w;
    cv.height = this.h;
    const cg = cv.getContext('2d', { willReadFrequently: true })!;
    cg.drawImage(img, 0, 0);
    const pix = cg.getImageData(0, 0, this.w, this.h).data;

    // alpha（1/2 分辨率）
    this.aw = Math.ceil(this.w / 2);
    this.ah = Math.ceil(this.h / 2);
    this.alpha = new Uint8Array(this.aw * this.ah);
    for (let y = 0; y < this.ah; y++) for (let x = 0; x < this.aw; x++) this.alpha[y * this.aw + x] = pix[((y * 2) * this.w + x * 2) * 4 + 3];

    // 只保留有内容的网格单元
    const idx: number[] = [];
    const filled = (x: number, y: number) => this.alphaAt(x, y) > 8;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const xa = c * cell,
          ya = r * cell;
        let any = false;
        for (let sy = -cell * 2; sy <= cell * 3 && !any; sy += cell / 2) for (let sx = -cell * 2; sx <= cell * 3 && !any; sx += cell / 2) any = filled(xa + sx, ya + sy);
        if (!any) continue;
        const i = r * (this.cols + 1) + c;
        idx.push(i, i + 1, i + this.cols + 1, i + 1, i + this.cols + 2, i + this.cols + 1);
      }
    this.count = idx.length;

    // 毛流方向场（结构张量）
    const gs = (this.gs = 4);
    const gw = (this.gw = Math.ceil(this.w / gs)),
      gh = (this.gh = Math.ceil(this.h / gs));
    const L = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        let s = 0;
        for (let dy = 0; dy < gs; dy++)
          for (let dx = 0; dx < gs; dx++) {
            const k = (Math.min(this.h - 1, y * gs + dy) * this.w + Math.min(this.w - 1, x * gs + dx)) * 4;
            s += 0.3 * pix[k] + 0.59 * pix[k + 1] + 0.11 * pix[k + 2];
          }
        L[y * gw + x] = s / (gs * gs);
      }
    const jxx = new Float32Array(gw * gh),
      jyy = new Float32Array(gw * gh),
      jxy = new Float32Array(gw * gh);
    for (let y = 1; y < gh - 1; y++)
      for (let x = 1; x < gw - 1; x++) {
        const i = y * gw + x;
        const gx = L[i + 1] - L[i - 1] + 0.5 * (L[i - gw + 1] - L[i - gw - 1] + L[i + gw + 1] - L[i + gw - 1]);
        const gy = L[i + gw] - L[i - gw] + 0.5 * (L[i + gw - 1] - L[i - gw - 1] + L[i + gw + 1] - L[i - gw + 1]);
        jxx[i] = gx * gx;
        jyy[i] = gy * gy;
        jxy[i] = gx * gy;
      }
    const blur = (a: Float32Array, r: number) => {
      const t = new Float32Array(a.length);
      for (let y = 0; y < gh; y++)
        for (let x = 0; x < gw; x++) {
          let s = 0,
            n = 0;
          for (let k = -r; k <= r; k++) {
            const xx = x + k;
            if (xx < 0 || xx >= gw) continue;
            s += a[y * gw + xx];
            n++;
          }
          t[y * gw + x] = s / n;
        }
      for (let y = 0; y < gh; y++)
        for (let x = 0; x < gw; x++) {
          let s = 0,
            n = 0;
          for (let k = -r; k <= r; k++) {
            const yy = y + k;
            if (yy < 0 || yy >= gh) continue;
            s += t[yy * gw + x];
            n++;
          }
          a[y * gw + x] = s / n;
        }
    };
    blur(jxx, 5);
    blur(jyy, 5);
    blur(jxy, 5);
    this.fur = new Float32Array(gw * gh * 2);
    const furBytes = new Uint8Array(gw * gh * 4);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const a = jxx[i],
          b = jyy[i],
          c = jxy[i];
        const theta = 0.5 * Math.atan2(2 * c, a - b) + Math.PI / 2;
        const coh = Math.hypot(a - b, 2 * c) / (a + b + 60);
        let dx = Math.cos(theta),
          dy = Math.sin(theta);
        const [px0, py0] = o.prior(x * gs + gs / 2, y * gs + gs / 2);
        if (dx * px0 + dy * py0 < 0) {
          dx = -dx;
          dy = -dy;
        }
        const k = clamp(coh * 1.2, 0, 0.5);
        let fx = dx * k + px0 * (1 - k),
          fy = dy * k + py0 * (1 - k);
        const l = Math.hypot(fx, fy) || 1;
        fx /= l;
        fy /= l;
        this.fur[i * 2] = fx;
        this.fur[i * 2 + 1] = fy;
        furBytes[i * 4] = Math.round((fx * 0.5 + 0.5) * 255);
        furBytes[i * 4 + 1] = Math.round((fy * 0.5 + 0.5) * 255);
        furBytes[i * 4 + 3] = 255;
      }
    this.nap = new Float32Array(gw * gh * 2);
    this.napBytes = new Uint8Array(gw * gh * 4).fill(128);

    // GL 资源
    this.prog = compile(gl, VS, FS);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.posData = new Float32Array(nv * 2);
    this.posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.posData, gl.DYNAMIC_DRAW);
    const pl = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(pl);
    gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
    const uv = new Float32Array(nv * 2);
    for (let i = 0; i < nv; i++) {
      uv[i * 2] = this.ix[i] / this.w;
      uv[i * 2 + 1] = this.iy[i] / this.h;
    }
    const uvBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    const ul = gl.getAttribLocation(this.prog, 'aUV');
    gl.enableVertexAttribArray(ul);
    gl.vertexAttribPointer(ul, 2, gl.FLOAT, false, 0, 0);
    this.lightBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.light, gl.DYNAMIC_DRAW);
    const ll = gl.getAttribLocation(this.prog, 'aLight');
    gl.enableVertexAttribArray(ll);
    gl.vertexAttribPointer(ll, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const small = (data: Uint8Array) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.furTex = small(furBytes);
    this.napTex = small(this.napBytes);
    this.emptyTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.emptyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    // 阴影：alpha 模糊
    const sc = document.createElement('canvas');
    sc.width = this.w;
    sc.height = this.h;
    const sg = sc.getContext('2d')!;
    sg.filter = `blur(${o.shadowBlur ?? 14}px)`;
    sg.drawImage(img, 0, 0);
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** 图片坐标处的 alpha（0..255）。 */
  alphaAt(px: number, py: number): number {
    const x = Math.round(px / 2),
      y = Math.round(py / 2);
    if (x < 0 || y < 0 || x >= this.aw || y >= this.ah) return 0;
    return this.alpha[y * this.aw + x];
  }

  /** 静止状态下：世界坐标 → 图片坐标。 */
  toImage(x: number, y: number): [number, number] {
    return [(x - this.x0) / this.scale, (y - this.y0) / this.scale];
  }

  /** 图片坐标处的毛流方向。 */
  furAt(px: number, py: number): [number, number] {
    const x = clamp(Math.round(px / this.gs), 0, this.gw - 1),
      y = clamp(Math.round(py / this.gs), 0, this.gh - 1);
    const i = (y * this.gw + x) * 2;
    return [this.fur[i], this.fur[i + 1]];
  }

  /** 图片坐标处的毛流方向（双线性插值，给顶点用）。 */
  furSmooth(px: number, py: number, out: [number, number]): void {
    const fx = clamp(px / this.gs - 0.5, 0, this.gw - 1.001),
      fy = clamp(py / this.gs - 0.5, 0, this.gh - 1.001);
    const x = fx | 0,
      y = fy | 0,
      tx = fx - x,
      ty = fy - y;
    const i = (y * this.gw + x) * 2,
      j = i + this.gw * 2;
    const f = this.fur;
    const ax = f[i] + (f[i + 2] - f[i]) * tx,
      ay = f[i + 1] + (f[i + 3] - f[i + 1]) * tx;
    const bx = f[j] + (f[j + 2] - f[j]) * tx,
      by = f[j + 1] + (f[j + 3] - f[j + 1]) * tx;
    out[0] = ax + (bx - ax) * ty;
    out[1] = ay + (by - ay) * ty;
  }

  /**
   * 手抚过：更新炸毛场。hx/hy 为手在图片坐标的位置，vx/vy 为图片坐标速度（像素/秒）。
   * 逆毛抚过才掀起毛尖；顺毛抚过会把已掀起的毛梳平。
   */
  stroke(dt: number, touch: Touch, hx: number, hy: number, vx: number, vy: number, radius: number): void {
    const decay = Math.exp(-dt / this.settle);
    const gw = this.gw,
      gh = this.gh,
      gs = this.gs;
    let mess = 0,
      cnt = 0;
    const speed = Math.hypot(vx, vy);
    const active = touch.active && speed > 25;
    const ux = speed > 0 ? vx / speed : 0,
      uy = speed > 0 ? vy / speed : 0;
    const strength = Math.min(1, speed / 450);
    const r2 = radius * radius;
    const x0 = active ? Math.max(0, Math.floor((hx - radius * 2) / gs)) : 1,
      x1 = active ? Math.min(gw - 1, Math.ceil((hx + radius * 2) / gs)) : 0;
    const y0 = active ? Math.max(0, Math.floor((hy - radius * 2) / gs)) : 1,
      y1 = active ? Math.min(gh - 1, Math.ceil((hy + radius * 2) / gs)) : 0;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = (y * gw + x) * 2;
        let nx = this.nap[i] * decay,
          ny = this.nap[i + 1] * decay;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
          const dx = x * gs - hx,
            dy = y * gs - hy;
          const w = Math.exp(-(dx * dx + dy * dy) / r2) * touch.p;
          if (w > 0.01) {
            const k = 1 - Math.exp(-dt * w * 16);
            nx += (ux * strength - nx) * k;
            ny += (uy * strength - ny) * k;
          }
        }
        this.nap[i] = nx;
        this.nap[i + 1] = ny;
        const fi = i;
        const along = nx * this.fur[fi] + ny * this.fur[fi + 1];
        if (along < 0 && this.alpha[Math.min(this.ah - 1, (y * gs) >> 1) * this.aw + Math.min(this.aw - 1, (x * gs) >> 1)] > 128) mess -= along;
        cnt++;
        const b = i * 2;
        this.napBytes[b] = Math.round((nx * 0.5 + 0.5) * 255);
        this.napBytes[b + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      }
    this.messiness = (mess / cnt) * 4;
    this.napDirty = true;
  }

  /**
   * 在血渍层上画。fn 收到的画布已按图片像素坐标设好变换；
   * x0..y1 为可能画到的范围（图片像素），只上传这部分。
   */
  paintStain(fn: (g: CanvasRenderingContext2D) => void, x0: number, y0: number, x1: number, y1: number): void {
    const k = 0.5;
    if (!this.stain) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(this.w * k);
      canvas.height = Math.ceil(this.h * k);
      const g = canvas.getContext('2d', { willReadFrequently: true })!;
      const gl = this.gl;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.stain = { canvas, g, tex, dirty: null };
    }
    const st = this.stain;
    st.g.setTransform(k, 0, 0, k, 0, 0);
    fn(st.g);
    const W = st.canvas.width,
      H = st.canvas.height;
    const r = [clamp(Math.floor(x0 * k) - 1, 0, W), clamp(Math.floor(y0 * k) - 1, 0, H), clamp(Math.ceil(x1 * k) + 1, 0, W), clamp(Math.ceil(y1 * k) + 1, 0, H)];
    const d = st.dirty;
    st.dirty = d ? [Math.min(d[0], r[0]), Math.min(d[1], r[1]), Math.max(d[2], r[2]), Math.max(d[3], r[3])] : r;
  }

  /** 调用者写完 px/py 和 light 后调用。 */
  commit(): void {
    for (let i = 0; i < this.n; i++) {
      this.posData[i * 2] = this.px[i];
      this.posData[i * 2 + 1] = this.py[i];
    }
  }

  /** alpha：整体透明度（淡入用） */
  draw(view: Float32Array, alpha = 1): void {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.posData);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lightBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.light);
    const u = (n: string) => gl.getUniformLocation(this.prog, n);
    gl.uniformMatrix3fv(u('uView'), false, view);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(u('uTex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.furTex);
    gl.uniform1i(u('uFur'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.napTex);
    if (this.napDirty) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.gw, this.gh, gl.RGBA, gl.UNSIGNED_BYTE, this.napBytes);
      this.napDirty = false;
    }
    gl.uniform1i(u('uNap'), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(u('uShadow'), 3);
    gl.activeTexture(gl.TEXTURE4);
    const st = this.stain;
    if (st) {
      gl.bindTexture(gl.TEXTURE_2D, st.tex);
      const d = st.dirty;
      if (d && d[2] > d[0] && d[3] > d[1]) {
        const img = st.g.getImageData(d[0], d[1], d[2] - d[0], d[3] - d[1]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, d[0], d[1], gl.RGBA, gl.UNSIGNED_BYTE, img);
      }
      st.dirty = null;
    } else gl.bindTexture(gl.TEXTURE_2D, this.emptyTex);
    gl.uniform1i(u('uStain'), 4);
    gl.uniform2f(u('uTexel'), 1 / this.w, 1 / this.h);
    gl.uniform1f(u('uSheen'), this.sheen);
    gl.uniform1f(u('uAlpha'), alpha);
    // 阴影（光从左上方来，影子落在右下）
    gl.uniform1f(u('uMode'), 1);
    gl.uniform1f(u('uShadowAlpha'), 0.42 * this.shadow);
    gl.uniform2f(u('uOffset'), 16 * this.scale, 22 * this.scale);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    gl.uniform1f(u('uShadowAlpha'), 0.3 * this.shadow);
    gl.uniform2f(u('uOffset'), 4 * this.scale, 6 * this.scale);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    gl.uniform1f(u('uMode'), 0);
    gl.uniform2f(u('uOffset'), 0, 0);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  resetNap(): void {
    this.nap.fill(0);
    this.napBytes.fill(128);
    this.napDirty = true;
  }
}
