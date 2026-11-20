// The street's customers (spec §9 "Nhân vật khách", "Phong cách"): flat vector people with rounded shapes and soft
// outlines in the project's warm colours, built deterministically from `Customer.look` on the jointed rig (rig.ts).
//
// - `traitsOf(look)`: who they are. An archetype (học sinh, dân văn phòng, shipper, cụ ông / cụ bà, bà nội trợ, KOL)
//   sets the outfit and the props; body, skin, hair, colours and accessories vary within it — dozens of kinds.
// - `selectAnim(actor, now, traits, prev)`: what they do and feel, from the director's state (walking, reading the
//   boards, queueing as patience runs down, happy with their cup, puzzled by the wrong one, stomping off, scared off).
// - `drawFigure`: one character in a pose seen from a side; `drawCustomer`: the street's renderer, which keeps a little
//   memory per actor (walk phase, pose transitions, emote timers) in the scene's store.
import { CONFIG } from '../../../../shared/sim/config';
import type { Actor, Heading } from '../director';
import {
  armInFront, clipPose, copyPose, DEFAULT_DIMS, mixPose, newSkeleton, pose, solve, WALKING, type Clip, type ClipInput,
  type Dims, type P, type Pose, type Skeleton, type View,
} from '../rig';
import type { RenderContext } from '../Scene';
import { clamp, smoothstep } from '../tween';
import {
  canRecord, penEnd, penForget, penStart, Recorder, RecordingCache, replay, setFill, setStroke, type Recording,
} from './recorder';
import {
  angerMark, BROW_MOODS, dots, drawFace, eyeSpots, heart, mark, puff, sweat, type FaceInput,
  type Mood,
} from './faces';

// ── Traits ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Archetype = 'student' | 'office' | 'shipper' | 'elder' | 'homemaker' | 'kol';
export const ARCHETYPES: readonly Archetype[] = ['student', 'office', 'shipper', 'elder', 'homemaker', 'kol'];

export type HairStyle =
  | 'short' | 'side' | 'spiky' | 'buzz' | 'bob' | 'long' | 'ponytail' | 'bun' | 'twin' | 'curly' | 'bald';
export type Hat = 'none' | 'helmet' | 'conical' | 'cap' | 'bucket';
export type Bag = 'none' | 'backpack' | 'box' | 'basket' | 'tote' | 'sling';
export type Neckwear = 'none' | 'scarf' | 'tie' | 'lanyard' | 'collar' | 'zip';

export interface Traits {
  look: number;
  archetype: Archetype;
  /** Skirt-or-trousers, hair and the like lean feminine. */
  fem: boolean;
  /** Height as a share of the street's person height; body width factor. */
  height: number;
  width: number;
  dims: Dims;
  skin: string; skinEdge: string;
  hair: HairStyle; hairColor: string; hairEdge: string;
  hat: Hat; hatColor: string; hatEdge: string;
  top: string; topEdge: string;
  longSleeves: boolean;
  /** The top hangs past the hips (a tunic, áo bà ba, a long blouse). */
  tunic: boolean;
  bottom: string; bottomEdge: string;
  bottomStyle: 'pants' | 'shorts' | 'skirt';
  /** Legs under a skirt or shorts: skin or tights. */
  legColor: string;
  shoes: string;
  neck: Neckwear; neckColor: string;
  pattern: 'none' | 'dots' | 'stripes'; patternColor: string;
  glasses: 'none' | 'round' | 'sun';
  bag: Bag; bagColor: string; bagEdge: string;
  cane: boolean;
  /** 0..1, an old back's bend. */
  stoop: number;
  /** 0..1: how much of their waiting they spend on the phone. */
  phone: number;
  /** The drink they leave with. */
  tea: string;
  /** Per-character offsets for the free-running clock (s). */
  phaseOffset: number;
}

/** A small deterministic generator (mulberry32). */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T>(r: number, items: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let x = r * total;
  for (const [v, w] of items) {
    x -= w;
    if (x < 0) return v;
  }
  return items[items.length - 1][0];
}

const pick = <T>(r: number, items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(r * items.length))];

const shades = new Map<string, Map<number, string>>();

/** A colour darkened (k < 1) or lightened toward white (k > 1); remembered, so drawing never builds strings. */
export function shade(hex: string, k: number): string {
  let byK = shades.get(hex);
  if (byK === undefined) {
    byK = new Map();
    shades.set(hex, byK);
  }
  let out = byK.get(k);
  if (out === undefined) {
    out = computeShade(hex, k);
    byK.set(k, out);
  }
  return out;
}

function computeShade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = k <= 1 ? v * k : v + (255 - v) * (k - 1);
    return Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0');
  };
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const EDGE = 0.66;

/** Skin tones, light to deep, and how often each comes (a Vietnamese street at lunch, every tone on it). */
export const SKINS = ['#f8dcc4', '#f0c6a2', '#e2ad86', '#cc9066', '#a9714b', '#7e5337'];
const SKIN_WEIGHTS = [3, 3.2, 2.6, 1.8, 1.1, 0.7];
const HAIR_NATURAL = ['#231a15', '#231a15', '#3b2a20', '#4e3426', '#6b4630'];
const HAIR_DYED = ['#b9773a', '#7d5ea8', '#c4606e', '#8a8f99', '#d9b26a'];
const HAIR_OLD = ['#c9c3bb', '#e8e3dc', '#a59e96'];
const C = {
  matcha: '#5b8f3e', caramel: '#c9772a', strawberry: '#de4f5a', tea: '#e9b872', taro: '#8e6fae', sky: '#6fa8c9',
  mint: '#8cc7a8', navy: '#3c4f73', cream: '#fff6ea', pink: '#f2a7b5', mustard: '#d9a632', teal: '#3f8f8a',
  brick: '#b55a3c', olive: '#7c8a4a', white: '#fbf8f2', lilac: '#c3b1de', peach: '#f4b98f', powder: '#bcd8ea',
  denim: '#4d6a94', charcoal: '#3d3a3e', khaki: '#b49a6e', black: '#27211e', brown: '#6a4a35', sand: '#e6d3b3',
  maroon: '#7d3438', plum: '#6d4a7a',
};
const TEAS = ['#d9a66b', '#c8945e', '#9dbb6e', '#b49ad1', '#ef9aa6', '#b07a4f'];

const traitCache = new Map<number, Traits>();

/** Who customer `look` is, always the same for the same look. */
export function traitsOf(look: number): Traits {
  const hit = traitCache.get(look);
  if (hit !== undefined) return hit;
  if (traitCache.size > 4000) traitCache.clear();
  const t = buildTraits(look >>> 0);
  traitCache.set(look, t);
  return t;
}

