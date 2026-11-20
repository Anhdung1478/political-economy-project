// The street's furniture and the day's props (spec §9 "Không khí phố", "Đạo cụ theo ngày"), each depth-sorted with
// the customers:
//
// - every day: concrete utility poles in the gaps of the top row with their tangle of wires and a street lamp; trees at
//   the street's ends (landscape) swaying; a motorbike now and then (one carries boxes, one a potted plant, one a
//   passenger) leaving a puff of exhaust; the cat strolling along the rooftops, sitting, licking a paw;
// - day 3: the ward's loudspeaker on the first pole sending out its rings, and a speed-limit style sign "GIÁ TRẦN 20K"
//   on the last pole (the ceiling read from the day's rules);
// - day 4: the tax officer in his olive uniform going from shop to shop with his clipboard (a coin flies from each
//   counter to it); the bus-stop building site (barriers, sand, a turning mixer, a worker with a hammer, a big board
//   "ĐANG THI CÔNG TRẠM XE BUÝT / từ tiền thuế");
// - day 5: the new shelter; the bus pulling in, opening its doors as its riders step off (the director's bus plan),
//   pulling away; at the inspection the ward's loudspeaker van crawling through with its banner.
//
// Reduced motion: no motorbikes, no cat, no swaying, no rings; the bus and the van appear parked while they matter.
// Nothing here allocates per frame: the props list and its entries are reused, per-layout facts are memoised.
import { CONFIG } from '../../../../shared/sim/config';
import type { ShopSlot, StreetLayout } from '../layout';
import { counterTop, particlesOf } from '../particlesLayer';
import { clipPose, newSkeleton, pose, solve, type ClipInput } from '../rig';
import type { ArtKind, Palette, Prop, RenderContext } from '../Scene';
import {
  busAt, busX, catAt, hash01, motoAt, newBusState, newCat, newRider, newWalker, officerAt, vanProgress, type Stop,
} from '../schedule';
import { blit, LAYER } from '../sprites';
import { lerp } from '../tween';
import { buildTraits, drawCharacterAt, shade, type FigureFx, type Traits } from './characters';
import { box, disc, DISPLAY, fe, line, oval, quad, rr, shadow, text, tri, type Ctx } from './kit';
import { crown, poleLampY, poleTop, poleXs, SIDE_CROWN_UP, sideTrees } from './street';

/** Motorbike streams: period (ms) and speed (heights a second). */
const MOTO_STREAMS: readonly (readonly [number, number])[] = [[9000, 6.5], [13700, 5.2]];
/** One exhaust puff per this many ms per motorbike. */
const PUFF_MS = 110;

type ArtProp = Extract<Prop, { kind: 'art' }>;
type OverflowProp = Extract<Prop, { kind: 'overflow' }>;

// ── Facts about a layout, worked out once ──────────────────────────────────────────────────────────────────────────

interface Site {
  /** Anchor of the small things (barriers, mixer, worker) and their scale. */
  x: number; y: number; k: number;
  /** The board: centre x, top, width, height (logical units). */
  bx: number; by: number; bw: number; bh: number;
}

interface LayoutFacts {
  /** Street trees: x, base y, crown radius in heights. */
  trees: readonly (readonly [number, number, number])[];
  poles: readonly number[];
  /** The cat's rooftop line and its depth. */
  catX0: number; catX1: number; catDepth: number;
  site: Site;
  topSlots: readonly ShopSlot[];
  bottomSlots: readonly ShopSlot[];
}

const facts = new WeakMap<StreetLayout, LayoutFacts>();

function factsOf(L: StreetLayout): LayoutFacts {
  let f = facts.get(L);
  if (f !== undefined) return f;
  const u = L.actorH;
  const top = L.shops.filter(s => s.row === 'top');
  const last = top[top.length - 1].rect;
  const portrait = L.kind === 'portrait';
  f = {
    trees: sideTrees(L),
    poles: poleXs(L),
    catX0: top[0].rect.x + u * 0.3, catX1: last.x + last.w - u * 0.3, catDepth: top[0].depth + 0.5,
    // Portrait's bus corner is narrow: the board stands high on two posts over the kerb, clear of Tập Đoàn's totem.
    site: portrait
      ? { x: L.busShelter.x + u * 0.2, y: L.sidewalkBottom.y0 + u * 1.25, k: 0.85, bx: L.width - u * 1.05,
        by: L.road.y1 - u * 0.62, bw: u * 2.0, bh: u * 0.82 }
      : { x: L.busShelter.x, y: L.busShelter.y + u * 0.2, k: 1, bx: L.width - u * 0.85, by: L.sidewalkBottom.y0 - u * 0.62,
        bw: u * 1.7, bh: u * 0.74 },
    topSlots: top,
    bottomSlots: L.shops.filter(s => s.row === 'bottom'),
  };
  facts.set(L, f);
  return f;
}

// ── Per-scene memory ───────────────────────────────────────────────────────────────────────────────────────────────

interface Live {
  bus: ReturnType<typeof newBusState>;
  officer: ReturnType<typeof newWalker>;
  riders: ReturnType<typeof newRider>[];
  cat: ReturnType<typeof newCat>;
  /** The frame's props, and the reusable entries they are made of. */
  out: Prop[];
  arts: ArtProp[];
  overflows: OverflowProp[];
  /** Officer: his stops (and their shops) for a set of selling shops; the stop whose coin already flew. */
  stops: Stop[]; stopSlots: ShopSlot[]; stopsKey: number; stopsL: StreetLayout | null; paid: number;
  /** Exhaust and dust timing. */
  motoPuff: number[]; busPuffAt: number; sitePuffAt: number;
  /** Motorbike bodies drawn once per look and direction (this scene's own). */
  motos: Map<number, { k: number; canvas: HTMLCanvasElement | null }>;
}

function liveOf(rc: RenderContext): Live {
  let l = rc.store.get('props.live') as Live | undefined;
  if (l === undefined) {
    l = {
      bus: newBusState(), officer: newWalker(), riders: MOTO_STREAMS.map(newRider), cat: newCat(), out: [], arts: [],
      overflows: [], stops: [], stopSlots: [], stopsKey: -1, stopsL: null, paid: -1, motoPuff: MOTO_STREAMS.map(() => -1),
      busPuffAt: 0, sitePuffAt: 0, motos: new Map(),
    };
    rc.store.set('props.live', l);
  }
  return l;
}

function push(live: Live, n: number, art: ArtKind, x: number, y: number, i = 0): number {
  let p = live.arts[n];
  if (p === undefined) {
    p = { kind: 'art', art, x, y, i };
    live.arts.push(p);
  } else {
    p.art = art;
    p.x = x;
    p.y = y;
    p.i = i;
  }
  live.out.push(p);
  return n + 1;
}

