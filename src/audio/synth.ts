import { AudioEngine } from './engine';

type Curve = [number, number][]; // [时间(秒), 值]

/** 按时间点安排参数曲线（线性或指数）。 */
export function curve(p: AudioParam, t0: number, pts: Curve, exp = false): void {
  p.cancelScheduledValues(t0);
  p.setValueAtTime(pts[0][1], t0 + pts[0][0]);
  for (let i = 1; i < pts.length; i++) {
    const [t, v] = pts[i];
    if (exp) p.exponentialRampToValueAtTime(Math.max(1e-4, v), t0 + t);
    else p.linearRampToValueAtTime(v, t0 + t);
  }
}

/** 包络：起音 a、保持 h、释放 r 秒（指数衰减）。 */
export function env(g: GainNode, t0: number, peak: number, a: number, h: number, r: number): number {
  const p = g.gain;
  p.cancelScheduledValues(t0);
  p.setValueAtTime(0, t0);
  p.linearRampToValueAtTime(peak, t0 + a);
  p.setValueAtTime(peak, t0 + a + h);
  p.setTargetAtTime(0, t0 + a + h, r / 4);
  return t0 + a + h + r;
}

export interface ToneOpts {
  type?: OscillatorType;
  /** 频率曲线 */
  f: Curve;
  gain?: number;
  a?: number;
  h?: number;
  r?: number;
  /** 颤音 */
  vib?: { rate: number; depth: number };
  lowpass?: number;
  highpass?: number;
  delay?: number;
  pan?: number;
  dest?: AudioNode;
}

export function tone(au: AudioEngine, o: ToneOpts): void {
  const ctx = au.ctx;
  if (!ctx) return;
  const t0 = ctx.currentTime + (o.delay ?? 0) + 0.005;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  curve(osc.frequency, t0, o.f, true);
  const g = ctx.createGain();
  const end = env(g, t0, o.gain ?? 0.2, o.a ?? 0.008, o.h ?? 0.05, o.r ?? 0.2);
  let node: AudioNode = osc;
  if (o.vib) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vib.rate;
    const lg = ctx.createGain();
    lg.gain.value = o.vib.depth;
    lfo.connect(lg).connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(end + 0.1);
  }
  if (o.lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lowpass;
    node = node.connect(f);
  }
  if (o.highpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = o.highpass;
    node = node.connect(f);
  }
  node = node.connect(g);
  if (o.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    node = node.connect(p);
  }
  node.connect(o.dest ?? au.sfx);
  osc.start(t0);
  osc.stop(end + 0.05);
}

export interface NoiseOpts {
  kind?: 'white' | 'pink' | 'brown';
  filter?: BiquadFilterType;
  /** 滤波频率曲线 */
  f: Curve;
  q?: number;
  gain?: number;
  a?: number;
  h?: number;
  r?: number;
  delay?: number;
  pan?: number;
  rate?: number;
  dest?: AudioNode;
}

export function noise(au: AudioEngine, o: NoiseOpts): void {
  const ctx = au.ctx;
  if (!ctx) return;
  const t0 = ctx.currentTime + (o.delay ?? 0) + 0.005;
  const src = ctx.createBufferSource();
  src.buffer = o.kind === 'pink' ? au.pink : o.kind === 'brown' ? au.brown : au.noise;
  src.playbackRate.value = o.rate ?? 1;
  const off = Math.random() * 1.5;
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? 'bandpass';
  f.Q.value = o.q ?? 1;
  curve(f.frequency, t0, o.f, true);
  const g = ctx.createGain();
  const end = env(g, t0, o.gain ?? 0.2, o.a ?? 0.005, o.h ?? 0.03, o.r ?? 0.15);
  let node: AudioNode = src.connect(f).connect(g);
  if (o.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    node = node.connect(p);
  }
  node.connect(o.dest ?? au.sfx);
  src.start(t0, off);
  src.stop(end + 0.05);
}

export interface VoiceOpts {
  /** 基频曲线 */
  f0: Curve;
  /** 共振峰：每个是 [频率曲线, 增益, Q] */
  formants: [Curve, number, number][];
  dur: number;
  gain?: number;
  /** 气声比例 0..1 */
  breath?: number;
  a?: number;
  r?: number;
  vib?: { rate: number; depth: number };
  delay?: number;
  type?: OscillatorType;
  pan?: number;
  /** 抖动，模拟声带不稳定 */
  jitter?: number;
}

