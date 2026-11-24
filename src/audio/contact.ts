import { AudioEngine, Material } from './engine';
import { render } from './synth';
import { clamp } from '../engine/math';

/**
 * 手和动物表面摩擦的持续声音。音色随材质变化，音量随手速和按压变化。
 * 这是"手感"里听觉的那一半：手一动就有声音，停下就安静。
 */
export class ContactSound {
  private rustle: GainNode;
  private band: BiquadFilterNode;
  private crackle: GainNode;
  private crackleFilter: BiquadFilterNode;
  private squeak: OscillatorNode;
  private squeakGain: GainNode;
  private material: Material = 'none';
  private smoothSpeed = 0;
  private stick = 0;

  constructor(private au: AudioEngine) {
    const ctx = au.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = au.pink;
    src.loop = true;
    this.band = ctx.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.frequency.value = 1200;
    this.band.Q.value = 0.7;
    this.rustle = ctx.createGain();
    this.rustle.gain.value = 0;
    src.connect(this.band).connect(this.rustle).connect(au.sfx);
    src.start();

    const crack = render(au, 2, () => 0);
    const d = crack.getChannelData(0);
    for (let k = 0; k < 520; k++) {
      const at = Math.floor(Math.random() * (d.length - 400));
      const amp = 0.3 + Math.random() * 0.7;
      const decay = 30 + Math.random() * 120;
      const sign = Math.random() < 0.5 ? -1 : 1;
      for (let i = 0; i < 400; i++) d[at + i] += sign * amp * Math.exp(-i / decay * 6) * (Math.random() * 2 - 1);
    }
    const cs = ctx.createBufferSource();
    cs.buffer = crack;
    cs.loop = true;
    this.crackleFilter = ctx.createBiquadFilter();
    this.crackleFilter.type = 'highpass';
    this.crackleFilter.frequency.value = 2500;
    this.crackle = ctx.createGain();
    this.crackle.gain.value = 0;
    cs.connect(this.crackleFilter).connect(this.crackle).connect(au.sfx);
    cs.start();

    this.squeak = ctx.createOscillator();
    this.squeak.type = 'sine';
    this.squeak.frequency.value = 700;
    this.squeakGain = ctx.createGain();
    this.squeakGain.gain.value = 0;
    const sq = ctx.createBiquadFilter();
    sq.type = 'lowpass';
    sq.frequency.value = 2400;
    this.squeak.connect(sq).connect(this.squeakGain).connect(au.sfx);
    this.squeak.start();
  }

  update(dt: number, material: Material, speed: number, pressure: number, contact: boolean): void {
    const ctx = this.au.ctx!;
    const t = ctx.currentTime;
    this.smoothSpeed += (speed - this.smoothSpeed) * Math.min(1, dt * 18);
    const s = contact ? clamp(this.smoothSpeed / 900) : 0;
    const press = 0.55 + 0.45 * pressure;
    if (material !== this.material) {
      this.material = material;
      const map: Record<Material, [BiquadFilterType, number, number]> = {
        fur: ['bandpass', 0.6, 2500],
        short: ['bandpass', 0.8, 3200],
        spine: ['highpass', 0.7, 3000],
        scale: ['bandpass', 1.6, 1800],
        skin: ['lowpass', 0.7, 1800],
        hot: ['highpass', 0.6, 3800],
        none: ['bandpass', 0.7, 1000],
      };
      const [type, q, cf] = map[material];
      this.band.type = type;
      this.band.Q.value = q;
      this.crackleFilter.frequency.value = cf;
    }
    let rustle = 0,
      crackle = 0,
      squeak = 0,
      freq = 1000;
    switch (material) {
      case 'fur':
        rustle = 0.22 * s ** 0.8;
        freq = 650 + 2200 * s;
        crackle = 0.02 * s;
        break;
      case 'short':
        rustle = 0.2 * s ** 0.8;
        freq = 1100 + 2600 * s;
        crackle = 0.04 * s;
        break;
      case 'spine':
        rustle = 0.08 * s;
        freq = 4000 + 2000 * s;
        crackle = 0.32 * s ** 0.7;
        break;
      case 'scale':
        rustle = 0.16 * s;
        freq = 500 + 900 * s;
        crackle = 0.22 * s ** 0.8;
        break;
      case 'skin': {
        rustle = 0.05 * s;
        freq = 600 + 600 * s;
        // 橡胶般的"吱吱"：粘滑交替
        this.stick += dt * (8 + 30 * s);
        const slip = 0.5 + 0.5 * Math.sin(this.stick * 6.3) * Math.sin(this.stick * 2.1);
        squeak = 0.07 * s ** 1.4 * slip;
        this.squeak.frequency.setTargetAtTime(480 + 900 * s + 120 * slip, t, 0.03);
        break;
      }
      case 'hot':
        // 皮肉贴上烧红的铁：不用动也一直"呲呲"响，动起来更响
        rustle = contact ? 0.13 + 0.12 * s : 0;
        freq = 4200 + 1800 * s;
        crackle = contact ? 0.3 + 0.25 * s : 0;
        break;
      default:
        break;
    }
    this.rustle.gain.setTargetAtTime(rustle * press, t, 0.04);
    this.band.frequency.setTargetAtTime(freq, t, 0.05);
    this.crackle.gain.setTargetAtTime(crackle * press, t, 0.04);
    this.squeakGain.gain.setTargetAtTime(squeak * press, t, 0.03);
  }

  silence(): void {
    const t = this.au.ctx!.currentTime;
    this.rustle.gain.setTargetAtTime(0, t, 0.05);
    this.crackle.gain.setTargetAtTime(0, t, 0.05);
    this.squeakGain.gain.setTargetAtTime(0, t, 0.05);
  }
}