export function props(rc: RenderContext): readonly Prop[] {
  const d = rc.director;
  const L = rc.layout;
  const u = L.actorH;
  const f = factsOf(L);
  const live = liveOf(rc);
  const out = live.out;
  out.length = 0;
  const markers = d.overflowMarkers();
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    let p = live.overflows[i];
    if (p === undefined) {
      p = { kind: 'overflow', x: 0, y: 0, shop: m.shop, n: 0 };
      live.overflows.push(p);
    }
    p.x = m.x;
    p.y = m.y;
    p.shop = m.shop;
    p.n = m.n;
    out.push(p);
  }
  const day = CONFIG.days[d.day];
  let n = push(live, 0, 'poles', 0, L.sidewalkTop.y1 - 2);
  for (let i = 0; i < f.trees.length; i++) n = push(live, n, 'tree', f.trees[i][0], f.trees[i][1], i);
  if (day.busStop) n = push(live, n, 'shelter', L.busShelter.x, L.busShelter.y);
  if ((d.rules?.taxPerCup ?? day.taxPerCup) > 0) {
    n = push(live, n, 'site', f.site.x, f.site.y + u * 0.3);
    const v = rc.view;
    officerStopsFor(rc, live);
    if (officerAt(live.stops, { x: v.x - u, y: L.lanes[0] }, { x: v.x - u, y: L.lanes[1] }, L.walk, rc.now, live.officer)) {
      n = push(live, n, 'officer', live.officer.x, live.officer.y);
    }
  }
  const bus = busAt(d.busVisits, rc.now, live.bus);
  if (bus) n = push(live, n, 'bus', 0, L.lanes[1] - u * 0.06);
  if ((d.rules?.rumor ?? day.rumor) && vanProgress(CONFIG.rumor.inspectionTick, rc.now) >= 0) {
    n = push(live, n, 'van', 0, (L.road.y0 + L.road.y1) / 2);
  }
  if (!rc.reducedMotion) {
    const v = rc.view;
    for (let i = 0; i < MOTO_STREAMS.length; i++) {
      const r = live.riders[i];
      if (!motoAt(rc.wall, i, v.x, v.x + v.w, MOTO_STREAMS[i][1] * u, MOTO_STREAMS[i][0], r)) continue;
      // The near half of the road is the bus's while it is on the street: no motorbike rides through it.
      if (bus && r.half === 1) continue;
      n = push(live, n, 'moto', r.x, L.road.y0 + (L.road.y1 - L.road.y0) * (r.half === 0 ? 0.4 : 0.62), i);
    }
    if (catAt(rc.wall, f.catX0, f.catX1, 41000, live.cat)) n = push(live, n, 'cat', live.cat.x, f.catDepth);
  }
  return out;
}

/**
 * The officer's stops: each shop that is selling, on its board's side of the road; the top row left to right, then
 * the bottom row back. Worked out again only when the set of selling shops (a bitmask) or the layout changes.
 */
function officerStopsFor(rc: RenderContext, live: Live): void {
  const L = rc.layout;
  let key = 0;
  for (const s of rc.director.shops) {
    if (s.status === 'open' || s.status === 'soldOut') key |= 1 << L.shops.findIndex(x => x.id === s.id);
  }
  if (live.stopsL === L && live.stopsKey === key) return;
  const f = factsOf(L);
  live.stops.length = 0;
  live.stopSlots.length = 0;
  for (const s of f.topSlots) {
    if ((key & (1 << s.index)) === 0) continue;
    live.stops.push({ x: s.board.x - L.actorH * 0.4, y: L.lanes[0] });
    live.stopSlots.push(s);
  }
  for (let i = f.bottomSlots.length - 1; i >= 0; i--) {
    const s = f.bottomSlots[i];
    if ((key & (1 << s.index)) === 0) continue;
    live.stops.push({ x: s.rect.x + s.rect.w * 0.55, y: L.lanes[1] });
    live.stopSlots.push(s);
  }
  live.stopsKey = key;
  live.stopsL = L;
}

export function drawProp(rc: RenderContext, prop: Prop): void {
  const { ctx, layout: L, palette: p } = rc;
  const u = L.actorH;
  if (prop.kind === 'overflow') {
    pill(ctx, `+${prop.n}`, prop.x, prop.y - u * 0.45, u * 0.34, p.boba, p.cream);
    return;
  }
  const live = liveOf(rc);
  switch (prop.art) {
    case 'poles':
      drawPoles(rc);
      return;
    case 'tree': {
      const [x, y, r] = factsOf(L).trees[prop.i];
      oval(ctx, x, y, u * 0.42, u * 0.11, 'rgba(90, 62, 40, 0.35)');
      ctx.fillStyle = '#8a5a36';
      ctx.fillRect(x - u * 0.07, y - u * 1.5, u * 0.14, u * 1.5);
      const sway = rc.reducedMotion ? 0 : Math.sin(rc.wall / 1100 + prop.i * 2) * 0.06;
      crown(ctx, x, y - u * SIDE_CROWN_UP, u * r, sway, prop.i * 17 + 5);
      return;
    }
    case 'shelter': {
      const sh = shelterRect(L);
      const s = rc.sprites.peek(L, LAYER.shelter, sh, rc.grid, 1)
        ?? rc.sprites.get(L, LAYER.shelter, sh, rc.grid, 1, c => paintShelter(c, L, p));
      blit(ctx, s, rc.grid);
      return;
    }
    case 'site':
      drawSite(rc, live);
      return;
    case 'bus':
      drawBus(rc, live);
      return;
    case 'van':
      drawVan(rc);
      return;
    case 'moto':
      drawMoto(rc, live, prop.i, prop.y);
      return;
    case 'cat':
      drawCat(ctx, live.cat, prop.x, L.shops[0].rect.y + 1, u, rc.reducedMotion);
      return;
    case 'officer':
      drawOfficer(rc, live);
      return;
  }
}

