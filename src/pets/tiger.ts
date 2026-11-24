import { Feline, FelineCoat, felineIcon, felineLook } from './feline';
import { grass } from './grounds';
import { ProneSpec } from './prone';
import { Species } from './types';

const coat: FelineCoat = {
  id: 'tiger',
  name: '老虎',
  swatch: ['#e8892e', '#1e1512'],
  base: '#ea8b30',
  light: '#fbf1e1',
  stripes: 'tiger',
  stripe: 'rgba(32,20,16,0.92)',
  rings: true,
  tailTip: '#1e1512',
  muzzle: true,
  iris: '#f0b53c',
  nose: '#d8877a',
  earInner: '#fbefe0',
  earSpot: true,
  whisker: 'rgba(255,255,255,0.9)',
};

const shape: Omit<ProneSpec, 'look'> = {
  material: 'short',
  body: { x: 30, rx: 255, ry: 122, shoulder: 0.16, haunch: 0.08, curve: 0.04 },
  head: { x: -265, y: 0, rx: 104, ry: 106, muzzle: 0.1 },
  ears: { kind: 'round', size: 0.42, base: 1.75, tip: 2.0, width: 0.42 },
  tail: { length: 380, radius: 21, taper: 0.1, root: 0.5, rest: [0, 0.45, 0.45, 0.42, 0.35, 0.22, 0.1, 0.05, 0.05, 0.05, 0.06, 0.08, 0.1, 0.12] },
  paws: { x: -345, y: 92, rx: 44, ry: 28 },
  fur: { spacing: 5.5, length: [4, 7], width: 1.8, edge: 1.3 },
  face: { x: -0.48, squash: 0.6, scale: 1.12 },
};

const ground = grass({ base: '#6e8a3e', blades: ['#5b7a32', '#7f9c48', '#94ad58', '#4f6a2c'], dapple: 1, seed: 17 });

export const tiger: Species = {
  id: 'tiger',
  name: '老虎',
  icon: (g, size) => felineIcon(g, size, coat, true),
  create: fx => new Feline(fx, felineLook(shape, coat), coat, { big: true, pitch: 0.5, rug: ground, yawnEvery: [9, 16] }),
};
