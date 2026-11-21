// The cup on the counter (spec §9 "Bảng pha chế"): it drops onto the counter with a bounce, ice falls cube by cube,
// tea pours in a stream with the level rising and sloshing in the colour of the day's tea grade (a cup with no ice
// stops lower, at its smaller tea, and wears a struck-through ice badge), toppings drop and bounce at the bottom, and a
// lid and a straw go on when the cup is done. Drawn on a canvas in the units of a
// 160 × 200 view box, with the shapes, colours and motion of the SVG cup it replaces (final review I1: moving SVG
// shapes every frame cost a style, layout and paint pass of the page each time). One requestAnimationFrame loop
// draws it from the sim clock, so it pauses with the clock and stays in step with the engine's step timing (R14). The
// empty counter's dashed outline stays a still SVG.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { CONFIG } from '../../../../shared/sim/config';
import type { CraftState, Size, TeaGrade, ToppingId } from '../../../../shared/sim/types';
import { stepProgress } from './rush';

export const TEA_COLORS: Record<TeaGrade, { fill: string; deep: string; foam: string }> = {
  skimp: { fill: '#dcc7a5', deep: '#c9ae86', foam: '#efe3cf' },
  standard: { fill: '#c99560', deep: '#a8733f', foam: '#e9cba3' },
  premium: { fill: '#a9693a', deep: '#7f4a24', foam: '#d9a774' },
};

const W = 160;
const FLOOR = 186;
const CX = 80;
const GEOM: Record<Size, { h: number; tw: number }> = { S: { h: 106, tw: 82 }, M: { h: 126, tw: 90 }, L: { h: 146, tw: 98 } };

interface Geom { h: number; tw: number; bw: number; top: number; left: number; right: number; path: string; fillH: number }

function geomOf(size: Size): Geom {
  const { h, tw } = GEOM[size];
  const bw = tw * 0.7;
  const top = FLOOR - h;
  const l = CX - tw / 2;
  const r = CX + tw / 2;
  const bl = CX - bw / 2;
  const br = CX + bw / 2;
  const path = `M${l} ${top} L${r} ${top} L${br - 1} ${FLOOR - 8} Q${br - 2} ${FLOOR} ${br - 10} ${FLOOR} `
    + `L${bl + 10} ${FLOOR} Q${bl + 2} ${FLOOR} ${bl + 1} ${FLOOR - 8} Z`;
  return { h, tw, bw, top, left: l, right: r, path, fillH: h * 0.8 };
}

/** Half the inner width of the cup at height y. */
function halfAt(g: Geom, y: number): number {
  const k = Math.min(1, Math.max(0, (FLOOR - y) / g.h));
  return (g.bw + (g.tw - g.bw) * k) / 2 - 7;
}

/** A small deterministic jitter in −1..1. */
const jit = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