function pill(ctx: Ctx, s: string, x: number, y: number, size: number, bg: string, fg: string): void {
  ctx.font = `700 ${size}px "Be Vietnam Pro", system-ui, sans-serif`;
  const w = ctx.measureText(s).width + size * 0.9;
  const h = size * 1.45;
  rr(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  text(ctx, s, x, y + size * 0.05, size, fg, { weight: 700 });
}

// ── Poles, wires, the loudspeaker and the ceiling sign ─────────────────────────────────────────────────────────────

const rectMemo = new WeakMap<StreetLayout, { wires: { x: number; y: number; w: number; h: number }; vx: number; vw: number;
  poles: { x: number; y: number; w: number; h: number }[] }>();

/** The wires' strip across the view, and each pole's own narrow box (small sprites, not one view-wide one). */
function poleRects(rc: RenderContext): { wires: { x: number; y: number; w: number; h: number }; poles: { x: number; y: number; w: number; h: number }[] } {
  const L = rc.layout;
  const v = rc.view;
  const m = rectMemo.get(L);
  if (m !== undefined && m.vx === v.x && m.vw === v.w) return m;
  const u = L.actorH;
  const top = poleTop(L);
  const base = L.sidewalkTop.y1;
  const made = {
    vx: v.x, vw: v.w,
    wires: { x: v.x, y: top, w: v.w, h: u * 1.0 },
    poles: poleXs(L).map(x => ({ x: x - u * 0.62, y: top - u * 0.05, w: u * 1.3, h: base - top + u * 0.1 })),
  };
  rectMemo.set(L, made);
  return made;
}

function drawPoles(rc: RenderContext): void {
  const { ctx, layout: L } = rc;
  const day = rc.director.day;
  const ceiling = rc.director.rules?.ceiling ?? CONFIG.days[day].ceiling;
  const r = poleRects(rc);
  const w = rc.sprites.peek(L, LAYER.wires, r.wires, rc.grid, 1)
    ?? rc.sprites.get(L, LAYER.wires, r.wires, rc.grid, 1, c => paintWires(c, L));
  blit(ctx, w, rc.grid);
  const xs = factsOf(L).poles;
  for (let i = 0; i < xs.length; i++) {
    // The first pole carries the loudspeaker on ceiling days, the last the ceiling sign.
    const role = ceiling === null ? 0 : i === 0 ? 1 : i === xs.length - 1 ? 2 : 0;
    const sig = role * 1000 + (role === 2 ? ceiling ?? 0 : 0);
    const s = rc.sprites.peek(L, LAYER.pole + i, r.poles[i], rc.grid, sig)
      ?? rc.sprites.get(L, LAYER.pole + i, r.poles[i], rc.grid, sig, c => paintPole(c, L, xs[i], role, ceiling ?? 0));
    blit(ctx, s, rc.grid);
  }
  if (ceiling !== null && !rc.reducedMotion) speakerRings(ctx, L, xs[0], rc.now, rc.wall);
}

function paintWires(c: Ctx, L: StreetLayout): void {
  const u = L.actorH;
  const xs = poleXs(L);
  const top = poleTop(L);
  const ends = [xs[0] - (xs[1] - xs[0]), ...xs, xs[xs.length - 1] + (xs[1] - xs[0])];
  const flat = L.kind === 'landscape';
  c.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    c.strokeStyle = k === 3 ? 'rgba(42, 29, 21, 0.75)' : 'rgba(42, 29, 21, 0.55)';
    c.lineWidth = u * (k === 3 ? 0.04 : 0.022);
    c.beginPath();
    for (let i = 0; i + 1 < ends.length; i++) {
      const a = ends[i];
      const b = ends[i + 1];
      const y = top + u * ((flat ? 0.28 : 0.35) + k * (flat ? 0.09 : 0.12));
      c.moveTo(a, y);
      c.quadraticCurveTo((a + b) / 2, y + u * (flat ? 0.22 + k * 0.04 : 0.35 + k * 0.08), b, y);
    }
    c.stroke();
  }
}

/** One pole: concrete, tapering, a cross-arm, insulators, the cable tangle, a lamp; its role's extra (horns, sign). */
function paintPole(c: Ctx, L: StreetLayout, x: number, role: number, ceiling: number): void {
  const u = L.actorH;
  const base = L.sidewalkTop.y1 - u * 0.12;
  const top = poleTop(L);
  quad(c, x - u * 0.09, base, x + u * 0.09, base, x + u * 0.05, top, x - u * 0.05, top);
  fe(c, '#c9c3bb', u * 0.025, '#8f877c');
  c.fillStyle = 'rgba(255, 255, 255, 0.35)';
  c.fillRect(x - u * 0.05, top + u * 0.2, u * 0.03, base - top - u * 0.3);
  box(c, x - u * 0.35, top + u * 0.28, u * 0.7, u * 0.07, u * 0.02, '#8f877c', 0);
  disc(c, x - u * 0.3, top + u * 0.26, u * 0.04, '#e6dccb', u * 0.015, '#8f877c');
  disc(c, x + u * 0.3, top + u * 0.26, u * 0.04, '#e6dccb', u * 0.015, '#8f877c');
  c.strokeStyle = '#2a1d15';
  c.lineWidth = u * 0.025;
  c.beginPath();
  for (let i = 0; i < 4; i++) {
    c.ellipse(x + u * 0.02, top + u * (0.85 + i * 0.05), u * (0.16 + i * 0.03), u * 0.07, 0.2 * i, 0, Math.PI * 2);
  }
  c.stroke();
  const lamp = poleLampY(L);
  line(c, x, lamp + u * 0.07, x + u * 0.42, lamp - u * 0.08, '#8f877c', u * 0.04);
  box(c, x + u * 0.3, lamp - u * 0.11, u * 0.26, u * 0.1, u * 0.04, '#6e665c', 0);
  oval(c, x + u * 0.43, lamp, u * 0.1, u * 0.04, '#fff3c4');
  box(c, x - u * 0.13, base - u * 0.15, u * 0.26, u * 0.18, u * 0.03, '#b9aea2', u * 0.02);
  if (role === 1) {
    // The ward's loudspeaker: two steel-blue horns with yellow mouths, easy to see against the sky and the houses.
    const sy = speakerY(L);
    horn(c, x, sy, u, -1);
    horn(c, x, sy, u, 1);
  } else if (role === 2) {
    // The ceiling sign above the shops' sign bands (portrait: on the wall above them; landscape, where the bands
    // touch the top of the view: below the awnings, over the shutters of the shops resting that day).
    const cy = ceilingSignY(L);
    const r = u * 0.4;
    disc(c, x, cy, r, '#fffcf7', u * 0.09, '#d6333f');
    text(c, `${ceiling}K`, x, cy + u * 0.02, u * 0.3, '#2a1d15', { font: DISPLAY, maxW: r * 1.5 });
    box(c, x - u * 0.42, cy + r + u * 0.05, u * 0.84, u * 0.26, u * 0.04, '#fffcf7', u * 0.03, '#2a1d15');
    text(c, 'GIÁ TRẦN', x, cy + r + u * 0.18, u * 0.15, '#2a1d15', { maxW: u * 0.76 });
  }
}

function speakerY(L: StreetLayout): number {
  return poleTop(L) + L.actorH * 0.62;
}

/** The ceiling sign's centre: clear of the top row's sign bands. */
export function ceilingSignY(L: StreetLayout): number {
  const u = L.actorH;
  const r = L.shops[0].rect;
  const ground = r.y + r.h;
  const signTop = ground - u * 2.8;
  return signTop - r.y >= u * 1.25 ? r.y + u * 0.55 : ground - u * 2.2 + u * 0.95;
}

