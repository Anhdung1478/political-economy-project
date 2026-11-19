// Interpolation and easing for the street scene: plain functions of a progress t in [0, 1] (or of time for the
// spring), shared by the director (walking) and the renderers (flips, bounces, pops).
import type { Pt } from './layout';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Where v sits between a and b, clamped to [0, 1]. */
export const progress = (a: number, b: number, v: number) => (a === b ? 1 : clamp((v - a) / (b - a), 0, 1));
export const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

export type Ease = (t: number) => number;

export const linear: Ease = t => t;
export const easeInQuad: Ease = t => t * t;
export const easeOutQuad: Ease = t => t * (2 - t);
export const easeInOutQuad: Ease = t => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
export const easeOutCubic: Ease = t => 1 - (1 - t) ** 3;
export const easeInOutCubic: Ease = t => (t < 0.5 ? 4 * t * t * t : 1 - 4 * (1 - t) ** 3);
export const smoothstep: Ease = t => t * t * (3 - 2 * t);
/** Overshoots and settles back: a pop. */
export const easeOutBack: Ease = t => {
  const s = 1.70158;
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};

/** Tween from a to b by progress t with an easing. */
export const tween = (a: number, b: number, t: number, ease: Ease = linear) => lerp(a, b, ease(clamp(t, 0, 1)));

export interface SpringOpts {
  /** Stiffness k (per s²). */
  stiffness?: number;
  /** Damping c (per s). */
  damping?: number;
}

/**
 * A damped spring released from 0 toward 1, at `t` seconds: overshoots and settles when underdamped (the default),
 * eases in without overshoot when critically or overdamped. Unit mass; closed form, so it can be sampled at any t.
 */
export function spring(t: number, { stiffness = 180, damping = 12 }: SpringOpts = {}): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
  const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
  return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
}

/** A spring that follows a moving target, one step of `dt` seconds (semi-implicit Euler); returns the new state. */
export function springStep(s: { x: number; v: number }, target: number, dt: number,
  { stiffness = 180, damping = 12 }: SpringOpts = {}): { x: number; v: number } {
  const v = s.v + (stiffness * (target - s.x) - damping * s.v) * dt;
  return { x: s.x + v * dt, v };
}
