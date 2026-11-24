import { AudioEngine } from '../audio/engine';
import { Bed, noise, render, resonator, tone, voice } from '../audio/synth';

/**
 * 呼噜声：离线合成一段 6 秒循环。
 * 模型：呼气/吸气交替（呼气更响、频率稍高），每个周期内约 25 次声门脉冲，
 * 脉冲经两个低频共振峰着色。size>1 时更低沉（老虎）。
 */
export function purrBuffer(au: AudioEngine, size = 1): AudioBuffer {
  const sr = au.ctx!.sampleRate;
  const r1 = resonator(240 / size, 2.5, sr),
    r2 = resonator(620 / size, 3.5, sr),
    r3 = resonator(1300 / size, 4, sr);
  let phase = 0,
    pt = 1,
    amp = 1,
    breath = 0;
  const cycle = 3;
  const buf = render(au, 6, t => {
    const tc = t % cycle;
    const ex = tc < 1.7;
    const env = ex ? Math.sin((Math.PI * tc) / 1.7) ** 0.55 : 0.5 * Math.sin((Math.PI * (tc - 1.7)) / 1.3) ** 0.55;
    const rate = (ex ? 26 : 23.5) / Math.sqrt(size) + 0.6 * Math.sin(t * 1.9);
    phase += rate / sr;
    if (phase >= 1) {
      phase -= 1;
      pt = 0;
      amp = 0.75 + Math.random() * 0.5;
    }
    pt += 1 / sr;
    const exc = amp * Math.exp(-pt / 0.0065) * (Math.random() * 2 - 1) + amp * 0.7 * Math.exp(-pt / 0.011) * Math.sin(2 * Math.PI * (85 / size) * pt);
    breath = breath * 0.995 + (Math.random() * 2 - 1) * 0.005;
    const y = r1(exc) * 1.0 + r2(exc) * 0.45 + r3(exc) * 0.12 + breath * (ex ? 0.5 : 0.8);
    return y * env;
  });
  normalize(buf, 0.9);
  return buf;
}

export function normalize(buf: AudioBuffer, peak: number): void {
  const d = buf.getChannelData(0);
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
}

export function purrBed(au: AudioEngine, size = 1): Bed {
  const ctx = au.ctx!;
  return new Bed(au, purrBuffer(au, size), input => {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 / size;
    return input.connect(lp);
  });
}

export const catVoice = {
  /** "咪噜？"——打招呼的颤音 */
  chirp(au: AudioEngine, pitch = 1): void {
    voice(au, {
      f0: [
        [0, 480 * pitch],
        [0.07, 720 * pitch],
        [0.2, 640 * pitch],
      ],
      formants: [
        [[[0, 500], [0.2, 800]], 1, 5],
        [[[0, 1800], [0.2, 1600]], 0.6, 7],
      ],
      dur: 0.22,
      gain: 0.22,
      breath: 0.2,
      vib: { rate: 28, depth: 60 * pitch },
      a: 0.02,
      r: 0.08,
    });
  },
  /** "喵～" */
  meow(au: AudioEngine, pitch = 1, len = 1): void {
    const d = 0.62 * len;
    voice(au, {
      f0: [
        [0, 520 * pitch],
        [d * 0.25, 780 * pitch],
        [d * 0.7, 640 * pitch],
        [d, 470 * pitch],
      ],
      formants: [
        [[[0, 380], [d * 0.3, 950], [d, 520]], 1, 6],
        [[[0, 2300], [d * 0.3, 1700], [d, 950]], 0.55, 8],
        [[[0, 3300], [d, 2800]], 0.22, 9],
      ],
      dur: d,
      gain: 0.24,
      breath: 0.12,
      vib: { rate: 6, depth: 14 * pitch },
      jitter: 8,
      a: 0.05,
      r: 0.18,
    });
  },
  /** 哈气 */
  hiss(au: AudioEngine, size = 1): void {
    noise(au, { filter: 'highpass', f: [[0, 2600 / size]], gain: 0.22, a: 0.04, h: 0.35, r: 0.25 });
    noise(au, { filter: 'bandpass', f: [[0, 5200 / size], [0.5, 4200 / size]], q: 1.5, gain: 0.16, a: 0.03, h: 0.3, r: 0.2 });
  },
  /** 低吼（不满） */
  growl(au: AudioEngine, size = 1, dur = 0.55): void {
    voice(au, {
      f0: [
        [0, 150 / size],
        [dur, 125 / size],
      ],
      formants: [
        [[[0, 420 / size]], 1, 3],
        [[[0, 1100 / size]], 0.4, 4],
      ],
      dur,
      gain: 0.3,
      breath: 0.35,
      vib: { rate: 24, depth: 30 / size },
      jitter: 30,
      a: 0.06,
      r: 0.15,
    });
  },
  /** 打哈欠（大猫张大嘴） */
  yawn(au: AudioEngine, size = 1): void {
    voice(au, {
      f0: [
        [0, 300 / size],
        [0.3, 420 / size],
        [1.2, 160 / size],
      ],
      formants: [
        [[[0, 500], [0.5, 900], [1.2, 400]], 1, 4],
        [[[0, 1200], [0.5, 1500], [1.2, 700]], 0.5, 5],
      ],
      dur: 1.25,
      gain: 0.22,
      breath: 0.45,
      a: 0.15,
      r: 0.4,
    });
  },
  /** 老虎的"噗噗"友好喷气（chuff） */
  chuff(au: AudioEngine): void {
    for (let i = 0; i < 3; i++) {
      noise(au, { kind: 'pink', filter: 'bandpass', f: [[0, 700], [0.12, 450]], q: 1.3, gain: 0.32, a: 0.01, h: 0.03, r: 0.12, delay: i * 0.2 });
      tone(au, { type: 'sawtooth', f: [[0, 90], [0.1, 70]], gain: 0.08, a: 0.01, h: 0.02, r: 0.1, lowpass: 400, delay: i * 0.2 });
    }
  },
  /** 轻轻的"啪"一爪 */
  swat(au: AudioEngine): void {
    noise(au, { kind: 'pink', filter: 'bandpass', f: [[0, 600], [0.08, 2400]], q: 0.8, gain: 0.2, a: 0.03, h: 0.01, r: 0.06 });
    noise(au, { filter: 'highpass', f: [[0, 2000]], gain: 0.18, a: 0.001, h: 0.004, r: 0.04, delay: 0.07 });
  },
};
