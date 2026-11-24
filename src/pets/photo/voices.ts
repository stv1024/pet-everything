import { AudioEngine } from '../../audio/engine';
import { Bed, noise, render, resonator, sfx, tone, voice } from '../../audio/synth';
import { catVoice, normalize, purrBed } from '../felineVoice';
import { PetVoice } from './photoPet';

/**
 * 各写实物种的叫声。全部实时合成（共振峰 voice、噪声、离线渲染的循环 Bed）。
 * 音量保守：单个音效增益 0.1–0.3。
 */

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** 离线渲染循环声，并按峰值归一。 */
function loop(au: AudioEngine, seconds: number, fn: (t: number, rate: number) => number, peak = 0.9): AudioBuffer {
  const buf = render(au, seconds, (t, _i, rate) => fn(t, rate));
  normalize(buf, peak);
  return buf;
}

// ---------- 猫 ----------

export const catSounds: PetVoice = {
  bed: au => purrBed(au, 1),
  bedLevel: (joy, petting, annoy) => (annoy > 0.5 || joy <= 0.18 ? 0 : (0.2 + 0.8 * joy) * (0.45 + 0.55 * petting) * Math.min(1, (joy - 0.18) / 0.15) * 0.7),
  greet: au => catVoice.chirp(au, 1),
  tap: (au, zone) => (zone === 'head' || zone === 'cheek' || zone === 'face' || zone === 'ear') && catVoice.chirp(au, 1.1),
  happy: au => catVoice.meow(au, 1, 0.8),
  grumble: au => catVoice.growl(au),
  angry: au => catVoice.hiss(au),
};

// ---------- 狗（柴犬） ----------

const dog = {
  /** 轻轻的"呜夫" */
  boof(au: AudioEngine, gain = 0.2): void {
    voice(au, {
      f0: [
        [0, 260],
        [0.05, 330],
        [0.16, 220],
      ],
      formants: [
        [[[0, 600], [0.16, 450]], 1, 4],
        [[[0, 1400], [0.16, 1100]], 0.5, 5],
      ],
      dur: 0.17,
      gain,
      breath: 0.35,
      jitter: 20,
      a: 0.01,
      r: 0.08,
    });
  },
  /** "汪！" */
  bark(au: AudioEngine, n = 2): void {
    for (let i = 0; i < n; i++)
      voice(au, {
        f0: [
          [0, 420],
          [0.04, 620],
          [0.14, 380],
        ],
        formants: [
          [[[0, 700], [0.05, 1000], [0.14, 600]], 1, 4],
          [[[0, 1700], [0.14, 1300]], 0.6, 6],
          [[[0, 3000]], 0.2, 8],
        ],
        dur: 0.15,
        gain: 0.26,
        breath: 0.3,
        jitter: 40,
        a: 0.006,
        r: 0.07,
        delay: i * 0.24,
      });
  },
  /** 撒娇的呜呜声 */
  whine(au: AudioEngine): void {
    const d = rnd(0.45, 0.7);
    voice(au, {
      f0: [
        [0, 900],
        [d * 0.4, 1250],
        [d, 820],
      ],
      formants: [
        [[[0, 1000], [d, 1200]], 1, 6],
        [[[0, 2500]], 0.4, 8],
      ],
      dur: d,
      gain: 0.12,
      breath: 0.2,
      vib: { rate: 7, depth: 40 },
      a: 0.06,
      r: 0.2,
    });
  },
  /** 喘气循环："哈—哈—" */
  pant(au: AudioEngine): Bed {
    let r1: ((x: number) => number) | undefined, r2: ((x: number) => number) | undefined;
    const buf = loop(au, 4, (t, sr) => {
      r1 ??= resonator(1100, 2, sr);
      r2 ??= resonator(2300, 3, sr);
      // 4 秒 12 个周期，循环处相位连续
      const ph = (t * 3) % 1;
      const out = ph < 0.45;
      const env = Math.sin((Math.PI * (out ? ph : ph - 0.45)) / (out ? 0.45 : 0.55)) ** 1.5 * (out ? 1 : 0.55);
      const n = Math.random() * 2 - 1;
      return (r1(n) + 0.5 * r2(n)) * env;
    });
    return new Bed(au, buf);
  },
};

export const dogSounds: PetVoice = {
  bed: au => dog.pant(au),
  bedLevel: (joy, petting, annoy) => (annoy > 0.4 ? 0 : Math.max(0, joy - 0.3) * (0.5 + 0.5 * petting) * 0.5),
  greet: au => dog.boof(au),
  tap: au => dog.boof(au, 0.16),
  happy: au => (Math.random() < 0.6 ? dog.whine(au) : dog.bark(au, 1)),
  grumble: au => catVoice.growl(au, 1.4, 0.7),
  angry: au => dog.bark(au, 3),
};

