// Where everything stands on the street (spec §9 "Cảnh phố", "Bố cục"): one diagram with a portrait and a landscape
// set of coordinates, in logical units, and the fit of either into a canvas of any size. A road runs across the
// middle; four shops stand above it and three below, the player's shop in the middle of the bottom row; queues form on
// the sidewalk between a shop and the road, from the counter along the sidewalk; walkers enter at both ends of the
// road and stop in the middle of the street to read the boards; on bus-stop days some arrive at the bus stop. The
// whole street fits one screen, no scrolling.
import { STREET } from '../../../shared/sim/shops';
import type { ShopId } from '../../../shared/sim/types';

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
/** A horizontal band of the street, from y0 down to y1. */
export interface Band { y0: number; y1: number }

/**
 * One shop's place on the street.
 *
 * Art rule (Task 16): the queue stands on the sidewalk in front of the counter, along `counter` → +x. A bottom-row shop
 * faces up, toward the road, so its queue stands just above `rect.y` and is drawn before the shop (its depth is
 * `rect.y`): along the queue's span nothing of the shop may rise above counter height at `rect.y`, or it hides the
 * people. Tall parts (signs, awning posts, balloons) go at the far edge of the shop, or are props at their own depth.
 * Top-row shops face down: the queue stands in front of them and is drawn after them, so they may be tall.
 */
export interface ShopSlot {
  id: ShopId;
  /** Index in `STREET`. */
  index: number;
  row: 'top' | 'bottom';
  /** The shop's footprint. */
  rect: Rect;
  /** The side the counter opens onto, toward the road: the top row faces down, the bottom row up. */
  facing: 'down' | 'up';
  /** Where the head of the queue stands, at the counter; the queue goes on along the sidewalk (+x). */
  counter: Pt;
  /** The price board on the shop. */
  board: Pt;
  /** The y the shop is depth-sorted at among actors and props (top row: its front edge; bottom row: its back). */
  depth: number;
}

export interface StreetLayout {
  kind: 'portrait' | 'landscape';
  width: number;
  height: number;
  /** Nominal height of a customer, feet to head. */
  actorH: number;
  /** Walking speed, logical units per tick. */
  walk: number;
  /** Distance between two people in a queue. */
  queueGap: number;
  /** Queue places drawn per shop; the rest shows as "+n". */
  queueSlots: number;
  /** Walkers stop to read the boards somewhere in this span of x (the middle of the street), before they choose. */
  browse: { x0: number; x1: number };
  back: Band; sidewalkTop: Band; road: Band; sidewalkBottom: Band; front: Band;
  /** y of the two walking lanes on the road: by the top sidewalk, by the bottom sidewalk. */
  lanes: readonly [number, number];
  /** In `STREET` order. */
  shops: readonly ShopSlot[];
  /**
   * Where bus passengers step off (bus-stop days): the bus's door, on the near walking lane; the bus pulls in on the
   * road just behind it.
   */
  busStop: Pt;
  /** The bus shelter's foot, on the bottom sidewalk by the stop; riders let off early wait around it. */
  busShelter: Pt;
}

interface RowSpec { y: number; h: number; x0: number; w: number; gap: number; queueY: number }
interface Spec {
  kind: StreetLayout['kind']; width: number; height: number; actorH: number; queueGap: number;
  /** From the shop's left edge to the head of its queue. */
  counterInset: number;
  back: Band; sidewalkTop: Band; road: Band; sidewalkBottom: Band; front: Band;
  top: RowSpec; bottom: RowSpec; busStop: Pt; busShelter: Pt;
}

/** Walking speed as a share of the actor's height per tick: 3 body heights a second, a brisk lunch-hour walk. */
const WALK_PER_HEIGHT = 0.3;
/** The browse span: the middle of the street, this share of its width in from either end. */
const BROWSE_FROM = 0.4;

function build(s: Spec): StreetLayout {
  const lanes = [s.road.y0 + s.actorH * 0.4, s.road.y1 - s.actorH * 0.4] as const;
  const shops = STREET.map((id, index): ShopSlot => {
    const top = index < 4;
    const r = top ? s.top : s.bottom;
    const k = top ? index : index - 4;
    const rect = { x: r.x0 + k * (r.w + r.gap), y: r.y, w: r.w, h: r.h };
    const inset = s.counterInset;
    return {
      id, index, row: top ? 'top' : 'bottom', rect, facing: top ? 'down' : 'up',
      counter: { x: rect.x + inset, y: r.queueY },
      board: top
        ? { x: rect.x + rect.w - s.actorH * 0.6, y: rect.y + rect.h - s.actorH * 1.05 }
        : { x: rect.x + rect.w - s.actorH * 0.6, y: rect.y + s.actorH * 0.7 },
      depth: top ? rect.y + rect.h : rect.y,
    };
  });
  return {
    kind: s.kind, width: s.width, height: s.height, actorH: s.actorH, walk: s.actorH * WALK_PER_HEIGHT,
    queueGap: s.queueGap, queueSlots: 5, browse: { x0: s.width * BROWSE_FROM, x1: s.width * (1 - BROWSE_FROM) },
    back: s.back, sidewalkTop: s.sidewalkTop, road: s.road, sidewalkBottom: s.sidewalkBottom, front: s.front,
    lanes, shops, busStop: s.busStop, busShelter: s.busShelter,
  };
}

