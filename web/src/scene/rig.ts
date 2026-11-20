// The jointed skeleton every street character is drawn on (spec §9 "Phong cách": "Nhân vật có khớp (đầu, thân, tay,
// chân) để làm dáng đi và biểu cảm"). Pure: no canvas, no clock.
//
// - A `Pose` is a set of named joint angles and offsets (radians and body heights).
// - `blendPose` / `mixPose` lerp two poses channel by channel (with an easing), for transitions.
// - `POSES` holds the named key poses; `clipPose` builds the pose of an animation clip at a time (walk cycles, breathing,
//   foot taps, hops, stomps…) from them, so any character with any proportions can play it.
// - `solve` runs forward kinematics for a view (side-on, facing us, back to us) into a `Skeleton` of joint points, with
//   the lower foot planted on the ground.
//
// Units: one unit is the character's height, feet at y = 0, up is −y. Side-on, +x is the way the character faces (the
// renderer mirrors for facing left). Arm 0 and leg 0 are the near ones side-on (drawn in front) and the +x ones facing
// us; arm 0 is the hand that holds things (a cup, a phone, a cane).
import { clamp, smoothstep, type Ease } from './tween';

export interface Pose {
  /** Whole body lifted off the ground (a hop), in heights. */
  lift: number;
  /** Upper body leaning forward (side-on) / its forward share (facing), radians. */
  lean: number;
  /** Upper body rolled sideways (seen facing or from behind), radians. */
  sway: number;
  /** Torso height scale (a squash on landing, a stretch on take-off). */
  squash: number;
  /** Head pitch: + looks down, − looks up (radians). */
  nod: number;
  /** Head roll (radians), + toward +x. */
  tilt: number;
  /** Where the eyes look, −1..1 (x: toward +x; y: + down). */
  lookX: number;
  lookY: number;
  /** Shoulders raised, in heights (a shrug, a cower). */
  shrug: number;
  /** Arm 0 / arm 1: shoulder swing forward (0 hangs down), elbow bend (+ folds the forearm forward and up), out. */
  a0: number; e0: number; x0: number;
  a1: number; e1: number; x1: number;
  /** Leg 0 / leg 1: hip swing forward, knee bend (+ folds the shin back). */
  l0: number; k0: number;
  l1: number; k1: number;
}

export const POSE_KEYS = [
  'lift', 'lean', 'sway', 'squash', 'nod', 'tilt', 'lookX', 'lookY', 'shrug',
  'a0', 'e0', 'x0', 'a1', 'e1', 'x1', 'l0', 'k0', 'l1', 'k1',
] as const satisfies readonly (keyof Pose)[];

const REST: Pose = {
  lift: 0, lean: 0, sway: 0, squash: 1, nod: 0, tilt: 0, lookX: 0, lookY: 0, shrug: 0,
  a0: 0.08, e0: 0.12, x0: 0.16, a1: 0.08, e1: 0.12, x1: 0.16, l0: 0, k0: 0, l1: 0, k1: 0,
};

/** A pose: the relaxed stand with some channels changed. */
export const pose = (p: Partial<Pose> = {}): Pose => ({ ...REST, ...p });

export function copyPose(out: Pose, src: Readonly<Pose>): Pose {
  for (const k of POSE_KEYS) out[k] = src[k];
  return out;
}