function horn(c: Ctx, x: number, y: number, u: number, side: -1 | 1): void {
  quad(c, x + side * u * 0.06, y - u * 0.05, x + side * u * 0.42, y - u * 0.2, x + side * u * 0.42, y + u * 0.2,
    x + side * u * 0.06, y + u * 0.05);
  fe(c, '#41607a', u * 0.03, '#22384a');
  oval(c, x + side * u * 0.42, y, u * 0.06, u * 0.2, '#ffd23f');
  oval(c, x + side * u * 0.42, y, u * 0.03, u * 0.12, '#22384a');
}

const RING = 'rgb(222, 79, 90)';

/** Rings from the loudspeaker while it speaks: as the rush opens, then a while every 20 s. */
function speakerRings(ctx: Ctx, L: StreetLayout, x: number, now: number, wall: number): void {
  if (now % 200 > 45) return;
  rings(ctx, x, speakerY(L), L.actorH, wall / 900, 0.45, 1);
}

/** Three arcs widening out of a pair of horns at (x, y). */
function rings(ctx: Ctx, x: number, y: number, u: number, clock: number, gap: number, scale: number): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = RING;
  ctx.lineWidth = u * 0.05 * scale;
  for (let i = 0; i < 3; i++) {
    const k = (clock + i / 3) % 1;
    ctx.globalAlpha = 0.8 * (1 - k);
    const r = u * (0.15 + k * 0.6) * scale;
    ctx.beginPath();
    ctx.arc(x + u * gap * scale, y, r, -0.7, 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x - u * gap * scale, y, r, Math.PI - 0.7, Math.PI + 0.7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ── The bus shelter and the building site ──────────────────────────────────────────────────────────────────────────

const shelterRects = new WeakMap<StreetLayout, { x: number; y: number; w: number; h: number }>();

function shelterRect(L: StreetLayout): { x: number; y: number; w: number; h: number } {
  let r = shelterRects.get(L);
  if (r === undefined) {
    const u = L.actorH;
    // Wide and tall enough for the stop sign's disc on its pole (left of the shelter, up high).
    r = { x: L.busShelter.x - u * 1.75, y: L.busShelter.y - u * 2.45, w: u * 2.6, h: u * 2.7 };
    shelterRects.set(L, r);
  }
  return r;
}

function paintShelter(c: Ctx, L: StreetLayout, p: Palette): void {
  const u = L.actorH;
  const { x, y } = L.busShelter;
  const w = u * 1.25;
  const x0 = x - w * 0.62;
  shadow(c, x, y + u * 0.05, w * 0.6, u * 0.12);
  // Back panel (an advert), posts, the bench, the roof.
  box(c, x0 + u * 0.08, y - u * 1.3, w - u * 0.16, u * 0.95, u * 0.04, 'rgba(200, 228, 240, 0.7)', u * 0.025, '#7d9bb0');
  box(c, x0 + u * 0.2, y - u * 1.18, w * 0.5, u * 0.7, u * 0.03, p.strawberrySoft, 0);
  text(c, 'TRÀ', x0 + u * 0.2 + w * 0.25, y - u * 0.98, u * 0.14, p.strawberryDeep);
  text(c, 'SỮA', x0 + u * 0.2 + w * 0.25, y - u * 0.78, u * 0.14, p.strawberryDeep);
  line(c, x0 + u * 0.05, y, x0 + u * 0.05, y - u * 1.45, '#5c7385', u * 0.06);
  line(c, x0 + w - u * 0.05, y, x0 + w - u * 0.05, y - u * 1.45, '#5c7385', u * 0.06);
  box(c, x0 + u * 0.1, y - u * 0.42, w - u * 0.2, u * 0.08, u * 0.03, '#8a5a36', u * 0.02);
  quad(c, x0 - u * 0.12, y - u * 1.42, x0 + w + u * 0.12, y - u * 1.42, x0 + w + u * 0.02, y - u * 1.62, x0 - u * 0.02,
    y - u * 1.62);
  fe(c, '#5b8f3e', u * 0.03);
  // The stop's sign on its own pole, toward the road.
  const sx = x0 - u * 0.05;
  line(c, sx, y - u * 0.05, sx, y - u * 1.9, '#5c7385', u * 0.05);
  disc(c, sx, y - u * 2.0, u * 0.24, '#2f6fb3', u * 0.03, '#1d4d80');
  box(c, sx - u * 0.13, y - u * 2.1, u * 0.26, u * 0.15, u * 0.03, '#fffcf7', 0);
  disc(c, sx - u * 0.07, y - u * 1.93, u * 0.03, '#fffcf7', 0);
  disc(c, sx + u * 0.07, y - u * 1.93, u * 0.03, '#fffcf7', 0);
}

const siteRects = new WeakMap<StreetLayout, { x: number; y: number; w: number; h: number }>();

function siteRect(L: StreetLayout): { x: number; y: number; w: number; h: number } {
  let r = siteRects.get(L);
  if (r === undefined) {
    const u = L.actorH;
    const s = factsOf(L).site;
    const x0 = Math.min(s.x - u * 1.3 * s.k, s.bx - s.bw / 2 - u * 0.1);
    const x1 = Math.max(s.x + u * 0.7 * s.k, s.bx + s.bw / 2 + u * 0.1);
    const y0 = s.by - u * 0.1;
    r = { x: x0, y: y0, w: x1 - x0, h: s.y + u * 0.5 * s.k - y0 };
    siteRects.set(L, r);
  }
  return r;
}

function drawSite(rc: RenderContext, live: Live): void {
  const { ctx, layout: L } = rc;
  const u = L.actorH;
  const site = factsOf(L).site;
  const rect = siteRect(L);
  const s = rc.sprites.peek(L, LAYER.site, rect, rc.grid, 1)
    ?? rc.sprites.get(L, LAYER.site, rect, rc.grid, 1, c => paintSite(c, u, site));
  blit(ctx, s, rc.grid);
  // The mixer turning and the worker's hammer.
  const { x, y, k } = site;
  const sec = rc.wall / 1000;
  const calm = rc.reducedMotion;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.save();
  ctx.translate(-u * 0.78, -u * 0.55);
  ctx.rotate(-0.35);
  ctx.beginPath();
  ctx.ellipse(0, 0, u * 0.28, u * 0.2, 0, 0, Math.PI * 2);
  fe(ctx, '#f08a3a', u * 0.03);
  ctx.strokeStyle = '#b8601f';
  ctx.lineWidth = u * 0.04;
  const turn = calm ? 0 : sec * 3;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const q = Math.sin(turn + (i * Math.PI * 2) / 3);
    ctx.moveTo(q * u * 0.23, -u * 0.17);
    ctx.lineTo(q * u * 0.18, u * 0.17);
  }
  ctx.stroke();
  ctx.restore();
  const tr = workerTraits();
  const m = officerMemo;
  clipPose(m.pose, 'idle', inputFor(m.input, sec, calm));
  const hit = calm ? 0.5 : (Math.sin(sec * 7) + 1) / 2;
  m.pose.a0 = 1.4 + hit * 1.2;
  m.pose.e0 = 0.9;
  m.pose.lean = 0.25;
  m.pose.nod = 0.25;
  const wx = -u * 0.05;
  const wy = u * 0.05;
  const sk = solve(m.pose, tr.dims, 'side', m.sk);
  m.fx.mood = 'focus';
  m.fx.phone = false;
  drawCharacterAt(ctx, tr, wx, wy, u * 0.95, -1, 'side', m.pose, sk, m.fx, null);
  const hx = wx - sk.hand0.x * u * 0.95;
  const hy = wy + sk.hand0.y * u * 0.95;
  line(ctx, hx, hy, hx - u * 0.12, hy - u * 0.14, '#8a5a36', u * 0.04);
  box(ctx, hx - u * 0.2, hy - u * 0.22, u * 0.16, u * 0.08, u * 0.02, '#6e665c', 0);
  ctx.restore();
  const pool = particlesOf(rc);
  if (pool !== null && hit > 0.97 && rc.wall - live.sitePuffAt > 300) {
    live.sitePuffAt = rc.wall;
    pool.emit('dust', x - u * 0.4 * k, y, -u * 0.4, -u * 0.5, 0.8, u * 0.1, '#cdb892', 0, 1.5);
  }
}

/** The site: dug-up paving, sand, cement bags, rebar, barriers around the anchor; the big board on its two posts. */
function paintSite(c: Ctx, u: number, s: Site): void {
  // The board first (it stands behind the works): two posts down to the anchor's row, blue, two lines.
  const bl = s.bx - s.bw / 2;
  line(c, bl + u * 0.15, s.by + s.bh, bl + u * 0.15, s.y - u * 0.1, '#6e665c', u * 0.05);
  line(c, bl + s.bw - u * 0.15, s.by + s.bh, bl + s.bw - u * 0.15, s.y - u * 0.1, '#6e665c', u * 0.05);
  box(c, bl, s.by, s.bw, s.bh, u * 0.05, '#2f6fb3', u * 0.04, '#1d4d80');
  c.fillStyle = '#ffd23f';
  c.fillRect(bl + u * 0.06, s.by + u * 0.06, s.bw - u * 0.12, u * 0.05);
  text(c, 'ĐANG THI CÔNG', s.bx, s.by + s.bh * 0.36, u * 0.21, '#fffcf7', { maxW: s.bw - u * 0.2 });
  text(c, 'TRẠM XE BUÝT', s.bx, s.by + s.bh * 0.62, u * 0.21, '#ffd23f', { maxW: s.bw - u * 0.2 });
  text(c, 'từ tiền thuế', s.bx, s.by + s.bh * 0.85, u * 0.15, '#e3efd6', { maxW: s.bw - u * 0.2, weight: 700 });
  c.save();
  c.translate(s.x, s.y);
  c.scale(s.k, s.k);
  c.fillStyle = '#c9ab82';
  rr(c, -u * 1.15, -u * 0.25, u * 1.6, u * 0.5, u * 0.15);
  c.fill();
  c.beginPath();
  c.ellipse(u * 0.25, u * 0.05, u * 0.32, u * 0.22, 0, Math.PI, 0);
  c.closePath();
  fe(c, '#e6c98f', u * 0.03);
  for (let i = 0; i < 3; i++) box(c, -u * 0.62 + (i % 2) * u * 0.16, u * 0.1 - Math.floor(i / 2) * u * 0.12, u * 0.28, u * 0.13, u * 0.04, '#e9e4dc', u * 0.02, '#a59e96');
  for (let i = 0; i < 3; i++) line(c, -u * 1.1 + i * u * 0.07, -u * 0.95, -u * 1.04 + i * u * 0.07, -u * 0.05, '#8a5a3a', u * 0.025);
  // The mixer's stand and wheels (the drum turns live).
  line(c, -u * 0.92, -u * 0.25, -u * 0.78, -u * 0.55, '#6e665c', u * 0.05);
  line(c, -u * 0.64, -u * 0.25, -u * 0.78, -u * 0.55, '#6e665c', u * 0.05);
  disc(c, -u * 0.92, -u * 0.2, u * 0.06, '#3a2f2a');
  disc(c, -u * 0.64, -u * 0.2, u * 0.06, '#3a2f2a');
  // Barriers in front.
  for (const bx of [-u * 1.2, 0]) {
    box(c, bx, 0, u * 0.5, u * 0.18, u * 0.03, '#fffcf7', u * 0.02, '#c0323e');
    c.fillStyle = '#e8533f';
    for (let q = 0; q < 3; q++) {
      const sx = bx + q * u * 0.17;
      quad(c, sx, u * 0.18, sx + u * 0.08, 0, sx + u * 0.16, 0, sx + u * 0.08, u * 0.18);
      c.fill();
    }
    line(c, bx + u * 0.05, u * 0.18, bx + u * 0.05, u * 0.4, '#8f877c', u * 0.04);
    line(c, bx + u * 0.45, u * 0.18, bx + u * 0.45, u * 0.4, '#8f877c', u * 0.04);
  }
  c.restore();
}

// ── People among the props ─────────────────────────────────────────────────────────────────────────────────────────

interface Memo { pose: ReturnType<typeof pose>; sk: ReturnType<typeof newSkeleton>; input: ClipInput; fx: FigureFx }
const officerMemo: Memo = {
  pose: pose(), sk: newSkeleton(), input: { t: 0, loop: 0, phase: 0, pace: 0, side: true, stoop: 0, calm: false },
  fx: { mood: 'neutral', blink: 0, cup: false, phone: false },
};

function inputFor(i: ClipInput, sec: number, calm: boolean): ClipInput {
  i.t = sec;
  i.loop = sec;
  i.calm = calm;
  i.stoop = 0;
  return i;
}

let officerTr: Traits | null = null;
let workerTr: Traits | null = null;

function officerTraits(): Traits {
  if (officerTr === null) {
    const b = buildTraits(4242);
    officerTr = {
      ...b, look: -20, archetype: 'office', fem: false, hair: 'short', hairColor: '#231a15', hairEdge: shade('#231a15', 0.66),
      top: '#7d8b4a', topEdge: shade('#7d8b4a', 0.66), longSleeves: false, tunic: false, bottom: '#4a4f3a',
      bottomEdge: shade('#4a4f3a', 0.66), bottomStyle: 'pants', hat: 'cap', hatColor: '#5f6b36', hatEdge: shade('#5f6b36', 0.66),
      neck: 'collar', neckColor: '#9aa66a', pattern: 'none', glasses: 'none', bag: 'none', cane: false, stoop: 0, phone: 0,
      height: 1, width: 1.05, legColor: b.skin,
    };
  }
  return officerTr;
}

function workerTraits(): Traits {
  if (workerTr === null) {
    const b = buildTraits(777);
    workerTr = {
      ...b, look: -21, archetype: 'shipper', fem: false, hat: 'helmet', hatColor: '#ffd23f', hatEdge: shade('#ffd23f', 0.66),
      top: '#f08a3a', topEdge: shade('#f08a3a', 0.66), neck: 'zip', neckColor: '#fffcf7', bottom: '#3b4a6b',
      bottomEdge: shade('#3b4a6b', 0.66), bottomStyle: 'pants', bag: 'none', cane: false, stoop: 0, glasses: 'none', phone: 0,
    };
  }
  return workerTr;
}

/** Seconds a coin takes to fly from a counter to the officer's clipboard, and when in a stop it flies (ticks). */
const COIN_FLIGHT = 0.75;
const COIN_AT = 6;

function drawOfficer(rc: RenderContext, live: Live): void {
  const { ctx, layout: L } = rc;
  const w = live.officer;
  const u = L.actorH;
  const tr = officerTraits();
  const m = officerMemo;
  const sec = rc.wall / 1000;
  const input = inputFor(m.input, sec, rc.reducedMotion);
  let view: 'side' | 'front' | 'back' = 'side';
  if (w.walking) {
    input.phase = (w.x / (u * 1.3)) * Math.PI * 2;
    input.pace = 0.8;
    input.side = true;
    clipPose(m.pose, 'walk', input);
  } else {
    // At a shop: turned to it, clipboard up, writing.
    view = w.y < (L.road.y0 + L.road.y1) / 2 ? 'back' : 'front';
    input.side = false;
    clipPose(m.pose, 'idle', input);
    const scribble = rc.reducedMotion ? 0 : Math.sin(sec * 11) * 0.08;
    m.pose.a0 = 0.9;
    m.pose.e0 = 1.5;
    m.pose.x0 = 0.05;
    m.pose.a1 = 0.75 + scribble;
    m.pose.e1 = 1.55;
    m.pose.x1 = 0.02;
    m.pose.nod = 0.25;
  }
  const sk = solve(m.pose, tr.dims, view, m.sk);
  m.fx.mood = w.walking ? 'neutral' : 'focus';
  m.fx.phone = false;
  m.fx.blink = 0;
  drawCharacterAt(ctx, tr, w.x, w.y, u * tr.height, w.facing, view, m.pose, sk, m.fx, null);
  const hx = w.x + w.facing * sk.hand0.x * u;
  const hy = w.y + sk.hand0.y * u;
  if (view !== 'back') {
    // The clipboard in his hand.
    box(ctx, hx - u * 0.1, hy - u * 0.16, u * 0.2, u * 0.25, u * 0.02, '#c9a27a', u * 0.015);
    ctx.fillStyle = '#fffcf7';
    ctx.fillRect(hx - u * 0.07, hy - u * 0.12, u * 0.14, u * 0.18);
  }
  if (w.walking) {
    live.paid = -1;
    return;
  }
  // The tax reaches him: a coin flies from the shop's counter to his clipboard, once per stop.
  const pool = particlesOf(rc);
  if (w.since >= COIN_AT && live.paid !== w.at) {
    live.paid = w.at;
    const slot = live.stopSlots[w.at];
    if (pool !== null && slot !== undefined) {
      const from = counterTop(L, slot);
      const tx = w.x;
      const ty = w.y - u * 0.75;
      const g = u * 9;
      const coin = pool.emit('coin', from.x, from.y, (tx - from.x) / COIN_FLIGHT,
        (ty - from.y - 0.5 * g * COIN_FLIGHT * COIN_FLIGHT) / COIN_FLIGHT, COIN_FLIGHT + 0.35, u * 0.13, '', g);
      coin.spin = 12;
      coin.floor = ty;
    }
  }
  if (w.since > COIN_AT) {
    const tax = rc.director.rules?.taxPerCup ?? CONFIG.days[rc.director.day].taxPerCup;
    pill(ctx, `+${tax}k/ly`, w.x, w.y - u * 1.3, u * 0.22, '#5f6b36', '#fffcf7');
  }
}

// ── Vehicles ───────────────────────────────────────────────────────────────────────────────────────────────────────

function wheel(ctx: Ctx, x: number, y: number, r: number): void {
  disc(ctx, x, y, r, '#2a2422', r * 0.1);
  disc(ctx, x, y, r * 0.5, '#9d968b', 0);
}

const SKIN_TONES = ['#f0c6a2', '#e2ad86', '#cc9066'];

function drawBus(rc: RenderContext, live: Live): void {
  const { ctx, layout: L, view: v } = rc;
  const s = live.bus;
  const u = L.actorH;
  const len = u * 3.3;
  const h = u * 1.45;
  const doorFrom = len * 0.74;
  let x: number;
  const doors = s.doors;
  if (rc.reducedMotion) {
    if (s.phase !== 'stop') return;
    x = L.busStop.x - doorFrom;
  } else {
    x = busX(s, L.busStop.x, doorFrom, len, v.x, v.x + v.w);
  }
  const ground = L.lanes[1] - u * 0.06;
  const y = ground - h;
  const bob = rc.reducedMotion || s.phase === 'stop' ? 0 : Math.sin(rc.wall / 90) * u * 0.012;
  shadow(ctx, x + len / 2, ground, len * 0.52, u * 0.12, 0.2);
  ctx.translate(0, bob);
  // Body: matcha green with a cream band, rounded front at the right.
  box(ctx, x, y, len, h - u * 0.14, u * 0.22, '#5b8f3e', u * 0.04);
  ctx.fillStyle = '#f6e7d2';
  ctx.fillRect(x + u * 0.05, y + h * 0.56, len - u * 0.1, u * 0.18);
  // Windows with passengers.
  const wy = y + u * 0.18;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const wx = x + u * 0.18 + i * (len - u * 0.75) / n;
    box(ctx, wx, wy, (len - u * 0.75) / n - u * 0.08, u * 0.42, u * 0.06, '#a8cfe0', 0);
    if (hash01(i + 3) < 0.75) {
      const hx = wx + u * 0.2;
      disc(ctx, hx, wy + u * 0.3, u * 0.11, SKIN_TONES[i % 3], 0);
      ctx.fillStyle = i % 2 ? '#3b2a20' : '#231a15';
      ctx.beginPath();
      ctx.arc(hx, wy + u * 0.27, u * 0.115, Math.PI, 0);
      ctx.fill();
      box(ctx, hx - u * 0.13, wy + u * 0.38, u * 0.26, u * 0.06, u * 0.03, SHIRTS[i % SHIRTS.length], 0);
    }
  }
  box(ctx, x + len - u * 0.5, wy, u * 0.4, u * 0.55, u * 0.1, '#bfe0ec', 0);
  box(ctx, x + u * 0.4, y - u * 0.02, u * 1.3, u * 0.16, u * 0.04, '#2a1d15', 0);
  text(ctx, '09 · PHỐ TRÀ SỮA', x + u * 1.05, y + u * 0.06, u * 0.11, '#ffd23f', { maxW: u * 1.2 });
  // The door, sliding open.
  const dx = x + doorFrom - u * 0.24;
  const dw = u * 0.48;
  box(ctx, dx, wy, dw, h - u * 0.36, u * 0.04, '#3a4a40', 0);
  const panel = (dw / 2) * (1 - doors);
  if (panel > 0.5) {
    box(ctx, dx, wy, panel, h - u * 0.36, u * 0.03, '#a8cfe0', u * 0.02, '#3e6a27');
    box(ctx, dx + dw - panel, wy, panel, h - u * 0.36, u * 0.03, '#a8cfe0', u * 0.02, '#3e6a27');
  }
  if (doors > 0.5) {
    ctx.fillStyle = 'rgba(255, 230, 170, 0.35)';
    ctx.fillRect(dx + u * 0.05, wy + u * 0.05, dw - u * 0.1, h - u * 0.5);
  }
  wheel(ctx, x + u * 0.62, ground - u * 0.17, u * 0.2);
  wheel(ctx, x + len - u * 0.68, ground - u * 0.17, u * 0.2);
  ctx.translate(0, -bob);
  const pool = particlesOf(rc);
  if (pool !== null && s.phase !== 'stop' && rc.wall - live.busPuffAt > 140) {
    live.busPuffAt = rc.wall;
    pool.emit('dust', x - u * 0.05, ground - u * 0.15, -u * 0.6, -u * 0.2, 0.9, u * 0.12, '#b9aea4', 0, 1);
  }
}