/** Builds the traits of a look (uncached; `traitsOf` caches). */
export function buildTraits(look: number): Traits {
  const r = rngOf(look ^ 0xa5f1523d);
  const archetype = weighted<Archetype>(r(), [
    ['student', 22], ['office', 22], ['shipper', 12], ['elder', 13], ['homemaker', 16], ['kol', 15]]);
  const fem = archetype === 'homemaker' ? r() < 0.92 : archetype === 'shipper' ? r() < 0.2 : r() < 0.5;
  const skin = weighted(r(), SKINS.map((s, i) => [s, SKIN_WEIGHTS[i]] as const));
  let height = 0.96 + r() * 0.1;
  let width = 0.92 + r() * 0.2;
  const dims: Dims = { ...DEFAULT_DIMS };
  let hair: HairStyle;
  let hairColor = pick(r(), HAIR_NATURAL);
  let hat: Hat = 'none';
  let hatColor = C.white;
  let top: string;
  let longSleeves = false;
  let tunic = false;
  let bottom: string;
  let bottomStyle: Traits['bottomStyle'] = 'pants';
  let legColor = skin;
  let shoes = pick(r(), [C.black, C.brown, C.white, C.charcoal]);
  let neck: Neckwear = 'none';
  let neckColor = C.strawberry;
  let pattern: Traits['pattern'] = 'none';
  let patternColor = C.white;
  let glasses: Traits['glasses'] = 'none';
  let bag: Bag = 'none';
  let bagColor = C.navy;
  let cane = false;
  let stoop = 0;
  let phone = 0.15 + r() * 0.35;
  const femHair: HairStyle[] = ['bob', 'long', 'ponytail', 'bun', 'twin'];
  const mascHair: HairStyle[] = ['short', 'side', 'spiky', 'buzz', 'curly'];

  switch (archetype) {
    case 'student':
      // White school shirt, the red scarf or a collar, navy bottoms, a backpack; a bigger head, a shorter body.
      height = 0.86 + r() * 0.08;
      dims.headR = 0.222;
      dims.legUpper = dims.legLower = 0.12;
      hair = fem ? pick(r(), ['bob', 'ponytail', 'twin', 'long']) : pick(r(), ['short', 'side', 'spiky', 'buzz']);
      top = C.white;
      neck = r() < 0.6 ? 'scarf' : 'collar';
      neckColor = C.strawberry;
      bottom = pick(r(), [C.navy, C.navy, C.charcoal, C.khaki]);
      bottomStyle = fem ? (r() < 0.75 ? 'skirt' : 'pants') : (r() < 0.45 ? 'shorts' : 'pants');
      bag = 'backpack';
      bagColor = pick(r(), [C.strawberry, C.sky, C.matcha, C.mustard, C.taro, C.teal, C.caramel]);
      glasses = r() < 0.18 ? 'round' : 'none';
      if (r() < 0.2) {
        hat = 'cap';
        hatColor = pick(r(), [C.navy, C.strawberry, C.mustard, C.white]);
      }
      shoes = pick(r(), [C.white, C.black, C.white]);
      phone = 0.35 + r() * 0.5;
      break;
    case 'office':
      // A shirt or a blouse, a tie or a lanyard, dark trousers or a pencil skirt; glasses now and then; a tote.
      hair = fem ? pick(r(), ['bob', 'long', 'ponytail', 'bun']) : pick(r(), ['side', 'short', 'side', 'buzz']);
      top = pick(r(), [C.white, C.powder, C.white, C.pink, C.lilac, C.mint, C.sand]);
      longSleeves = r() < 0.55;
      neck = fem ? (r() < 0.6 ? 'lanyard' : 'collar') : (r() < 0.55 ? 'tie' : 'lanyard');
      neckColor = pick(r(), [C.strawberry, C.navy, C.matcha, C.maroon, C.caramel]);
      bottom = pick(r(), [C.charcoal, C.navy, C.black, C.khaki]);
      bottomStyle = fem && r() < 0.55 ? 'skirt' : 'pants';
      if (bottomStyle === 'skirt' && r() < 0.4) legColor = shade(C.black, 1.25);
      glasses = r() < 0.35 ? 'round' : 'none';
      bag = r() < 0.45 ? 'tote' : 'none';
      bagColor = pick(r(), [C.caramel, C.brown, C.black, C.tea]);
      shoes = pick(r(), [C.black, C.brown, C.black]);
      phone = 0.45 + r() * 0.45;
      break;
    case 'shipper':
      // A bright jacket and a helmet in a matching colour (no brand), dark trousers, often a box on the back.
      top = pick(r(), [C.matcha, C.caramel, C.strawberry, C.sky, C.mustard, C.teal]);
      longSleeves = true;
      neck = 'zip';
      neckColor = shade(top, 0.75);
      hat = 'helmet';
      hatColor = r() < 0.7 ? top : pick(r(), [C.white, C.black, C.mustard]);
      hair = pick(r(), mascHair);
      bottom = pick(r(), [C.charcoal, C.black, C.denim]);
      bag = r() < 0.6 ? 'box' : 'none';
      // Never jacket, helmet and box all in one colour (that reads as a delivery brand): the box is always another.
      bagColor = pick(r(), [C.mustard, C.strawberry, C.sky, C.white, C.charcoal].filter(c => c !== top));
      width += 0.06;
      phone = 0.55 + r() * 0.4;
      break;
    case 'elder':
      // Grey or white hair, a cardigan or áo bà ba, a bent back, often a cane; spectacles.
      height = 0.88 + r() * 0.08;
      stoop = 0.55 + r() * 0.45;
      hairColor = pick(r(), HAIR_OLD);
      hair = fem ? pick(r(), ['bun', 'bun', 'short', 'curly']) : pick(r(), ['bald', 'bald', 'short', 'side']);
      top = fem ? pick(r(), [C.plum, C.maroon, C.brown, C.teal, C.taro]) : pick(r(), [C.sand, C.olive, C.khaki, C.white,
        C.brown]);
      longSleeves = true;
      tunic = fem;
      bottom = fem ? pick(r(), [C.black, C.charcoal, C.brown]) : pick(r(), [C.brown, C.charcoal, C.khaki]);
      neck = fem ? 'none' : 'collar';
      cane = r() < 0.65;
      glasses = r() < 0.45 ? 'round' : 'none';
      if (!fem && r() < 0.3) {
        hat = 'cap';
        hatColor = pick(r(), [C.khaki, C.olive, C.brown]);
      }
      shoes = pick(r(), [C.brown, C.black]);
      phone = r() * 0.15;
      break;
    case 'homemaker':
      // Đồ bộ (a printed top and trousers to match), the market basket, a nón lá half the time.
      hair = fem ? pick(r(), ['bun', 'long', 'ponytail', 'bob', 'curly']) : pick(r(), mascHair);
      top = pick(r(), [C.pink, C.mint, C.lilac, C.peach, C.powder, C.tea, C.strawberry]);
      pattern = r() < 0.75 ? 'dots' : 'stripes';
      patternColor = shade(top, 1.55);
      bottom = r() < 0.6 ? shade(top, 0.92) : pick(r(), [C.black, C.charcoal, C.brown]);
      tunic = r() < 0.4;
      bag = 'basket';
      bagColor = '#c9944f';
      if (r() < 0.5) {
        hat = 'conical';
        hatColor = '#efd89f';
      }
      shoes = pick(r(), [C.brown, C.strawberry, C.black, C.sky]);
      phone = 0.1 + r() * 0.3;
      break;
    case 'kol':
      // Trendy colours, sunglasses, the phone held up, dyed hair now and then, a bucket hat or a cap, a sling bag.
      hair = fem ? pick(r(), femHair) : pick(r(), [...mascHair, 'long']);
      if (r() < 0.45) hairColor = pick(r(), HAIR_DYED);
      top = pick(r(), [C.taro, C.pink, C.mint, C.lilac, C.mustard, C.strawberry, C.black, C.white]);
      bottom = pick(r(), [C.cream, C.denim, C.black, C.sand, C.lilac]);
      bottomStyle = fem && r() < 0.5 ? 'skirt' : r() < 0.25 ? 'shorts' : 'pants';
      glasses = r() < 0.75 ? 'sun' : 'none';
      bag = 'sling';
      bagColor = pick(r(), [C.black, C.strawberry, C.white, C.caramel]);
      if (r() < 0.45) {
        hat = r() < 0.5 ? 'bucket' : 'cap';
        hatColor = pick(r(), [C.cream, C.black, C.lilac, C.mustard, C.mint]);
      }
      pattern = r() < 0.2 ? 'stripes' : 'none';
      patternColor = shade(top, 1.4);
      shoes = pick(r(), [C.white, C.white, C.black, C.pink]);
      phone = 1;
      break;
  }
  if (bottomStyle === 'shorts') legColor = skin;
  dims.shoulder *= width;
  dims.hip *= width;
  const tea = pick(r(), TEAS);
  return {
    look, archetype, fem, height, width, dims, skin, skinEdge: shade(skin, 0.74),
    hair, hairColor, hairEdge: shade(hairColor, hairColor === '#231a15' ? 0.55 : EDGE),
    hat, hatColor, hatEdge: shade(hatColor, EDGE), top, topEdge: shade(top, EDGE), longSleeves, tunic,
    bottom, bottomEdge: shade(bottom, EDGE), bottomStyle, legColor, shoes, neck, neckColor, pattern, patternColor,
    glasses, bag, bagColor, bagEdge: shade(bagColor, EDGE), cane, stoop, phone, tea, phaseOffset: r() * 100,
  };
}

// ── What they do ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AnimSel { clip: Clip; mood: Mood }

/** Leaving a queue for these is a stomp; for the rest (sold out, closed, a suspicious discount) a let-down shrug. */
const ANGRY_CAUSES: ReadonlySet<string> = new Set(['patience', 'priceUp']);
/** Clips of someone standing in a queue (a walk from one of these, still queued, is a shuffle forward). */
const QUEUE_CLIPS: ReadonlySet<Clip> = new Set<Clip>(['idle', 'phone', 'selfie', 'tap', 'crossed', 'shuffle']);
/** Impatience thresholds, as shares of the sim's patience: tapping, then arms crossed, then angry. */
export const TAP_AT = 0.45;
export const CROSS_AT = 0.7;
export const FUME_AT = 0.86;
/** How long a phone habit lasts before it is re-rolled (ticks). */
const HABIT_TICKS = 50;

const hash32 = (n: number) => {
  let h = Math.imul(n ^ 0x7feb352d, 0x846ca68b);
  h ^= h >>> 15;
  return (Math.imul(h, 0x2c1b3c6d) >>> 0) / 4294967296;
};

/** Whether someone with this phone habit has it out during the window of time `now` falls in. */
export function onPhone(tr: Pick<Traits, 'look' | 'phone'>, now: number): boolean {
  const w = Math.floor((now + (tr.look % 97)) / HABIT_TICKS);
  return hash32(tr.look ^ Math.imul(w + 1, 0x9e3779b1)) < tr.phone;
}

/** How much of their patience a queued customer has used (0..1+), or 0 when not queued. */
export function impatience(a: Pick<Actor, 'joinedAt'>, now: number,
  patienceTicks: number = CONFIG.rush.patienceTicks): number {
  return a.joinedAt === null ? 0 : Math.max(0, (now - a.joinedAt) / patienceTicks);
}

/** One shared answer per clip and face: selection runs for every actor every frame and allocates nothing. */
const SEL = {
  happy: { clip: 'happy', mood: 'happy' },
  puzzled: { clip: 'puzzled', mood: 'puzzled' },
  stomp: { clip: 'stomp', mood: 'angry' },
  shrug: { clip: 'shrug', mood: 'annoyed' },
  whisper: { clip: 'whisper', mood: 'scared' },
  lookBoard: { clip: 'lookBoard', mood: 'curious' },
  idle: { clip: 'idle', mood: 'neutral' },
  idleScared: { clip: 'idle', mood: 'scared' },
  walkDrink: { clip: 'walkDrink', mood: 'happy' },
  walkDrinkWrong: { clip: 'walkDrink', mood: 'annoyed' },
  walkAngry: { clip: 'walkAngry', mood: 'angry' },
  walkAnnoyed: { clip: 'walk', mood: 'annoyed' },
  walkCaneAnnoyed: { clip: 'walkCane', mood: 'annoyed' },
  walkScared: { clip: 'walkScared', mood: 'scared' },
  walkScaredIn: { clip: 'walk', mood: 'scared' },
  shuffle: { clip: 'shuffle', mood: 'neutral' },
  shuffleAnnoyed: { clip: 'shuffle', mood: 'annoyed' },
  walkCane: { clip: 'walkCane', mood: 'neutral' },
  walkPhone: { clip: 'walkPhone', mood: 'focus' },
  walk: { clip: 'walk', mood: 'neutral' },
  crossed: { clip: 'crossed', mood: 'annoyed' },
  crossedAngry: { clip: 'crossed', mood: 'angry' },
  tap: { clip: 'tap', mood: 'annoyed' },
  selfie: { clip: 'selfie', mood: 'happy' },
  phone: { clip: 'phone', mood: 'focus' },
} as const satisfies Record<string, AnimSel>;

/**
 * The clip and the face for an actor now. `prev` is the clip shown last frame (a walk straight out of a queue clip,
 * still queued, is a shuffle forward). The answer is shared: read it, do not change it.
 */
export function selectAnim(a: Readonly<Actor>, now: number, tr: Pick<Traits, 'look' | 'phone' | 'archetype' | 'cane'>,
  prev: Clip | null, patienceTicks: number = CONFIG.rush.patienceTicks): Readonly<AnimSel> {
  const angry = a.cause !== null && ANGRY_CAUSES.has(a.cause);
  switch (a.activity) {
    case 'served': return SEL.happy;
    case 'wrongCup': return SEL.puzzled;
    case 'abandon': return angry ? SEL.stomp : SEL.shrug;
    case 'lookBoard': return a.scared ? SEL.whisper : SEL.lookBoard;
    case 'queue': return queueAnim(a, now, tr, patienceTicks);
    case 'idle': return a.scared ? SEL.idleScared : SEL.idle;
    case 'walk':
      if (a.speed <= 0) {
        if (a.shop !== null) return queueAnim(a, now, tr, patienceTicks);
        return a.scared ? SEL.idleScared : SEL.idle;
      }
      if (a.carrying) return a.cupWrong ? SEL.walkDrinkWrong : SEL.walkDrink;
      if (angry) return SEL.walkAngry;
      if (a.cause !== null) return tr.cane ? SEL.walkCaneAnnoyed : SEL.walkAnnoyed;
      if (a.scared) return a.leaving ? SEL.walkScared : SEL.walkScaredIn;
      if (a.shop !== null && prev !== null && QUEUE_CLIPS.has(prev)) {
        return impatience(a, now, patienceTicks) >= TAP_AT ? SEL.shuffleAnnoyed : SEL.shuffle;
      }
      if (tr.cane) return SEL.walkCane;
      if (a.shop === null && !a.leaving && tr.phone >= 0.6 && onPhone(tr, now)) return SEL.walkPhone;
      return SEL.walk;
  }
}

