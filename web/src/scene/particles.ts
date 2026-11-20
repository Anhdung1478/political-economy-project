// Particles on the street (spec §9 "Kỹ thuật dựng hình": "hạt (đồng xu, tim, pháo giấy)"): a coin that pops over a
// counter on each sale, hearts, confetti for a grand opening, the inspection and the end of the rush, and dust behind
// vehicles and at the building site. A fixed pool of preallocated particles: spawning reuses a dead one (or the
// oldest), stepping compacts in place, nothing is allocated per frame. Positions are logical units, time is wall
// seconds (they keep falling while the sim is paused). None with reduced motion.
//
// `ParticlePool` is pure (tested in node); `drawParticles` paints them.
import { heart } from './draw/faces';

export type ParticleKind = 'coin' | 'heart' | 'confetti' | 'dust' | 'spark';

export interface Particle {
  kind: ParticleKind;
  x: number; y: number;
  vx: number; vy: number;
  /** Seconds lived, and the lifespan. */
  age: number; life: number;
  /** Size in logical units. */
  size: number;
  /** Spin angle and speed (rad, rad/s). */
  rot: number; spin: number;
  /** Downward acceleration (units/s²); negative floats up. */
  gravity: number;
  /** Air drag per second (0 none, 1 stops at once). */
  drag: number;
  color: string;
  /** Coins: the y of the counter they land and bounce on (Infinity: no floor). */
  floor: number;
  /** Bounces left on the floor. */
  bounces: number;
}

const blank = (): Particle => ({
  kind: 'dust', x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 1, rot: 0, spin: 0, gravity: 0, drag: 0, color: '#000',
  floor: Infinity, bounces: 0,
});

export interface SpawnSpec {
  kind: ParticleKind; x: number; y: number; vx?: number; vy?: number; life: number; size: number;
  rot?: number; spin?: number; gravity?: number; drag?: number; color?: string; floor?: number; bounces?: number;
}

/**
 * A fixed set of particles; `items[0..count)` are alive. Spawning past capacity takes over the oldest particle.
 */
export class ParticlePool {
  readonly items: Particle[];
  count = 0;

  constructor(readonly capacity: number) {
    this.items = Array.from({ length: capacity }, blank);
  }

  /** A spec'd particle (tests, rare bursts); hot paths use `emit`, which takes no object. */
  spawn(s: SpawnSpec): Particle {
    const p = this.emit(s.kind, s.x, s.y, s.vx ?? 0, s.vy ?? 0, s.life, s.size, s.color ?? '#000', s.gravity ?? 0,
      s.drag ?? 0);
    p.rot = s.rot ?? 0;
    p.spin = s.spin ?? 0;
    p.floor = s.floor ?? Infinity;
    p.bounces = s.bounces ?? 0;
    return p;
  }

  /**
   * A particle from plain numbers (no object made); spin, rotation, floor and bounces start at rest and may be set on
   * the returned particle.
   */
  emit(kind: ParticleKind, x: number, y: number, vx: number, vy: number, life: number, size: number, color: string,
    gravity = 0, drag = 0): Particle {
    let p: Particle;
    if (this.count < this.capacity) {
      p = this.items[this.count++];
    } else {
      // Full: the oldest one is reused.
      let oldest = 0;
      let most = -1;
      for (let i = 0; i < this.count; i++) {
        const q = this.items[i];
        const k = q.age / q.life;
        if (k > most) {
          most = k;
          oldest = i;
        }
      }
      p = this.items[oldest];
    }
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.age = 0;
    p.life = life;
    p.size = size;
    p.rot = 0;
    p.spin = 0;
    p.gravity = gravity;
    p.drag = drag;
    p.color = color;
    p.floor = Infinity;
    p.bounces = 0;
    return p;
  }