/** The ward's loudspeaker van at the inspection: big enough to read over the crowd on the near lane. */
function drawVan(rc: RenderContext): void {
  const { ctx, layout: L, view: v } = rc;
  const u = L.actorH;
  const at = CONFIG.rumor.inspectionTick;
  let k = vanProgress(at, rc.now);
  if (k < 0) return;
  if (rc.reducedMotion) {
    if (Math.abs(rc.now - at) > 25) return;
    k = 0.5;
  }
  const len = u * 2.9;
  const h = u * 1.5;
  const x = lerp(v.x - len - u, v.x + v.w + u, k);
  const ground = (L.road.y0 + L.road.y1) / 2;
  const y = ground - h;
  shadow(ctx, x + len / 2, ground, len * 0.5, u * 0.12, 0.2);
  // A white van: a cab at the front (right), a boxy body with the red banner, a blue stripe, horns on a roof rack.
  box(ctx, x, y + u * 0.32, len, h - u * 0.46, u * 0.14, '#f4f1ec', u * 0.04, '#9d968b');
  box(ctx, x + len - u * 0.62, y + u * 0.4, u * 0.48, u * 0.42, u * 0.1, '#a8cfe0', 0);
  ctx.fillStyle = '#2f6fb3';
  ctx.fillRect(x + u * 0.05, ground - u * 0.36, len - u * 0.1, u * 0.08);
  const bw = len - u * 0.85;
  box(ctx, x + u * 0.12, y + u * 0.4, bw, u * 0.5, u * 0.05, '#c0323e', u * 0.03, '#8a2028');
  text(ctx, 'LOA LOA!', x + u * 0.12 + bw / 2, y + u * 0.54, u * 0.15, '#fffcf7', { maxW: bw - u * 0.1 });
  text(ctx, 'KẾT QUẢ KIỂM ĐỊNH', x + u * 0.12 + bw / 2, y + u * 0.75, u * 0.17, '#ffd23f', { maxW: bw - u * 0.12 });
  // The roof rack and the horns.
  const hx = x + len * 0.4;
  ctx.fillStyle = '#6e665c';
  ctx.fillRect(x + u * 0.3, y + u * 0.26, len * 0.6, u * 0.06);
  line(ctx, hx, y + u * 0.28, hx, y + u * 0.06, '#6e665c', u * 0.05);
  horn(ctx, hx, y, u * 0.85, -1);
  horn(ctx, hx, y, u * 0.85, 1);
  wheel(ctx, x + u * 0.55, ground - u * 0.16, u * 0.18);
  wheel(ctx, x + len - u * 0.6, ground - u * 0.16, u * 0.18);
  if (!rc.reducedMotion) rings(ctx, hx, y, u, rc.wall / 700, 0.4, 0.9);
}

