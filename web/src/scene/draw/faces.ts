// Faces and the little marks over heads (spec §9 "Nhân vật khách": biểu cảm khuôn mặt): drawn in a head's own frame
// (origin at its centre, already rotated), big and simple enough to read on a 38 px character — dot eyes, a mouth line,
// brows only when they say something. Emotes (a heart, "?", an anger mark, steam, a sweat drop) are drawn upright in
// street coordinates, never mirrored.

/** What a face shows. */
export type Mood = 'neutral' | 'happy' | 'annoyed' | 'angry' | 'puzzled' | 'scared' | 'focus' | 'curious';

export const MOODS: readonly Mood[] = ['neutral', 'happy', 'annoyed', 'angry', 'puzzled', 'scared', 'focus', 'curious'];

const INK = '#2a1d15';
const BLUSH = 'rgba(222, 79, 90, 0.32)';
const ANGRY_BLUSH = 'rgba(222, 79, 90, 0.5)';
const WHITE = '#fffcf7';
const TONGUE = '#e9737b';
const PALE = 'rgba(111, 168, 201, 0.55)';

export interface FaceInput {
  mood: Mood;
  /** Head radius (the frame's units). */
  r: number;
  /** Three-quarter view toward +x (else straight on). */
  side: boolean;
  /** −1..1 each; y + down. */
  lookX: number;
  lookY: number;
  /** 0 open … 1 shut. */
  blink: number;
  /** Head pitch: + down (features slide down). */
  nod: number;
}

/** Where the eyes sit in a head of radius r (glasses go over them): near x, far x, y. */
export function eyeSpots(r: number, side: boolean, nod: number): { near: number; far: number; y: number } {
  const cx = side ? r * 0.36 : 0;
  const span = side ? r * 0.3 : r * 0.36;
  return { near: cx + span, far: cx - span * (side ? 1.05 : 1), y: r * (0.1 + nod * 0.3) };
}

