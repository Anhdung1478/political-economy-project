// The speech bubbles on the street (spec §9 "Bong bóng lời nói"), the `bubbles` overlay layer. Above the light of the
// hour, so they stay paper-white and readable in the evening. bubbles.ts picks who speaks and the words and places
// them; this measures, wraps and draws: a rounded paper bubble with a tail to the speaker's head, words coloured by
// tone (a good word matcha, a bad one strawberry), a strawberry rim when it is about the player's shop. Each pops in
// with a small overshoot and shrinks away at the end; with reduced motion they simply appear and fade.
import { CONFIG } from '../../../../shared/sim/config';
import type { ShopId } from '../../../../shared/sim/types';
import {
  admit, candidates, daySeed, placeBubbles, popOf, tailTip, type Placed, type Placing, type Shown,
} from '../bubbles';
import type { Rect } from '../layout';
import type { RenderContext } from '../Scene';
import { traitsOf } from './characters';
import { FONT, rr } from './kit';
import { ceilingSignRect, vanBannerRect } from './props';

const STORE = 'speech.bubbles';

interface State {
  shown: Shown[]; out: Shown[]; seed: number; day: number; daySeed: number;
  /** Reused each frame: the placements asked for and whose they are. */
  place: Placing[]; who: Shown[];
}

function stateOf(rc: RenderContext): State {
  let s = rc.store.get(STORE) as State | undefined;
  if (s === undefined) {
    s = { shown: [], out: [], seed: NaN, day: 0, daySeed: 0, place: [], who: [] };
    rc.store.set(STORE, s);
  }
  if (s.seed !== rc.seed || s.day !== rc.director.day) {
    s.seed = rc.seed;
    s.day = rc.director.day;
    s.daySeed = daySeed(rc.seed, rc.director.day);
  }
  return s;
}

/** Text size and bubble metrics, in heights of a person. */
const SIZE = 0.3;
const MAX_W = 4.4;
const PAD_X = 0.26;
const PAD_Y = 0.13;
const LEAD = 1.22;
const TAIL = 0.22;
/** Longest tail, in heights: a bubble pushed further off only points the way. */
const TAIL_MAX = 0.6;

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

function measure(rc: RenderContext, b: Shown): void {
  const { ctx } = rc;
  const u = rc.layout.actorH;
  const size = u * SIZE;
  ctx.font = `700 ${size}px ${FONT}`;
  const lines = wrap(ctx, b.text, u * MAX_W - u * PAD_X * 2);
  let w = 0;
  for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
  b.lines = lines;
  b.w = w + u * PAD_X * 2 + (b.player ? u * 0.16 : 0);
  b.h = lines.length * size * LEAD + u * PAD_Y * 2;
}

function canSpeak(rc: RenderContext, id: number): boolean {
  const a = rc.director.actor(id);
  if (a === undefined || a.hidden || a.fadeAt !== null) return false;
  const v = rc.view;
  return a.x > v.x && a.x < v.x + v.w;
}

/** The overlay: admits this frame's words, lays the bubbles out and draws them. */
export function drawSpeech(rc: RenderContext): void {
  if (!rc.speech) return;
  const st = stateOf(rc);
  const d = rc.director;
  const now = rc.now;
  let sales: { shop: ShopId; customer: number; correct: boolean; t: number }[] | null = null;
  for (const c of rc.cues) if (c.kind === 'sale') (sales ??= []).push(c);
  if (rc.bubbles.length > 0 || sales !== null || st.shown.length > 0) {
    const res = admit(st.shown, rc.bubbles.length > 0 || sales !== null
      ? candidates(rc.bubbles, sales ?? [], st.daySeed) : [], {
      now, daySeed: st.daySeed,
      canSpeak: id => canSpeak(rc, id),
      priceOf: shop => (shop === null ? null : d.shops.find(s => s.id === shop)?.price ?? null),
    });
    st.shown = res.shown;
    if (res.out.length > 0) st.out.push(...res.out);
  }
  if (st.out.length > 0) st.out = st.out.filter(b => now < b.until + 3 && d.actor(b.customer) !== undefined);
  const n = st.shown.length + st.out.length;
  if (n === 0) return;

  // Lay out: the player's first, then the oldest; outgoing ones keep the spot they had.
  const all = st.shown.length > 1 ? [...st.shown].sort((a, b) => Number(b.player) - Number(a.player) || a.born - b.born)
    : st.shown;
  const u = rc.layout.actorH;
  const place = st.place;
  place.length = 0;
  const who = st.who;
  who.length = 0;
  for (const b of all) {
    if (b.lines === null) measure(rc, b);
    const a = d.actor(b.customer);
    if (a === undefined) continue;
    const s = u * traitsOf(a.look).height;
    place.push({ ax: a.x, ay: a.y - s * 1.08, footY: a.y, w: b.w, h: b.h, prev: b.opt });
    who.push(b);
  }
  const avoid: Rect[] = [];
  const day = d.rules;
  if (day?.ceiling != null) avoid.push(ceilingSignRect(rc.layout));
  if (day?.rumor ?? CONFIG.days[d.day].rumor) {
    const van = vanBannerRect(rc.layout, rc.view, now, rc.reducedMotion);
    if (van !== null) avoid.push(van);
  }
  const spots = placeBubbles(place, rc.view, avoid, u * TAIL, u * 0.12);
  // Drawn last-first, so the most important bubble is on top.
  for (let i = spots.length - 1; i >= 0; i--) {
    const b = who[i];
    b.opt = spots[i].opt;
    drawBubble(rc, b, spots[i], place[i]);
  }
  for (const b of st.out) {
    const a = d.actor(b.customer);
    if (a === undefined || b.lines === null) continue;
    const s = u * traitsOf(a.look).height;
    const pl: Placing = { ax: a.x, ay: a.y - s * 1.08, footY: a.y, w: b.w, h: b.h, prev: b.opt };
    const [spot] = placeBubbles([pl], rc.view, [], u * TAIL, u * 0.12);
    drawBubble(rc, b, spot, pl);
  }
}