/** 简易共振峰合成：声源（锯齿+噪声）→ 并联带通。用于各种叫声。 */
export function voice(au: AudioEngine, o: VoiceOpts): void {
  const ctx = au.ctx;
  if (!ctx) return;
  const t0 = ctx.currentTime + (o.delay ?? 0) + 0.005;
  const end = t0 + o.dur;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sawtooth';
  curve(osc.frequency, t0, o.f0, true);
  const stops: AudioScheduledSourceNode[] = [osc];
  if (o.vib) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vib.rate;
    const lg = ctx.createGain();
    lg.gain.value = o.vib.depth;
    lfo.connect(lg).connect(osc.frequency);
    stops.push(lfo);
  }
  if (o.jitter) {
    const jn = ctx.createBufferSource();
    jn.buffer = au.pink;
    jn.loop = true;
    const jg = ctx.createGain();
    jg.gain.value = o.jitter;
    jn.connect(jg).connect(osc.frequency);
    stops.push(jn);
  }
  const src = ctx.createGain();
  src.gain.value = 1 - (o.breath ?? 0.15);
  osc.connect(src);
  const br = ctx.createBufferSource();
  br.buffer = au.noise;
  br.loop = true;
  const bg = ctx.createGain();
  bg.gain.value = (o.breath ?? 0.15) * 1.4;
  br.connect(bg);
  stops.push(br);
  const out = ctx.createGain();
  const amp = o.gain ?? 0.25;
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(amp, t0 + (o.a ?? 0.03));
  out.gain.setValueAtTime(amp, Math.max(t0 + (o.a ?? 0.03), end - (o.r ?? 0.12)));
  out.gain.linearRampToValueAtTime(0, end);
  for (const [fc, g, q] of o.formants) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    curve(bp.frequency, t0, fc, true);
    const fg = ctx.createGain();
    fg.gain.value = g;
    src.connect(bp);
    bg.connect(bp);
    bp.connect(fg).connect(out);
  }
  let node: AudioNode = out;
  if (o.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = o.pan;
    node = node.connect(p);
  }
  node.connect(au.sfx);
  for (const s of stops) {
    s.start(t0);
    s.stop(end + 0.05);
  }
}

/** 可调音量的循环声（呼噜、喘气、打鼾、摩擦声等）。 */
export class Bed {
  gain: GainNode;
  private src: AudioBufferSourceNode;
  level = 0;
  constructor(
    private au: AudioEngine,
    buffer: AudioBuffer,
    chain?: (input: AudioNode) => AudioNode,
  ) {
    const ctx = au.ctx!;
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = true;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    const tail = chain ? chain(this.src) : this.src;
    tail.connect(this.gain).connect(au.bed);
    this.src.start(ctx.currentTime, Math.random() * buffer.duration);
  }
  set(level: number, tau = 0.12): void {
    if (Math.abs(level - this.level) < 0.003) return;
    this.level = level;
    const ctx = this.au.ctx!;
    this.gain.gain.setTargetAtTime(level, ctx.currentTime, tau);
  }
  rate(r: number): void {
    this.src.playbackRate.setTargetAtTime(r, this.au.ctx!.currentTime, 0.1);
  }
  stop(): void {
    const ctx = this.au.ctx!;
    this.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    this.src.stop(ctx.currentTime + 0.5);
  }
}

/** 离线生成单声道缓冲。 */
export function render(au: AudioEngine, seconds: number, fn: (t: number, i: number, rate: number) => number): AudioBuffer {
  const ctx = au.ctx!;
  const rate = ctx.sampleRate;
  const len = Math.floor(seconds * rate);
  const buf = ctx.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = fn(i / rate, i, rate);
  const fade = Math.floor(rate * 0.08);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    d[i] = d[i] * t + d[len - fade + i] * (1 - t);
  }
  return buf;
}

/** 二阶共振器（用于离线合成里的"声道"）。 */
export function resonator(freq: number, q: number, rate: number): (x: number) => number {
  const w = (2 * Math.PI * freq) / rate;
  const r = Math.exp(-w / (2 * q));
  const a1 = -2 * r * Math.cos(w),
    a2 = r * r;
  let y1 = 0,
    y2 = 0;
  return x => {
    const y = x * (1 - r) - a1 * y1 - a2 * y2;
    y2 = y1;
    y1 = y;
    return y;
  };
}

// ---------- 常用卡通音效 ----------