/** A face, in the head's frame. */
export function drawFace(ctx: CanvasRenderingContext2D, f: FaceInput): void {
  const { r, mood } = f;
  // Side-on (three-quarter): features gather toward the front; the far eye is a little smaller.
  const cx = f.side ? r * 0.36 : 0;
  const span = f.side ? r * 0.3 : r * 0.36;
  const ey = r * (0.1 + f.nod * 0.3);
  const lx = f.lookX * r * 0.07;
  const ly = f.lookY * r * 0.06;
  const er = r * 0.135;
  const nearX = cx + span + lx;
  const farX = cx - span * (f.side ? 1.05 : 1) + lx;
  const farK = f.side ? 0.85 : 1;
  const my = r * (0.5 + f.nod * 0.25);
  const mx = cx + (f.side ? r * 0.04 : 0) + lx * 0.5;
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = r * 0.11;

  // Cheeks.
  if (mood === 'happy' || mood === 'angry' || mood === 'neutral' || mood === 'curious') {
    ctx.fillStyle = mood === 'angry' ? ANGRY_BLUSH : BLUSH;
    ctx.beginPath();
    ctx.ellipse(nearX + r * 0.1, my - r * 0.12, r * 0.16, r * 0.1, 0, 0, Math.PI * 2);
    if (!f.side) ctx.ellipse(farX - r * 0.1, my - r * 0.12, r * 0.16, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
  } else if (mood === 'scared') {
    ctx.strokeStyle = PALE;
    ctx.lineWidth = r * 0.07;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const x = nearX - r * 0.12 + i * r * 0.1;
      ctx.moveTo(x, ey + r * 0.22);
      ctx.lineTo(x, ey + r * 0.36);
    }
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.11;
  }

  // Eyes.
  const shut = f.blink > 0.5 && mood !== 'happy' && mood !== 'scared';
  if (mood === 'happy') {
    // Smiling eyes: upturned arcs.
    ctx.beginPath();
    for (const [x, k] of [[nearX, 1], [farX, farK]] as const) {
      ctx.moveTo(x - er * 1.1 * k, ey + er * 0.4);
      ctx.quadraticCurveTo(x, ey - er * 1.3 * k, x + er * 1.1 * k, ey + er * 0.4);
    }
    ctx.stroke();
  } else if (shut) {
    ctx.beginPath();
    for (const [x, k] of [[nearX, 1], [farX, farK]] as const) {
      ctx.moveTo(x - er * k, ey + ly);
      ctx.lineTo(x + er * k, ey + ly);
    }
    ctx.stroke();
  } else if (mood === 'scared') {
    // Wide eyes: whites with small pupils.
    for (const [x, k] of [[nearX, 1], [farX, farK]] as const) {
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.arc(x, ey, er * 1.45 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = r * 0.06;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x + lx * 0.8, ey + ly, er * 0.62 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = r * 0.11;
  } else {
    const big = mood === 'puzzled' ? 1.25 : mood === 'curious' ? 1.1 : 1;
    ctx.beginPath();
    ctx.arc(nearX, ey + ly, er * big, 0, Math.PI * 2);
    ctx.arc(farX, ey + ly, er * farK * (mood === 'puzzled' ? 0.8 : big), 0, Math.PI * 2);
    ctx.fill();
    // A catch-light makes dot eyes alive at any size.
    if (mood !== 'annoyed' && mood !== 'angry') {
      ctx.fillStyle = WHITE;
      ctx.beginPath();
      ctx.arc(nearX + er * 0.35, ey + ly - er * 0.35, er * 0.38, 0, Math.PI * 2);
      ctx.arc(farX + er * 0.35 * farK, ey + ly - er * 0.35 * farK, er * 0.32 * farK, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
    }
    if (mood === 'annoyed') {
      // Heavy lids: the top half of each eye is cut off by a flat lid.
      ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      for (const [x, k] of [[nearX, 1], [farX, farK]] as const) {
        ctx.moveTo(x - er * 1.5 * k, ey + ly - er * 0.25);
        ctx.lineTo(x + er * 1.5 * k, ey + ly - er * 0.25);
      }
      ctx.stroke();
    }
  }

  // Brows.
  const by = ey - r * 0.34;
  ctx.lineWidth = r * 0.1;
  if (mood === 'angry') {
    ctx.lineWidth = r * 0.13;
    ctx.beginPath();
    ctx.moveTo(nearX + er * 1.6, by - r * 0.1);
    ctx.lineTo(nearX - er * 0.9, by + r * 0.08);
    ctx.moveTo(farX - er * 1.4 * farK, by - r * 0.1);
    ctx.lineTo(farX + er * 0.9, by + r * 0.08);
    ctx.stroke();
  } else if (mood === 'annoyed') {
    ctx.beginPath();
    ctx.moveTo(nearX + er * 1.5, by - r * 0.02);
    ctx.lineTo(nearX - er * 1.1, by + r * 0.05);
    ctx.moveTo(farX - er * 1.3 * farK, by - r * 0.02);
    ctx.lineTo(farX + er * 1.1, by + r * 0.05);
    ctx.stroke();
  } else if (mood === 'scared') {
    ctx.beginPath();
    ctx.moveTo(nearX + er * 1.5, by + r * 0.02);
    ctx.lineTo(nearX - er * 0.8, by - r * 0.12);
    ctx.moveTo(farX - er * 1.3 * farK, by + r * 0.02);
    ctx.lineTo(farX + er * 0.8, by - r * 0.12);
    ctx.stroke();
  } else if (mood === 'puzzled') {
    ctx.beginPath();
    ctx.moveTo(nearX - er * 1.2, by - r * 0.06);
    ctx.quadraticCurveTo(nearX, by - r * 0.26, nearX + er * 1.4, by - r * 0.1);
    ctx.moveTo(farX - er * 1.2 * farK, by + r * 0.06);
    ctx.lineTo(farX + er * 1.1, by + r * 0.06);
    ctx.stroke();
  }

  // Mouth.
  ctx.lineWidth = r * 0.1;
  const mw = r * 0.2;
  ctx.beginPath();
  switch (mood) {
    case 'happy':
      ctx.moveTo(mx - mw * 1.2, my - r * 0.06);
      ctx.quadraticCurveTo(mx, my + r * 0.42, mx + mw * 1.2, my - r * 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = TONGUE;
      ctx.beginPath();
      ctx.ellipse(mx, my + r * 0.1, mw * 0.55, r * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK;
      return;
    case 'angry':
      ctx.moveTo(mx - mw, my + r * 0.1);
      ctx.quadraticCurveTo(mx, my - r * 0.14, mx + mw, my + r * 0.1);
      break;
    case 'annoyed':
      ctx.moveTo(mx - mw * 0.9, my + r * 0.02);
      ctx.lineTo(mx + mw * 0.9, my - r * 0.02);
      break;
    case 'puzzled':
      ctx.moveTo(mx - mw, my + r * 0.02);
      ctx.quadraticCurveTo(mx - mw * 0.4, my - r * 0.08, mx, my + r * 0.02);
      ctx.quadraticCurveTo(mx + mw * 0.4, my + r * 0.1, mx + mw, my - r * 0.02);
      break;
    case 'scared':
      ctx.moveTo(mx - mw, my + r * 0.04);
      ctx.lineTo(mx - mw * 0.5, my - r * 0.03);
      ctx.lineTo(mx, my + r * 0.04);
      ctx.lineTo(mx + mw * 0.5, my - r * 0.03);
      ctx.lineTo(mx + mw, my + r * 0.04);
      break;
    case 'curious':
      ctx.ellipse(mx, my, r * 0.07, r * 0.085, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'focus':
      ctx.moveTo(mx - mw * 0.5, my);
      ctx.lineTo(mx + mw * 0.5, my);
      break;
    case 'neutral':
      ctx.moveTo(mx - mw * 0.75, my - r * 0.04);
      ctx.quadraticCurveTo(mx, my + r * 0.12, mx + mw * 0.75, my - r * 0.04);
      break;
  }
  ctx.stroke();
}

// ── Emotes ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const HEART = '#de4f5a';
const HEART_DEEP = '#a8323c';
const MARK = '#94531a';
const ANGER = '#de4f5a';
const SWEAT = '#8cc4e0';
const SWEAT_EDGE = '#4f8fb3';
const STEAM = 'rgba(255, 252, 247, 0.9)';
const STEAM_EDGE = 'rgba(110, 91, 77, 0.45)';

/** A heart of size s centred at (x, y). */
export function heart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, alpha = 1): void {
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.42);
  ctx.bezierCurveTo(x - s * 0.62, y - s * 0.02, x - s * 0.42, y - s * 0.62, x, y - s * 0.24);
  ctx.bezierCurveTo(x + s * 0.42, y - s * 0.62, x + s * 0.62, y - s * 0.02, x, y + s * 0.42);
  ctx.fillStyle = HEART;
  ctx.fill();
  ctx.lineWidth = s * 0.09;
  ctx.strokeStyle = HEART_DEEP;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 252, 247, 0.7)';
  ctx.beginPath();
  ctx.ellipse(x - s * 0.2, y - s * 0.18, s * 0.09, s * 0.06, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** A bold "?" (or "!") of height s centred at (x, y), in a small round badge. */
export function mark(ctx: CanvasRenderingContext2D, glyph: '?' | '!', x: number, y: number, s: number,
  colour = MARK): void {
  ctx.fillStyle = WHITE;
  ctx.strokeStyle = colour;
  ctx.lineWidth = s * 0.1;
  ctx.beginPath();
  ctx.arc(x, y, s * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // The glyph as strokes: crisp at any size, no font needed.
  ctx.lineWidth = s * 0.16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (glyph === '?') {
    ctx.arc(x, y - s * 0.14, s * 0.17, Math.PI * 1.1, Math.PI * 0.45);
    ctx.lineTo(x, y + s * 0.1);
  } else {
    ctx.moveTo(x, y - s * 0.32);
    ctx.lineTo(x, y + s * 0.08);
  }
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y + s * 0.3, s * 0.09, 0, Math.PI * 2);
  ctx.fill();
}

/** The cross-popping anger mark of size s at (x, y). */
export function angerMark(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.strokeStyle = ANGER;
  ctx.lineWidth = s * 0.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + Math.PI / 4;
    const cx = x + Math.cos(a) * s * 0.36;
    const cy = y + Math.sin(a) * s * 0.36;
    // Each quarter is a little arc bowing toward the centre.
    ctx.moveTo(cx + Math.cos(a + Math.PI / 2) * s * 0.26, cy + Math.sin(a + Math.PI / 2) * s * 0.26);
    ctx.quadraticCurveTo(x + Math.cos(a) * s * 0.1, y + Math.sin(a) * s * 0.1,
      cx + Math.cos(a - Math.PI / 2) * s * 0.26, cy + Math.sin(a - Math.PI / 2) * s * 0.26);
  }
  ctx.stroke();
}

/** A sweat drop of height s at (x, y) (its round bottom). */
export function sweat(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.bezierCurveTo(x + s * 0.15, y - s * 0.6, x + s * 0.42, y - s * 0.3, x + s * 0.42, y - s * 0.05);
  ctx.arc(x, y - s * 0.05, s * 0.42, 0, Math.PI);
  ctx.bezierCurveTo(x - s * 0.42, y - s * 0.3, x - s * 0.15, y - s * 0.6, x, y - s);
  ctx.fillStyle = SWEAT;
  ctx.fill();
  ctx.lineWidth = s * 0.1;
  ctx.strokeStyle = SWEAT_EDGE;
  ctx.stroke();
}

/** A puff of steam of size s at (x, y), fading with alpha. */
export function puff(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, alpha: number): void {
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x - s * 0.3, y, s * 0.36, 0, Math.PI * 2);
  ctx.arc(x + s * 0.25, y - s * 0.1, s * 0.42, 0, Math.PI * 2);
  ctx.arc(x + s * 0.05, y - s * 0.4, s * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = STEAM;
  ctx.fill();
  ctx.lineWidth = s * 0.1;
  ctx.strokeStyle = STEAM_EDGE;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Three whisper dots ("…") of size s centred at (x, y). */
export function dots(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, n = 3): void {
  ctx.fillStyle = WHITE;
  ctx.strokeStyle = 'rgba(42, 29, 21, 0.35)';
  ctx.lineWidth = s * 0.08;
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.9, s * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  for (let i = 0; i < n; i++) ctx.arc(x + (i - (n - 1) / 2) * s * 0.42, y, s * 0.11, 0, Math.PI * 2);
  ctx.fill();
}