function queueAnim(a: Readonly<Actor>, now: number, tr: Pick<Traits, 'look' | 'phone' | 'archetype'>,
  patienceTicks: number): Readonly<AnimSel> {
  const p = impatience(a, now, patienceTicks);
  if (p >= CROSS_AT) return p >= FUME_AT ? SEL.crossedAngry : SEL.crossed;
  if (p >= TAP_AT) return SEL.tap;
  if (tr.archetype === 'kol') return SEL.selfie;
  if (onPhone(tr, now)) return SEL.phone;
  return SEL.idle;
}

/** The view of the walk cycle for a heading. */
export const viewOf = (h: Heading): View => (h === 'up' ? 'back' : h === 'down' ? 'front' : 'side');

// ── Drawing ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Outline width, in heights. */
const OL = 0.02;
const ARM_W = 0.068;
const LEG_W = 0.084;
const HAND_R = 0.034;

/** What a figure has in hand and on its face this frame. */
export interface FigureFx {
  mood: Mood;
  blink: number;
  cup: boolean;
  phone: boolean;
}

type Ctx = CanvasRenderingContext2D;

function path3(ctx: Ctx, a: P, b: P, c: P): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
}

/** A limb as a thick round stroke with an outline. */
function limb(ctx: Ctx, a: P, b: P, c: P, w: number, fill: string, edge: string): void {
  path3(ctx, a, b, c);
  setStroke(ctx, edge, w + OL * 2);
  ctx.stroke();
  setStroke(ctx, fill, w);
  ctx.stroke();
}

function seg(ctx: Ctx, a: P, b: P, t: number, w: number, fill: string, edge: string): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  setStroke(ctx, edge, w + OL * 2);
  ctx.stroke();
  setStroke(ctx, fill, w);
  ctx.stroke();
}

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string, edge: string | null): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  setFill(ctx, fill);
  ctx.fill();
  if (edge !== null) {
    setStroke(ctx, edge, OL);
    ctx.stroke();
  }
}

/** Fill the current path, then outline it (styles through the pen: nothing set twice). */
function fillEdge(ctx: Ctx, fill: string, edge: string): void {
  setFill(ctx, fill);
  ctx.fill();
  setStroke(ctx, edge, OL);
  ctx.stroke();
}

/** Into a joint's frame and back out (cheaper than save/restore, and nothing else in the state changes). */
function enter(ctx: Ctx, at: P, angle: number): void {
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
}

function leave(ctx: Ctx, at: P, angle: number): void {
  ctx.rotate(-angle);
  ctx.translate(-at.x, -at.y);
}

/** A rounded rectangle path (no roundRect needed). */
function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function arm(ctx: Ctx, tr: Traits, s: P, e: P, h: P, far: boolean): void {
  const skin = far ? tr.skinEdge : tr.skin;
  const sleeve = far ? tr.topEdge : tr.top;
  const w = ARM_W * (0.92 + tr.width * 0.08);
  if (tr.longSleeves) {
    limb(ctx, s, e, h, w, sleeve, far ? shade(tr.top, 0.5) : tr.topEdge);
  } else {
    limb(ctx, s, e, h, w * 0.9, skin, tr.skinEdge);
    seg(ctx, s, e, 0.55, w * 1.12, sleeve, far ? shade(tr.top, 0.5) : tr.topEdge);
  }
  // The hand: a skin cap over the sleeve's end (bare arms end in a round cap already).
  if (tr.longSleeves) disc(ctx, h.x, h.y, HAND_R, skin, null);
}

function armPath(ctx: Ctx, a: P, b: P, c: P, t: number): void {
  ctx.moveTo(a.x, a.y);
  if (t >= 1) {
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
  } else {
    ctx.lineTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }
}

/** Both arms' paths (or their first `t` of the upper arm), one path, then outline and fill. */
function bothArms(ctx: Ctx, sk: Skeleton, lw: number, fill: string, edge: string, t: number): void {
  ctx.beginPath();
  armPath(ctx, sk.shoulder1, sk.elbow1, sk.hand1, t);
  armPath(ctx, sk.shoulder0, sk.elbow0, sk.hand0, t);
  setStroke(ctx, edge, lw + OL * 2);
  ctx.stroke();
  setStroke(ctx, fill, lw);
  ctx.stroke();
}

/** Both arms at once, facing us (same colours: one path per layer, half the strokes). */
function arms(ctx: Ctx, tr: Traits, sk: Skeleton): void {
  const w = ARM_W * (0.92 + tr.width * 0.08);
  if (tr.longSleeves) {
    bothArms(ctx, sk, w, tr.top, tr.topEdge, 1);
    ctx.beginPath();
    ctx.arc(sk.hand1.x, sk.hand1.y, HAND_R, 0, Math.PI * 2);
    ctx.moveTo(sk.hand0.x + HAND_R, sk.hand0.y);
    ctx.arc(sk.hand0.x, sk.hand0.y, HAND_R, 0, Math.PI * 2);
    setFill(ctx, tr.skin);
    ctx.fill();
  } else {
    bothArms(ctx, sk, w * 0.9, tr.skin, tr.skinEdge, 1);
    bothArms(ctx, sk, w * 1.12, tr.top, tr.topEdge, 0.55);
  }
}

function legPath(ctx: Ctx, h: P, k: P, f: P, t: number): void {
  ctx.moveTo(h.x, h.y);
  if (t >= 1) {
    ctx.lineTo(k.x, k.y);
    ctx.lineTo(f.x, f.y);
  } else {
    ctx.lineTo(h.x + (k.x - h.x) * t, h.y + (k.y - h.y) * t);
  }
}

function bothLegs(ctx: Ctx, sk: Skeleton, lw: number, fill: string, edge: string, t: number): void {
  ctx.beginPath();
  legPath(ctx, sk.hip1, sk.knee1, sk.foot1, t);
  legPath(ctx, sk.hip0, sk.knee0, sk.foot0, t);
  setStroke(ctx, edge, lw + OL * 2);
  ctx.stroke();
  setStroke(ctx, fill, lw);
  ctx.stroke();
}

/** Both legs at once (same colours, so one path per layer: half the strokes), then the shoes. */
function legs(ctx: Ctx, tr: Traits, sk: Skeleton, side: boolean): void {
  const w = LEG_W * (0.9 + tr.width * 0.1);
  if (tr.bottomStyle === 'pants') {
    bothLegs(ctx, sk, w, tr.bottom, tr.bottomEdge, 1);
  } else {
    bothLegs(ctx, sk, w * 0.82, tr.legColor, shade(tr.legColor, 0.74), 1);
    if (tr.bottomStyle === 'shorts') bothLegs(ctx, sk, w * 1.1, tr.bottom, tr.bottomEdge, 0.8);
  }
  if (side) {
    shoesSide(ctx, tr, sk);
    return;
  }
  ctx.beginPath();
  ctx.ellipse(sk.foot1.x, sk.foot1.y + 0.014, 0.036, 0.024, 0, 0, Math.PI * 2);
  ctx.moveTo(sk.foot0.x + 0.036, sk.foot0.y + 0.014);
  ctx.ellipse(sk.foot0.x, sk.foot0.y + 0.014, 0.036, 0.024, 0, 0, Math.PI * 2);
  fillEdge(ctx, tr.shoes, shade(tr.shoes, tr.shoes === C.black ? 1.6 : 0.6));
}

/** Both shoes side-on, rounded toes forward, in one path. */
function shoesSide(ctx: Ctx, tr: Traits, sk: Skeleton): void {
  ctx.beginPath();
  ctx.ellipse(sk.foot1.x + 0.022, sk.foot1.y + 0.013, 0.048, 0.026, 0, 0, Math.PI * 2);
  ctx.moveTo(sk.foot0.x + 0.07, sk.foot0.y + 0.013);
  ctx.ellipse(sk.foot0.x + 0.022, sk.foot0.y + 0.013, 0.048, 0.026, 0, 0, Math.PI * 2);
  fillEdge(ctx, tr.shoes, shade(tr.shoes, tr.shoes === C.black ? 1.6 : 0.6));
}

/** The torso's path in its own frame (origin at the hip, up the spine is −y). */
function torsoPath(ctx: Ctx, wTop: number, wBottom: number, len: number, below: number): void {
  const r = 0.055;
  ctx.beginPath();
  ctx.moveTo(-wBottom / 2, below - 0.02);
  ctx.lineTo(-wTop / 2, -len + r);
  ctx.quadraticCurveTo(-wTop / 2, -len, -wTop / 2 + r, -len);
  ctx.lineTo(wTop / 2 - r, -len);
  ctx.quadraticCurveTo(wTop / 2, -len, wTop / 2, -len + r);
  ctx.lineTo(wBottom / 2, below - 0.02);
  ctx.quadraticCurveTo(wBottom / 2, below, wBottom / 2 - 0.02, below);
  ctx.lineTo(-wBottom / 2 + 0.02, below);
  ctx.quadraticCurveTo(-wBottom / 2, below, -wBottom / 2, below - 0.02);
  ctx.closePath();
}

/** The top (and a skirt under it, the print, the neckwear) in the torso's frame, `len` long. */
function torsoShape(ctx: Ctx, tr: Traits, view: View, len: number): void {
  const side = view === 'side';
  const wTop = (side ? 0.15 : 0.215) * tr.width;
  const wBottom = (side ? 0.16 : 0.2) * tr.width * (tr.tunic ? 1.12 : 1);
  const below = tr.tunic ? 0.085 : 0.035;
  // Skirt first: under the top, flaring to the knees.
  if (tr.bottomStyle === 'skirt') {
    const sw = side ? 0.17 : 0.21;
    ctx.beginPath();
    ctx.moveTo(-wBottom / 2 + 0.005, -0.02);
    ctx.lineTo(wBottom / 2 - 0.005, -0.02);
    ctx.lineTo(sw / 2 * tr.width + 0.02, 0.115);
    ctx.quadraticCurveTo(0, 0.13, -sw / 2 * tr.width - 0.02, 0.115);
    ctx.closePath();
    fillEdge(ctx, tr.bottom, tr.bottomEdge);
  }
  torsoPath(ctx, wTop, wBottom, len, below);
  fillEdge(ctx, view === 'back' ? shade(tr.top, 0.94) : tr.top, tr.topEdge);
  // The print, kept inside the top (no clipping: it is costly).
  if (tr.pattern === 'dots') {
    setFill(ctx, tr.patternColor);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const x = ((i * 0.37) % 1 - 0.5) * wTop * 0.7;
      const y = -len * (0.15 + (i * 0.29 % 1) * 0.75);
      ctx.moveTo(x + 0.016, y);
      ctx.arc(x, y, 0.016, 0, Math.PI * 2);
    }
    ctx.fill();
  } else if (tr.pattern === 'stripes') {
    setStroke(ctx, tr.patternColor, 0.022, 'butt');
    ctx.beginPath();
    const half = Math.min(wTop, wBottom) / 2 - 0.012;
    for (let y = -len + 0.06; y < below - 0.02; y += 0.06) {
      ctx.moveTo(-half, y);
      ctx.lineTo(half, y);
    }
    ctx.stroke();
  }
  if (view !== 'back') neckwear(ctx, tr, len, wTop, side);
}