// ---------- 兔子 ----------

const rabbit = {
  /** 轻声"咕"（兔子满足时的小哼声） */
  honk(au: AudioEngine): void {
    for (let i = 0; i < 2; i++)
      voice(au, {
        f0: [
          [0, 380],
          [0.06, 320],
        ],
        formants: [[[[0, 900]], 1, 4]],
        dur: 0.07,
        gain: 0.1,
        breath: 0.6,
        a: 0.005,
        r: 0.04,
        delay: i * 0.11,
      });
  },
  /** 磨牙"咯咯"：开心时轻轻磨牙 */
  chatter(au: AudioEngine): Bed {
    let next = 0,
      pt = 1,
      amp = 0;
    let r: ((x: number) => number) | undefined;
    const buf = loop(au, 5, (t, sr) => {
      r ??= resonator(3200, 3, sr);
      if (t >= next) {
        next = t + rnd(0.05, 0.11) + (Math.random() < 0.08 ? 0.3 : 0);
        pt = 0;
        amp = rnd(0.5, 1);
      }
      pt += 1 / sr;
      return r((Math.random() * 2 - 1) * amp * Math.exp(-pt / 0.004));
    });
    return new Bed(au, buf);
  },
};

export const rabbitSounds: PetVoice = {
  bed: au => rabbit.chatter(au),
  bedLevel: (joy, petting, annoy) => (annoy > 0.4 || joy < 0.35 ? 0 : (joy - 0.35) * (0.4 + 0.6 * petting) * 0.6),
  greet: au => rabbit.honk(au),
  happy: au => rabbit.honk(au),
  grumble: au => rabbit.honk(au),
  // 生气：后脚跺地
  angry: au => {
    sfx.thump(au, 0.35, 0.9);
    sfx.thump(au, 0.25, 0.9, 0.18);
  },
};

// ---------- 刺猬 ----------

const hedgehog = {
  /** 嗅嗅 */
  sniff(au: AudioEngine, n = 3): void {
    for (let i = 0; i < n; i++)
      noise(au, { filter: 'bandpass', f: [[0, rnd(2600, 3400)]], q: 2, gain: 0.07, a: 0.01, h: 0.02, r: 0.05, delay: i * rnd(0.09, 0.13) });
  },
  /**
   * 喷气（不满、被扎时）：刺猬用鼻子短促地"噗"，只有气流声，没有音高。
   * 以前叠了方波，听起来像电子音"嘟嘟嘟"，已去掉。
   */
  huff(au: AudioEngine, n = 2): void {
    for (let i = 0; i < n; i++) {
      const d = i * rnd(0.13, 0.19);
      noise(au, { kind: 'pink', filter: 'bandpass', f: [[0, rnd(2200, 2800)], [0.07, 1200]], q: 0.7, gain: 0.13, a: 0.003, h: 0.015, r: 0.07, delay: d });
      noise(au, { filter: 'highpass', f: [[0, 3500]], gain: 0.05, a: 0.002, h: 0.01, r: 0.04, delay: d });
    }
  },
  /** 开心时的小哼唧 */
  squeak(au: AudioEngine): void {
    voice(au, {
      f0: [
        [0, 1800],
        [0.06, 2300],
        [0.12, 1900],
      ],
      formants: [[[[0, 2400]], 1, 6]],
      dur: 0.13,
      gain: 0.07,
      breath: 0.3,
      a: 0.01,
      r: 0.05,
    });
  },
};

export const hedgehogSounds: PetVoice = {
  greet: au => hedgehog.sniff(au),
  happy: au => (Math.random() < 0.5 ? hedgehog.squeak(au) : hedgehog.sniff(au, 4)),
  grumble: au => hedgehog.huff(au, 1),
  angry: au => hedgehog.huff(au, 2),
  prickled: au => hedgehog.huff(au, 1),
};

// ---------- 老虎 ----------

const tiger = {
  /** 深沉的呼吸 */
  breathe(au: AudioEngine): Bed {
    let r: ((x: number) => number) | undefined;
    let b = 0;
    const buf = loop(au, 6, (t, sr) => {
      r ??= resonator(260, 1.5, sr);
      const ph = (t / 3) % 1;
      const env = ph < 0.55 ? Math.sin((Math.PI * ph) / 0.55) : 0.4 * Math.sin((Math.PI * (ph - 0.55)) / 0.45);
      b = b * 0.97 + (Math.random() * 2 - 1) * 0.03;
      return r(b) * env ** 1.5;
    });
    return new Bed(au, buf);
  },
};