const easeOutBounce = (x: number): number => {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
const easeOutBack = (x: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The cup's frame budget (ms between draws): while a step runs (as the portraits), and at rest (it only breathes). */
const STEP_MS = 30;
const REST_MS = 50;

const ICE = 5;
const PIECES: Record<ToppingId, number> = { pearl: 10, jelly: 6, pudding: 3 };
const BAND = 15;

interface Piece { topping: ToppingId; band: number; k: number; n: number; x: number; y: number; r: number }

function piecesOf(g: Geom, toppings: readonly ToppingId[]): Piece[] {
  const out: Piece[] = [];
  toppings.forEach((t, band) => {
    const n = PIECES[t];
    const yMid = FLOOR - 9 - band * BAND;
    const half = halfAt(g, yMid) - 2;
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0.5 : k / (n - 1);
      const x = CX - half + u * half * 2 + jit(k + band * 13) * 3;
      const y = yMid + jit(k * 7 + band) * 3.5 - (k % 2) * (t === 'pearl' ? 5 : 2);
      out.push({ topping: t, band, k, n, x, y, r: jit(k + 99) * 30 });
    }
  });
  return out;
}

export interface CupProps {
  craft: CraftState;
  machine: boolean;
  tea: TeaGrade;
  /** Sim time in fractional ticks (the rush clock or the practice clock). */
  time: () => number;
  reduced: boolean;
  /** Ready to hand over: glows. */
  ready: boolean;
  /** Set by the cup: call it to make the tea slosh (a drag, a shake). */
  sloshRef?: MutableRefObject<((amount: number) => void) | null>;
}

/** What React lays out: everything but the motion. */
function layoutKey(c: CraftState): string {
  const cup = c.cup;
  const a = c.anim;
  return `${cup ? `${cup.size}${cup.iced ? 'i' : ''}${cup.teaMl > 0 ? 't' : ''}${cup.toppings.join('')}` : '-'}`
    + `|${a ? `${a.step}${a.endsAt}` : ''}|${c.buffer.length}`;
}

/**
 * The part of the view box the canvas covers: the cup's 160 × 200 box and what rises out of it (the straw, the
 * pitcher, the cup dropping in). The canvas is laid out that much larger than the cup's box (rush.css `.rcup--canvas`).
 */
const VX = -20;
const VY = -70;
const VW = 220;
const VH = 280;
/** Canvas pixels per CSS pixel, at most (a phone at 3× keeps the sharpness the SVG had). */
const MAX_DPR = 3;
const DEG = Math.PI / 180;

/** Where everything in the cup is in one frame: what the loop works out, then draws. */
interface Frame {
  bodyY: number;
  bodySy: number;
  level: number;
  surf: number;
  amp: number;
  ph: number;
  pitcher: number;
  tilt: number;
  stream: boolean;
  wob: number;
  iceX: number[];
  iceY: number[];
  iceR: number[];
  iceOp: number[];
  pieceY: number[];
  pieceOp: number[];
  lid: number;
  lidOn: boolean;
  /** Tea poured with no ice: the "không đá" badge. */
  dry: boolean;
}

const newFrame = (): Frame => ({
  bodyY: 0, bodySy: 1, level: 0, surf: 0, amp: 0, ph: 0, pitcher: 0, tilt: 0, stream: false, wob: 0,
  iceX: [0, 0, 0, 0, 0], iceY: [0, 0, 0, 0, 0], iceR: [0, 0, 0, 0, 0], iceOp: [0, 0, 0, 0, 0], pieceY: [], pieceOp: [],
  lid: 0, lidOn: false, dry: false,
});

type Ctx = CanvasRenderingContext2D;

/** An SVG `<rect rx>`: the corner radius clamped to half the sides. */
function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + k, y);
  c.lineTo(x + w - k, y);
  c.arcTo(x + w, y, x + w, y + k, k);
  c.lineTo(x + w, y + h - k);
  c.arcTo(x + w, y + h, x + w - k, y + h, k);
  c.lineTo(x + k, y + h);
  c.arcTo(x, y + h, x, y + h - k, k);
  c.lineTo(x, y + k);
  c.arcTo(x, y, x + k, y, k);
  c.closePath();
}

