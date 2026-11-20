// The customers' frame cache (Task 17's performance pass). Drawing a character is about 30 fills and strokes; blitting
// a frame of it is one `drawImage`. So each figure (with its shadow) is painted into a small offscreen canvas and the
// street blits it, the way the keepers are cached (draw/owners.ts); only the emotes and foot marks stay live.
//
// Frames are keyed so they are painted only when the picture would change:
// - Walk cycles that depend on nothing but the distance walked (walk, walkCane, shuffle, walkAngry, walkPhone) are
//   shared per look: one frame per sixteenth of the cycle (and per pace step for the plain walk), so a walker crossing
//   the street paints their sixteen frames once and then only blits.
// - Everything else (breathing, tapping, stomping, a blend between clips) is the actor's own and refreshed at a
//   modest rate per clip (FRAME_MS), staggered per actor so the repaints spread over frames.
// Facing left is the same frame mirrored at blit time (the figure is drawn mirrored anyway). Every frame of a scene has
// the same device size (the tallest person at this zoom), so an evicted canvas is reused as is. The cache holds a
// bounded number of frames (least recently used out first) and starts over when the zoom changes.
//
// The pure parts (the keys, the LRU) are tested in node; the canvases are made only in a browser.
import type { Clip } from '../rig';
import { CLIPS } from '../rig';
import type { Mood } from './faces';
import { MOODS } from './faces';
import type { View } from '../rig';

// ── LRU ────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface LruNode<V> { a: number; b: number; v: V; prev: LruNode<V> | null; next: LruNode<V> | null }

/**
 * A least-recently-used map on a pair of numbers (no strings per frame). `get` marks an entry used; `set` beyond the
 * capacity evicts the least recently used and hands it to `onEvict` (which may recycle its value).
 */
export class Lru<V> {
  private readonly map = new Map<number, Map<number, LruNode<V>>>();
  private head: LruNode<V> | null = null;
  private tail: LruNode<V> | null = null;
  private n = 0;

  constructor(readonly capacity: number, private readonly onEvict?: (v: V) => void) {
    if (!(capacity >= 1)) throw new Error('an LRU needs room for one entry');
  }

  get size(): number { return this.n; }

  get(a: number, b: number): V | undefined {
    const node = this.map.get(a)?.get(b);
    if (node === undefined) return undefined;
    this.touch(node);
    return node.v;
  }

  has(a: number, b: number): boolean { return this.map.get(a)?.has(b) ?? false; }

  /** Stores v under (a, b) as the most recently used; evicts the least recently used past the capacity. */
  set(a: number, b: number, v: V): void {
    let inner = this.map.get(a);
    if (inner === undefined) {
      inner = new Map();
      this.map.set(a, inner);
    }
    const old = inner.get(b);
    if (old !== undefined) {
      old.v = v;
      this.touch(old);
      return;
    }
    const node: LruNode<V> = { a, b, v, prev: null, next: this.head };
    if (this.head !== null) this.head.prev = node;
    this.head = node;
    if (this.tail === null) this.tail = node;
    inner.set(b, node);
    this.n++;
    while (this.n > this.capacity) this.evictTail();
  }

  /** The least recently used value, removed (null when empty). */
  pop(): V | null {
    const t = this.tail;
    if (t === null) return null;
    this.unlink(t);
    return t.v;
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
    this.n = 0;
  }

  private evictTail(): void {
    const t = this.tail;
    if (t === null) return;
    this.unlink(t);
    this.onEvict?.(t.v);
  }

  private unlink(node: LruNode<V>): void {
    if (node.prev !== null) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next !== null) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
    const inner = this.map.get(node.a);
    inner?.delete(node.b);
    if (inner !== undefined && inner.size === 0) this.map.delete(node.a);
    this.n--;
  }

  private touch(node: LruNode<V>): void {
    if (this.head === node) return;
    // Out of its place, then in front.
    if (node.prev !== null) node.prev.next = node.next;
    if (node.next !== null) node.next.prev = node.prev;
    if (this.tail === node) this.tail = node.prev;
    node.prev = null;
    node.next = this.head;
    if (this.head !== null) this.head.prev = node;
    this.head = node;
  }
}

// ── Keys ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Walk clips whose pose depends only on the walk phase and one small second step (pace, sip, glance). */
export const CYCLIC: ReadonlySet<Clip> = new Set<Clip>([
  'walk', 'walkCane', 'shuffle', 'walkAngry', 'walkPhone', 'walkDrink', 'walkScared',
]);
/** Steps of a walk frame's second dimension: the plain walk's pace, the sip of a walk with a cup, a scared glance. */
export const EXTRA_STEPS = 16;
/** Seconds of the sip cycle (rig.ts walkDrink): the cup is up for its first 1.5 s, down for the rest. */
const SIP_PERIOD = 3.2;
const SIP_UP = 1.5;
const SIP_STEP = 0.1;