const MOTO_COLS = ['#de4f5a', '#2f6fb3', '#f2c14e', '#5b8f3e', '#2a2f3a', '#b49ad1'];
const SHIRTS = ['#7fb8e0', '#f6e7d2', '#9dbb6e', '#f08a3a', '#fffcf7', '#e3d3ef'];

/** A motorbike and its rider (and cargo), drawn once per look and direction into a little canvas, then blitted. */
function drawMoto(rc: RenderContext, live: Live, i: number, ground: number): void {
  const { ctx, layout: L } = rc;
  const r = live.riders[i];
  const u = L.actorH;
  const x = r.x;
  const d = r.dir;
  const k = rc.pxPerUnit;
  const key = r.look * 2 + (d > 0 ? 1 : 0);
  let hit = live.motos.get(key);
  if (hit === undefined || hit.k !== k) {
    if (live.motos.size > 12) live.motos.clear();
    let canvas: HTMLCanvasElement | null = null;
    if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = Math.ceil(u * 1.8 * k);
      canvas.height = Math.ceil(u * 1.5 * k);
      const c = canvas.getContext('2d');
      if (c !== null) {
        c.scale(k, k);
        c.translate(u * 0.9, u * 1.4);
        paintMoto(c, r.look, d, u);
      }
    }
    hit = { k, canvas };
    live.motos.set(key, hit);
  }
  const bob = rc.reducedMotion ? 0 : Math.sin(r.t * 18) * u * 0.012;
  shadow(ctx, x, ground, u * 0.55, u * 0.08, 0.2);
  if (hit.canvas !== null) ctx.drawImage(hit.canvas, x - u * 0.9, ground - u * 1.4 + bob, u * 1.8, u * 1.5);
  else {
    ctx.translate(x, ground + bob);
    paintMoto(ctx, r.look, d, u);
    ctx.translate(-x, -ground - bob);
  }
  // One puff of exhaust per window, some windows none.
  const pool = particlesOf(rc);
  const win = Math.floor(rc.wall / PUFF_MS);
  if (pool !== null && live.motoPuff[i] !== win) {
    live.motoPuff[i] = win;
    if (hash01(win + r.look) < 0.6) {
      pool.emit('dust', x - d * u * 0.48, ground - u * 0.16, -d * u * 0.5, -u * 0.25, 0.7, u * 0.07, '#c8bfb5', 0, 1);
    }
  }
}