function ellipse(c: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

function circle(c: Ctx, cx: number, cy: number, r: number): void {
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
}

/** The pitcher's fixed shapes, made on first use (there is no Path2D in node). */
let pitcherPaths: { body: Path2D; spout: Path2D; handle: Path2D } | null = null;
function pitcherShapes() {
  pitcherPaths ??= {
    body: new Path2D('M-14 -18 L14 -18 L18 18 Q18 24 12 24 L-12 24 Q-18 24 -18 18 Z'),
    spout: new Path2D('M-14 -18 L-24 -26 L-12 -12 Z'),
    handle: new Path2D('M14 -10 Q28 -6 26 6 Q24 14 16 12'),
  };
  return pitcherPaths;
}

/** What drawing needs besides the frame: the canvas's fit and what it reads from the CSS once. */
interface Paint {
  ctx: Ctx;
  /** Canvas pixels per view-box unit, and the view box's origin in canvas pixels. */
  k: number;
  ox: number;
  oy: number;
  /** The straw's stripes at this scale. */
  stripes: CanvasPattern | null;
  font: string;
  caramel: string;
}

/** The straw's stripes (the SVG's 12 × 12 `<pattern>`, rotate(40)), drawn at `k` pixels a unit so they stay sharp. */
function stripesAt(ctx: Ctx, k: number): CanvasPattern | null {
  const n = Math.max(12, Math.ceil(12 * k));
  const tile = document.createElement('canvas');
  tile.width = n;
  tile.height = n;
  const t = tile.getContext('2d');
  if (t === null) return null;
  t.scale(n / 12, n / 12);
  t.fillStyle = '#de4f5a';
  t.fillRect(0, 0, 12, 12);
  t.fillStyle = '#fff6ea';
  t.fillRect(0, 0, 5, 12);
  const p = ctx.createPattern(tile, 'repeat');
  p?.setTransform(new DOMMatrix().rotate(40).scale(12 / n));
  return p;
}

/** "Không đá" on the cup: the order bubble's ice cube in a red "no" sign (CounterCustomer `NoIceIcon`, ×1.2). */
function drawNoIceBadge(c: Ctx, x: number, y: number): void {
  c.save();
  c.translate(x, y);
  c.scale(1.2, 1.2);
  circle(c, 0, 0, 8.4);
  c.fillStyle = '#fffcf7';
  c.fill();
  c.strokeStyle = '#de4f5a';
  c.lineWidth = 2.2;
  c.stroke();
  c.save();
  c.rotate(-10 * DEG);
  roundRect(c, -4.4, -4.4, 8.8, 8.8, 2.4);
  c.fillStyle = '#e8f6ff';
  c.fill();
  c.strokeStyle = '#6fa8c9';
  c.lineWidth = 1.4;
  c.stroke();
  c.restore();
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(-5.8, 5.8);
  c.lineTo(5.8, -5.8);
  c.strokeStyle = '#de4f5a';
  c.lineWidth = 2.2;
  c.stroke();
  c.lineCap = 'butt';
  c.restore();
}

/** Draws the cup as the SVG did, back to front, in view-box units. */
function drawCup(P: Paint, f: Frame, g: Geom, size: Size, pieces: readonly Piece[],
  colors: (typeof TEA_COLORS)[TeaGrade], cupPath: Path2D): void {
  const c = P.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  c.setTransform(P.k, 0, 0, P.k, P.ox, P.oy);
  c.globalAlpha = 1;
  c.lineCap = 'butt';
  c.lineJoin = 'miter';
  c.miterLimit = 4;
  c.setLineDash([]);

  // the shadow on the counter
  c.fillStyle = 'rgba(42, 29, 21, 0.16)';
  ellipse(c, CX, FLOOR + 3, g.bw / 2 + 10, 6);
  c.fill();

  // the cup, dropping in with a squash
  c.save();
  c.translate(0, f.bodyY);
  c.translate(CX, FLOOR);
  c.scale(2 - f.bodySy, f.bodySy);
  c.translate(-CX, -FLOOR);

  // inside the glass
  c.save();
  c.clip(cupPath);
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fillRect(0, 0, W, 200);
  if (f.level > 0) {
    const x0 = g.left - 6;
    const x1 = g.right + 6;
    const n = 8;
    let top = f.surf + Math.sin(f.ph) * f.amp;
    c.beginPath();
    c.moveTo(x0, top);
    for (let i = 1; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = f.surf + Math.sin(f.ph + i * 0.9) * f.amp + Math.sin(f.ph * 1.7 - i * 1.3) * f.amp * 0.4;
      if (y < top) top = y;
      c.lineTo(x, y);
    }
    c.lineTo(x1, 200);
    c.lineTo(x0, 200);
    c.closePath();
    // the SVG gradient ran over the liquid's own box (objectBoundingBox): from its highest point to the bottom
    const grad = c.createLinearGradient(0, top, 0, 200);
    grad.addColorStop(0, colors.fill);
    grad.addColorStop(1, colors.deep);
    c.fillStyle = grad;
    c.fill();
    const fy = f.surf + Math.sin(f.ph + 4) * f.amp * 0.6;
    c.globalAlpha = 0.55;
    c.fillStyle = colors.foam;
    c.fillRect(x0, fy - 1, x1 - x0, 5);
    c.globalAlpha = 1;
  }
  for (let j = 0; j < pieces.length; j++) {
    if (!(f.pieceOp[j] > 0)) continue;
    const pc = pieces[j];
    c.save();
    c.translate(pc.x, f.pieceY[j]);
    c.rotate(Math.round(pc.r) * DEG);
    if (pc.topping === 'pearl') {
      c.fillStyle = '#3a271c';
      circle(c, 0, 0, 5.4);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.5)';
      circle(c, -1.6, -1.8, 1.6);
      c.fill();
    } else if (pc.topping === 'jelly') {
      roundRect(c, -5, -5, 10, 10, 2.5);
      c.fillStyle = 'rgba(120,180,90,0.85)';
      c.fill();
      c.strokeStyle = '#5b8f3e';
      c.lineWidth = 1;
      c.stroke();
      roundRect(c, -3, -3.5, 3, 2, 1);
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.fill();
    } else {
      ellipse(c, 0, 0, 10, 6.5);
      c.fillStyle = '#f2c14e';
      c.fill();
      c.strokeStyle = '#c9922a';
      c.lineWidth = 1;
      c.stroke();
      c.globalAlpha = 0.75;
      ellipse(c, 0, -3.4, 7, 2.4);
      c.fillStyle = '#a8641f';
      c.fill();
      c.globalAlpha = 1;
    }
    c.restore();
  }
  for (let i = 0; i < ICE; i++) {
    if (!(f.iceOp[i] > 0)) continue;
    c.save();
    c.translate(f.iceX[i], f.iceY[i]);
    c.rotate(f.iceR[i] * DEG);
    roundRect(c, -9, -9, 18, 18, 4.5);
    c.fillStyle = 'rgba(232,246,255,0.78)';
    c.fill();
    c.strokeStyle = 'rgba(111,168,201,0.75)';
    c.lineWidth = 1.4;
    c.stroke();
    c.beginPath();
    c.moveTo(-5, -4);
    c.lineTo(1, -6);
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.stroke();
    c.lineCap = 'butt';
    c.restore();
  }
  // the glass's shine
  roundRect(c, g.left + 10, g.top + 8, 6, g.h - 28, 3);
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fill();
  c.restore();

  // the glass, the fill mark, the size sticker
  c.lineJoin = 'round';
  c.strokeStyle = '#6e5b4d';
  c.lineWidth = 2.6;
  c.stroke(cupPath);
  c.lineJoin = 'miter';
  const mark = FLOOR - 6 - g.fillH;
  c.beginPath();
  c.moveTo(g.left + 4, mark);
  c.lineTo(g.right - 4, mark);
  c.setLineDash([3, 4]);
  c.strokeStyle = 'rgba(110, 91, 77, 0.35)';
  c.lineWidth = 1.5;
  c.stroke();
  c.setLineDash([]);
  const sy = FLOOR - g.h * 0.42;
  circle(c, CX, sy, 12);
  c.fillStyle = P.caramel;
  c.fill();
  c.strokeStyle = '#fff';
  c.lineWidth = 2;
  c.stroke();
  c.fillStyle = '#fff';
  c.font = P.font;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillText(size, CX, sy + 4.5);
  if (f.dry) drawNoIceBadge(c, CX + 19, sy - 12);

  // the lid and the straw
  if (f.lidOn) {
    c.save();
    c.translate(0, f.lid);
    c.save();
    c.translate(g.left + 24, g.top);
    c.rotate(14 * DEG);
    c.translate(-(g.left + 24), -g.top);
    roundRect(c, g.left + 18, g.top - 92, 11, 108, 5);
    c.fillStyle = P.stripes ?? '#de4f5a';
    c.fill();
    c.strokeStyle = '#a8323c';
    c.lineWidth = 1.2;
    c.stroke();
    c.restore();
    c.beginPath();
    c.moveTo(g.left - 3, g.top + 1);
    c.quadraticCurveTo(CX, g.top - 30, g.right + 3, g.top + 1);
    c.closePath();
    c.fillStyle = 'rgba(255, 255, 255, 0.72)';
    c.fill();
    c.lineJoin = 'round';
    c.strokeStyle = '#6e5b4d';
    c.lineWidth = 2.2;
    c.stroke();
    c.lineJoin = 'miter';
    roundRect(c, g.left - 5, g.top - 2, g.tw + 10, 7, 3.5);
    c.fillStyle = '#fffcf7';
    c.fill();
    c.stroke();
    c.restore();
  }
  c.restore();

  // the stream and the pitcher pouring it
  if (f.stream) {
    const top = g.top - 22;
    const h = Math.max(0, f.surf - top + 4);
    if (h > 0) {
      roundRect(c, CX + 9 + f.wob, top, 5.5 + f.wob * 0.6, h, 2.5);
      c.fillStyle = colors.fill;
      c.fill();
    }
  }
  if (f.pitcher > 0) {
    const ps = pitcherShapes();
    c.save();
    c.globalAlpha = f.pitcher;
    c.translate(CX + 34 + (1 - f.pitcher) * 30, g.top - 34);
    c.rotate(f.tilt * DEG);
    c.fillStyle = '#fffcf7';
    c.strokeStyle = '#6e5b4d';
    c.lineWidth = 2;
    c.fill(ps.body);
    c.stroke(ps.body);
    c.lineJoin = 'round';
    c.fill(ps.spout);
    c.stroke(ps.spout);
    c.lineJoin = 'miter';
    c.lineWidth = 3;
    c.lineCap = 'round';
    c.stroke(ps.handle);
    c.lineCap = 'butt';
    c.globalAlpha = f.pitcher * 0.85;
    roundRect(c, -15, -2, 31, 22, 3);
    c.fillStyle = colors.fill;
    c.fill();
    c.restore();
  }
}