/**
 * The second dimension of a walk frame from the free-running clock (seconds): for a walk with a cup, the moment of
 * the sip (0 when the cup is down, else its tenth of a second); for a scared walk, whether they glance back (rig.ts:
 * sin(2.3·loop) > 0.3). Other walks: 0 (the plain walk's pace step is passed separately).
 */
export function loopStep(clip: Clip, loop: number): number {
  if (clip === 'walkDrink') {
    const c = ((loop % SIP_PERIOD) + SIP_PERIOD) % SIP_PERIOD;
    return c >= SIP_UP ? 0 : 1 + Math.min(EXTRA_STEPS - 2, Math.floor(c / SIP_STEP));
  }
  if (clip === 'walkScared') return Math.sin(loop * 2.3) > 0.3 ? 1 : 0;
  return 0;
}

/** A clock value that gives `loopStep` = step (the middle of its slice), to draw the frame at. */
export function stepLoop(clip: Clip, step: number): number {
  if (clip === 'walkDrink') return step === 0 ? (SIP_UP + SIP_PERIOD) / 2 : (step - 1 + 0.5) * SIP_STEP;
  if (clip === 'walkScared') return step === 1 ? Math.PI / 2 / 2.3 : (3 * Math.PI) / 2 / 2.3;
  return 0;
}
/** Frames per walk cycle. */
export const CYCLE_FRAMES = 16;
/** Pace steps for the plain walk (its stride grows from 1.4× to 3× walking speed). */
export const PACE_STEPS = 8;

/** Refresh period of an actor's own frames, per clip (ms): quick motions more often, slow breathing less. */
export const FRAME_MS: Readonly<Record<Clip, number>> = {
  idle: 150, walk: 66, shuffle: 66, walkDrink: 66, walkAngry: 66, walkScared: 66, walkPhone: 66, walkCane: 66,
  lookBoard: 133, phone: 133, selfie: 100, tap: 83, crossed: 83, happy: 50, puzzled: 66, stomp: 50, shrug: 66,
  whisper: 100,
};

const CLIP_INDEX = new Map<Clip, number>(CLIPS.map((c, i) => [c, i]));
const MOOD_INDEX = new Map<Mood, number>(MOODS.map((m, i) => [m, i]));
const VIEW_INDEX: Record<View, number> = { side: 0, front: 1, back: 2 };

/** The walk-cycle frame for a phase (radians): 0..CYCLE_FRAMES−1. */
export function cycleFrame(phase: number): number {
  const u = phase / (Math.PI * 2);
  const f = Math.floor((u - Math.floor(u)) * CYCLE_FRAMES);
  return f >= CYCLE_FRAMES ? 0 : f;
}

/** The phase a cycle frame is drawn at (its middle). */
export const framePhase = (f: number): number => ((f + 0.5) / CYCLE_FRAMES) * Math.PI * 2;

/** The plain walk's pace step: walking speed and below is 0; 3× and above is the last. */
export function paceStep(pace: number): number {
  return Math.max(0, Math.min(PACE_STEPS - 1, Math.round(((pace - 1.4) / 1.6) * (PACE_STEPS - 1))));
}

/** The pace a step is drawn at. */
export const stepPace = (s: number): number => (s <= 0 ? 1 : 1.4 + (s / (PACE_STEPS - 1)) * 1.6);

/** What a figure shows besides its pose. `flags`: bit 0 cup, bit 1 phone, bit 2 reduced motion. */
export interface FrameLook { clip: Clip; view: View; mood: Mood; blink: number; flags: number }

/** The part of a key every frame shares: clip, view, mood, blink, flags (under 2^14). */
export function lookKey(f: FrameLook): number {
  const c = CLIP_INDEX.get(f.clip) ?? 0;
  const m = MOOD_INDEX.get(f.mood) ?? 0;
  return ((((c * 3 + VIEW_INDEX[f.view]) * 8 + m) * 2 + (f.blink > 0.5 ? 1 : 0)) * 8) + (f.flags & 7);
}

/** Key space of `lookKey`. */
export const LOOK_KEYS = CLIPS.length * 3 * 8 * 2 * 8;

/** A shared walk frame's key (under the look's own space): the look part, the cycle frame and the second step. */
export function cycleKey(f: FrameLook, frame: number, extra: number): number {
  return (frame * EXTRA_STEPS + extra) * LOOK_KEYS + lookKey(f);
}