/** The motorbike at the origin (its ground point), facing `d`. */
function paintMoto(ctx: Ctx, look: number, d: 1 | -1, u: number): void {
  const col = MOTO_COLS[look % MOTO_COLS.length];
  const shirt = SHIRTS[(look >> 3) % SHIRTS.length];
  const helmet = MOTO_COLS[(look >> 6) % MOTO_COLS.length];
  const cargo = (look >> 9) % 4;
  wheel(ctx, -d * u * 0.36, -u * 0.13, u * 0.13);
  wheel(ctx, d * u * 0.36, -u * 0.13, u * 0.13);
  ctx.save();
  ctx.scale(d, 1);
  // The scooter body.
  ctx.beginPath();
  ctx.moveTo(-u * 0.42, -u * 0.2);
  ctx.lineTo(-u * 0.1, -u * 0.38);
  ctx.lineTo(u * 0.22, -u * 0.32);
  ctx.lineTo(u * 0.3, -u * 0.62);
  ctx.lineTo(u * 0.38, -u * 0.6);
  ctx.lineTo(u * 0.4, -u * 0.2);
  ctx.lineTo(u * 0.12, -u * 0.12);
  ctx.lineTo(-u * 0.36, -u * 0.12);
  ctx.closePath();
  fe(ctx, col, u * 0.03);
  box(ctx, -u * 0.32, -u * 0.46, u * 0.42, u * 0.09, u * 0.04, '#2a2422', 0);
  disc(ctx, u * 0.42, -u * 0.5, u * 0.05, '#fff3c4', 0);
  // The rider: legs, body, arm to the handlebar, a helmet.
  line(ctx, -u * 0.05, -u * 0.48, u * 0.12, -u * 0.22, '#3b4a6b', u * 0.09);
  box(ctx, -u * 0.18, -u * 0.9, u * 0.26, u * 0.44, u * 0.1, shirt, u * 0.025);
  line(ctx, u * 0.02, -u * 0.8, u * 0.3, -u * 0.62, shirt, u * 0.07);
  disc(ctx, -u * 0.04, -u * 1.0, u * 0.13, '#f0c6a2', u * 0.02);
  ctx.beginPath();
  ctx.arc(-u * 0.05, -u * 1.03, u * 0.15, Math.PI, 0);
  ctx.closePath();
  fe(ctx, helmet, u * 0.025);
  // What it carries.
  if (cargo === 1) {
    for (let i = 0; i < 3; i++) box(ctx, -u * 0.62, -u * (0.62 + i * 0.2), u * 0.36, u * 0.2, u * 0.02, '#c8995e', u * 0.02);
  } else if (cargo === 2) {
    // A potted tree riding pillion.
    box(ctx, -u * 0.55, -u * 0.62, u * 0.26, u * 0.22, u * 0.04, '#b5523e', u * 0.02);
    disc(ctx, -u * 0.42, -u * 0.95, u * 0.26, '#66a046', u * 0.025);
    disc(ctx, -u * 0.3, -u * 1.12, u * 0.15, '#86bd5c', 0);
  } else if (cargo === 3) {
    // A passenger.
    box(ctx, -u * 0.42, -u * 0.86, u * 0.24, u * 0.4, u * 0.1, SHIRTS[(look >> 12) % SHIRTS.length], u * 0.025);
    disc(ctx, -u * 0.3, -u * 0.97, u * 0.12, '#e2ad86', u * 0.02);
    ctx.beginPath();
    ctx.arc(-u * 0.3, -u * 1.0, u * 0.14, Math.PI, 0);
    ctx.closePath();
    fe(ctx, MOTO_COLS[(look >> 14) % MOTO_COLS.length], u * 0.025);
  }
  ctx.restore();
}