function CupView({ craft, machine, tea, time, reduced, ready, sloshRef }: CupProps) {
  const cup = craft.cup;
  const size = cup?.size ?? null;
  const g = useMemo(() => (size === null ? null : geomOf(size)), [size]);
  const toppingKey = cup?.toppings.join(',') ?? '';
  const pieces = useMemo(() => (g === null ? [] : piecesOf(g, toppingKey === '' ? [] : toppingKey.split(',') as ToppingId[])),
    [g, toppingKey]);
  const cupPath = useMemo(() => (g === null || typeof Path2D === 'undefined' ? null : new Path2D(g.path)), [g]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ craft, machine, time, reduced, g, pieces, tea, cupPath });
  /** Draws the cup at once (set by the loop): after a render, so a changed cup never shows its last frame. */
  const drawNow = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    latest.current = { craft, machine, time, reduced, g, pieces, tea, cupPath };
    drawNow.current?.();
  });

  // Slosh: an amount that decays; a lid that drops in when the cup is done.
  const motion = useRef({ slosh: 0, lidSince: -1, lastWall: 0, wasPouring: false });
  useEffect(() => {
    if (sloshRef === undefined) return;
    sloshRef.current = (a: number) => { motion.current.slosh = Math.min(10, motion.current.slosh + a); };
    return () => { sloshRef.current = null; };
  }, [sloshRef]);

  const hasCup = cup !== null;
  useLayoutEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d') ?? null;
    if (el === null || ctx === null) return;
    const css = getComputedStyle(el);
    const P: Paint = {
      ctx, k: 0, ox: 0, oy: 0, stripes: null,
      font: `800 14px ${css.getPropertyValue('--font-display').trim() || 'sans-serif'}`,
      caramel: css.getPropertyValue('--caramel').trim() || '#c9772a',
    };
    const f = newFrame();
    const fit = () => {
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (el.width !== bw) el.width = bw;
      if (el.height !== bh) el.height = bh;
      // the cup's box inside the canvas, fitted as the SVG's view box was (meet, centred)
      const boxW = (w * W) / VW;
      const boxH = (h * 200) / VH;
      const s = Math.min(boxW / W, boxH / 200);
      const k = s * dpr;
      if (P.stripes === null || Math.abs(k - P.k) > 1e-3) P.stripes = stripesAt(ctx, k);
      P.k = k;
      P.ox = ((w * -VX) / VW + (boxW - W * s) / 2) * dpr;
      P.oy = ((h * -VY) / VH + (boxH - 200 * s) / 2) * dpr;
    };

    /** Works out where everything is at `wall` (the SVG cup's motion, unchanged) and draws it. */
    const step = (wall: number, force: boolean) => {
      const L = latest.current;
      const m = motion.current;
      const resting = L.craft.anim === null && m.slosh < 0.3 && (m.lidSince < 0 || wall - m.lidSince > 450);
      if (!force && wall - m.lastWall < (resting ? REST_MS : STEP_MS)) return;
      const dt = m.lastWall === 0 ? 16 : Math.min(64, Math.max(0, wall - m.lastWall));
      m.lastWall = wall;
      const geo = L.g;
      const c = L.craft;
      if (geo === null || c.cup === null || L.cupPath === null) {
        m.lidSince = -1;
        return;
      }
      const now = L.time();
      const anim = c.anim;
      const stp = anim?.step ?? null;
      const p = stepProgress(anim, now, c.cup.size, L.machine);
      const calm = L.reduced;

      // The cup set down: it drops in with a squash.
      f.bodyY = 0;
      f.bodySy = 1;
      if (stp === 'size' && !calm) {
        const k = clamp01(p / 0.85);
        f.bodyY = -70 * (1 - easeOutBounce(k));
        f.bodySy = k > 0.55 ? 1 - Math.sin(((k - 0.55) / 0.45) * Math.PI) * 0.07 : 1;
      }

      // Tea level: up to the fill mark over ice, lower with no ice (less tea, §6).
      const hasTea = c.cup.teaMl > 0;
      const pouring = stp === 'tea';
      const full = hasTea ? Math.min(1, c.cup.teaMl / CONFIG.supplies.sizeMl[c.cup.size]) : 1;
      f.level = !hasTea ? 0 : (pouring ? clamp01((p - 0.06) / 0.9) : 1) * full;
      f.dry = hasTea && !c.cup.iced;
      f.surf = FLOOR - 6 - f.level * geo.fillH;
      if (pouring) m.slosh = Math.max(m.slosh, 3.2);
      if (m.wasPouring && !pouring) m.slosh = Math.max(m.slosh, 4.5);
      m.wasPouring = pouring;
      m.slosh *= Math.exp(-dt / 700);
      f.amp = calm ? 0 : 0.8 + m.slosh;
      f.ph = wall / 260;

      // The pitcher tips in and pours a stream down to the surface.
      f.pitcher = pouring ? (calm ? 1 : Math.min(clamp01(p / 0.08), clamp01((1 - p) / 0.08))) : 0;
      f.tilt = -48 * f.pitcher;
      f.stream = pouring && p > 0.05 && p < 0.96;
      f.wob = calm ? 0 : Math.sin(wall / 45) * 0.8;

      // Ice: cubes drop one by one, then float up with the tea.
      for (let i = 0; i < ICE; i++) {
        if (!c.cup.iced) {
          f.iceOp[i] = 0;
          continue;
        }
        const row = i < 3 ? 0 : 1;
        const baseY = FLOOR - 16 - row * 15;
        const half = halfAt(geo, baseY) - 8;
        f.iceX[i] = row === 0 ? CX + (i - 1) * half * 0.85 : CX + (i === 3 ? -0.45 : 0.45) * half;
        const floatY = f.surf + 7 + (i % 2) * 6 + (calm ? 0 : Math.sin(wall / 500 + i) * 1.4);
        let y = f.level > 0 ? Math.min(baseY, floatY) : baseY;
        let op = 1;
        if (stp === 'ice') {
          const start = (i / ICE) * 0.62;
          const k = clamp01((p - start) / 0.34);
          if (k <= 0) op = 0;
          else if (!calm) y = geo.top - 40 + (y - geo.top + 40) * easeOutBounce(k);
        }
        f.iceY[i] = y;
        f.iceOp[i] = op;
        f.iceR[i] = jit(i) * 18 + (calm ? 0 : Math.sin(wall / 700 + i) * 4);
      }

      // Toppings: the newest drops in, slower once in the tea, and bounces at the bottom.
      const pcs = L.pieces;
      const lastBand = c.cup.toppings.length - 1;
      f.pieceY.length = pcs.length;
      f.pieceOp.length = pcs.length;
      for (let j = 0; j < pcs.length; j++) {
        const pc = pcs[j];
        let y = pc.y;
        let op = 1;
        if (stp === 'topping' && pc.band === lastBand) {
          const start = (pc.k / pc.n) * 0.4;
          const k = clamp01((p - start) / 0.5);
          if (k <= 0) op = 0;
          else if (!calm) y = geo.top - 34 + (pc.y - geo.top + 34) * easeOutBounce(k);
          if (k > 0 && k < 1 && !calm) m.slosh = Math.max(m.slosh, 2);
        }
        f.pieceY[j] = y;
        f.pieceOp[j] = op;
      }

      // Lid and straw once the cup is done (tea in, nothing running).
      const done = hasTea && anim === null;
      if (done && m.lidSince < 0) m.lidSince = wall;
      if (!done) m.lidSince = -1;
      const k = m.lidSince < 0 ? 0 : calm ? 1 : clamp01((wall - m.lidSince) / 380);
      f.lidOn = k > 0;
      f.lid = -46 * (1 - easeOutBack(k));

      drawCup(P, f, geo, c.cup.size, pcs, TEA_COLORS[L.tea], L.cupPath);
    };

    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      fit();
      step(performance.now(), true);
    });
    ro?.observe(el);
    // A window moved to a screen with another pixel ratio: refit. The query is for one ratio, so re-arm after each change.
    let mq: MediaQueryList | null = null;
    const onDpr = () => { arm(); fit(); step(performance.now(), true); };
    const arm = () => {
      mq?.removeEventListener('change', onDpr);
      mq = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
      mq?.addEventListener?.('change', onDpr);
    };
    arm();
    let raf = 0;
    const loop = (wall: number) => {
      raf = requestAnimationFrame(loop);
      step(wall, false);
    };
    drawNow.current = () => step(performance.now(), true);
    step(performance.now(), true);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      mq?.removeEventListener?.('change', onDpr);
      mq = null;
      drawNow.current = null;
    };
  }, [hasCup]);

  if (cup === null || g === null) {
    return (
      <svg className="rcup rcup--empty" viewBox={`0 0 ${W} 200`} aria-hidden="true">
        <ellipse cx={CX} cy={FLOOR + 3} rx={44} ry={6} className="rcup__shadow" />
        <path d={geomOf('M').path} className="rcup__ghost" />
      </svg>
    );
  }
  return <canvas ref={canvas} className={`rcup rcup--canvas${ready ? ' rcup--ready' : ''}`} aria-hidden="true" />;
}

/** Re-rendered only when what is in the cup or the running step changes; the motion runs on its own. */
export const Cup = memo(CupView, (a, b) => layoutKey(a.craft) === layoutKey(b.craft) && a.machine === b.machine
  && a.tea === b.tea && a.reduced === b.reduced && a.ready === b.ready && a.time === b.time);