function neckwear(ctx: Ctx, tr: Traits, len: number, wTop: number, side: boolean): void {
  const top = -len;
  const fx = side ? wTop * 0.3 : 0;
  switch (tr.neck) {
    case 'scarf': {
      // Khăn quàng đỏ: a knot under the chin and two tails.
      ctx.beginPath();
      ctx.moveTo(fx - 0.05, top + 0.005);
      ctx.lineTo(fx + 0.05, top + 0.005);
      ctx.lineTo(fx + 0.012, top + 0.04);
      ctx.lineTo(fx + 0.03, top + 0.1);
      ctx.lineTo(fx, top + 0.085);
      ctx.lineTo(fx - 0.03, top + 0.1);
      ctx.lineTo(fx - 0.012, top + 0.04);
      ctx.closePath();
      fillEdge(ctx, tr.neckColor, shade(tr.neckColor, 0.65));
      return;
    }
    case 'collar':
    case 'tie':
    case 'lanyard': {
      // White collar points.
      ctx.beginPath();
      ctx.moveTo(fx - 0.055, top + 0.003);
      ctx.lineTo(fx, top + 0.035);
      ctx.lineTo(fx - 0.03, top + 0.05);
      ctx.closePath();
      ctx.moveTo(fx + 0.055, top + 0.003);
      ctx.lineTo(fx, top + 0.035);
      ctx.lineTo(fx + 0.03, top + 0.05);
      ctx.closePath();
      fillEdge(ctx, tr.top === C.white ? '#ffffff' : shade(tr.top, 1.5), shade(tr.top, 0.7));
      if (tr.neck === 'tie') {
        ctx.beginPath();
        ctx.moveTo(fx - 0.014, top + 0.03);
        ctx.lineTo(fx + 0.014, top + 0.03);
        ctx.lineTo(fx + 0.022, top + len * 0.62);
        ctx.lineTo(fx, top + len * 0.72);
        ctx.lineTo(fx - 0.022, top + len * 0.62);
        ctx.closePath();
        fillEdge(ctx, tr.neckColor, shade(tr.neckColor, 0.6));
      } else if (tr.neck === 'lanyard') {
        ctx.beginPath();
        ctx.moveTo(fx - 0.05, top + 0.01);
        ctx.lineTo(fx, top + len * 0.5);
        ctx.lineTo(fx + 0.05, top + 0.01);
        setStroke(ctx, tr.neckColor, 0.014);
        ctx.stroke();
        rrect(ctx, fx - 0.03, top + len * 0.48, 0.06, 0.07, 0.012);
        fillEdge(ctx, '#ffffff', shade(tr.neckColor, 0.7));
        setFill(ctx, tr.neckColor);
        ctx.fillRect(fx - 0.03, top + len * 0.48, 0.06, 0.018);
      }
      return;
    }
    case 'zip': {
      // A jacket: a stand-up collar and the zip.
      ctx.beginPath();
      ctx.moveTo(fx, top + 0.01);
      ctx.lineTo(fx, top + len + 0.02);
      setStroke(ctx, tr.neckColor, 0.014);
      ctx.stroke();
      rrect(ctx, fx - 0.06, top - 0.012, 0.12, 0.035, 0.015);
      fillEdge(ctx, shade(tr.top, 0.9), tr.topEdge);
      // A reflective band across the chest.
      setFill(ctx, 'rgba(255, 252, 247, 0.55)');
      ctx.fillRect(-wTop / 2, top + len * 0.42, wTop, 0.022);
      return;
    }
    case 'none':
      return;
  }
}

// ── Heads ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Hair that hangs behind the head (long hair, a bun, a ponytail, pigtails): drawn before the head. */
function hairBehind(ctx: Ctx, tr: Traits, r: number, view: View): void {
  const s = tr.hair;
  if (tr.hat === 'helmet' || tr.hat === 'conical') {
    if (s !== 'long') return;
  }
  ctx.beginPath();
  let any = false;
  if (s === 'long') {
    any = true;
    if (view === 'side') rrect(ctx, -r * 1.12, -r * 0.4, r * 1.45, r * 2.05, r * 0.55);
    else rrect(ctx, -r * 1.12, -r * 0.3, r * 2.24, r * 1.95, r * 0.6);
  } else if (s === 'ponytail') {
    any = true;
    if (view === 'side') {
      ctx.moveTo(-r * 0.7, -r * 0.55);
      ctx.quadraticCurveTo(-r * 1.65, -r * 0.4, -r * 1.35, r * 0.9);
      ctx.quadraticCurveTo(-r * 1.0, r * 0.2, -r * 0.6, -r * 0.1);
      ctx.closePath();
    } else if (view === 'back') {
      ctx.ellipse(0, r * 0.75, r * 0.32, r * 0.7, 0, 0, Math.PI * 2);
    } else {
      any = false;
    }
  } else if (s === 'bun') {
    any = true;
    const old = tr.archetype === 'elder';
    if (view === 'side') ctx.arc(-r * 0.78, old ? r * 0.05 : -r * 0.75, r * 0.4, 0, Math.PI * 2);
    else if (view === 'back') ctx.arc(0, old ? r * 0.25 : -r * 0.8, r * 0.42, 0, Math.PI * 2);
    else ctx.arc(0, -r * 1.02, r * 0.4, 0, Math.PI * 2);
  } else if (s === 'twin') {
    any = true;
    if (view === 'side') {
      ctx.ellipse(-r * 0.75, r * 0.45, r * 0.28, r * 0.5, 0.35, 0, Math.PI * 2);
    } else {
      ctx.ellipse(r * 1.08, r * 0.4, r * 0.27, r * 0.5, -0.3, 0, Math.PI * 2);
      ctx.moveTo(-r * 1.08 + r * 0.27, r * 0.4);
      ctx.ellipse(-r * 1.08, r * 0.4, r * 0.27, r * 0.5, 0.3, 0, Math.PI * 2);
    }
  }
  if (any) fillEdge(ctx, tr.hairColor, tr.hairEdge);
}

/** The hair on the head, by style and view. */
function hairOn(ctx: Ctx, tr: Traits, r: number, view: View): void {
  const s = tr.hair;
  const R = r * 1.07;
  const helmet = tr.hat === 'helmet';
  ctx.beginPath();
  if (view === 'back') {
    if (s === 'bald') {
      // A narrow band of white round the back of the head at ear height, the crown bare above it.
      ctx.arc(0, 0, R, 0.05, Math.PI - 0.05);
      ctx.arc(0, -r * 0.2, R * 0.93, Math.PI - 0.2, 0.2, true);
      ctx.closePath();
    } else if (s === 'bob') {
      ctx.arc(0, 0, R, Math.PI * 0.85, Math.PI * 0.15);
      ctx.lineTo(R * 0.98, r * 0.62);
      ctx.lineTo(-R * 0.98, r * 0.62);
      ctx.closePath();
    } else {
      ctx.arc(0, 0, R, 0, Math.PI * 2);
    }
    // A shade darker from behind (out of the light), so grey and white hair never pass for a pale face.
    fillEdge(ctx, s === 'bald' ? tr.hairColor : shade(tr.hairColor, 0.84), tr.hairEdge);
    if (s === 'curly') curls(ctx, tr, r, 9, Math.PI, Math.PI * 2);
    if (s !== 'bald' && s !== 'curly') {
      // Strands from the crown and the nape of the neck below: it reads as the back of a head, never a face.
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.75);
      ctx.quadraticCurveTo(-r * 0.15, 0, -r * 0.05, R * 0.8);
      ctx.moveTo(-r * 0.3, -R * 0.65);
      ctx.quadraticCurveTo(-r * 0.55, 0, -r * 0.45, R * 0.72);
      ctx.moveTo(r * 0.3, -R * 0.65);
      ctx.quadraticCurveTo(r * 0.5, 0, r * 0.4, R * 0.74);
      setStroke(ctx, tr.hairEdge, r * 0.07);
      ctx.stroke();
      if (s !== 'long' && s !== 'bob') {
        ctx.beginPath();
        ctx.ellipse(0, R * 0.98, r * 0.34, r * 0.17, 0, 0, Math.PI);
        fillEdge(ctx, tr.skin, tr.skinEdge);
      }
    }
    return;
  }
  if (view === 'side') {
    if (s === 'bald') {
      // A fringe of white round the back of the head, under the bare crown.
      ctx.arc(0, 0, R, Math.PI * 0.55, Math.PI * 1.12);
      ctx.quadraticCurveTo(-r * 0.55, -r * 0.05, -r * 0.42, r * 0.62);
      ctx.closePath();
      fillEdge(ctx, tr.hairColor, tr.hairEdge);
      return;
    }
    const low = s === 'bob' || s === 'long' ? r * 0.75 : s === 'buzz' ? r * 0.2 : r * 0.45;
    const front = s === 'buzz' ? -r * 0.62 : -r * 0.42;
    ctx.moveTo(r * 0.25, -R * 0.97);
    ctx.arc(0, 0, R, -1.32, Math.PI * 0.62, true);
    ctx.lineTo(-r * 0.92, low);
    ctx.lineTo(-r * 0.25, low * 0.6);
    ctx.quadraticCurveTo(-r * 0.12, -r * 0.2, r * 0.25, front * 0.75);
    if (s === 'side' || s === 'spiky') {
      ctx.quadraticCurveTo(r * 0.7, -r * 0.2, r * 1.0, front * 0.6);
    } else {
      ctx.quadraticCurveTo(r * 0.6, front * 0.95, r * 0.95, front * 0.75);
    }
    ctx.quadraticCurveTo(R * 0.9, -R * 0.7, r * 0.25, -R * 0.97);
    ctx.closePath();
    fillEdge(ctx, tr.hairColor, tr.hairEdge);
    if (s === 'spiky' && !helmet) spikes(ctx, tr, r, true);
    if (s === 'curly' && !helmet) curls(ctx, tr, r, 7, Math.PI * 1.05, Math.PI * 1.75);
    return;
  }
  // Facing us.
  switch (s) {
    case 'bald':
      ctx.ellipse(-r * 0.92, r * 0.02, r * 0.2, r * 0.34, 0.2, 0, Math.PI * 2);
      ctx.moveTo(r * 0.92 + r * 0.2, r * 0.02);
      ctx.ellipse(r * 0.92, r * 0.02, r * 0.2, r * 0.34, -0.2, 0, Math.PI * 2);
      fillEdge(ctx, tr.hairColor, tr.hairEdge);
      return;
    case 'bob':
    case 'long':
      ctx.moveTo(-R, r * 0.62);
      ctx.lineTo(-R, 0);
      ctx.arc(0, 0, R, Math.PI, Math.PI * 2);
      ctx.lineTo(R, r * 0.62);
      ctx.lineTo(r * 0.72, r * 0.62);
      ctx.lineTo(r * 0.74, -r * 0.18);
      ctx.quadraticCurveTo(0, -r * 0.08, -r * 0.74, -r * 0.18);
      ctx.lineTo(-r * 0.72, r * 0.62);
      ctx.closePath();
      break;
    case 'buzz':
      ctx.arc(0, 0, r * 1.03, Math.PI * 1.08, Math.PI * 1.92);
      ctx.quadraticCurveTo(0, -r * 0.62, -r * 1.03 * Math.cos(Math.PI * 0.08), -r * 1.03 * Math.sin(Math.PI * 0.08));
      ctx.closePath();
      break;
    case 'side':
      ctx.moveTo(-R, r * 0.15);
      ctx.arc(0, 0, R, Math.PI * 1.04, Math.PI * 1.98);
      ctx.lineTo(r * 0.98, r * 0.05);
      ctx.quadraticCurveTo(r * 0.55, -r * 0.3, -r * 0.35, -r * 0.42);
      ctx.quadraticCurveTo(-r * 0.75, -r * 0.3, -r * 0.82, r * 0.15);
      ctx.closePath();
      break;
    case 'twin':
    case 'ponytail':
    case 'bun':
      // Centre-parted or with a soft fringe.
      ctx.moveTo(-R, r * 0.2);
      ctx.arc(0, 0, R, Math.PI * 1.02, Math.PI * 1.98);
      ctx.lineTo(R * 0.96, r * 0.2);
      ctx.quadraticCurveTo(r * 0.75, -r * 0.35, s === 'twin' ? r * 0.3 : 0, -r * 0.42);
      ctx.quadraticCurveTo(-r * 0.75, -r * 0.35, -R * 0.96, r * 0.2);
      ctx.closePath();
      break;
    default:
      // Short, spiky, curly: a cap with a scalloped fringe.
      ctx.moveTo(-R, r * 0.1);
      ctx.arc(0, 0, R, Math.PI * 1.03, Math.PI * 1.97);
      ctx.lineTo(r * 0.92, r * 0.05);
      ctx.quadraticCurveTo(r * 0.75, -r * 0.42, r * 0.42, -r * 0.3);
      ctx.quadraticCurveTo(r * 0.2, -r * 0.5, 0, -r * 0.34);
      ctx.quadraticCurveTo(-r * 0.25, -r * 0.5, -r * 0.45, -r * 0.3);
      ctx.quadraticCurveTo(-r * 0.78, -r * 0.42, -r * 0.92, r * 0.05);
      ctx.closePath();
  }
  fillEdge(ctx, tr.hairColor, tr.hairEdge);
  if (s === 'spiky' && !helmet) spikes(ctx, tr, r, false);
  if (s === 'curly' && !helmet) curls(ctx, tr, r, 8, Math.PI * 1.02, Math.PI * 1.98);
}