// ── The cat ────────────────────────────────────────────────────────────────────────────────────────────────────────

const FUR = '#e9a15a';
const FUR_DARK = '#b9733a';

function drawCat(ctx: Ctx, c: ReturnType<typeof newCat>, x: number, y: number, u: number, calm: boolean): void {
  const s = u * 0.38;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(c.dir, 1);
  const step = calm ? 0 : Math.sin(c.t * 9);
  const tail = calm ? 0 : Math.sin(c.t * 2.2) * 0.3;
  ctx.strokeStyle = FUR_DARK;
  ctx.lineCap = 'round';
  if (c.pose === 'walk') {
    // Legs, body, head, tail up.
    ctx.lineWidth = s * 0.12;
    ctx.beginPath();
    ctx.moveTo(-s * 0.35, -s * 0.25);
    ctx.lineTo(-s * 0.35 + step * s * 0.12, 0);
    ctx.moveTo(-s * 0.2, -s * 0.25);
    ctx.lineTo(-s * 0.2 - step * s * 0.12, 0);
    ctx.moveTo(s * 0.25, -s * 0.25);
    ctx.lineTo(s * 0.25 - step * s * 0.12, 0);
    ctx.moveTo(s * 0.4, -s * 0.25);
    ctx.lineTo(s * 0.4 + step * s * 0.12, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.38, s * 0.52, s * 0.2, 0, 0, Math.PI * 2);
    fe(ctx, FUR, s * 0.05, FUR_DARK);
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(-s * 0.48, -s * 0.42);
    ctx.quadraticCurveTo(-s * 0.8, -s * 0.6, -s * 0.7 + tail * s * 0.3, -s * 0.95);
    ctx.stroke();
    catHead(ctx, s * 0.55, -s * 0.58, s);
  } else {
    // Sitting up: tail curled round; licking: head down to a raised paw.
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.38, s * 0.28, s * 0.38, 0, 0, Math.PI * 2);
    fe(ctx, FUR, s * 0.05, FUR_DARK);
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, -s * 0.05);
    ctx.quadraticCurveTo(-s * 0.6, 0, -s * 0.5, -s * 0.3 + tail * s * 0.2);
    ctx.stroke();
    const lick = c.pose === 'lick' && !calm ? Math.abs(Math.sin(c.t * 6)) : 0;
    catHead(ctx, s * 0.12, -s * (0.85 - lick * 0.12), s);
    if (c.pose === 'lick') {
      ctx.lineWidth = s * 0.12;
      ctx.beginPath();
      ctx.moveTo(s * 0.15, -s * 0.35);
      ctx.lineTo(s * 0.32, -s * (0.62 + lick * 0.1));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function catHead(ctx: Ctx, x: number, y: number, s: number): void {
  tri(ctx, x - s * 0.18, y - s * 0.08, x - s * 0.14, y - s * 0.3, x - s * 0.02, y - s * 0.14);
  fe(ctx, FUR, s * 0.04, FUR_DARK);
  tri(ctx, x + s * 0.18, y - s * 0.08, x + s * 0.14, y - s * 0.3, x + s * 0.02, y - s * 0.14);
  fe(ctx, FUR, s * 0.04, FUR_DARK);
  disc(ctx, x, y, s * 0.2, FUR, s * 0.04, FUR_DARK);
  disc(ctx, x + s * 0.07, y - s * 0.02, s * 0.03, '#2a1d15', 0);
  disc(ctx, x - s * 0.06, y - s * 0.02, s * 0.03, '#2a1d15', 0);
}
