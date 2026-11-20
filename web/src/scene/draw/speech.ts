// The speech bubbles on the street (spec §9 "Bong bóng lời nói"), the `bubbles` overlay layer. Above the light of the
// hour, so they stay paper-white and readable in the evening. bubbles.ts picks who speaks and the words and places
// them; this measures, wraps and draws: a rounded paper bubble with a tail to the speaker's head, words coloured by
// tone (a good word matcha, a bad one strawberry), a strawberry rim when it is about the player's shop (and a heart
// when the word is a good one). Each pops in with a small overshoot and shrinks away at the end; with reduced motion
// they simply appear and fade.
//
// Readable at any zoom: the words never go under MIN_CSS_PX on screen, however small the street is drawn (the rush
// shrinks it beside the craft panel), and a bubble is never wider than a share of the view. Each bubble's body and
// words are painted once into a little canvas and blitted (the tail stays live, it follows the speaker).
import { CONFIG } from '../../../../shared/sim/config';
import type { ShopId } from '../../../../shared/sim/types';
import {
  admit, candidates, daySeed, placeBubbles, popOf, tailTip, type AvoidRect, type Candidate, type Placed,
  type Placing, type Shown,
} from '../bubbles';
import type { RenderContext } from '../Scene';
import { fontEpoch } from '../sprites';
import { traitsOf } from './characters';
import { FONT, rr } from './kit';
import { ceilingSignRect, vanBannerRect } from './props';

const STORE = 'speech.bubbles';

interface State {
  shown: Shown[]; out: Shown[]; waiting: Candidate[]; seed: number; day: number; daySeed: number;
  /** Reused each frame: the placements asked for and whose they are. */
  place: Placing[]; who: Shown[];
}

function stateOf(rc: RenderContext): State {
  let s = rc.store.get(STORE) as State | undefined;
  if (s === undefined) {
    s = { shown: [], out: [], waiting: [], seed: NaN, day: 0, daySeed: 0, place: [], who: [] };
    rc.store.set(STORE, s);
  }
  if (s.seed !== rc.seed || s.day !== rc.director.day) {
    s.seed = rc.seed;
    s.day = rc.director.day;
    s.daySeed = daySeed(rc.seed, rc.director.day);
  }
  return s;
}

/** Text size and bubble metrics, in heights of a person (`unit` below, grown when the street is drawn small). */
const SIZE = 0.3;
const MAX_W = 4.4;
const PAD_X = 0.26;
const PAD_Y = 0.13;
const LEAD = 1.22;
const TAIL = 0.22;
/** Longest tail, in units: a bubble pushed further off only points the way. */
const TAIL_MAX = 0.6;
/** The words are never smaller than this on screen (CSS px). */
export const MIN_CSS_PX = 11.5;
/** A bubble is at most this share of the view wide. */
const MAX_VIEW_SHARE = 0.58;

/**
 * The bubbles' unit (street units): a person's height on a street drawn at a readable size; bigger than a person
 * when the street is drawn small, so the words stay at least MIN_CSS_PX (`cssPerUnit`: CSS px per street unit).
 */