function spikes(ctx: Ctx, tr: Traits, r: number, side: boolean): void {
  ctx.beginPath();
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (side ? 1.15 + i * 0.16 : 1.2 + i * 0.2);
    const b = a + 0.22;
    ctx.moveTo(Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.98);
    ctx.lineTo(Math.cos(a + 0.11) * r * 1.38, Math.sin(a + 0.11) * r * 1.38);
    ctx.lineTo(Math.cos(b) * r * 0.98, Math.sin(b) * r * 0.98);
  }
  fillEdge(ctx, tr.hairColor, tr.hairEdge);
}

function curls(ctx: Ctx, tr: Traits, r: number, n: number, from: number, to: number): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = from + ((to - from) * i) / (n - 1);
    const x = Math.cos(a) * r * 1.02;
    const y = Math.sin(a) * r * 1.02;
    ctx.moveTo(x + r * 0.26, y);
    ctx.arc(x, y, r * 0.26, 0, Math.PI * 2);
  }
  fillEdge(ctx, tr.hairColor, tr.hairEdge);
}

/** Where the nón lá's ribs run, as shares of the way down from its tip. */
const CONE_RIBS = [0.4, 0.68] as const;

function hatOn(ctx: Ctx, tr: Traits, r: number, view: View): void {
  const side = view === 'side';
  switch (tr.hat) {
    case 'none':
      return;
    case 'helmet': {
      ctx.beginPath();
      ctx.arc(0, -r * 0.22, r * 1.18, Math.PI * 1.02, Math.PI * 1.98);
      ctx.closePath();
      fillEdge(ctx, tr.hatColor, tr.hatEdge);
      // A lighter stripe over the crown, the rim, a visor side-on, the chin strap.
      ctx.beginPath();
      ctx.arc(0, -r * 0.22, r * 0.9, Math.PI * 1.35, Math.PI * 1.65);
      ctx.strokeStyle = 'rgba(255, 252, 247, 0.6)';
      ctx.lineWidth = r * 0.16;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 1.12, -r * 0.25);
      ctx.lineTo(r * 1.12, -r * 0.25);
      ctx.strokeStyle = tr.hatEdge;
      ctx.lineWidth = r * 0.16;
      ctx.stroke();
      if (side) {
        ctx.beginPath();
        ctx.moveTo(r * 0.85, -r * 0.32);
        ctx.quadraticCurveTo(r * 1.5, -r * 0.34, r * 1.45, -r * 0.16);
        ctx.lineTo(r * 0.9, -r * 0.16);
        ctx.closePath();
        fillEdge(ctx, shade(tr.hatColor, 0.7), tr.hatEdge);
      }
      if (view !== 'back') {
        ctx.beginPath();
        ctx.moveTo(side ? -r * 0.15 : -r * 0.85, -r * 0.05);
        ctx.quadraticCurveTo(side ? r * 0.2 : 0, r * 1.2, side ? r * 0.55 : r * 0.85, -r * 0.05);
        ctx.strokeStyle = shade(tr.hatColor, 0.5);
        ctx.lineWidth = r * 0.07;
        ctx.stroke();
      }
      return;
    }
    case 'conical': {
      // Nón lá: a wide cone with its ribs.
      ctx.beginPath();
      ctx.moveTo(0, -r * 2.0);
      ctx.lineTo(r * 2.0, -r * 0.32);
      ctx.quadraticCurveTo(0, -r * 0.08, -r * 2.0, -r * 0.32);
      ctx.closePath();
      fillEdge(ctx, tr.hatColor, tr.hatEdge);
      ctx.beginPath();
      for (let i = 0; i < CONE_RIBS.length; i++) {
        const k = CONE_RIBS[i];
        ctx.moveTo(-r * 2.0 * k, -r * (2.0 - 1.62 * k));
        ctx.quadraticCurveTo(0, -r * (2.0 - 1.62 * k) + r * 0.14 * k, r * 2.0 * k, -r * (2.0 - 1.62 * k));
      }
      ctx.strokeStyle = shade(tr.hatColor, 0.8);
      ctx.lineWidth = r * 0.06;
      ctx.stroke();
      return;
    }
    case 'cap': {
      ctx.beginPath();
      ctx.arc(0, -r * 0.12, r * 1.1, Math.PI * 1.02, Math.PI * 1.98);
      ctx.closePath();
      fillEdge(ctx, tr.hatColor, tr.hatEdge);
      ctx.beginPath();
      if (side) {
        ctx.moveTo(r * 0.6, -r * 0.2);
        ctx.quadraticCurveTo(r * 1.65, -r * 0.3, r * 1.6, -r * 0.08);
        ctx.lineTo(r * 0.6, -r * 0.06);
      } else if (view === 'front') {
        ctx.ellipse(0, -r * 0.16, r * 0.95, r * 0.2, 0, 0, Math.PI * 2);
      } else {
        ctx.ellipse(0, -r * 0.16, r * 0.4, r * 0.08, 0, 0, Math.PI * 2);
      }
      fillEdge(ctx, shade(tr.hatColor, 0.86), tr.hatEdge);
      return;
    }
    case 'bucket': {
      ctx.beginPath();
      ctx.moveTo(-r * 1.45, r * 0.08);
      ctx.lineTo(-r * 0.98, -r * 0.3);
      ctx.arc(0, -r * 0.3, r * 0.98, Math.PI, Math.PI * 2);
      ctx.lineTo(r * 1.45, r * 0.08);
      ctx.quadraticCurveTo(0, -r * 0.08, -r * 1.45, r * 0.08);
      ctx.closePath();
      fillEdge(ctx, tr.hatColor, tr.hatEdge);
      ctx.beginPath();
      ctx.moveTo(-r * 1.0, -r * 0.28);
      ctx.quadraticCurveTo(0, -r * 0.4, r * 1.0, -r * 0.28);
      ctx.strokeStyle = tr.hatEdge;
      ctx.lineWidth = r * 0.06;
      ctx.stroke();
      return;
    }
  }
}