/**
 * An actor's own frame's key (under the actor's own space): the look part and the refresh slot it falls in (the wall
 * clock in FRAME_MS steps, staggered by `offsetMs`). Two moments in the same slot show the same frame.
 */
export function slotKey(f: FrameLook, wallMs: number, offsetMs: number): number {
  return Math.floor((wallMs + offsetMs) / FRAME_MS[f.clip]) * LOOK_KEYS + lookKey(f);
}

/** First-level key spaces: a look's shared walk frames (looks are unsigned), or one actor's own (negative). */
export const lookSpace = (look: number): number => look >>> 0;
export const actorSpace = (id: number): number => -1 - id;

/** A stagger per actor so their refreshes spread over the frames (0..99 ms). */
export const staggerOf = (id: number): number => (Math.imul(id + 1, 0x9e3779b1) >>> 0) % 100;

/** Frames painted by every cache (the dev bench reads it). */
export const figureStats = { painted: 0, paintMs: 0 };

// ── The cache ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** One painted frame (the figure and its shadow): the canvas, and the joints the live marks need. */
export interface Frame {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Head centre, toe and feet, in figure units (facing right, feet at 0, one unit the person's height). */
  headX: number; headY: number; toeX: number; foot0X: number; foot1X: number;
}

/** Device size of every frame, in heights of the actor (room for a raised arm, a cone hat, a hop). */
const BOX_W = 1.04;
const BOX_UP = 1.38;
const BOX_DOWN = 0.08;
/** The tallest person (traits go to 1.06). */
const TALLEST = 1.08;
/** Memory for frames, in bytes (RGBA). */
const BUDGET_BYTES = 24 * 1024 * 1024;

/** How many frames fit the budget at a frame size (at least 64, at most 400). */
export function framesFor(pw: number, ph: number): number {
  return Math.max(64, Math.min(400, Math.floor(BUDGET_BYTES / Math.max(1, pw * ph * 4))));
}

/** The device-pixel box of a frame for actors `H` units tall at `k` device px per unit; feet at (ax, ay). */
export function frameBox(H: number, k: number): { pw: number; ph: number; ax: number; ay: number } {
  const s = H * TALLEST * k;
  const half = Math.ceil((BOX_W / 2) * s);
  const up = Math.ceil(BOX_UP * s);
  return { pw: half * 2, ph: up + Math.ceil(BOX_DOWN * s), ax: half, ay: up };
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  return null;
}

/**
 * The frames of one scene. `begin(H, k)` each frame (a new zoom starts over); `get` finds a frame; `paint` takes a
 * canvas (a fresh one, or the least recently used frame's) and stores the result. Not usable without a canvas
 * (node): `available` is false and the street draws live.
 */
export class FigureCache {
  private lru: Lru<Frame>;
  private H = 0;
  private k = 0;
  private spare: Frame | null = null;
  box = { pw: 1, ph: 1, ax: 0, ay: 0 };
  readonly available: boolean;
  /** Frames painted (for the dev bench). */
  painted = 0;

  constructor() {
    this.available = typeof document !== 'undefined' || typeof OffscreenCanvas === 'function';
    this.lru = new Lru<Frame>(64, f => { this.spare = f; });
  }

  begin(H: number, k: number): void {
    if (H === this.H && k === this.k) return;
    this.H = H;
    this.k = k;
    this.box = frameBox(H, k);
    this.lru = new Lru<Frame>(framesFor(this.box.pw, this.box.ph), f => { this.spare = f; });
    this.spare = null;
  }

  get(a: number, b: number): Frame | undefined { return this.lru.get(a, b); }

  /**
   * Paints a frame under (a, b): `draw` gets a context whose transform puts the feet at the origin with one unit per
   * device px times `scale` (the caller scales to the person). Returns null without a canvas.
   */
  paint(a: number, b: number, draw: (ctx: CanvasRenderingContext2D) => void): Frame | null {
    const { pw, ph, ax, ay } = this.box;
    let f = this.spare;
    this.spare = null;
    if (f === null || f.canvas.width !== pw || f.canvas.height !== ph) {
      const canvas = makeCanvas(pw, ph);
      if (canvas === null) return null;
      f = { canvas, headX: 0, headY: 0, toeX: 0, foot0X: 0, foot1X: 0 };
    }
    const t0 = performance.now();
    const c = f.canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (c === null) return null;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, pw, ph);
    c.setTransform(this.k, 0, 0, this.k, ax, ay);
    draw(c);
    this.painted++;
    figureStats.painted++;
    figureStats.paintMs += performance.now() - t0;
    this.lru.set(a, b, f);
    return f;
  }

  get size(): number { return this.lru.size; }

  clear(): void {
    this.lru.clear();
    this.spare = null;
    this.H = 0;
    this.k = 0;
  }
}