export const sfx = {
  /** 柔和的"啵"，选择动物、冒爱心 */
  pop(au: AudioEngine, pitch = 1, gain = 0.16, delay = 0): void {
    tone(au, { f: [[0, 520 * pitch], [0.09, 900 * pitch]], gain, a: 0.004, h: 0.02, r: 0.09, delay });
    tone(au, { type: 'triangle', f: [[0, 1040 * pitch], [0.05, 1500 * pitch]], gain: gain * 0.25, a: 0.002, h: 0.01, r: 0.05, delay });
  },
  /** 弹簧"嘣～" */
  boing(au: AudioEngine, gain = 0.18, delay = 0): void {
    tone(au, { type: 'triangle', f: [[0, 180], [0.08, 420], [0.5, 260]], gain, a: 0.005, h: 0.1, r: 0.35, vib: { rate: 22, depth: 40 }, delay });
  },
  /** 刺痛"叮" */
  prick(au: AudioEngine, gain = 0.2): void {
    tone(au, { f: [[0, 2600], [0.25, 2200]], gain, a: 0.001, h: 0.005, r: 0.25 });
    tone(au, { f: [[0, 3900], [0.2, 3500]], gain: gain * 0.4, a: 0.001, h: 0.004, r: 0.18 });
    tone(au, { type: 'square', f: [[0, 900], [0.3, 140]], gain: gain * 0.25, a: 0.003, h: 0.02, r: 0.25, lowpass: 2200, delay: 0.03 });
  },
  /** 魔法亮晶晶的琶音 */
  chime(au: AudioEngine, notes = [0, 4, 7, 12, 16], base = 784, gain = 0.09, step = 0.07): void {
    notes.forEach((n, i) => {
      const f = base * 2 ** (n / 12);
      tone(au, { f: [[0, f], [0.6, f]], gain, a: 0.003, h: 0.02, r: 0.9, delay: i * step });
      tone(au, { f: [[0, f * 2.01], [0.4, f * 2.01]], gain: gain * 0.25, a: 0.003, h: 0.01, r: 0.5, delay: i * step });
    });
  },
  /** 闷响（脚踢地板、尾巴拍地） */
  thump(au: AudioEngine, gain = 0.3, pitch = 1, delay = 0): void {
    tone(au, { f: [[0, 140 * pitch], [0.12, 55 * pitch]], gain, a: 0.002, h: 0.01, r: 0.14, delay });
    noise(au, { kind: 'brown', filter: 'lowpass', f: [[0, 600 * pitch], [0.1, 200]], gain: gain * 0.7, a: 0.001, h: 0.01, r: 0.06, delay });
  },
  /** 水花 */
  splash(au: AudioEngine, size = 1, delay = 0): void {
    noise(au, { filter: 'bandpass', f: [[0, 900], [0.05, 2600], [0.5 * size, 700]], q: 0.6, gain: 0.32 * size, a: 0.004, h: 0.05, r: 0.5 * size, delay });
    noise(au, { kind: 'pink', filter: 'lowpass', f: [[0, 1800], [0.3, 400]], gain: 0.25 * size, a: 0.002, h: 0.02, r: 0.3 * size, delay });
    for (let i = 0; i < 6 * size; i++) {
      const f = 900 + Math.random() * 1800;
      tone(au, { f: [[0, f], [0.06, f * 1.8]], gain: 0.03, a: 0.002, h: 0.005, r: 0.05, delay: delay + 0.05 + Math.random() * 0.45 * size });
    }
  },
  /** 嗖 */
  whoosh(au: AudioEngine, gain = 0.15, delay = 0): void {
    noise(au, { kind: 'pink', filter: 'bandpass', f: [[0, 400], [0.12, 1800], [0.3, 600]], q: 1.2, gain, a: 0.08, h: 0.02, r: 0.2, delay });
  },
  /** 咔嚓（咬合） */
  snap(au: AudioEngine, gain = 0.4): void {
    noise(au, { filter: 'highpass', f: [[0, 1800]], gain, a: 0.001, h: 0.004, r: 0.05 });
    tone(au, { type: 'square', f: [[0, 180], [0.06, 70]], gain: gain * 0.6, a: 0.001, h: 0.01, r: 0.09, lowpass: 900 });
    noise(au, { kind: 'brown', filter: 'lowpass', f: [[0, 400]], gain: gain * 0.8, a: 0.001, h: 0.03, r: 0.12 });
  },
};