/** out = a + (b − a)·t, channel by channel (t is not clamped: 0 gives a, 1 gives b). */
export function blendPose(out: Pose, a: Readonly<Pose>, b: Readonly<Pose>, t: number): Pose {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** A transition from a to b at progress t (clamped to 0..1) through an easing (smoothstep by default). */
export const mixPose = (out: Pose, a: Readonly<Pose>, b: Readonly<Pose>, t: number, ease: Ease = smoothstep): Pose =>
  blendPose(out, a, b, ease(clamp(t, 0, 1)));

/** Adds `w` times the pose's difference from the rest stand onto out (layering a gesture over a cycle). */
function layer(out: Pose, p: Readonly<Pose>, w: number): Pose {
  for (const k of POSE_KEYS) out[k] += (p[k] - REST[k]) * w;
  return out;
}

/** The key poses the clips are made of. */
export const POSES = {
  stand: pose(),
  /** Chin up, eyes up: reading a price board above. */
  lookUp: pose({ nod: -0.32, lookY: -0.9, a1: 0.25, e1: 1.9, x1: -0.05 }),
  /** Head down over a phone held in front of the chest. */
  phone: pose({ nod: 0.3, lookY: 0.85, a0: 0.35, e0: 1.75, x0: 0.05, a1: 0.3, e1: 1.5, x1: 0.02 }),
  /** A phone held up at arm's length, a selfie. */
  selfie: pose({ nod: -0.08, lookX: 0.4, lookY: -0.3, a0: 2.3, e0: 0.35, x0: 0.95, tilt: 0.12 }),
  /** Arms folded across the chest. */
  crossed: pose({ a0: 0.35, e0: 1.85, x0: -0.12, a1: 0.35, e1: 1.85, x1: -0.12, lean: -0.04, nod: -0.04 }),
  /** Hands on hips. */
  hips: pose({ a0: -0.15, e0: 1.5, x0: 0.75, a1: -0.15, e1: 1.5, x1: 0.75 }),
  /** Both arms up. */
  cheer: pose({ a0: 2.7, e0: 0.3, x0: 0.45, a1: 2.7, e1: 0.3, x1: 0.45, nod: -0.12, lookY: -0.4 }),
  /** A cup at the lips. */
  sip: pose({ a0: 0.55, e0: 2.2, x0: 0.02, nod: -0.1 }),
  /** Palms up, shoulders up, head tilted. */
  shrug: pose({ shrug: 0.035, a0: -0.05, e0: 1.45, x0: 0.6, a1: -0.05, e1: 1.45, x1: 0.6, tilt: 0.18 }),
  /** Hunched, shoulders up, hands at the chin. */
  cower: pose({ shrug: 0.03, lean: 0.12, nod: 0.12, a0: 0.4, e0: 2.25, x0: 0.05, a1: 0.4, e1: 2.25, x1: 0.05, k0: 0.12,
    k1: 0.12 }),
  /** A hand cupped at the mouth, leaning in to whisper. */
  whisper: pose({ a1: 0.55, e1: 2.35, x1: 0.1, lean: 0.08, tilt: -0.14, lookX: 0.7 }),
  /** Scratching the head. */
  scratch: pose({ a1: 2.2, e1: 1.9, x1: 0.15, tilt: 0.2, lookY: -0.2 }),
  /** Fists down and stiff. */
  fists: pose({ a0: 0.15, e0: 0.55, x0: 0.18, a1: 0.15, e1: 0.55, x1: 0.18, lean: 0.06, nod: 0.12 }),
  /** Pointing up at the boards. */
  point: pose({ a0: 2.35, e0: 0.12, x0: 0.25 }),
} satisfies Record<string, Pose>;

/** Holding a cup between sips. */
const CUP_HOLD = pose({ a0: 0.45, e0: 1.25, x0: 0.06 });

/** Hop k of the happy clip at time t: 0 on the ground, up to 1 at the top. */
function hopAt(t: number, k: number): number {
  const u = (t - k * 0.42) / 0.36;
  return u > 0 && u < 1 ? S(u * Math.PI) : 0;
}

// ── Clips ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Clip =
  | 'idle' | 'walk' | 'shuffle' | 'walkDrink' | 'walkAngry' | 'walkScared' | 'walkPhone' | 'walkCane'
  | 'lookBoard' | 'phone' | 'selfie' | 'tap' | 'crossed' | 'happy' | 'puzzled' | 'stomp' | 'shrug' | 'whisper';

export const CLIPS: readonly Clip[] = [
  'idle', 'walk', 'shuffle', 'walkDrink', 'walkAngry', 'walkScared', 'walkPhone', 'walkCane',
  'lookBoard', 'phone', 'selfie', 'tap', 'crossed', 'happy', 'puzzled', 'stomp', 'shrug', 'whisper',
];

/** Clips whose feet travel (the walk cycle runs on the distance covered). */
export const WALKING: ReadonlySet<Clip> = new Set<Clip>(
  ['walk', 'shuffle', 'walkDrink', 'walkAngry', 'walkScared', 'walkPhone', 'walkCane']);

export interface ClipInput {
  /** Seconds since the clip started (sim time, for one-shots that follow the story: a hop, a stomp). */
  t: number;
  /** A free-running clock in seconds, offset per character (breathing, blinking, foot taps). */
  loop: number;
  /** Walk cycle phase, radians (from the distance walked). */
  phase: number;
  /** Walking speed in walking speeds (1 a stroll, up to 4 a hurry); 0 standing. */
  pace: number;
  /** Seen side-on (else facing us or from behind). */
  side: boolean;
  /** 0..1: an old back's bend. */
  stoop: number;
  /** Reduced motion: no hop, no bob, no tapping; postures stay. */
  calm: boolean;
}

const TAU = Math.PI * 2;
const S = Math.sin;

/** One walk cycle into out: legs swing, the far knee folds on the back swing, arms counter-swing, the body bobs. */
function walkCycle(out: Pose, i: ClipInput, stride: number, armSwing: number, bob: number): void {
  const p = i.phase;
  const s = S(p);
  out.l0 = s * stride;
  out.l1 = -s * stride;
  // The leg swinging forward lifts its knee; the one pushing off behind folds its shin.
  out.k0 = Math.max(0, -Math.cos(p)) * stride * 1.6 + 0.05;
  out.k1 = Math.max(0, Math.cos(p)) * stride * 1.6 + 0.05;
  out.a0 = 0.05 - s * armSwing;
  out.a1 = 0.05 + s * armSwing;
  out.e0 = 0.25 + Math.max(0, -s) * 0.35;
  out.e1 = 0.25 + Math.max(0, s) * 0.35;
  out.sway = s * 0.05;
  out.lift = i.calm ? 0 : Math.abs(Math.cos(p)) * bob;
}

/** The base stand with an old back's bend. */
function base(out: Pose, i: ClipInput): Pose {
  copyPose(out, REST);
  if (i.stoop > 0) {
    out.lean = 0.28 * i.stoop;
    out.nod = -0.18 * i.stoop;
    out.k0 = out.k1 = 0.1 * i.stoop;
  }
  return out;
}

/** Breathing: a slow squash of the torso and a little shoulder rise. */
function breathe(out: Pose, i: ClipInput, amount = 1): void {
  if (i.calm) return;
  const b = S(i.loop * 1.9);
  out.squash += b * 0.018 * amount;
  out.shrug += (b + 1) * 0.003 * amount;
}

/**
 * The pose of `clip` at the time in `i`, into `out`. One-shots (happy, puzzled, stomp, shrug) read `i.t`; loops read
 * `i.loop`; walks read `i.phase`.
 */
export function clipPose(out: Pose, clip: Clip, i: ClipInput): Pose {
  base(out, i);
  const fast = clamp((i.pace - 1.4) / 1.6, 0, 1);
  switch (clip) {
    case 'idle': {
      breathe(out, i);
      // Now and then a glance around.
      const g = i.calm ? 0 : S(i.loop * 0.45) * S(i.loop * 0.17);
      out.lookX = clamp(g * 2.2, -0.8, 0.8);
      out.tilt = g * 0.06;
      return out;
    }
    case 'walk':
      walkCycle(out, i, 0.5 + fast * 0.2, 0.62 + fast * 0.3, 0.024 + fast * 0.012);
      out.lean += 0.04 + fast * 0.14;
      return out;
    case 'walkCane':
      walkCycle(out, i, 0.3, 0.12, 0.012);
      // The cane hand (arm 1) stays forward on the stick.
      out.a1 = 0.32 + S(i.phase) * 0.12;
      out.e1 = 0.35;
      return out;
    case 'shuffle':
      walkCycle(out, i, 0.2, 0.18, 0.012);
      return out;
    case 'walkDrink': {
      walkCycle(out, i, 0.38, 0.5, 0.02);
      // A sip every few seconds: the cup comes up to the lips, stays, goes down.
      const c = i.loop % 3.2;
      const up = c < 0.35 ? smoothstep(c / 0.35) : c < 1.15 ? 1 : c < 1.5 ? 1 - smoothstep((c - 1.15) / 0.35) : 0;
      out.a0 = CUP_HOLD.a0 + (POSES.sip.a0 - CUP_HOLD.a0) * up;
      out.e0 = CUP_HOLD.e0 + (POSES.sip.e0 - CUP_HOLD.e0) * up;
      out.x0 = CUP_HOLD.x0;
      out.nod = -0.1 * up;
      return out;
    }
    case 'walkAngry': {
      // Short heavy steps, fists pumping, head down, a jolt on every footfall.
      walkCycle(out, i, 0.36, 0.25, 0.0);
      out.lean += 0.14;
      out.nod = 0.16;
      out.a0 = 0.25 - S(i.phase) * 0.4;
      out.a1 = 0.25 + S(i.phase) * 0.4;
      out.e0 = out.e1 = 1.1;
      out.x0 = out.x1 = 0.2;
      const thud = Math.abs(S(i.phase));
      out.lift = i.calm ? 0 : thud * 0.035;
      out.squash = 1 - (1 - thud) * (i.calm ? 0 : 0.05);
      out.shrug = 0.012;
      return out;
    }
    case 'walkScared': {
      // Quick small steps, hunched, hands at the chin, a glance back now and then.
      walkCycle(out, i, 0.3, 0.1, 0.016);
      layer(out, POSES.cower, 0.85);
      out.lookX = i.calm ? -0.6 : S(i.loop * 2.3) > 0.3 ? -0.9 : 0.4;
      return out;
    }
    case 'walkPhone':
      walkCycle(out, i, 0.32, 0.3, 0.016);
      out.a0 = POSES.phone.a0;
      out.e0 = POSES.phone.e0;
      out.x0 = POSES.phone.x0;
      out.nod = 0.26;
      out.lookY = 0.8;
      return out;
    case 'lookBoard': {
      layer(out, POSES.lookUp, 1);
      breathe(out, i);
      // Eyes run along the boards (seen from behind, the head turns with them); a chin rub; now and then a point at
      // a price.
      out.lookX = i.calm ? 0 : S(i.loop * 0.9) * 0.6;
      out.e1 += i.calm ? 0 : S(i.loop * 5) * 0.06;
      const pt = i.calm ? 0 : smoothstep(clamp(S(i.loop * 0.55 + 1) * 3 - 2, 0, 1));
      out.a0 += (POSES.point.a0 - out.a0) * pt;
      out.e0 += (POSES.point.e0 - out.e0) * pt;
      out.x0 += (0.5 - out.x0) * pt;
      return out;
    }
    case 'phone': {
      layer(out, POSES.phone, 1);
      breathe(out, i);
      // Thumb taps.
      if (!i.calm) out.e0 += Math.max(0, S(i.loop * 9)) * 0.08;
      return out;
    }
    case 'selfie': {
      layer(out, POSES.selfie, 1);
      breathe(out, i);
      // A pose for the camera every couple of seconds: lean and tilt the other way.
      const s = i.calm ? 0 : smoothstep(clamp(S(i.loop * 1.4) * 2, -1, 1) * 0.5 + 0.5);
      out.tilt = 0.14 - s * 0.28;
      out.sway = 0.04 - s * 0.08;
      out.a1 = 0.1 + s * 0.4;
      out.e1 = 0.2 + s * 1.6;
      out.x1 = 0.12 + s * 0.6;
      return out;
    }
    case 'tap': {
      layer(out, POSES.hips, 0.7);
      breathe(out, i, 0.6);
      // The near foot taps; the eyes go to the counter and back.
      const tap = i.calm ? 0.5 : Math.max(0, S(i.loop * TAU * 2.2));
      out.l0 = 0.12 + tap * 0.3;
      out.k0 = tap * 0.7;
      // The shoulders bounce and the body rocks with each tap (seen from every side).
      out.shrug += tap * 0.012;
      out.sway += (tap - 0.3) * 0.05;
      out.lookX = i.calm ? -0.5 : S(i.loop * 0.7) > 0 ? -0.7 : 0.2;
      out.lean -= 0.03;
      return out;
    }
    case 'crossed': {
      layer(out, POSES.crossed, 1);
      breathe(out, i, 1.3);
      const tap = i.calm ? 0.5 : Math.max(0, S(i.loop * TAU * 3));
      out.l0 = 0.1 + tap * 0.3;
      out.k0 = tap * 0.7;
      out.shrug += tap * 0.01;
      out.sway += (tap - 0.3) * 0.04;
      out.tilt = i.calm ? -0.06 : S(i.loop * 0.8) * 0.08;
      out.lookX = -0.6;
      return out;
    }
    case 'happy': {
      // Two little hops with a squash on each landing, the free arm up, the cup held high; then a bounce in place.
      const t = i.t;
      const h = t < 0.84 ? Math.max(hopAt(t, 0), hopAt(t, 1)) : 0;
      const landing = t < 0.95 ? Math.max(0, 1 - Math.abs(((t % 0.42) - 0.38) / 0.06)) : 0;
      layer(out, POSES.cheer, 0.55);
      out.a0 = 1.9;
      out.e0 = 0.7;
      out.x0 = 0.3;
      out.k0 = out.k1 = h * 0.5;
      out.l0 = out.l1 = h * 0.25;
      out.lift = i.calm ? 0 : h * 0.1;
      out.squash = i.calm ? 1 : 1 + h * 0.05 - landing * 0.08;
      out.lookY = -0.3;
      if (t >= 0.84) breathe(out, i, 1.5);
      return out;
    }
    case 'puzzled': {
      // Holds the cup up to look at it, head tilts, scratches the head.
      const t = i.t;
      const w = smoothstep(clamp(t / 0.3, 0, 1));
      layer(out, POSES.scratch, w);
      out.a0 = 0.55 * w + out.a0 * (1 - w);
      out.e0 = 1.5 * w + out.e0 * (1 - w);
      out.x0 = 0.05;
      out.e1 += i.calm ? 0 : S(i.loop * 14) * 0.12 * w;
      out.lookX = 0.5;
      out.lookY = 0.2;
      out.tilt = 0.22 + (i.calm ? 0 : S(i.loop * 1.1) * 0.05);
      return out;
    }
    case 'stomp': {
      // Stomping in place: knees come up in turn and slam down, fists stiff, the body jolts.
      layer(out, POSES.fists, 1);
      // Reduced motion: one knee held up, still (the posture says it; nothing pumps).
      const p = i.calm ? Math.PI / 2 : i.t * TAU * 2.4;
      const s = S(p);
      out.l0 = Math.max(0, s) * 0.95;
      out.k0 = Math.max(0, s) * 1.15;
      out.l1 = Math.max(0, -s) * 0.95;
      out.k1 = Math.max(0, -s) * 1.15;
      const slam = Math.abs(Math.cos(p));
      out.squash = i.calm ? 1 : 1 - Math.pow(slam, 6) * 0.07;
      // The body rocks toward the lifted leg and jolts down on each slam (what shows facing us).
      out.sway = i.calm ? 0 : -s * 0.09;
      out.tilt = i.calm ? 0 : s * 0.06;
      out.a0 += s * 0.15;
      out.a1 -= s * 0.15;
      out.shrug = 0.015;
      return out;
    }
    case 'shrug': {
      // Let down: shoulders go up, palms out, then sag.
      const w = smoothstep(clamp(i.t / 0.35, 0, 1));
      layer(out, POSES.shrug, w);
      const sag = smoothstep(clamp((i.t - 0.8) / 0.4, 0, 1));
      out.shrug -= sag * 0.03;
      out.nod += sag * 0.18;
      out.lookY = 0.5 * sag;
      return out;
    }
    case 'whisper': {
      // Day 5: leaning in with a hand at the mouth, pointing at the boards now and then, eyes darting.
      layer(out, POSES.whisper, 1);
      const pt = i.calm ? 0 : smoothstep(clamp(S(i.loop * 0.9) * 3 - 1, 0, 1));
      out.a0 = REST.a0 + (POSES.point.a0 - REST.a0) * pt;
      out.e0 = REST.e0 + (POSES.point.e0 - REST.e0) * pt;
      out.x0 = REST.x0 + (POSES.point.x0 - REST.x0) * pt;
      out.lookX = i.calm ? 0.6 : S(i.loop * 3.1) > 0 ? 0.8 : -0.6;
      out.lookY = -0.3 * pt;
      out.shrug = 0.02;
      breathe(out, i, 1.6);
      return out;
    }
  }
}

// ── Skeleton ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Body proportions, in heights. */
export interface Dims {
  legUpper: number; legLower: number;
  /** Ankle to sole. */
  foot: number;
  torso: number; neck: number; headR: number;
  armUpper: number; armLower: number;
  /** Half the shoulder span and half the hip span (facing). */
  shoulder: number; hip: number;
}

export const DEFAULT_DIMS: Dims = {
  legUpper: 0.13, legLower: 0.13, foot: 0.03, torso: 0.26, neck: 0.015, headR: 0.205,
  armUpper: 0.12, armLower: 0.115, shoulder: 0.11, hip: 0.06,
};

export interface P { x: number; y: number }
export type View = 'side' | 'front' | 'back';

/** Joint points after `solve`. */
export interface Skeleton {
  hip: P; neck: P; head: P;
  /** Where the arms hang from (one point side-on, two facing). */
  shoulder0: P; shoulder1: P;
  elbow0: P; hand0: P; elbow1: P; hand1: P;
  hip0: P; hip1: P; knee0: P; foot0: P; knee1: P; foot1: P;
  /** The head's rotation (radians): its nod side-on, its roll facing. */
  headAngle: number;
  /** The torso's rotation (radians). */
  torsoAngle: number;
  /** Torso length after the squash. */
  torsoLen: number;
}

const pt = (): P => ({ x: 0, y: 0 });

const JOINTS = [
  'hip', 'neck', 'head', 'shoulder0', 'shoulder1', 'elbow0', 'hand0', 'elbow1', 'hand1', 'hip0', 'hip1', 'knee0',
  'foot0', 'knee1', 'foot1',
] as const satisfies readonly (keyof Skeleton)[];

export const newSkeleton = (): Skeleton => ({
  hip: pt(), neck: pt(), head: pt(), shoulder0: pt(), shoulder1: pt(), elbow0: pt(), hand0: pt(), elbow1: pt(),
  hand1: pt(), hip0: pt(), hip1: pt(), knee0: pt(), foot0: pt(), knee1: pt(), foot1: pt(), headAngle: 0,
  torsoAngle: 0, torsoLen: 0,
});

const set = (p: P, x: number, y: number) => { p.x = x; p.y = y; };

/** How far a bent elbow pulls the forearm toward the middle of the body, facing (the arms cross in front). */
const INWARD = 0.85;

/**
 * Forward kinematics: the joint points of `pose` for `dims` seen from `view`, into `out`. The lower foot stands on
 * the ground (y = 0), then the whole body rises by `pose.lift`.
 */
export function solve(pose: Readonly<Pose>, dims: Readonly<Dims>, view: View, out: Skeleton): Skeleton {
  const d = dims;
  const hipH = d.legUpper + d.legLower + d.foot;
  const torsoLen = d.torso * pose.squash;
  out.torsoLen = torsoLen;
  set(out.hip, 0, -hipH);
  if (view === 'side') {
    const ux = S(pose.lean);
    const uy = -Math.cos(pose.lean);
    set(out.neck, ux * torsoLen, -hipH + uy * torsoLen);
    out.torsoAngle = pose.lean;
    const ha = pose.lean + pose.nod * 0.8;
    out.headAngle = ha;
    const hr = d.neck + d.headR * 0.82;
    set(out.head, out.neck.x + S(ha) * hr, out.neck.y - Math.cos(ha) * hr);
    // Arms hang from just under the neck (raised by a shrug).
    const drop = 0.035 - pose.shrug;
    set(out.shoulder0, out.neck.x - ux * drop, out.neck.y - uy * drop);
    set(out.shoulder1, out.shoulder0.x - 0.012, out.shoulder0.y);
    sideArm(out.shoulder0, pose.a0 + pose.lean, pose.e0, d, out.elbow0, out.hand0);
    sideArm(out.shoulder1, pose.a1 + pose.lean, pose.e1, d, out.elbow1, out.hand1);
    set(out.hip0, 0.01, -hipH);
    set(out.hip1, -0.01, -hipH);
    sideLeg(out.hip0, pose.l0, pose.k0, d, out.knee0, out.foot0);
    sideLeg(out.hip1, pose.l1, pose.k1, d, out.knee1, out.foot1);
  } else {
    // Facing us or from behind: the forward swings foreshorten, the sideways ones show.
    const ux = S(pose.sway);
    const len = torsoLen * (1 - 0.12 * Math.abs(S(pose.lean)));
    const uy = -Math.cos(pose.sway);
    set(out.neck, ux * len, -hipH + uy * len);
    out.torsoAngle = pose.sway;
    // From behind, where the eyes look turns the head a little (the only way to see someone scan the boards); a chin
    // raised to look up lifts the head.
    out.headAngle = pose.sway + pose.tilt + (view === 'back' ? pose.lookX * 0.16 : 0);
    const hr = d.neck + d.headR * 0.82 - pose.nod * 0.035;
    set(out.head, out.neck.x + S(out.headAngle) * hr, out.neck.y - Math.cos(out.headAngle) * hr);
    const drop = 0.035 - pose.shrug;
    const px = -uy; // the shoulder line, perpendicular to the spine
    const py = ux;
    const sw = d.shoulder + 0.004;
    set(out.shoulder0, out.neck.x + px * sw - ux * drop, out.neck.y + py * sw - uy * drop);
    set(out.shoulder1, out.neck.x - px * sw - ux * drop, out.neck.y - py * sw - uy * drop);
    frontArm(out.shoulder0, 1, pose.a0, pose.e0, pose.x0, d, out.elbow0, out.hand0);
    frontArm(out.shoulder1, -1, pose.a1, pose.e1, pose.x1, d, out.elbow1, out.hand1);
    set(out.hip0, d.hip, -hipH);
    set(out.hip1, -d.hip, -hipH);
    frontLeg(out.hip0, pose.l0, pose.k0, d, out.knee0, out.foot0);
    frontLeg(out.hip1, pose.l1, pose.k1, d, out.knee1, out.foot1);
  }
  // Plant the lower foot, then lift.
  const dy = -(Math.max(out.foot0.y, out.foot1.y) + d.foot) - pose.lift;
  for (const k of JOINTS) out[k].y += dy;
  return out;
}

function sideArm(s: P, a: number, e: number, d: Dims, elbow: P, hand: P): void {
  set(elbow, s.x + S(a) * d.armUpper, s.y + Math.cos(a) * d.armUpper);
  set(hand, elbow.x + S(a + e) * d.armLower, elbow.y + Math.cos(a + e) * d.armLower);
}

function sideLeg(h: P, l: number, k: number, d: Dims, knee: P, foot: P): void {
  set(knee, h.x + S(l) * d.legUpper, h.y + Math.cos(l) * d.legUpper);
  set(foot, knee.x + S(l - k) * d.legLower, knee.y + Math.cos(l - k) * d.legLower);
}

function frontArm(s: P, side: 1 | -1, a: number, e: number, x: number, d: Dims, elbow: P, hand: P): void {
  set(elbow, s.x + side * S(x) * d.armUpper, s.y + Math.cos(a) * Math.cos(x) * d.armUpper);
  const fx = side * (S(x) * 0.6 - S(clamp(e, 0, Math.PI)) * INWARD * Math.min(1, Math.max(0, Math.cos(a) + 0.6)));
  set(hand, elbow.x + fx * d.armLower, elbow.y + Math.cos(a + e) * Math.cos(x * 0.5) * d.armLower);
}

/** Facing us: a forward swing foreshortens the thigh, and a raised knee turns a little outward. */
function frontLeg(h: P, l: number, k: number, d: Dims, knee: P, foot: P): void {
  const out = Math.sign(h.x) * Math.max(0, S(l)) * 0.04;
  set(knee, h.x + out, h.y + Math.cos(l) * d.legUpper);
  set(foot, knee.x - out * 0.4, knee.y + Math.cos(l - k) * d.legLower);
}

/**
 * Seen from behind, whether arm 0 or 1 is folded in front of the body (so it, and what it holds, is hidden behind the
 * back): its hand reaches forward (sin a + sin(a + e), the elbow's and the hand's forward reach in segment lengths,
 * over 0.5) and ends within the middle of the torso (`inner` from the spine). The reach alone would also hide a walking
 * arm swung forward, which from behind still shows beside the body; the position alone would hide a hand hanging
 * straight down against the hip.
 */
export function armInFront(p: Readonly<Pose>, sk: Readonly<Skeleton>, arm: 0 | 1, inner: number): boolean {
  const a = arm === 0 ? p.a0 : p.a1;
  const e = arm === 0 ? p.e0 : p.e1;
  const hand = arm === 0 ? sk.hand0 : sk.hand1;
  return S(a) + S(a + e) > 0.5 && Math.abs(hand.x - sk.neck.x) < inner;
}
