// When the street's scripted things happen (Task 16), all pure: the bus on bus-stop days (when it pulls in, opens its
// doors, lets each rider off and drives away), the tax officer's round on the tax day, the ward's loudspeaker van at
// the inspection, and the ambience on the wall clock (a motorbike now and then, the cat on the rooftops).
//
// Times are sim ticks unless said otherwise; the ambience runs on wall milliseconds so it goes on while paused.
import { clamp, easeInQuad, easeOutCubic, lerp, smoothstep } from './tween';

// ── The bus ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Bus timings, in ticks. */
export const BUS = {
  /** From the street's end to the stop. */
  driveIn: 36,
  /** Doors opening (and closing), and the pause before the first rider and after the last. */
  doors: 5,
  /** Between two riders stepping off. */
  stagger: 4,
  /**
   * Riders whose latest step-off falls within this many ticks of a visit's first rider's share that visit. It is a
   * grouping window, not a cap on waiting: when two visits would overlap they merge, and a rider of the merged visit
   * may wait at the stop somewhat longer than this.
   */
  groupWindow: 110,
  /** From the stop out of the street. */
  driveOut: 26,
  /** Least time between one visit leaving and the next arriving. */
  rest: 14,
} as const;

export type BusTiming = { readonly [K in keyof typeof BUS]: number };

export interface BusRider { id: number; off: number; spot: number }

export interface BusVisit {
  /** Appears at the street's end. */
  arrive: number;
  /** Stopped, doors start to open. */
  open: number;
  /** Doors shut (they start closing `doors` ticks before), then it pulls away. */
  close: number;
  /** Gone past the street's end. */
  depart: number;
  /** In the order they step off; `spot` is where each waits at the stop. */
  riders: BusRider[];
}

function visitOf(g: readonly { id: number; latest: number }[], o: BusTiming): BusVisit {
  // Everyone steps off in turn as soon as the doors are open, none later than their latest.
  let open = Infinity;
  g.forEach((r, i) => { open = Math.min(open, r.latest - o.doors - i * o.stagger); });
  const riders = g.map((r, i) => ({ id: r.id, off: open + o.doors + i * o.stagger, spot: i }));
  const close = riders[riders.length - 1].off + o.doors;
  return { arrive: open - o.driveIn, open, close, depart: close + o.driveOut, riders };
}

/**
 * The bus visits for the day's bus riders. `latest` is the latest tick each may step off to still reach the boards in
 * time. Riders whose latest falls within `groupWindow` of a visit's first ride it together; visits that would overlap (or
 * come closer than `rest`) merge. Every rider steps off at or before their latest (the 1.5 s lag rule is untouched:
 * they only come earlier).
 */
export function planBus(riders: readonly { id: number; latest: number }[], o: BusTiming = BUS): BusVisit[] {
  const sorted = [...riders].sort((a, b) => a.latest - b.latest || a.id - b.id);
  const groups: { id: number; latest: number }[][] = [];
  for (const r of sorted) {
    const g = groups[groups.length - 1];
    if (g !== undefined && r.latest <= g[0].latest + o.groupWindow) g.push(r);
    else groups.push([r]);
  }
  const kept: { id: number; latest: number }[][] = [];
  const visits: BusVisit[] = [];
  for (const g of groups) {
    let group = g;
    let v = visitOf(group, o);
    while (visits.length > 0 && v.arrive < visits[visits.length - 1].depart + o.rest) {
      visits.pop();
      group = [...(kept.pop() ?? []), ...group];
      v = visitOf(group, o);
    }
    kept.push(group);
    visits.push(v);
  }
  return visits;
}

export interface BusState {
  visit: BusVisit | null;
  phase: 'in' | 'stop' | 'out';
  /** Progress through the phase, 0..1. */
  k: number;
  /** Doors open, 0..1. */
  doors: number;
}

export const newBusState = (): BusState => ({ visit: null, phase: 'in', k: 0, doors: 0 });