function glassesOn(ctx: Ctx, tr: Traits, r: number, side: boolean, nod: number): void {
  if (tr.glasses === 'none') return;
  const e = eyeSpots(r, side, nod);
  const gr = r * 0.25;
  ctx.lineWidth = r * 0.08;
  ctx.strokeStyle = '#2a1d15';
  if (tr.glasses === 'sun') {
    ctx.fillStyle = '#2a1d15';
    ctx.beginPath();
    ctx.ellipse(e.near, e.y, gr * 1.15, gr * 0.85, 0, 0, Math.PI * 2);
    ctx.moveTo(e.far + gr * (side ? 0.9 : 1.15), e.y);
    ctx.ellipse(e.far, e.y, gr * (side ? 0.9 : 1.15), gr * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 252, 247, 0.45)';
    ctx.beginPath();
    ctx.ellipse(e.near + gr * 0.3, e.y - gr * 0.3, gr * 0.3, gr * 0.16, -0.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(e.near, e.y, gr, 0, Math.PI * 2);
    ctx.moveTo(e.far + gr * 0.9, e.y);
    ctx.arc(e.far, e.y, gr * (side ? 0.9 : 1), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(e.far + gr * 0.9, e.y);
  ctx.lineTo(e.near - gr, e.y);
  if (side) {
    ctx.moveTo(e.far - gr * 0.9, e.y);
    ctx.lineTo(-r * 0.15, e.y - r * 0.05);
  }
  ctx.stroke();
}

/** Behind the face: hair hanging behind, the ears, the head. */
function headUnder(ctx: Ctx, tr: Traits, r: number, view: View): void {
  const side = view === 'side';
  hairBehind(ctx, tr, r, view);
  // Ears, then the head.
  if (side) {
    disc(ctx, -r * 0.12, r * 0.12, r * 0.2, tr.skin, tr.skinEdge);
  } else if (view === 'front') {
    ctx.beginPath();
    ctx.arc(-r * 0.96, r * 0.12, r * 0.18, 0, Math.PI * 2);
    ctx.moveTo(r * 1.14, r * 0.12);
    ctx.arc(r * 0.96, r * 0.12, r * 0.18, 0, Math.PI * 2);
    fillEdge(ctx, tr.skin, tr.skinEdge);
  }
  disc(ctx, 0, 0, r, tr.skin, tr.skinEdge);
}

/** Over the face: the hair, the ears from behind, the hat. */
function headOver(ctx: Ctx, tr: Traits, r: number, view: View): void {
  hairOn(ctx, tr, r, view);
  // From behind the ears stick out past the hair, so the back of a head never reads as a face.
  if (view === 'back' && tr.hat !== 'helmet') {
    ctx.beginPath();
    ctx.arc(-r * 1.0, r * 0.14, r * 0.17, 0, Math.PI * 2);
    ctx.moveTo(r * 1.17, r * 0.14);
    ctx.arc(r * 1.0, r * 0.14, r * 0.17, 0, Math.PI * 2);
    fillEdge(ctx, tr.skin, tr.skinEdge);
  }
  hatOn(ctx, tr, r, view);
}

// ── Recorded parts ──────────────────────────────────────────────────────────────────────────────────────────────

/** A part drawn once per look (and view, and one number) into a recording: (ctx, traits, view, n). */
type PartFn = (ctx: Ctx, tr: Traits, view: View, n: number) => void;

/** Parts per look; faces per head size and expression (shared by everyone). */
const parts = new RecordingCache(6000);
const faces = new RecordingCache(4000);

const VIEW_INDEX: Record<View, number> = { side: 0, front: 1, back: 2 };
const enum Part { HeadUnder = 1, HeadOver, Torso, PackBehind, PackOver, Sling, Glasses, Cup, Basket, Tote }

function recordPart(fn: PartFn, tr: Traits, view: View, n: number): Recording {
  const r = new Recorder();
  fn(r as unknown as Ctx, tr, view, n);
  return r.ops;
}

/** Draws a part from its recording (made the first time); live where there is no Path2D. */
function part(ctx: Ctx, id: Part, fn: PartFn, tr: Traits, view: View, n: number, extra = 0): void {
  const key = id * 1000 + VIEW_INDEX[view] * 100 + extra;
  let ops = parts.get(tr.look, key);
  if (ops === undefined) {
    if (!canRecord()) {
      fn(ctx, tr, view, n);
      penForget();
      return;
    }
    ops = parts.put(tr.look, key, recordPart(fn, tr, view, n));
  }
  replay(ctx, ops);
}

const ORIGIN: P = { x: 0, y: 0 };
const underPart: PartFn = (c, tr, view) => headUnder(c, tr, tr.dims.headR, view);
const overPart: PartFn = (c, tr, view) => headOver(c, tr, tr.dims.headR, view);
const glassesPart: PartFn = (c, tr, view, nod) => glassesOn(c, tr, tr.dims.headR, view === 'side', nod);
const cupPart: PartFn = (c, tr) => cup(c, 0, 0, tr.tea);
const basketPart: PartFn = (c, tr) => basket(c, tr, ORIGIN);
const totePart: PartFn = (c, tr) => tote(c, tr, ORIGIN);

/**
 * A torso-frame part (the top, a pack, a sling), recorded at the torso's rest length and stretched to the breathing
 * length of the moment (a couple of percent: invisible in the outline width).
 */
function torsoPart(ctx: Ctx, id: Part, fn: PartFn, tr: Traits, sk: Skeleton, view: View): void {
  const rest = tr.dims.torso;
  const k = sk.torsoLen / rest;
  enter(ctx, sk.hip, sk.torsoAngle);
  ctx.scale(1, k);
  part(ctx, id, fn, tr, view, id === Part.Torso ? rest + 0.01 : rest);
  ctx.scale(1, 1 / k);
  leave(ctx, sk.hip, sk.torsoAngle);
}

const torsoFn: PartFn = (c, tr, view, len) => torsoShape(c, tr, view, len);

function torso(ctx: Ctx, tr: Traits, sk: Skeleton, view: View): void {
  torsoPart(ctx, Part.Torso, torsoFn, tr, sk, view);
}

function pack(ctx: Ctx, tr: Traits, sk: Skeleton, view: View, layer: 'behind' | 'over'): void {
  const over = layer === 'over';
  if (!packShows(tr, view, over)) return;
  torsoPart(ctx, over ? Part.PackOver : Part.PackBehind, over ? packOverShape : packBehindShape, tr, sk, view);
}

function sling(ctx: Ctx, tr: Traits, sk: Skeleton, view: View): void {
  if (tr.bag !== 'sling' || view === 'back') return;
  torsoPart(ctx, Part.Sling, slingShape, tr, sk, view);
}

/** Reused for every face drawn (no allocation per frame). */
const FACE: FaceInput = { mood: 'neutral', r: 1, side: false, lookX: 0, lookY: 0, blink: 0, nod: 0 };

const MOOD_INDEX: Record<Mood, number> = {
  neutral: 0, happy: 1, annoyed: 2, angry: 3, puzzled: 4, scared: 5, focus: 6, curious: 7,
};
/** Faces are kept at eighths of gaze and twentieths of nod: finer than a pixel on the street. */
const q = (v: number, steps: number) => Math.round(clamp(v, -1.5, 1.5) * steps) + 2 * steps;

/** The face, from the shared recordings. */
function face(ctx: Ctx, f: FaceInput): void {
  const lx = q(f.lookX, 8);
  const ly = q(f.lookY, 8);
  const nod = q(f.nod, 20);
  f.lookX = (lx - 16) / 8;
  f.lookY = (ly - 16) / 8;
  f.nod = (nod - 40) / 20;
  f.blink = f.blink > 0.5 ? 1 : 0;
  const k1 = Math.round(f.r * 1000);
  const k2 = ((((MOOD_INDEX[f.mood] * 2 + (f.side ? 1 : 0)) * 2 + f.blink) * 64 + lx) * 64 + ly) * 128 + nod;
  let ops = faces.get(k1, k2);
  if (ops === undefined) {
    if (!canRecord()) {
      drawFace(ctx, f);
      penForget();
      return;
    }
    const r = new Recorder();
    drawFace(r as unknown as Ctx, f);
    ops = faces.put(k1, k2, r.ops);
  }
  replay(ctx, ops);
}

function head(ctx: Ctx, tr: Traits, sk: Skeleton, view: View, pose: Readonly<Pose>, fx: FigureFx): void {
  enter(ctx, sk.head, sk.headAngle);
  part(ctx, Part.HeadUnder, underPart, tr, view, 0);
  const f = FACE;
  if (view !== 'back') {
    f.mood = fx.mood;
    f.r = tr.dims.headR;
    f.side = view === 'side';
    f.lookX = pose.lookX;
    f.lookY = pose.lookY;
    f.blink = fx.blink;
    f.nod = pose.nod;
    face(ctx, f);
  }
  part(ctx, Part.HeadOver, overPart, tr, view, 0);
  if (view !== 'back' && tr.glasses !== 'none') {
    const nod = q(pose.nod, 20);
    // Sunglasses would hide what someone feels: upset, they push them up onto the head and the eyes show.
    const up = tr.glasses === 'sun' && BROW_MOODS.has(fx.mood) ? -tr.dims.headR * 0.62 : 0;
    if (up !== 0) ctx.translate(0, up);
    part(ctx, Part.Glasses, glassesPart, tr, view, (nod - 40) / 20, nod);
    if (up !== 0) ctx.translate(0, -up);
  }
  leave(ctx, sk.head, sk.headAngle);
}

// ── Things carried ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A cup of milk tea with a dome lid and a straw, held at (x, y). */
export function cup(ctx: Ctx, x: number, y: number, tea: string, s = 1): void {
  const w = 0.085 * s;
  const h = 0.11 * s;
  const top = y - h * 0.62;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, top);
  ctx.lineTo(x + w / 2, top);
  ctx.lineTo(x + w * 0.38, top + h);
  ctx.lineTo(x - w * 0.38, top + h);
  ctx.closePath();
  fillEdge(ctx, tea, shade(tea, 0.6));
  // Pearls at the bottom, the lid, the straw.
  setFill(ctx, '#3a271c');
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const bx = x + (i - 1) * w * 0.24;
    ctx.moveTo(bx + w * 0.1, top + h * 0.8);
    ctx.arc(bx, top + h * 0.8, w * 0.1, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, top, w * 0.56, w * 0.24, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  fillEdge(ctx, 'rgba(255, 252, 247, 0.92)', 'rgba(110, 91, 77, 0.6)');
  ctx.beginPath();
  ctx.moveTo(x + w * 0.1, top - w * 0.15);
  ctx.lineTo(x + w * 0.32, top - h * 0.62);
  setStroke(ctx, '#de4f5a', 0.018 * s);
  ctx.stroke();
}

function phoneAt(ctx: Ctx, x: number, y: number, screen: boolean): void {
  rrect(ctx, x - 0.026, y - 0.075, 0.052, 0.085, 0.012);
  fillEdge(ctx, screen ? '#cfe9f5' : '#3a3338', '#1f1a1c');
  if (!screen) {
    setFill(ctx, '#6e6670');
    ctx.beginPath();
    ctx.arc(x - 0.01, y - 0.06, 0.006, 0, Math.PI * 2);
    ctx.fill();
  }
}

function basket(ctx: Ctx, tr: Traits, h: P): void {
  const x = h.x;
  const y = h.y + 0.02;
  // Greens sticking out, the woven body, the handle up to the hand.
  ctx.beginPath();
  ctx.ellipse(x - 0.03, y + 0.005, 0.022, 0.05, -0.4, 0, Math.PI * 2);
  ctx.ellipse(x + 0.025, y, 0.02, 0.055, 0.35, 0, Math.PI * 2);
  fillEdge(ctx, '#7fb35a', '#4f7d35');
  ctx.beginPath();
  ctx.moveTo(x - 0.075, y + 0.03);
  ctx.lineTo(x + 0.075, y + 0.03);
  ctx.lineTo(x + 0.058, y + 0.11);
  ctx.quadraticCurveTo(x, y + 0.12, x - 0.058, y + 0.11);
  ctx.closePath();
  fillEdge(ctx, tr.bagColor, tr.bagEdge);
  ctx.beginPath();
  ctx.moveTo(x - 0.066, y + 0.06);
  ctx.lineTo(x + 0.066, y + 0.06);
  ctx.moveTo(x - 0.06, y + 0.085);
  ctx.lineTo(x + 0.06, y + 0.085);
  ctx.strokeStyle = tr.bagEdge;
  ctx.lineWidth = 0.009;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 0.06, y + 0.03);
  ctx.quadraticCurveTo(x, y - 0.09, x + 0.06, y + 0.03);
  ctx.lineWidth = 0.014;
  ctx.stroke();
}

function tote(ctx: Ctx, tr: Traits, h: P): void {
  ctx.beginPath();
  ctx.moveTo(h.x - 0.035, h.y + 0.04);
  ctx.quadraticCurveTo(h.x, h.y - 0.04, h.x + 0.035, h.y + 0.04);
  ctx.strokeStyle = tr.bagEdge;
  ctx.lineWidth = 0.013;
  ctx.stroke();
  rrect(ctx, h.x - 0.06, h.y + 0.035, 0.12, 0.1, 0.018);
  fillEdge(ctx, tr.bagColor, tr.bagEdge);
}

function cane(ctx: Ctx, h: P): void {
  ctx.beginPath();
  ctx.moveTo(h.x - 0.035, h.y - 0.01);
  ctx.quadraticCurveTo(h.x - 0.01, h.y - 0.05, h.x + 0.01, h.y - 0.01);
  ctx.lineTo(h.x + 0.035, 0);
  setStroke(ctx, '#5a3a22', 0.026);
  ctx.stroke();
  setStroke(ctx, '#94612f', 0.014);
  ctx.stroke();
}

/** Whether a pack shows in this view and layer (side-on behind the back and its strap over the shoulder; from behind
 *  over the torso; facing, the straps, and a delivery box peeking over the shoulders). */
function packShows(tr: Traits, view: View, over: boolean): boolean {
  if (tr.bag !== 'backpack' && tr.bag !== 'box') return false;
  if (view === 'back') return over;
  if (view === 'front' && !over) return tr.bag === 'box';
  return true;
}

/** The pack's part behind the body, in the torso's frame (`len` the torso's length). */
function packBehindShape(ctx: Ctx, tr: Traits, view: View, len: number): void {
  const box = tr.bag === 'box';
  if (view === 'side') {
    const w = box ? 0.17 : 0.1;
    const top = box ? -len - 0.07 : -len + 0.02;
    const h = box ? 0.25 : 0.19;
    rrect(ctx, -0.075 * tr.width - w + 0.03, top, w, h, box ? 0.02 : 0.04);
    fillEdge(ctx, tr.bagColor, tr.bagEdge);
    if (box) {
      setFill(ctx, 'rgba(255, 252, 247, 0.5)');
      ctx.fillRect(-0.075 * tr.width - w + 0.03, top + h * 0.35, w, 0.02);
    }
  } else if (view === 'front' && box) {
    rrect(ctx, -0.16, -len - 0.08, 0.32, 0.2, 0.025);
    fillEdge(ctx, tr.bagColor, tr.bagEdge);
  }
}

/** The pack's part over the body, in the torso's frame. */
function packOverShape(ctx: Ctx, tr: Traits, view: View, len: number): void {
  const box = tr.bag === 'box';
  if (view === 'side') {
    ctx.beginPath();
    ctx.moveTo(-0.02, -len + 0.005);
    ctx.quadraticCurveTo(0.06 * tr.width, -len + 0.06, 0.02, -len + 0.15);
    setStroke(ctx, tr.bagEdge, 0.022);
    ctx.stroke();
  } else if (view === 'back') {
    const w = box ? 0.3 : 0.2;
    const top = box ? -len - 0.08 : -len + 0.02;
    const h = box ? 0.27 : 0.2;
    rrect(ctx, -w / 2, top, w, h, box ? 0.025 : 0.05);
    fillEdge(ctx, tr.bagColor, tr.bagEdge);
    if (box) {
      setFill(ctx, 'rgba(255, 252, 247, 0.5)');
      ctx.fillRect(-w / 2, top + h * 0.35, w, 0.022);
    } else {
      rrect(ctx, -w * 0.32, top + h * 0.5, w * 0.64, h * 0.36, 0.03);
      fillEdge(ctx, shade(tr.bagColor, 0.88), tr.bagEdge);
    }
  } else {
    const x = 0.075 * tr.width;
    ctx.beginPath();
    ctx.moveTo(-x, -len + 0.005);
    ctx.lineTo(-x * 0.93, -len + 0.16);
    ctx.moveTo(x, -len + 0.005);
    ctx.lineTo(x * 0.93, -len + 0.16);
    setStroke(ctx, tr.bagEdge, 0.02);
    ctx.stroke();
  }
}

/** A sling bag's strap across the chest and its pouch at the hip, in the torso's frame. */
function slingShape(ctx: Ctx, tr: Traits, view: View, len: number): void {
  const w = view === 'side' ? 0.15 : 0.21;
  ctx.beginPath();
  ctx.moveTo(-w * 0.4, -len + 0.01);
  ctx.lineTo(w * 0.42, -0.03);
  setStroke(ctx, shade(tr.bagColor, tr.bagColor === C.black ? 1.4 : 0.7), 0.014);
  ctx.stroke();
  rrect(ctx, w * 0.3, -0.06, 0.07, 0.055, 0.015);
  fillEdge(ctx, tr.bagColor, tr.bagEdge);
}

/** A recorded part drawn with its origin at (x, y). */
function partAt(ctx: Ctx, id: Part, fn: PartFn, tr: Traits, x: number, y: number): void {
  ctx.translate(x, y);
  part(ctx, id, fn, tr, 'side', 0);
  ctx.translate(-x, -y);
}

/** The cup or phone in hand 0. From behind the phone's screen shows (unless the arm hides it, see drawFigure). */
function held(ctx: Ctx, tr: Traits, sk: Skeleton, view: View, fx: FigureFx): void {
  if (fx.phone) phoneAt(ctx, sk.hand0.x, sk.hand0.y + 0.01, view === 'back');
  else if (fx.cup) partAt(ctx, Part.Cup, cupPart, tr, sk.hand0.x, sk.hand0.y);
}

/**
 * The thing in the other hand (basket, tote, cane), drawn with that arm. A bag slides to the crook of the elbow when the
 * hand comes up (to the chin, to scratch the head).
 */
function heldOther(ctx: Ctx, tr: Traits, sk: Skeleton): void {
  if (tr.cane) {
    cane(ctx, sk.hand1);
    return;
  }
  const at = sk.hand1.y < sk.hip.y - 0.04 ? sk.elbow1 : sk.hand1;
  if (tr.bag === 'basket') partAt(ctx, Part.Basket, basketPart, tr, at.x, at.y);
  else if (tr.bag === 'tote') partAt(ctx, Part.Tote, totePart, tr, at.x, at.y);
}

/**
 * A clip's pose for this character: someone with a cane keeps that hand on it whatever else they do (the walk with a
 * cane swings it itself).
 */
export function characterPose(out: Pose, clip: Clip, input: ClipInput, tr: Traits): Pose {
  clipPose(out, clip, input);
  if (tr.cane && clip !== 'walkCane') {
    out.a1 = 0.3;
    out.e1 = 0.3;
    out.x1 = 0.14;
  }
  return out;
}

/**
 * One character, in its own frame: feet at the origin, one unit its height, facing +x side-on. The caller translates,
 * scales and mirrors.
 */
export function drawFigure(ctx: Ctx, tr: Traits, sk: Skeleton, view: View, p: Readonly<Pose>, fx: FigureFx): void {
  penStart(ctx);
  if (view === 'side') figureSide(ctx, tr, sk, p, fx);
  else if (view === 'front') figureFront(ctx, tr, sk, p, fx);
  else figureBack(ctx, tr, sk, p, fx);
  penEnd();
}

function figureSide(ctx: Ctx, tr: Traits, sk: Skeleton, p: Readonly<Pose>, fx: FigureFx): void {
  pack(ctx, tr, sk, 'side', 'behind');
  heldOther(ctx, tr, sk);
  arm(ctx, tr, sk.shoulder1, sk.elbow1, sk.hand1, true);
  legs(ctx, tr, sk, true);
  torso(ctx, tr, sk, 'side');
  pack(ctx, tr, sk, 'side', 'over');
  sling(ctx, tr, sk, 'side');
  head(ctx, tr, sk, 'side', p, fx);
  if (fx.cup && !fx.phone) held(ctx, tr, sk, 'side', fx);
  arm(ctx, tr, sk.shoulder0, sk.elbow0, sk.hand0, false);
  if (fx.phone) held(ctx, tr, sk, 'side', fx);
}

function figureFront(ctx: Ctx, tr: Traits, sk: Skeleton, p: Readonly<Pose>, fx: FigureFx): void {
  pack(ctx, tr, sk, 'front', 'behind');
  legs(ctx, tr, sk, false);
  torso(ctx, tr, sk, 'front');
  pack(ctx, tr, sk, 'front', 'over');
  sling(ctx, tr, sk, 'front');
  head(ctx, tr, sk, 'front', p, fx);
  heldOther(ctx, tr, sk);
  arms(ctx, tr, sk);
  held(ctx, tr, sk, 'front', fx);
}

/** From behind, a hand within this share of the torso's half-width of the spine is in front of the body. */
const INNER = 0.08;

/**
 * From behind: an arm folded in front of the body (a phone, crossed arms, a hand at the chin, a sip) goes behind the
 * back, with what it holds; arms at the sides or swinging show beside the body; the pack and the head cover the rest.
 */
function figureBack(ctx: Ctx, tr: Traits, sk: Skeleton, p: Readonly<Pose>, fx: FigureFx): void {
  const inner = INNER * tr.width;
  const front0 = armInFront(p, sk, 0, inner);
  const front1 = armInFront(p, sk, 1, inner);
  if (front0) {
    held(ctx, tr, sk, 'back', fx);
    arm(ctx, tr, sk.shoulder0, sk.elbow0, sk.hand0, false);
  }
  if (front1) {
    heldOther(ctx, tr, sk);
    arm(ctx, tr, sk.shoulder1, sk.elbow1, sk.hand1, false);
  }
  legs(ctx, tr, sk, false);
  torso(ctx, tr, sk, 'back');
  if (!front0) {
    arm(ctx, tr, sk.shoulder0, sk.elbow0, sk.hand0, false);
    held(ctx, tr, sk, 'back', fx);
  }
  if (!front1) {
    arm(ctx, tr, sk.shoulder1, sk.elbow1, sk.hand1, false);
    heldOther(ctx, tr, sk);
  }
  pack(ctx, tr, sk, 'back', 'over');
  head(ctx, tr, sk, 'back', p, fx);
}

// ── Emotes over the head ────────────────────────────────────────────────────────────────────────────────────────────

export interface EmoteState {
  clip: Clip;
  mood: Mood;
  /** Seconds since the clip began (sim time). */
  t: number;
  /** Free-running seconds. */
  loop: number;
  /** Seconds since they were served correctly (the heart floats up for a while), Infinity if not. */
  sinceHappy: number;
  calm: boolean;
}

/** The marks over a head at (x, top), in street units; s is the person's height. */
export function drawEmotes(ctx: Ctx, x: number, top: number, s: number, e: EmoteState): void {
  const u = s * 0.3;
  if (e.sinceHappy < 1.6) {
    if (e.calm) {
      // Reduced motion: the heart stays put over the head, then goes.
      heart(ctx, x, top - u * 0.6, u * 0.9, 1);
    } else {
      const k = e.sinceHappy / 1.6;
      const rise = smoothstep(k) * s * 0.45;
      heart(ctx, x + Math.sin(e.sinceHappy * 6) * s * 0.05, top - u * 0.5 - rise,
        u * (0.75 + 0.25 * Math.min(1, k * 4)), k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3);
    }
  }
  switch (e.clip) {
    case 'puzzled': {
      const pop = e.calm ? 1 : popScale(e.t);
      if (pop > 0) mark(ctx, '?', x + s * 0.14, top - u * 0.55, u * pop);
      return;
    }
    case 'stomp':
    case 'walkAngry': {
      if (!e.calm) {
        for (let i = 0; i < 2; i++) {
          const k = (e.loop * 1.4 + i * 0.5) % 1;
          puff(ctx, x + (i === 0 ? -1 : 1) * s * (0.15 + k * 0.08), top + s * 0.06 - k * s * 0.35,
            u * (0.45 + k * 0.3), 1 - k);
        }
      }
      const beat = e.calm ? 1 : 0.9 + Math.abs(Math.sin(e.loop * 5)) * 0.2;
      angerMark(ctx, x + s * 0.16, top - u * 0.1, u * 0.87 * beat);
      return;
    }
    case 'crossed':
      if (e.mood === 'angry') {
        const beat = e.calm ? 1 : 0.9 + Math.abs(Math.sin(e.loop * 4)) * 0.2;
        angerMark(ctx, x + s * 0.16, top - u * 0.1, u * 0.8 * beat);
      } else {
        sweat(ctx, x - s * 0.16, top + s * 0.12 + (e.calm ? 0 : ((e.loop * 0.6) % 1) * s * 0.06), u * 0.5);
      }
      return;
    case 'walkScared':
    case 'whisper':
      sweat(ctx, x + s * 0.17, top + s * 0.1 + (e.calm ? 0 : ((e.loop * 0.9) % 1) * s * 0.07), u * 0.55);
      if (e.clip === 'whisper') dots(ctx, x - s * 0.22, top - u * 0.45, u * 0.7);
      return;
    case 'shrug':
      if (e.t < 1.4) dots(ctx, x + s * 0.12, top - u * 0.5, u * 0.7, 3);
      return;
    default:
      return;
  }
}

const TICK = 'rgba(42, 29, 21, 0.7)';

/**
 * Marks at the feet (street units): little tick lines at the toe each time an impatient foot taps down, and a dust puff
 * under each stomp. `toeX` is the tapping toe; `foot0X`/`foot1X` the two feet. None with reduced motion (the posture
 * stays).
 */
export function drawFootMarks(ctx: Ctx, toeX: number, foot0X: number, foot1X: number, y: number, s: number,
  e: EmoteState): void {
  if (e.calm) return;
  if (e.clip === 'tap' || e.clip === 'crossed') {
    // The foot is down for the second half of each tap cycle; the ticks flash as it lands.
    const k = (e.loop * (e.clip === 'tap' ? 2.2 : 3)) % 1;
    if (k < 0.5 || k > 0.75) return;
    const a = 1 - (k - 0.5) / 0.25;
    ctx.globalAlpha = a;
    ctx.strokeStyle = TICK;
    ctx.lineWidth = s * 0.034;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      const ang = -Math.PI / 2 + i * 0.75;
      const r0 = s * 0.07;
      const r1 = s * (0.16 + (1 - a) * 0.03);
      ctx.moveTo(toeX + Math.cos(ang) * r0, y - s * 0.02 + Math.sin(ang) * r0);
      ctx.lineTo(toeX + Math.cos(ang) * r1, y - s * 0.02 + Math.sin(ang) * r1);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (e.clip === 'stomp') {
    // A slam every half cycle (2.4 a second), alternating feet; the puff spreads and fades.
    const n = e.t * 4.8;
    const k = n % 1;
    if (k > 0.45) return;
    const fx = Math.floor(n) % 2 === 1 ? foot0X : foot1X;
    const a = 1 - k / 0.45;
    const spread = s * (0.07 + k * 0.12);
    puff(ctx, fx - spread, y - s * 0.01, s * (0.09 + k * 0.04), a);
    puff(ctx, fx + spread, y - s * 0.01, s * (0.09 + k * 0.04), a);
  }
}

/** A pop-in: 0 → overshoot → 1 over 0.3 s. */
function popScale(t: number): number {
  if (t <= 0) return 0;
  const u = clamp(t / 0.3, 0, 1);
  const s = 1.70158;
  const v = u - 1;
  return 1 + (s + 1) * v * v * v + s * v * v;
}

// ── The street's renderer ───────────────────────────────────────────────────────────────────────────────────────────

/** Pose transitions take this long (ms of wall time). */
const BLEND_MS = 220;
/** A walk cycle covers this many heights at walking pace (longer strides when hurrying). */
const CYCLE_HEIGHTS = 1.3;
/** A jump longer than this many heights in one frame is a catch-up, not a walk: the cycle does not race. */
const TELEPORT_HEIGHTS = 1.5;

interface Memo {
  traits: Traits;
  lastX: number;
  lastY: number;
  phase: number;
  clip: Clip | null;
  view: View;
  blendFrom: number;
  from: Pose;
  cur: Pose;
  target: Pose;
  happyAt: number;
  lastActivity: Actor['activity'];
  seen: number;
}

interface Cast { memos: Map<number, Memo>; frame: number; sk: Skeleton; input: ClipInput; fx: FigureFx; emote: EmoteState }

const STORE_KEY = 'characters.cast';

/** `forEach` callback (this: the wall clock): drops a memo not seen for 3 s. */
function sweepMemo(this: number, m: Memo, id: number, map: Map<number, Memo>): void {
  if (this - m.seen > 3000) map.delete(id);
}

function castOf(rc: RenderContext): Cast {
  let c = rc.store.get(STORE_KEY) as Cast | undefined;
  if (c === undefined) {
    c = {
      memos: new Map(), frame: 0, sk: newSkeleton(),
      input: { t: 0, loop: 0, phase: 0, pace: 0, side: true, stoop: 0, calm: false },
      fx: { mood: 'neutral', blink: 0, cup: false, phone: false },
      emote: { clip: 'idle', mood: 'neutral', t: 0, loop: 0, sinceHappy: Infinity, calm: false },
    };
    rc.store.set(STORE_KEY, c);
  }
  return c;
}

/** Blink: shut for ~0.12 s every 3–5 s, at a time of its own per character. */
export function blinkAt(loop: number, offset: number): number {
  const period = 3 + (offset % 2);
  const t = (loop + offset) % period;
  return t < 0.12 ? 1 : 0;
}

/** Which clips hold the phone or the cup. */
const PHONE_CLIPS: ReadonlySet<Clip> = new Set<Clip>(['phone', 'selfie', 'walkPhone']);

/**
 * The street's customer renderer (registered as `drawCustomer`): the actor's character, posed for what the director
 * says they are doing, feet at (actor.x, actor.y).
 */
export function drawCustomer(rc: RenderContext, a: Actor): void {
  const cast = castOf(rc);
  const { ctx } = rc;
  const H = rc.layout.actorH;
  // About once a second: forget actors not seen for a while.
  if (rc.wall - cast.frame > 1000) {
    cast.frame = rc.wall;
    if (cast.memos.size > 60) cast.memos.forEach(sweepMemo, rc.wall);
  }
  let m = cast.memos.get(a.id);
  if (m === undefined) {
    m = {
      traits: traitsOf(a.look), lastX: a.x, lastY: a.y, phase: 0, clip: null, view: viewOf(a.heading),
      blendFrom: -Infinity, from: pose(), cur: pose(), target: pose(), happyAt: -Infinity, lastActivity: a.activity,
      seen: rc.wall,
    };
    cast.memos.set(a.id, m);
  }
  m.seen = rc.wall;
  const tr = m.traits;

  // The walk cycle runs on the distance covered (paused sim, paused feet), longer strides when hurrying.
  const pace = a.speed > 0 ? a.speed / rc.layout.walk : 0;
  const moved = Math.hypot(a.x - m.lastX, a.y - m.lastY);
  if (moved < H * TELEPORT_HEIGHTS) m.phase += (moved / (H * CYCLE_HEIGHTS * Math.sqrt(Math.max(1, pace)))) * Math.PI * 2;
  m.lastX = a.x;
  m.lastY = a.y;
  if (a.activity === 'served' && m.lastActivity !== 'served') m.happyAt = a.since;
  m.lastActivity = a.activity;

  const sel = selectAnim(a, rc.now, tr, m.clip);
  const view = viewOf(a.heading);
  if (sel.clip !== m.clip || view !== m.view) {
    // A new clip (or a turn): blend from wherever the body is now.
    copyPose(m.from, m.cur);
    m.blendFrom = m.clip === null ? -Infinity : rc.wall;
    m.clip = sel.clip;
    m.view = view;
  }
  const input = cast.input;
  input.t = Math.max(0, (rc.now - a.since) / 10);
  input.loop = rc.wall / 1000 + tr.phaseOffset;
  input.phase = m.phase;
  input.pace = WALKING.has(sel.clip) ? Math.max(1, pace) : 0;
  input.side = view === 'side';
  input.stoop = tr.stoop;
  input.calm = rc.reducedMotion;
  characterPose(m.target, sel.clip, input, tr);
  mixPose(m.cur, m.from, m.target, (rc.wall - m.blendFrom) / BLEND_MS);
  const sk = solve(m.cur, tr.dims, view, cast.sk);

  const s = H * tr.height;
  const fx = cast.fx;
  fx.mood = sel.mood;
  fx.blink = blinkAt(input.loop, tr.phaseOffset);
  fx.phone = PHONE_CLIPS.has(sel.clip) && !a.carrying;
  fx.cup = a.carrying;

  const e = cast.emote;
  e.clip = sel.clip;
  e.mood = sel.mood;
  e.t = input.t;
  e.loop = input.loop;
  e.sinceHappy = a.carrying && !a.cupWrong ? (rc.now - m.happyAt) / 10 : Infinity;
  e.calm = rc.reducedMotion;
  drawCharacterAt(ctx, tr, a.x, a.y, s, a.facing, view, m.cur, sk, fx, e);
}

/**
 * A posed character with its shadow and emotes, feet at (x, y), `s` tall, mirrored for facing −1. `sk` must be
 * `solve(p, tr.dims, view)`.
 */
export function drawCharacterAt(ctx: Ctx, tr: Traits, x: number, y: number, s: number, facing: 1 | -1, view: View,
  p: Readonly<Pose>, sk: Skeleton, fx: FigureFx, e: EmoteState | null): void {
  // A soft shadow that shrinks as they leave the ground.
  const air = clamp(p.lift * 6, 0, 0.5);
  ctx.fillStyle = 'rgba(42, 29, 21, 0.15)';
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.2 * (1 - air), s * 0.05 * (1 - air), 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s * facing, s);
  drawFigure(ctx, tr, sk, view, p, fx);
  ctx.restore();

  if (e === null) return;
  const hx = x + facing * sk.head.x * s;
  const top = y + (sk.head.y - tr.dims.headR * (tr.hat === 'conical' ? 1.9 : 1.15)) * s;
  drawEmotes(ctx, hx, top, s, e);
  const toe = view === 'side' ? sk.foot0.x + 0.05 : sk.foot0.x;
  drawFootMarks(ctx, x + facing * toe * s, x + facing * sk.foot0.x * s, x + facing * sk.foot1.x * s, y, s, e);
}