function drawBubble(rc: RenderContext, b: Shown, at: Placed, p: Placing): void {
  const { ctx, palette: pal } = rc;
  const u = rc.layout.actorH;
  const { scale, alpha } = popOf(b, rc.now, rc.reducedMotion);
  if (alpha <= 0 || scale <= 0 || b.lines === null) return;
  const { x, y } = at;
  const w = b.w;
  const h = b.h;
  const rad = Math.min(h / 2, u * 0.32);
  ctx.save();
  ctx.globalAlpha = alpha;
  // The pop grows from the tail's root.
  ctx.translate(at.rootX, at.rootY);
  ctx.scale(scale, scale);
  ctx.translate(-at.rootX, -at.rootY);
  // The tail: a wedge from the edge toward the speaker (their head; their feet from below), short when far.
  const target = at.edge === 'top' ? { x: p.ax, y: p.footY + u * 0.05 } : { x: p.ax, y: p.ay - u * 0.04 };
  const tip = tailTip({ x: at.rootX, y: at.rootY }, target, u * TAIL_MAX);
  const tw = u * 0.14;
  const inset = u * 0.12;
  const side = at.edge === 'left' || at.edge === 'right';
  const ix = at.edge === 'left' ? inset : at.edge === 'right' ? -inset : 0;
  const iy = at.edge === 'top' ? inset : at.edge === 'bottom' ? -inset : 0;
  const b0x = at.rootX + ix + (side ? 0 : -tw);
  const b0y = at.rootY + iy + (side ? -tw : 0);
  const b1x = at.rootX + ix + (side ? 0 : tw);
  const b1y = at.rootY + iy + (side ? tw : 0);
  // A soft drop shadow under the body.
  ctx.fillStyle = 'rgba(42, 29, 21, 0.16)';
  rr(ctx, x + u * 0.03, y + u * 0.06, w, h, rad);
  ctx.fill();
  // Outlines first (twice the width: the fills then cover their inner half), so body and tail read as one shape.
  const lw = u * (b.player ? 0.13 : 0.09);
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = b.player ? pal.strawberry : 'rgba(42, 29, 21, 0.55)';
  ctx.beginPath();
  ctx.moveTo(b0x, b0y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(b1x, b1y);
  ctx.closePath();
  ctx.stroke();
  rr(ctx, x, y, w, h, rad);
  ctx.stroke();
  ctx.fillStyle = pal.paper;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(b0x, b0y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(b1x, b1y);
  ctx.closePath();
  ctx.fill();
  // The words.
  const size = u * SIZE;
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = b.tone === 'bad' ? pal.strawberryDeep : b.tone === 'good' ? pal.matchaDeep : pal.ink;
  const cx = x + w / 2 + (b.player ? u * 0.08 : 0);
  let ly = y + u * PAD_Y + size * LEAD * 0.5 + size * 0.04;
  for (const l of b.lines) {
    ctx.fillText(l, cx, ly);
    ly += size * LEAD;
  }
  if (b.player) {
    // A little heart at the start: this is about your shop.
    const hx = x + u * 0.2;
    const hy = y + h / 2 - u * 0.02;
    const r = u * 0.075;
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
  ctx.restore();
}
