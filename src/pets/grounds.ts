import { Bounds } from '../engine/part';
import { TAU, rng } from '../engine/math';

// 俯视背景（地面）。都在世界坐标里画，由 Backdrop 缓存。

/** 俯视的编织圆毯 + 木地板。 */
export function woodAndRug(colors: { wood: string; plank: string; rug: string[] }) {
  return (g: CanvasRenderingContext2D, a: Bounds): void => {
    g.fillStyle = colors.wood;
    g.fillRect(a.x, a.y, a.w, a.h);
    const rand = rng(9);
    g.strokeStyle = colors.plank;
    g.lineWidth = 2;
    const pw = 70;
    for (let y = Math.floor(a.y / pw) * pw; y < a.y + a.h; y += pw) {
      g.beginPath();
      g.moveTo(a.x, y);
      g.lineTo(a.x + a.w, y);
      g.stroke();
      for (let x = a.x + rand() * 300; x < a.x + a.w; x += 260 + rand() * 260) {
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, y + pw);
        g.stroke();
      }
      g.save();
      g.globalAlpha = 0.08;
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        const yy = y + 10 + rand() * (pw - 20);
        g.moveTo(a.x, yy);
        g.bezierCurveTo(a.x + a.w * 0.3, yy + 6, a.x + a.w * 0.6, yy - 6, a.x + a.w, yy + 3);
        g.stroke();
      }
      g.restore();
    }
    // 圆形编织毯
    const rx = 520,
      ry = 340;
    g.fillStyle = 'rgba(70,40,20,0.18)';
    g.beginPath();
    g.ellipse(6, 14, rx + 6, ry + 6, 0, 0, TAU);
    g.fill();
    const rings = colors.rug;
    for (let k = 0; k < 9; k++) {
      const f = 1 - k / 9;
      g.fillStyle = rings[k % rings.length];
      g.beginPath();
      g.ellipse(0, 0, rx * f, ry * f, 0, 0, TAU);
      g.fill();
      g.save();
      g.strokeStyle = 'rgba(255,255,255,0.16)';
      g.lineWidth = 3;
      g.setLineDash([7, 9]);
      g.beginPath();
      g.ellipse(0, 0, rx * f - 10, ry * f - 10 * (ry / rx), 0, 0, TAU);
      g.stroke();
      g.restore();
    }
  };
}


/** 俯视草地。lush 越大草越密越深，dapple 为树荫光斑。 */
export function grass(o: { base: string; blades: string[]; flowers?: string[]; dapple?: number; seed?: number }) {
  return (g: CanvasRenderingContext2D, a: Bounds): void => {
    const rand = rng(o.seed ?? 7);
    g.fillStyle = o.base;
    g.fillRect(a.x, a.y, a.w, a.h);
    // 大块明暗
    for (let i = 0; i < 40; i++) {
      const x = a.x + rand() * a.w,
        y = a.y + rand() * a.h,
        r = 80 + rand() * 220;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const light = rand() < 0.5;
      gr.addColorStop(0, light ? 'rgba(255,255,200,0.10)' : 'rgba(0,30,0,0.10)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // 草叶
    g.lineCap = 'round';
    const n = Math.round((a.w * a.h) / 30);
    for (const [k, color] of o.blades.entries()) {
      g.strokeStyle = color;
      g.lineWidth = 2.2 - k * 0.3;
      g.beginPath();
      for (let i = 0; i < n / o.blades.length; i++) {
        const x = a.x + rand() * a.w,
          y = a.y + rand() * a.h;
        const ang = -Math.PI / 2 + (rand() - 0.5) * 2.4;
        const l = 6 + rand() * 12;
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(ang) * l * 0.5 + 2, y + Math.sin(ang) * l * 0.5, x + Math.cos(ang) * l, y + Math.sin(ang) * l);
      }
      g.stroke();
    }
    for (const c of o.flowers ?? []) {
      for (let i = 0; i < (a.w * a.h) / 90000; i++) {
        const x = a.x + rand() * a.w,
          y = a.y + rand() * a.h;
        g.fillStyle = c;
        for (let p = 0; p < 5; p++) {
          const pa = (p / 5) * TAU;
          g.beginPath();
          g.ellipse(x + Math.cos(pa) * 4, y + Math.sin(pa) * 4, 3.6, 2.4, pa, 0, TAU);
          g.fill();
        }
        g.fillStyle = '#f6c945';
        g.beginPath();
        g.arc(x, y, 2.4, 0, TAU);
        g.fill();
      }
    }
    if (o.dapple) {
      // 树荫下的光斑
      for (let i = 0; i < (a.w * a.h) / 25000; i++) {
        const x = a.x + rand() * a.w,
          y = a.y + rand() * a.h,
          r = 20 + rand() * 60;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(255,250,200,${0.22 * o.dapple})`);
        gr.addColorStop(1, 'rgba(255,250,200,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.ellipse(x, y, r, r * 0.7, rand() * 3, 0, TAU);
        g.fill();
      }
      g.fillStyle = `rgba(10,30,10,${0.18 * o.dapple})`;
      g.fillRect(a.x, a.y, a.w, a.h);
    }
  };
}
