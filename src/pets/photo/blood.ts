/**
 * 写实血渍：画在 PhotoSkin 的血渍层上（图片像素坐标），随网格一起形变。
 * 着色器会用照片的明暗细节调制血色，所以血渍会"渗进"毛里、带上纹理。
 */

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** 不规则的圆斑路径（边缘有小起伏）。 */
function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, wobble = 0.22): void {
  const n = 14;
  const pts: [number, number][] = [];
  const phase = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wobble * (Math.sin(a * 2 + phase) * 0.5 + (Math.random() - 0.5));
    pts.push([x + Math.cos(a) * r * k, y + Math.sin(a) * r * k]);
  }
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const p = pts[i % n],
      q = pts[(i + 1) % n];
    const mx = (p[0] + q[0]) / 2,
      my = (p[1] + q[1]) / 2;
    if (i === 0) g.moveTo(mx, my);
    else g.quadraticCurveTo(p[0], p[1], mx, my);
  }
  g.closePath();
}

/** 一滴刚渗出的血：深红不规则斑、更深的边缘、左上方的高光，周围几粒溅出的小血点。 */
export function drop(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.save();
  // 血滴不是正圆：沿随机方向拉长一点
  const ang = Math.random() * Math.PI;
  const stretch = rnd(1, 1.7);
  g.translate(x, y);
  g.rotate(ang);
  g.scale(stretch, 1 / Math.sqrt(stretch));
  g.rotate(-ang);
  g.translate(-x, -y);
  // 溅出的小血点
  const n = 2 + Math.floor(Math.random() * 4);
  g.fillStyle = 'rgba(105,4,10,0.9)';
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2,
      d = r * rnd(1.3, 2.3);
    blob(g, x + Math.cos(a) * d, y + Math.sin(a) * d, r * rnd(0.08, 0.22), 0.3);
    g.fill();
  }
  // 渗开的晕：血顺着毛/纹理渗进去，颜色浅、边缘不规则
  for (let i = 0; i < 3; i++) {
    blob(g, x + rnd(-0.3, 0.3) * r, y + rnd(-0.3, 0.3) * r, r * rnd(1.25, 1.7), 0.45);
    g.fillStyle = 'rgba(112,8,14,0.16)';
    g.fill();
  }
  // 主体
  r *= 0.8;
  blob(g, x, y, r);
  const body = g.createRadialGradient(x - r * 0.2, y - r * 0.25, r * 0.1, x, y, r * 1.15);
  body.addColorStop(0, 'rgba(150,14,20,0.95)');
  body.addColorStop(0.6, 'rgba(118,6,13,0.96)');
  body.addColorStop(1, 'rgba(84,2,8,0.97)');
  g.fillStyle = body;
  g.fill();
  // 边缘更深（血在边缘先干）
  g.strokeStyle = 'rgba(58,0,4,0.55)';
  g.lineWidth = r * 0.16;
  g.stroke();
  // 湿润的高光（光从左上方来）
  g.fillStyle = 'rgba(255,190,190,0.5)';
  g.beginPath();
  g.ellipse(x - r * 0.38, y - r * 0.36, r * 0.24, r * 0.15, -0.7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,240,240,0.75)';
  g.beginPath();
  g.arc(x - r * 0.42, y - r * 0.4, r * 0.07, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/**
 * 沾了血的手指拖过：沿路径点一串不规则的小血斑，断断续续、越来越淡。
 * a 为浓度 0..1（随拖过的距离减少）。
 */
export function smear(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, a: number): void {
  const dx = x1 - x0,
    dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.5 || a < 0.02) return;
  const step = Math.max(1, w * 0.35);
  g.save();
  for (let d = 0; d < len; d += step) {
    // 手指和表面不是一直贴紧：随机断开
    if (Math.random() < 0.35 * (1 - a)) continue;
    const t = d / len;
    const x = x0 + dx * t + (Math.random() - 0.5) * w * 0.5,
      y = y0 + dy * t + (Math.random() - 0.5) * w * 0.5;
    blob(g, x, y, w * rnd(0.25, 0.6) * (0.55 + 0.45 * a), 0.45);
    g.fillStyle = `rgba(${Math.round(rnd(96, 128))},${Math.round(rnd(4, 10))},12,${(rnd(0.45, 0.8) * a).toFixed(3)})`;
    g.fill();
  }
  g.restore();
}

/**
 * 滴到地面（地毯、沙地）上的血：预先画成小贴图，绘制时用 multiply 叠到地面上，
 * 让地面的纹理透出来，像血渗进了织物。px 为每世界单位的像素数，r 为半径（世界单位）。
 * 返回的画布中心就是落点，边长为 size 世界单位。
 */
export function groundSplat(r: number, px = 6): { canvas: HTMLCanvasElement; size: number } {
  const size = r * 6;
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size * px);
  const g = c.getContext('2d')!;
  g.scale(px, px);
  const x = size / 2,
    y = size / 2;
  // 从手上滴下来：落点外围有几粒溅开的小血点
  const n = 3 + Math.floor(Math.random() * 6);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2,
      d = r * rnd(1.25, 2.6);
    blob(g, x + Math.cos(a) * d, y + Math.sin(a) * d, r * rnd(0.06, 0.2), 0.35);
    g.fillStyle = `rgba(120,20,28,${rnd(0.6, 0.9).toFixed(2)})`;
    g.fill();
  }
  // 渗开的部分：沿纤维吸开，浅、边缘毛糙
  for (let i = 0; i < 5; i++) {
    blob(g, x + rnd(-0.25, 0.25) * r, y + rnd(-0.25, 0.25) * r, r * rnd(1.05, 1.35), 0.5);
    g.fillStyle = 'rgba(150,45,45,0.3)';
    g.fill();
  }
  // 主体：中间深，边缘一圈更深（干得快）
  blob(g, x, y, r, 0.18);
  const body = g.createRadialGradient(x, y, 0, x, y, r);
  body.addColorStop(0, 'rgba(120,14,22,0.92)');
  body.addColorStop(0.75, 'rgba(105,10,18,0.95)');
  body.addColorStop(1, 'rgba(70,4,10,0.97)');
  g.fillStyle = body;
  g.fill();
  return { canvas: c, size };
}