/** Where the bus is at `now` (into `out`); false when no bus is on the street. */
export function busAt(visits: readonly BusVisit[], now: number, out: BusState): boolean {
  out.visit = null;
  for (const v of visits) {
    if (now < v.arrive || now >= v.depart) continue;
    out.visit = v;
    if (now < v.open) {
      out.phase = 'in';
      out.k = (now - v.arrive) / (v.open - v.arrive);
      out.doors = 0;
    } else if (now < v.close) {
      out.phase = 'stop';
      out.k = (now - v.open) / Math.max(1e-6, v.close - v.open);
      const shut = 3;
      out.doors = Math.min(clamp((now - v.open) / shut, 0, 1), clamp((v.close - now) / shut, 0, 1));
    } else {
      out.phase = 'out';
      out.k = (now - v.close) / (v.depart - v.close);
      out.doors = 0;
    }
    return true;
  }
  return false;
}

/**
 * The bus's x (its rear end) for a state: it drives in from beyond the left end of the street, easing to a stop with
 * its door at `doorX`, then pulls away to the right.
 */
export function busX(s: BusState, doorX: number, doorFromRear: number, length: number, viewX0: number,
  viewX1: number): number {
  const park = doorX - doorFromRear;
  if (s.phase === 'stop') return park;
  if (s.phase === 'in') return lerp(viewX0 - length - 8, park, easeOutCubic(clamp(s.k, 0, 1)));
  return lerp(park, viewX1 + 8, easeInQuad(clamp(s.k, 0, 1)));
}

// ── The tax officer (day 4) ─────────────────────────────────────────────────────────────────────────────────────────

export interface Stop { x: number; y: number }

export interface Walker {
  x: number; y: number;
  walking: boolean;
  /** −1 left, +1 right; `toward` is set while standing at a stop (facing the shop: up or down). */
  facing: 1 | -1;
  /** Index of the stop stood at, −1 while walking. */
  at: number;
  /** Ticks since the current leg or stop began. */
  since: number;
}

export const newWalker = (): Walker => ({ x: 0, y: 0, walking: false, facing: 1, at: -1, since: 0 });

/** The officer's round, in ticks. */
export const ROUND = { start: 25, stand: 46, speed: 0.55, pause: 60 } as const;

/**
 * The officer's place at `now` (into `out`): in from the left end at `start`, to each stop in turn at `speed`
 * walking speeds (`walk` units a tick), `stand` ticks writing at each, out at the right end, a pause off the street,
 * then the round again. False while off the street.
 */
export function officerAt(stops: readonly Stop[], from: Stop, to: Stop, walk: number, now: number, out: Walker,
  r: typeof ROUND = ROUND): boolean {
  const v = walk * r.speed;
  // Length of one round.
  let total = 0;
  let px = from.x;
  let py = from.y;
  for (const s of stops) {
    total += Math.hypot(s.x - px, s.y - py) / v + r.stand;
    px = s.x;
    py = s.y;
  }
  total += Math.hypot(to.x - px, to.y - py) / v;
  if (now < r.start) return false;
  let t = (now - r.start) % (total + r.pause);
  if (t >= total) return false;
  px = from.x;
  py = from.y;
  for (let i = 0; i <= stops.length; i++) {
    const s = i < stops.length ? stops[i] : to;
    const leg = Math.hypot(s.x - px, s.y - py) / v;
    if (t < leg) {
      const k = leg <= 0 ? 1 : t / leg;
      out.x = lerp(px, s.x, k);
      out.y = lerp(py, s.y, k);
      out.walking = true;
      out.facing = s.x >= px ? 1 : -1;
      out.at = -1;
      out.since = t;
      return true;
    }
    t -= leg;
    if (i === stops.length) break;
    if (t < r.stand) {
      out.x = s.x;
      out.y = s.y;
      out.walking = false;
      out.at = i;
      out.since = t;
      return true;
    }
    t -= r.stand;
    px = s.x;
    py = s.y;
  }
  return false;
}

// ── The loudspeaker van (day 5, at the inspection) ─────────────────────────────────────────────────────────────────

export const VAN = { before: 34, after: 46 } as const;