export function bubbleUnit(actorH: number, cssPerUnit: number): number {
  return Math.max(actorH, MIN_CSS_PX / (SIZE * Math.max(1e-6, cssPerUnit)));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const tryLine = cur === '' ? w : `${cur} ${w}`;
    if (cur !== '' && ctx.measureText(tryLine).width > maxW) {
      lines.push(cur);
      cur = w;
    } else {
      cur = tryLine;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

const showsHeart = (b: Shown) => b.player && b.tone === 'good';

function measure(rc: RenderContext, b: Shown, m: number): void {
  const { ctx } = rc;
  const size = m * SIZE;
  ctx.font = `700 ${size}px ${FONT}`;
  const maxW = Math.min(m * MAX_W, rc.view.w * MAX_VIEW_SHARE);
  const lines = wrap(ctx, b.text, maxW - m * PAD_X * 2 - (showsHeart(b) ? m * 0.16 : 0));
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  b.lines = lines;
  b.w = w + m * PAD_X * 2 + (showsHeart(b) ? m * 0.16 : 0);
  b.h = lines.length * size * LEAD + m * PAD_Y * 2;
  b.unit = m;
  b.epoch = fontEpoch();
  b.art = null;
}

function canSpeak(rc: RenderContext, id: number): boolean {
  const a = rc.director.actor(id);
  if (a === undefined || a.hidden || a.fadeAt !== null) return false;
  const v = rc.view;
  return a.x > v.x && a.x < v.x + v.w;
}

/** What the bubbles keep clear of: the van's banner and the ceiling sign; at a lower cost the boards and your shop. */
function avoidRects(rc: RenderContext): AvoidRect[] {
  const d = rc.director;
  const L = rc.layout;
  const u = L.actorH;
  const avoid: AvoidRect[] = [];
  const day = d.rules;
  if (day?.ceiling != null) avoid.push(ceilingSignRect(L));
  if (day?.rumor ?? CONFIG.days[d.day].rumor) {
    const van = vanBannerRect(L, rc.view, rc.now, rc.reducedMotion);
    if (van !== null) avoid.push(van);
  }
  for (const s of L.shops) {
    avoid.push({ x: s.board.x - u * 0.6, y: s.board.y - u * 0.45, w: u * 1.2, h: u * 0.9, weight: 0.8 });
    if (s.id === 'player') avoid.push({ ...s.rect, weight: 0.35 });
  }
  return avoid;
}

/** The overlay: admits this frame's words, lays the bubbles out and draws them. */
export function drawSpeech(rc: RenderContext): void {
  if (!rc.speech) return;
  const st = stateOf(rc);
  const d = rc.director;
  const now = rc.now;
  let sales: { shop: ShopId; customer: number; correct: boolean; t: number }[] | null = null;
  for (const c of rc.cues) if (c.kind === 'sale') (sales ??= []).push(c);
  if (rc.bubbles.length > 0 || sales !== null || st.shown.length > 0 || st.waiting.length > 0) {
    const res = admit(st.shown, rc.bubbles.length > 0 || sales !== null
      ? candidates(rc.bubbles, sales ?? [], st.daySeed) : [], {
      now, daySeed: st.daySeed,
      canSpeak: id => canSpeak(rc, id),
      priceOf: shop => (shop === null ? null : d.shops.find(s => s.id === shop)?.price ?? null),
    }, st.waiting);
    st.shown = res.shown;
    st.waiting = res.waiting;
    if (res.out.length > 0) st.out.push(...res.out);
  }
  if (st.out.length > 0) st.out = st.out.filter(b => now < b.until + 3 && d.actor(b.customer) !== undefined);
  if (st.shown.length + st.out.length === 0) return;

  const u = rc.layout.actorH;
  const m = bubbleUnit(u, rc.cssPerUnit);
  const epoch = fontEpoch();
  // Lay out: the player's first, then the oldest.
  const all = st.shown.length > 1 ? [...st.shown].sort((a, b) => Number(b.player) - Number(a.player) || a.born - b.born)
    : st.shown;
  const place = st.place;
  place.length = 0;
  const who = st.who;
  who.length = 0;
  for (const b of all) {
    if (b.lines === null || b.unit !== m || b.epoch !== epoch) measure(rc, b, m);
    const a = d.actor(b.customer);
    if (a === undefined) continue;
    const s = u * traitsOf(a.look).height;
    place.push({ ax: a.x, ay: a.y - s * 1.08, footY: a.y, w: b.w, h: b.h, prev: b.opt });
    who.push(b);
  }
  const avoid = avoidRects(rc);
  // Bubbles popping out keep their spot: the live ones keep clear of it.
  for (const b of st.out) if (!Number.isNaN(b.lastX)) avoid.push({ x: b.lastX, y: b.lastY, w: b.w, h: b.h, weight: 2 });
  const spots = placeBubbles(place, rc.view, avoid, m * TAIL, m * 0.12);
  // Outgoing bubbles first (under), where they last were; then the live ones last-first, the most important on top.
  for (const b of st.out) {
    const a = d.actor(b.customer);
    if (a === undefined || b.lines === null || Number.isNaN(b.lastX)) continue;
    const s = u * traitsOf(a.look).height;
    const pl: Placing = { ax: a.x, ay: a.y - s * 1.08, footY: a.y, w: b.w, h: b.h, prev: -1 };
    const above = b.lastY + b.h <= pl.ay;
    const at: Placed = {
      x: b.lastX, y: b.lastY, opt: b.opt, edge: above ? 'bottom' : 'top',
      rootX: Math.min(b.lastX + b.w - m * TAIL, Math.max(b.lastX + m * TAIL, a.x)), rootY: above ? b.lastY + b.h : b.lastY,
    };
    drawBubble(rc, b, at, pl, m);
  }
  for (let i = spots.length - 1; i >= 0; i--) {
    const b = who[i];
    b.opt = spots[i].opt;
    b.lastX = spots[i].x;
    b.lastY = spots[i].y;
    drawBubble(rc, b, spots[i], place[i], m);
  }
}

interface Art { canvas: HTMLCanvasElement | OffscreenCanvas; k: number; pad: number }

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : null;
}

/** The body (shadow, rim, paper) and the words, in a bubble's own frame (its box at 0, 0). */
function paintBody(ctx: CanvasRenderingContext2D, rc: RenderContext, b: Shown, m: number): void {
  const pal = rc.palette;
  const w = b.w;
  const h = b.h;
  const rad = Math.min(h / 2, m * 0.32);
  ctx.fillStyle = 'rgba(42, 29, 21, 0.16)';
  rr(ctx, m * 0.03, m * 0.06, w, h, rad);
  ctx.fill();
  ctx.lineWidth = m * (b.player ? 0.13 : 0.09);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = b.player ? pal.strawberry : 'rgba(42, 29, 21, 0.55)';
  rr(ctx, 0, 0, w, h, rad);
  ctx.stroke();
  ctx.fillStyle = pal.paper;
  ctx.fill();
  const size = m * SIZE;
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = b.tone === 'bad' ? pal.strawberryDeep : b.tone === 'good' ? pal.matchaDeep : pal.ink;
  const cx = w / 2 + (showsHeart(b) ? m * 0.08 : 0);
  let ly = m * PAD_Y + size * LEAD * 0.5 + size * 0.04;
  for (const l of b.lines ?? []) {
    ctx.fillText(l, cx, ly);
    ly += size * LEAD;
  }
  if (showsHeart(b)) {
    // A little heart at the start: a good word about your shop.
    const hx = m * 0.2;
    const hy = h / 2 - m * 0.02;
    const r = m * 0.075;
    ctx.fillStyle = pal.strawberry;
    ctx.beginPath();
    ctx.arc(hx - r * 0.5, hy - r * 0.15, r * 0.55, 0, Math.PI * 2);
    ctx.arc(hx + r * 0.5, hy - r * 0.15, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(hx - r * 1.04, hy);
    ctx.lineTo(hx, hy + r * 1.05);
    ctx.lineTo(hx + r * 1.04, hy);
    ctx.closePath();
    ctx.fill();
  }
}

/** The bubble's painted body at this zoom (painted on first use, again after a zoom change). */
function artOf(rc: RenderContext, b: Shown, m: number): Art | null {
  const k = rc.pxPerUnit;
  const kept = b.art as Art | null;
  if (kept !== null && kept.k === k) return kept;
  const pad = m * 0.15;
  const canvas = makeCanvas(Math.ceil((b.w + pad * 2) * k), Math.ceil((b.h + pad * 2) * k));
  const c = canvas?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
  if (canvas == null || c == null) return null;
  c.setTransform(k, 0, 0, k, pad * k, pad * k);
  paintBody(c, rc, b, m);
  const art: Art = { canvas, k, pad };
  b.art = art;
  return art;
}

function drawBubble(rc: RenderContext, b: Shown, at: Placed, p: Placing, m: number): void {
  const { ctx, palette: pal, grid: g } = rc;
  const { scale, alpha } = popOf(b, rc.now, rc.reducedMotion);
  if (alpha <= 0 || scale <= 0 || b.lines === null) return;
  const { x, y } = at;
  ctx.save();
  ctx.globalAlpha = alpha;
  // The pop grows from the tail's root.
  ctx.translate(at.rootX, at.rootY);
  ctx.scale(scale, scale);
  ctx.translate(-at.rootX, -at.rootY);
  // The tail: a wedge from the edge toward the speaker (their head; their feet from below), short when far.
  const target = at.edge === 'top' ? { x: p.ax, y: p.footY + m * 0.05 } : { x: p.ax, y: p.ay - m * 0.04 };
  const tip = tailTip({ x: at.rootX, y: at.rootY }, target, m * TAIL_MAX);
  const tw = m * 0.14;
  const lw = m * (b.player ? 0.13 : 0.09);
  // The tail's paper reaches just past the rim's inner half, never into the words.
  const inset = lw * 0.62;
  const side = at.edge === 'left' || at.edge === 'right';
  const ix = at.edge === 'left' ? inset : at.edge === 'right' ? -inset : 0;
  const iy = at.edge === 'top' ? inset : at.edge === 'bottom' ? -inset : 0;
  const b0x = at.rootX + ix + (side ? 0 : -tw);
  const b0y = at.rootY + iy + (side ? -tw : 0);
  const b1x = at.rootX + ix + (side ? 0 : tw);
  const b1y = at.rootY + iy + (side ? tw : 0);
  // A speaker under the bubble itself (pushed there by the view's edge) gets no tail across the words.
  const tailed = !(tip.x > x && tip.x < x + b.w && tip.y > y && tip.y < y + b.h);
  const tail = () => {
    ctx.beginPath();
    ctx.moveTo(b0x, b0y);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(b1x, b1y);
    ctx.closePath();
  };
  // Outlines are twice the width and the fills cover their inner half, so body and tail read as one shape: the
  // tail's outline, the body (rim and paper, painted once), then the tail's paper over the rim at its root.
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = b.player ? pal.strawberry : 'rgba(42, 29, 21, 0.55)';
  if (tailed) {
    tail();
    ctx.stroke();
  }
  const art = artOf(rc, b, m);
  if (art !== null) {
    if (scale === 1) {
      // At rest: on the device grid, as sharp as drawing it.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(art.canvas as CanvasImageSource, Math.round((x - art.pad) * g.k + g.devX),
        Math.round((y - art.pad) * g.k + g.devY));
      ctx.setTransform(g.k, 0, 0, g.k, g.devX, g.devY);
    } else {
      ctx.drawImage(art.canvas as CanvasImageSource, x - art.pad, y - art.pad, art.canvas.width / art.k,
        art.canvas.height / art.k);
    }
  } else {
    ctx.translate(x, y);
    paintBody(ctx, rc, b, m);
    ctx.translate(-x, -y);
  }
  if (tailed) {
    ctx.fillStyle = pal.paper;
    tail();
    ctx.fill();
  }
  ctx.restore();
}