export const tigerSounds: PetVoice = {
  bed: au => tiger.breathe(au),
  bedLevel: (joy, petting, annoy) => 0.25 + 0.35 * joy * (0.5 + 0.5 * petting) - 0.2 * annoy,
  greet: au => catVoice.chuff(au),
  tap: au => catVoice.chuff(au),
  happy: au => catVoice.chuff(au),
  grumble: au => catVoice.growl(au, 2.4, 0.9),
  angry: au => {
    catVoice.growl(au, 2.6, 1.3);
    catVoice.hiss(au, 2);
  },
};

// ---------- 鳄鱼 ----------

const croc = {
  /** 低沉的隆隆声 */
  rumble(au: AudioEngine, dur = 1.2): void {
    tone(au, { type: 'sawtooth', f: [[0, 48], [dur, 42]], gain: 0.22, a: 0.2, h: dur - 0.4, r: 0.4, lowpass: 220, vib: { rate: 11, depth: 4 } });
    noise(au, { kind: 'brown', filter: 'lowpass', f: [[0, 180]], gain: 0.25, a: 0.2, h: dur - 0.4, r: 0.4 });
  },
  hiss(au: AudioEngine): void {
    noise(au, { filter: 'bandpass', f: [[0, 1800], [0.6, 1400]], q: 0.7, gain: 0.2, a: 0.08, h: 0.4, r: 0.3 });
    noise(au, { kind: 'pink', filter: 'lowpass', f: [[0, 600]], gain: 0.15, a: 0.08, h: 0.4, r: 0.3 });
  },
};

export const crocodileSounds: PetVoice = {
  greet: au => croc.rumble(au, 0.9),
  happy: au => croc.rumble(au, 1.6),
  grumble: au => croc.hiss(au),
  angry: au => {
    croc.hiss(au);
    setTimeout(() => sfx.snap(au, 0.35), 350);
  },
};

// ---------- 虎鲸 ----------

const orca = {
  /** 上扬的哨声 */
  whistle(au: AudioEngine, up = true): void {
    const a = rnd(5200, 6500),
      b = rnd(8500, 10500);
    const d = rnd(0.35, 0.6);
    tone(au, { f: up ? [[0, a], [d * 0.7, b], [d, b * 0.95]] : [[0, b], [d, a]], gain: 0.06, a: 0.04, h: d - 0.1, r: 0.1, vib: { rate: 9, depth: 120 } });
  },
  /** 一串"咔咔"回声定位声 */
  clicks(au: AudioEngine, n = 8): void {
    for (let i = 0; i < n; i++) noise(au, { filter: 'highpass', f: [[0, 3500]], gain: 0.12, a: 0.0005, h: 0.001, r: 0.006, delay: i * (0.05 - i * 0.003) });
  },
  /** 脉冲叫声（不满） */
  call(au: AudioEngine, gain = 0.14): void {
    voice(au, {
      f0: [
        [0, 900],
        [0.25, 1400],
        [0.5, 700],
      ],
      formants: [
        [[[0, 1800], [0.5, 2600]], 1, 5],
        [[[0, 4200]], 0.5, 6],
      ],
      dur: 0.5,
      gain,
      breath: 0.1,
      vib: { rate: 40, depth: 160 },
      a: 0.02,
      r: 0.12,
    });
  },
  /** 呼吸孔"噗——" */
  blow(au: AudioEngine): void {
    noise(au, { kind: 'pink', filter: 'bandpass', f: [[0, 700], [0.6, 400]], q: 0.6, gain: 0.25, a: 0.03, h: 0.25, r: 0.45 });
  },
  /** 水波轻拍 */
  water(au: AudioEngine): Bed {
    let l = 0,
      env = 0,
      target = 0,
      next = 0;
    const buf = loop(au, 6, t => {
      if (t >= next) {
        next = t + rnd(0.2, 0.7);
        target = rnd(0.2, 1);
      }
      env += (target - env) * 0.0004;
      target *= 0.99995;
      l = l * 0.985 + (Math.random() * 2 - 1) * 0.015;
      return l * env;
    });
    return new Bed(au, buf);
  },
};

export const orcaSounds: PetVoice = {
  bed: au => orca.water(au),
  bedLevel: joy => 0.35 + 0.15 * joy,
  greet: au => orca.whistle(au),
  tap: au => orca.clicks(au, 6),
  happy: au => {
    orca.whistle(au);
    if (Math.random() < 0.5) setTimeout(() => orca.blow(au), 500);
  },
  grumble: au => orca.call(au),
  angry: au => {
    orca.call(au, 0.2);
    sfx.splash(au, 0.8, 0.3);
  },
};

// ---------- 仙人球（不出声；摩擦声由材质决定） ----------

export const cactusSounds: PetVoice = {};