/**
 * A phone held upright (390 × 844 shows it at scale 1). Five people (38 tall, 19 apart) fit along each shop; the
 * bottom-row queue stands half a body clear of the shops.
 */
export const PORTRAIT: StreetLayout = build({
  kind: 'portrait', width: 390, height: 760, actorH: 38, queueGap: 19, counterInset: 8.5,
  back: { y0: 0, y1: 40 },
  top: { y: 40, h: 160, x0: 4, w: 92.5, gap: 4, queueY: 238 },
  sidewalkTop: { y0: 200, y1: 284 },
  road: { y0: 284, y1: 396 },
  sidewalkBottom: { y0: 396, y1: 490 },
  bottom: { y: 490, h: 182, x0: 4, w: 116, gap: 6, queueY: 470 },
  front: { y0: 672, y1: 760 },
  busStop: { x: 364, y: 384 },
  busShelter: { x: 372, y: 416 },
});

/** A phone on its side or a computer. The bottom-row queue stands more than half a body clear of the shops. */
export const LANDSCAPE: StreetLayout = build({
  kind: 'landscape', width: 800, height: 470, actorH: 46, queueGap: 24, counterInset: 20.7,
  back: { y0: 0, y1: 18 },
  top: { y: 18, h: 132, x0: 40, w: 168, gap: 16, queueY: 196 },
  sidewalkTop: { y0: 150, y1: 212 },
  road: { y0: 212, y1: 292 },
  sidewalkBottom: { y0: 292, y1: 372 },
  bottom: { y: 372, h: 98, x0: 76, w: 200, gap: 24, queueY: 346 },
  front: { y0: 470, y1: 470 },
  busStop: { x: 748, y: 277 },
  busShelter: { x: 768, y: 306 },
});

export function slotOf(L: StreetLayout, id: ShopId): ShopSlot {
  const s = L.shops.find(x => x.id === id);
  if (s === undefined) throw new Error(`no slot for ${id}`);
  return s;
}

/** Place `i` of a shop's queue (0 at the counter); past the drawn places it goes on along the same line. */
export function queuePoint(L: StreetLayout, slot: ShopSlot, i: number): Pt {
  // Every other person stands a little further back, so a tight queue still reads as people.
  const back = i % 2 === 1 ? L.actorH * 0.06 : 0;
  return { x: slot.counter.x + i * L.queueGap, y: slot.counter.y + (slot.facing === 'down' ? -back : back) };
}

/** Where someone leaving place `i` of a queue steps to, toward the road, clear of the people behind. */
export function asidePoint(L: StreetLayout, slot: ShopSlot, i: number): Pt {
  const q = queuePoint(L, slot, i);
  return { x: q.x + L.queueGap * 0.4, y: q.y + (slot.facing === 'down' ? 1 : -1) * L.actorH * 0.55 };
}

/**
 * Where the k-th rider let off one bus waits for their time to walk on: two loose columns in front of the shelter,
 * rows toward the shops; past eight they stand a little to the side of the first eight.
 */
export function busWaitPoint(L: StreetLayout, k: number): Pt {
  const s = L.busShelter;
  const i = k % 8;
  const round = Math.floor(k / 8) % 3;
  const col = i % 2;
  const row = Math.floor(i / 2);
  const u = L.actorH;
  return {
    x: s.x - col * u * 0.48 - (row % 2) * u * 0.18 - round * u * 0.3,
    y: s.y + u * 0.32 + row * u * (L.kind === 'portrait' ? 0.34 : 0.4) + round * u * 0.12,
  };
}

/** The y of a walking lane (0 by the top sidewalk, 1 by the bottom one). */
export const laneY = (L: StreetLayout, lane: 0 | 1) => L.lanes[lane];

/** The fit of a layout into a canvas of `w × h` CSS pixels: logical → CSS is `x · scale + ox`. */
export interface Fit {
  layout: StreetLayout;
  scale: number;
  ox: number;
  oy: number;
  /** The logical rect the canvas shows: the layout and the margin around it. */
  view: Rect;
}

export function fitTo(L: StreetLayout, w: number, h: number): Fit {
  const scale = Math.min(w / L.width, h / L.height);
  const ox = (w - L.width * scale) / 2;
  const oy = (h - L.height * scale) / 2;
  return { layout: L, scale, ox, oy, view: { x: -ox / scale, y: -oy / scale, w: w / scale, h: h / scale } };
}

/** The layout that fills more of a `w × h` canvas, fitted into it whole (letterboxed, centred). */
export function fitLayout(w: number, h: number): Fit {
  const p = fitTo(PORTRAIT, w, h);
  const l = fitTo(LANDSCAPE, w, h);
  const cover = (f: Fit) => f.layout.width * f.layout.height * f.scale * f.scale;
  return cover(p) > cover(l) ? p : l;
}

/** The whole layout as its own view (no margin). */
export const fullView = (L: StreetLayout): Rect => ({ x: 0, y: 0, w: L.width, h: L.height });
