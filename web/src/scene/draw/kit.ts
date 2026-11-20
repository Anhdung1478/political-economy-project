// Small drawing helpers shared by the street, shops and props (Task 16): rounded shapes with a soft darker outline of
// their own colour (the characters' style), text that fits, and a few recurring bits (a potted plant, a striped
// awning, a string of bulbs).
import { shade } from './characters';

export type Ctx = CanvasRenderingContext2D;

export const FONT = '"Be Vietnam Pro", system-ui, sans-serif';
export const DISPLAY = '"Bricolage Grotesque", "Be Vietnam Pro", system-ui, sans-serif';

export { shade };

/** The outline colour for a fill. */
export const edge = (c: string): string => shade(c, 0.72);

export function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, rad);
  else ctx.rect(x, y, w, h);
}

/** Fills the current path, then outlines it in its own darker shade (or `line`). */
export function fe(ctx: Ctx, fill: string, lw: number, line: string = edge(fill)): void {
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = line;
    ctx.stroke();
  }
}

/** A rounded box filled and outlined. */
export function box(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, lw: number,
  line?: string): void {
  rr(ctx, x, y, w, h, r);
  fe(ctx, fill, lw, line);
}

export function poly(ctx: Ctx, pts: readonly number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

export function disc(ctx: Ctx, x: number, y: number, r: number, fill: string, lw = 0, line?: string): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  fe(ctx, fill, lw, line);
}

export function oval(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
  ctx.fill();
}

export function line(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string, w: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/** Text centred at (x, y), shrunk to `maxW` if given. */
export function text(ctx: Ctx, s: string, x: number, y: number, size: number, color: string,
  o: { weight?: number; font?: string; maxW?: number; align?: CanvasTextAlign; stroke?: string; strokeW?: number } = {},
): void {
  ctx.font = `${o.weight ?? 800} ${size}px ${o.font ?? FONT}`;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'middle';
  if (o.stroke !== undefined) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.strokeW ?? size * 0.2;
    ctx.strokeStyle = o.stroke;
    if (o.maxW !== undefined) ctx.strokeText(s, x, y, o.maxW);
    else ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = color;
  if (o.maxW !== undefined) ctx.fillText(s, x, y, o.maxW);
  else ctx.fillText(s, x, y);
}

/** A soft shadow on the ground. */
export function shadow(ctx: Ctx, x: number, y: number, rx: number, ry: number, a = 0.16): void {
  oval(ctx, x, y, rx, ry, `rgba(42, 29, 21, ${a})`);
}

/** A scalloped striped awning from x to x + w, top at y, `h` deep, stripes of `a` and `b`. */
export function awning(ctx: Ctx, x: number, y: number, w: number, h: number, a: string, b: string, u: number): void {
  const n = Math.max(3, Math.round(w / (u * 0.36)));
  const sw = w / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 === 0 ? a : b;
    ctx.beginPath();
    ctx.moveTo(x + i * sw, y);
    ctx.lineTo(x + (i + 1) * sw, y);
    ctx.lineTo(x + (i + 1) * sw, y + h - sw * 0.5);
    ctx.arc(x + (i + 0.5) * sw, y + h - sw * 0.5, sw / 2, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
  }
  // A darker hem and the shade under it.
  ctx.fillStyle = 'rgba(42, 29, 21, 0.12)';
  ctx.fillRect(x, y, w, h * 0.14);
  ctx.strokeStyle = edge(a);
  ctx.lineWidth = u * 0.03;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();
}

/** A potted plant standing at (x, y), about s tall. */
export function plant(ctx: Ctx, x: number, y: number, s: number, pot = '#c9772a', leaf = '#5b8f3e'): void {
  shadow(ctx, x, y, s * 0.3, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.22, y - s * 0.38);
  ctx.lineTo(x + s * 0.22, y - s * 0.38);
  ctx.lineTo(x + s * 0.16, y);
  ctx.lineTo(x - s * 0.16, y);
  ctx.closePath();
  fe(ctx, pot, s * 0.035);
  const l2 = shade(leaf, 1.18);
  disc(ctx, x - s * 0.16, y - s * 0.55, s * 0.2, leaf, s * 0.03);
  disc(ctx, x + s * 0.16, y - s * 0.6, s * 0.2, leaf, s * 0.03);
  disc(ctx, x, y - s * 0.78, s * 0.24, l2, s * 0.03, edge(leaf));
}

/** A string of bulbs drooping from (x0, y0) to (x1, y1), `n` bulbs, `lit` 0..1 glow. */
export function bulbs(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, sag: number, n: number, u: number,
  colors: readonly string[]): void {
  ctx.strokeStyle = 'rgba(42, 29, 21, 0.55)';
  ctx.lineWidth = u * 0.02;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag * 2, x1, y1);
  ctx.stroke();
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * ((x0 + x1) / 2) + t * t * x1;
    const y = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * ((y0 + y1) / 2 + sag * 2) + t * t * y1;
    disc(ctx, x, y + u * 0.05, u * 0.05, colors[i % colors.length], u * 0.015);
  }
}
