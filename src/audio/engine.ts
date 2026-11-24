/**
 * 音频引擎：全部音效实时合成，不加载音频文件。
 * 浏览器要求用户手势后才能出声，所以 AudioContext 在第一次点击/按键时创建。
 */
export type Material = 'fur' | 'short' | 'spine' | 'scale' | 'skin' | 'none';

const MUTE_KEY = 'pet-everything-muted';

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  /** 音效总线（一次性声音） */
  sfx!: GainNode;
  /** 叫声/呼噜等持续声音 */
  bed!: GainNode;
  noise!: AudioBuffer;
  pink!: AudioBuffer;
  brown!: AudioBuffer;
  muted: boolean;
  private listeners = new Set<() => void>();
  private readyHooks: ((a: AudioEngine) => void)[] = [];

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* 隐私模式 */
    }
    this.muted = m;
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const f of this.listeners) f();
  }

  /** ctx 就绪后执行（若已就绪则立即执行）。 */
  whenReady(fn: (a: AudioEngine) => void): void {
    if (this.ctx) fn(this);
    else this.readyHooks.push(fn);
  }

  /** 在用户手势回调里调用。 */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(comp).connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.bed = ctx.createGain();
      this.bed.connect(this.master);
      this.noise = makeNoise(ctx, 'white');
      this.pink = makeNoise(ctx, 'pink');
      this.brown = makeNoise(ctx, 'brown');
      ctx.onstatechange = () => this.emit();
      const hooks = this.readyHooks.splice(0);
      for (const h of hooks) h(this);
    }
    if (this.ctx.state !== 'running') void this.ctx.resume().then(() => this.emit());
    this.emit();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    this.emit();
  }

  /** 页面隐藏时静音，回来后恢复。 */
  suspend(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }
}

function makeNoise(ctx: BaseAudioContext, kind: 'white' | 'pink' | 'brown'): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 2.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w * 0.5;
    else if (kind === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
  }
  // 首尾交叉淡化，循环无缝
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    d[i] = d[i] * t + d[len - fade + i] * (1 - t);
  }
  return buf;
}
