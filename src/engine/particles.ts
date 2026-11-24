import { TAU, clamp } from './math';

export type ParticleKind = 'heart' | 'sparkle' | 'note' | 'z' | 'anger' | 'drop' | 'tuft' | 'petal' | 'star' | 'sweat' | 'puff' | 'text';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  gravity: number;
  drag: number;
  wobble: number;
  text?: string;
}

export class Particles {
  list: Particle[] = [];

  emit(kind: ParticleKind, x: number, y: number, o: Partial<Particle> = {}): Particle {
    const p: Particle = {
      kind,
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0,
      max: 1.4,
      size: 16,
      rot: 0,
      vr: 0,
      color: '#ff6b8b',
      gravity: 0,
      drag: 0.6,
      wobble: 0,
      ...o,
    };
    this.list.push(p);
    if (this.list.length > 260) this.list.shift();
    return p;
  }

  heart(x: number, y: number, size = 18): void {
    this.emit('heart', x, y, {
      vx: (Math.random() - 0.5) * 60,
      vy: -90 - Math.random() * 60,
      size: size * (0.8 + Math.random() * 0.5),
      max: 1.3 + Math.random() * 0.5,
      wobble: Math.random() * TAU,
      color: ['#ff5f86', '#ff7a9c', '#ff4f74'][Math.floor(Math.random() * 3)],
      rot: (Math.random() - 0.5) * 0.5,
    });
  }

  burst(kind: ParticleKind, x: number, y: number, n: number, o: Partial<Particle> & { speed?: number; spread?: number; up?: number } = {}): void {
    const speed = o.speed ?? 200,
      spread = o.spread ?? TAU,
      up = o.up ?? -Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const a = up + (Math.random() - 0.5) * spread;
      const v = speed * (0.5 + Math.random() * 0.7);
      this.emit(kind, x, y, {
        ...o,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        size: (o.size ?? 10) * (0.6 + Math.random() * 0.8),
        max: (o.max ?? 1) * (0.7 + Math.random() * 0.6),
        rot: Math.random() * TAU,
        vr: (Math.random() - 0.5) * 8,
        wobble: Math.random() * TAU,
      });
    }
  }

  step(dt: number): void {
    for (const p of this.list) {
      p.life += dt;
      p.vy += p.gravity * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt + (p.kind === 'heart' || p.kind === 'note' || p.kind === 'petal' ? Math.sin(p.life * 4 + p.wobble) * 18 * dt : 0);
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    this.list = this.list.filter(p => p.life < p.max);
  }

  draw(g: CanvasRenderingContext2D): void {
    for (const p of this.list) {
      const t = p.life / p.max;
      const fadeIn = clamp(p.life / 0.12);
      const alpha = fadeIn * (1 - clamp((t - 0.65) / 0.35));
      if (alpha <= 0) continue;
      g.save();
      g.globalAlpha *= alpha;
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      const pop = p.kind === 'heart' || p.kind === 'anger' || p.kind === 'star' ? 0.6 + 0.4 * Math.min(1, p.life / 0.18) + 0.12 * Math.sin(Math.min(1, p.life / 0.3) * Math.PI) : 1;
      const s = p.size * pop;
      drawKind(g, p, s, t);
      g.restore();
    }
  }
}

export function heartPath(g: CanvasRenderingContext2D | Path2D, s: number): void {
  g.moveTo(0, s * 0.35);
  g.bezierCurveTo(-s * 0.1, s * 0.25, -s * 0.55, 0, -s * 0.5, -s * 0.28);
  g.bezierCurveTo(-s * 0.45, -s * 0.55, -s * 0.08, -s * 0.55, 0, -s * 0.28);
  g.bezierCurveTo(s * 0.08, -s * 0.55, s * 0.45, -s * 0.55, s * 0.5, -s * 0.28);
  g.bezierCurveTo(s * 0.55, 0, s * 0.1, s * 0.25, 0, s * 0.35);
  g.closePath();
}