/**
 * The van's progress across the street at `now`, 0..1 (it crawls past the middle at the announcement), or −1 when it
 * is not on the street. `at` is the inspection tick.
 */
export function vanProgress(at: number, now: number): number {
  const u = (now - (at - VAN.before)) / (VAN.before + VAN.after);
  if (u < 0 || u >= 1) return -1;
  // Fast at the ends, slow in the middle: u + 0.14·sin(2πu) is 0.5 near the middle a while.
  const shifted = clamp(u + 0.14 * Math.sin(2 * Math.PI * u), 0, 1);
  return shifted;
}

// ── Ambience (wall clock) ──────────────────────────────────────────────────────────────────────────────────────────

/** A small deterministic hash to 0..1. */
export function hash01(n: number): number {
  let h = Math.imul((n | 0) ^ 0x27d4eb2d, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export interface Rider {
  x: number;
  /** Which half of the road: 0 the far half (heading left), 1 the near half (heading right). */
  half: 0 | 1;
  dir: 1 | -1;
  /** Appearance seed. */
  look: number;
  /** Seconds since it came on. */
  t: number;
}

export const newRider = (): Rider => ({ x: 0, half: 0, dir: 1, look: 0, t: 0 });

/**
 * A motorbike now and then (stream `lane`): each period of `periodMs` one rides across the view at its own moment,
 * on the half of the road its direction keeps to. False when none is on the street.
 */
export function motoAt(wallMs: number, stream: number, x0: number, x1: number, speed: number, periodMs: number,
  out: Rider): boolean {
  const n = Math.floor(wallMs / periodMs);
  const seed = n * 7919 + stream * 104729;
  const startIn = hash01(seed) * 0.45 * periodMs;
  const t = (wallMs - n * periodMs - startIn) / 1000;
  const span = x1 - x0 + 120;
  if (t < 0 || t * speed > span) return false;
  out.dir = hash01(seed + 1) < 0.5 ? 1 : -1;
  out.half = out.dir > 0 ? 1 : 0;
  out.look = Math.floor(hash01(seed + 2) * 1e6);
  out.t = t;
  out.x = out.dir > 0 ? x0 - 60 + t * speed : x1 + 60 - t * speed;
  return true;
}

export interface Cat { x: number; dir: 1 | -1; walking: boolean; pose: 'walk' | 'sit' | 'lick'; t: number }

export const newCat = (): Cat => ({ x: 0, dir: 1, walking: false, pose: 'walk', t: 0 });

/**
 * The cat strolling along a rooftop line from x0 to x1 (or back), with two sits on the way, once every `periodMs`.
 */
export function catAt(wallMs: number, x0: number, x1: number, periodMs: number, out: Cat): boolean {
  const n = Math.floor(wallMs / periodMs);
  const t = (wallMs - n * periodMs) / 1000;
  const walkS = 9;
  const sitS = 3.2;
  const total = walkS * 3 + sitS * 2;
  if (t >= total) return false;
  out.dir = hash01(n * 31 + 5) < 0.5 ? 1 : -1;
  let walked: number;
  if (t < walkS) {
    walked = t / walkS;
    out.walking = true;
    out.pose = 'walk';
  } else if (t < walkS + sitS) {
    walked = 1;
    out.walking = false;
    out.pose = 'sit';
  } else if (t < walkS * 2 + sitS) {
    walked = 1 + (t - walkS - sitS) / walkS;
    out.walking = true;
    out.pose = 'walk';
  } else if (t < walkS * 2 + sitS * 2) {
    walked = 2;
    out.walking = false;
    out.pose = 'lick';
  } else {
    walked = 2 + (t - walkS * 2 - sitS * 2) / walkS;
    out.walking = true;
    out.pose = 'walk';
  }
  const k = smoothstep(clamp(walked / 3, 0, 1)) * 0.15 + (walked / 3) * 0.85;
  out.x = out.dir > 0 ? lerp(x0, x1, k) : lerp(x1, x0, k);
  out.t = t;
  return true;
}
