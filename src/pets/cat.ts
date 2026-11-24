import { Feline, FelineCoat, felineIcon, felineLook } from './feline';
import { woodAndRug } from './grounds';
import { ProneSpec } from './prone';
import { Species } from './types';

const coats: FelineCoat[] = [
  {
    id: 'orange',
    name: '橘猫',
    swatch: ['#f2a65a', '#d9822b'],
    base: '#f3a85e',
    light: '#fde3bf',
    stripes: 'tabby',
    stripe: 'rgba(206,112,40,0.75)',
    rings: true,
    muzzle: true,
    nose: '#f08a8a',
    earInner: '#f7b7a8',
  },
  {
    id: 'black',
    name: '黑猫',
    swatch: ['#2f2a2c', '#4a4446'],
    base: '#2f2a2d',
    light: '#3d3639',
    nose: '#4a3438',
    earInner: '#5a3f45',
    iris: '#f0cf4f',
    whisker: 'rgba(255,255,255,0.7)',
  },
  {
    id: 'calico',
    name: '三花',
    swatch: ['#fbf6ef', '#ee9a4c', '#3a3132'],
    base: '#fbf6ef',
    light: '#ffffff',
    muzzle: true,
    patches: [
      { part: 'body', color: '#ee9a4c', u: -0.25, v: -0.35, ru: 0.38, rv: 0.55, rot: 0.3 },
      { part: 'body', color: '#3a3132', u: 0.45, v: 0.15, ru: 0.32, rv: 0.6, rot: -0.3 },
      { part: 'body', color: '#3a3132', u: -0.55, v: 0.5, ru: 0.14, rv: 0.25 },
      { part: 'head', color: '#ee9a4c', u: 0.15, v: -0.45, ru: 0.6, rv: 0.5, rot: 0.3 },
      { part: 'head', color: '#3a3132', u: 0.25, v: 0.5, ru: 0.55, rv: 0.45, rot: -0.3 },
      { part: 'ear', color: '#ee9a4c', u: 0, v: -1, ru: 1, rv: 1 },
      { part: 'ear', color: '#3a3132', u: 0, v: 1, ru: 1, rv: 1 },
    ],
    tailTip: '#3a3132',
    nose: '#f39aa0',
    earInner: '#f6b9b2',
    whisker: 'rgba(170,150,140,0.85)',
  },
  {
    id: 'tuxedo',
    name: '奶牛猫',
    swatch: ['#2f2a2d', '#fbf8f3'],
    base: '#2f2a2d',
    light: '#fbf8f3',
    muzzle: true,
    socks: true,
    nose: '#f3a0a8',
    earInner: '#5a3f45',
    iris: '#9fd36a',
    whisker: 'rgba(255,255,255,0.85)',
  },
  {
    id: 'white',
    name: '白猫',
    swatch: ['#fbf8f4', '#dcd6cf'],
    base: '#f8f4ef',
    light: '#ffffff',
    nose: '#f5a3ac',
    earInner: '#f8c4c4',
    iris: '#7fb8ea',
    whisker: 'rgba(175,165,160,0.9)',
  },
  {
    id: 'gray',
    name: '灰狸花',
    swatch: ['#a0a2a8', '#5e6068'],
    base: '#a2a4aa',
    light: '#e7e5e2',
    stripes: 'tabby',
    stripe: 'rgba(78,80,90,0.75)',
    rings: true,
    muzzle: true,
    nose: '#c98c8f',
    earInner: '#d9a9a9',
    iris: '#c9d65c',
  },
];

const shape: Omit<ProneSpec, 'look'> = {
  material: 'fur',
  body: { x: 20, rx: 210, ry: 112, shoulder: 0.22, haunch: 0.1, curve: 0.05 },
  head: { x: -250, y: 0, rx: 96, ry: 100, muzzle: 0.16 },
  ears: { kind: 'pointed', size: 0.72, base: 1.78, tip: 2.2, width: 0.62 },
  tail: { length: 320, radius: 19, taper: 0.15, root: 0.55, rest: [0, 0.5, 0.5, 0.48, 0.4, 0.25, 0.1, 0.05, 0.05, 0.05, 0.06, 0.08, 0.1, 0.12] },
  paws: { x: -318, y: 80, rx: 34, ry: 21 },
  fur: { spacing: 6, length: [6, 10], width: 1.9 },
  face: { x: -0.5, squash: 0.55, scale: 1 },
};

const rug = woodAndRug({ wood: '#d9b48c', plank: 'rgba(120,80,45,0.25)', rug: ['#f4d2b8', '#efc6aa', '#f7dcc6', '#ecbfa2'] });

export const cat: Species = {
  id: 'cat',
  name: '猫',
  variants: coats.map(c => ({ id: c.id, name: c.name, swatch: c.swatch })),
  icon: (g, size) => felineIcon(g, size, coats[0]),
  create: (fx, variant) => {
    const coat = coats.find(c => c.id === variant) ?? coats[0];
    return new Feline(fx, felineLook(shape, coat), coat, { big: false, pitch: 1, rug });
  },
};