function drawKind(g: CanvasRenderingContext2D, p: Particle, s: number, t: number): void {
  switch (p.kind) {
    case 'heart': {
      g.beginPath();
      heartPath(g, s * 1.6);
      g.fillStyle = p.color;
      g.fill();
      g.lineWidth = s * 0.1;
      g.strokeStyle = 'rgba(160,30,60,0.35)';
      g.stroke();
      g.beginPath();
      g.ellipse(-s * 0.35, -s * 0.22, s * 0.14, s * 0.09, -0.6, 0, TAU);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fill();
      break;
    }
    case 'sparkle':
    case 'star': {
      const n = p.kind === 'star' ? 5 : 4;
      const inner = p.kind === 'star' ? 0.45 : 0.22;
      g.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * TAU - Math.PI / 2;
        const r = i % 2 ? s * inner : s;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.fillStyle = p.color;
      g.fill();
      break;
    }
    case 'note': {
      g.fillStyle = p.color;
      g.beginPath();
      g.ellipse(0, 0, s * 0.42, s * 0.32, -0.4, 0, TAU);
      g.fill();
      g.fillRect(s * 0.3, -s * 1.3, s * 0.12, s * 1.3);
      g.beginPath();
      g.moveTo(s * 0.42, -s * 1.3);
      g.quadraticCurveTo(s * 0.9, -s * 1.0, s * 0.75, -s * 0.6);
      g.lineWidth = s * 0.14;
      g.strokeStyle = p.color;
      g.stroke();
      break;
    }
    case 'z': {
      g.font = `700 ${s * 2}px ui-rounded, "Nunito", system-ui, sans-serif`;
      g.fillStyle = p.color;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(p.text ?? 'z', 0, 0);
      break;
    }
    case 'text': {
      g.font = `800 ${s}px ui-rounded, "Nunito", system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = s * 0.22;
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineJoin = 'round';
      g.strokeText(p.text ?? '', 0, 0);
      g.fillStyle = p.color;
      g.fillText(p.text ?? '', 0, 0);
      break;
    }
    case 'anger': {
      g.strokeStyle = p.color;
      g.lineWidth = s * 0.22;
      g.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        g.save();
        g.rotate((i * Math.PI) / 2 + Math.PI / 4);
        g.beginPath();
        g.moveTo(s * 0.2, s * 0.55);
        g.quadraticCurveTo(s * 0.25, s * 0.25, s * 0.55, s * 0.2);
        g.stroke();
        g.restore();
      }
      break;
    }
    case 'drop':
    case 'sweat': {
      g.rotate(Math.atan2(p.vy, p.vx) - p.rot + Math.PI / 2);
      g.beginPath();
      g.moveTo(0, -s);
      g.bezierCurveTo(s * 0.6, -s * 0.1, s * 0.6, s * 0.6, 0, s * 0.6);
      g.bezierCurveTo(-s * 0.6, s * 0.6, -s * 0.6, -s * 0.1, 0, -s);
      g.fillStyle = p.color;
      g.fill();
      g.beginPath();
      g.ellipse(-s * 0.18, s * 0.15, s * 0.12, s * 0.2, 0, 0, TAU);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fill();
      break;
    }
    case 'tuft': {
      g.strokeStyle = p.color;
      g.lineCap = 'round';
      g.lineWidth = s * 0.16;
      g.beginPath();
      for (let i = -2; i <= 2; i++) {
        g.moveTo(i * s * 0.08, 0);
        g.quadraticCurveTo(i * s * 0.2, -s * 0.4, i * s * 0.35 + Math.sin(i) * s * 0.1, -s * 0.75);
      }
      g.stroke();
      break;
    }
    case 'petal': {
      g.beginPath();
      g.ellipse(0, 0, s * 0.35, s * 0.7, 0, 0, TAU);
      g.fillStyle = p.color;
      g.fill();
      break;
    }
    case 'puff': {
      const r = s * (0.6 + t * 0.8);
      g.beginPath();
      g.arc(0, 0, r, 0, TAU);
      g.fillStyle = p.color;
      g.fill();
      break;
    }
  }
}