  /** Moves everything on by `dt` seconds and drops the dead (swapping the last live one into the hole). */
  step(dt: number): void {
    if (dt <= 0) return;
    const items = this.items;
    let i = 0;
    while (i < this.count) {
      const p = items[i];
      p.age += dt;
      if (p.age >= p.life) {
        const last = this.count - 1;
        items[i] = items[last];
        items[last] = p;
        this.count--;
        continue;
      }
      p.vy += p.gravity * dt;
      if (p.drag > 0) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.y > p.floor && p.vy > 0) {
        p.y = p.floor;
        if (p.bounces > 0) {
          p.bounces--;
          p.vy = -p.vy * 0.45;
          p.vx *= 0.6;
        } else {
          p.vy = 0;
          p.vx = 0;
          p.gravity = 0;
          p.spin *= 0.3;
        }
      }
      i++;
    }
  }

  clear(): void { this.count = 0; }
}

/** Opacity at the end of life: full, then fading over the last share `fade` of it. */
export function fadeOut(p: Particle, fade = 0.3): number {
  const k = p.age / p.life;
  return k < 1 - fade ? 1 : Math.max(0, (1 - k) / fade);
}

type Ctx = CanvasRenderingContext2D;

const GOLD = '#f2c14e';
const GOLD_EDGE = '#b07d1c';

/** Paints the live particles, grouped by kind so styles change little. */
export function drawParticles(ctx: Ctx, pool: ParticlePool): void {
  const items = pool.items;
  // Dust first (it sits low), then confetti, coins, hearts, sparks.
  for (let i = 0; i < pool.count; i++) {
    const p = items[i];
    if (p.kind !== 'dust') continue;
    const k = p.age / p.life;
    ctx.globalAlpha = (1 - k) * 0.55;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.6 + k * 0.8), 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < pool.count; i++) {
    const p = items[i];
    if (p.kind !== 'confetti') continue;
    ctx.globalAlpha = fadeOut(p, 0.25);
    ctx.fillStyle = p.color;
    // A paper strip turning over: its width follows the spin.
    const w = p.size * (0.35 + 0.65 * Math.abs(Math.cos(p.rot * 1.7)));
    drawStrip(ctx, p.x, p.y, w, p.size * 0.5, p.rot);
  }
  for (let i = 0; i < pool.count; i++) {
    const p = items[i];
    if (p.kind !== 'coin') continue;
    ctx.globalAlpha = fadeOut(p, 0.25);
    const r = p.size;
    const squeeze = Math.abs(Math.cos(p.rot));
    ctx.fillStyle = GOLD_EDGE;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * Math.max(0.12, squeeze), r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r * Math.max(0.06, squeeze) * 0.78, r * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    if (squeeze > 0.45) {
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.ellipse(p.x - r * 0.25 * squeeze, p.y - r * 0.3, r * 0.18 * squeeze, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (let i = 0; i < pool.count; i++) {
    const p = items[i];
    if (p.kind !== 'heart') continue;
    heart(ctx, p.x + Math.sin(p.age * 7 + p.rot) * p.size * 0.3, p.y, p.size, fadeOut(p, 0.4));
  }
  for (let i = 0; i < pool.count; i++) {
    const p = items[i];
    if (p.kind !== 'spark') continue;
    const k = p.age / p.life;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = p.color;
    const r = p.size * (1 - k * 0.5);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x + r * 0.28, p.y - r * 0.28);
    ctx.lineTo(p.x + r, p.y);
    ctx.lineTo(p.x + r * 0.28, p.y + r * 0.28);
    ctx.lineTo(p.x, p.y + r);
    ctx.lineTo(p.x - r * 0.28, p.y + r * 0.28);
    ctx.lineTo(p.x - r, p.y);
    ctx.lineTo(p.x - r * 0.28, p.y - r * 0.28);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** A small rotated rectangle without touching the transform. */
function drawStrip(ctx: Ctx, x: number, y: number, w: number, h: number, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const hw = w / 2;
  const hh = h / 2;
  ctx.beginPath();
  ctx.moveTo(x - c * hw + s * hh, y - s * hw - c * hh);
  ctx.lineTo(x + c * hw + s * hh, y + s * hw - c * hh);
  ctx.lineTo(x + c * hw - s * hh, y + s * hw + c * hh);
  ctx.lineTo(x - c * hw - s * hh, y - s * hw + c * hh);
  ctx.closePath();
  ctx.fill();
}
