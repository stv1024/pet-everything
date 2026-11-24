import { View, visibleWorld } from '../../pets/types';
import { GLLayer, compile } from './layer';

/**
 * 流动的水面：同一张可平铺的水面照片取样两次，以不同方向、不同缩放缓慢漂移后混合，
 * 再加左上方来的光。画在 GL 层最底下（在动物之前）。
 * 用 2D canvas 的图案填充做同样的事，每帧两次全屏重采样会掉帧，所以放到 GPU 上。
 */
const VS = `#version 300 es
in vec2 aPos;
uniform mat3 uView;
out vec2 vWorld;
void main() {
  vec3 p = uView * vec3(aPos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vWorld = aPos;
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vWorld;
uniform sampler2D uTex;
uniform float uTile;
uniform float uTime;
uniform vec4 uArea;
out vec4 frag;
void main() {
  vec2 uv1 = (vWorld - vec2(14.0, 6.0) * uTime) / uTile;
  vec2 uv2 = (vWorld + vec2(11.0, -9.0) * uTime + vec2(300.0, 170.0)) / (uTile * 1.37);
  vec3 a = texture(uTex, uv1).rgb;
  vec3 b = texture(uTex, uv2).rgb;
  vec3 c = mix(a, b, 0.45);
  // 两层的亮部叠加时更亮，像焦散
  c += 0.25 * max(vec3(0.0), a + b - 1.1);
  // 光从左上方来
  vec2 lc = uArea.xy + uArea.zw * vec2(0.1, 0.05);
  float d = length(vWorld - lc) / (max(uArea.z, uArea.w) * 1.1);
  c = mix(c, vec3(0.86, 1.0, 1.0), 0.16 * (1.0 - smoothstep(0.0, 0.55, d)));
  c = mix(c, vec3(0.0, 0.1, 0.16), 0.35 * smoothstep(0.55, 1.0, d));
  frag = vec4(c, 1.0);
}`;

export class WaterPlane {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private buf: WebGLBuffer;
  private tex: WebGLTexture;
  private quad = new Float32Array(8);

  constructor(
    img: HTMLImageElement,
    private tile: number,
  ) {
    const gl = (this.gl = GLLayer.get().gl);
    this.prog = compile(gl, VS, FS);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.quad, gl.DYNAMIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  draw(v: View): void {
    const gl = this.gl;
    const a = visibleWorld(v, 60);
    const q = this.quad;
    q.set([a.x, a.y, a.x + a.w, a.y, a.x, a.y + a.h, a.x + a.w, a.y + a.h]);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, q);
    const u = (n: string) => gl.getUniformLocation(this.prog, n);
    gl.uniformMatrix3fv(u('uView'), false, GLLayer.viewMatrix(v));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(u('uTex'), 0);
    gl.uniform1f(u('uTile'), this.tile);
    gl.uniform1f(u('uTime'), v.t);
    gl.uniform4f(u('uArea'), a.x, a.y, a.w, a.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
