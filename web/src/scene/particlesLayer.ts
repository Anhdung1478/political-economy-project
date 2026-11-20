// The `particles` overlay (Task 16): turns the frame's cues into particles — a coin popping over the counter on each
// sale (and two little hearts at the player's on a right cup), confetti over a grand opening as the rush opens and on
// and off through its first seconds, confetti and sparkles over each shop certified at the inspection, a grey puff over
// each one named, confetti over the street when the rush ends — then moves and paints them. Other renderers emit into
// the same pool (`particlesOf`): dust behind the vehicles, at the building site. Nothing with reduced motion.
import { slotOf, type Pt, type ShopSlot, type StreetLayout } from './layout';
import { drawParticles, ParticlePool } from './particles';
import type { RenderContext } from './Scene';

const POOL_SIZE = 260;
const KEY = 'particles.pool';

interface State { pool: ParticlePool; confettiAt: number; seed: number }

function stateOf(rc: RenderContext): State {
  let s = rc.store.get(KEY) as State | undefined;
  if (s === undefined) {
    s = { pool: new ParticlePool(POOL_SIZE), confettiAt: 0, seed: 1 };
    rc.store.set(KEY, s);
  }
  return s;
}

/** The scene's particle pool, for any renderer to emit into (null with reduced motion: emit nothing). */
export function particlesOf(rc: RenderContext): ParticlePool | null {
  return rc.reducedMotion ? null : stateOf(rc).pool;
}

/** A cheap repeatable 0..1 stream per scene (no Math.random: frames stay comparable in shots). */
function rnd(s: State): number {
  s.seed = (Math.imul(s.seed, 1664525) + 1013904223) >>> 0;
  return s.seed / 4294967296;
}

/** Where the money lands on a shop's counter: the top row's counter top in front, the bottom row's along its edge. */
export function counterTop(L: StreetLayout, slot: ShopSlot): Pt {
  const u = L.actorH;
  return slot.row === 'top'
    ? { x: slot.counter.x + u * 0.55, y: slot.rect.y + slot.rect.h - u * 0.62 }
    : { x: slot.counter.x + u * 0.55, y: slot.rect.y - u * 0.48 };
}

function confetti(rc: RenderContext, s: State, x: number, y: number, n: number, spread: number): void {
  const p = rc.palette;
  const colors = [p.strawberry, p.tea, p.matcha, p.caramel, '#7fb8e0', '#b49ad1', p.paper];
  const u = rc.layout.actorH;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (rnd(s) - 0.5) * spread;
    const v = u * (3 + rnd(s) * 4);
    s.pool.spawn({
      kind: 'confetti', x: x + (rnd(s) - 0.5) * u * 0.4, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 1.6 + rnd(s) * 1.2, size: u * (0.12 + rnd(s) * 0.08), rot: rnd(s) * 6, spin: (rnd(s) - 0.5) * 16,
      gravity: u * 5, drag: 1.6, color: colors[i % colors.length],
    });
  }
}

function sparks(rc: RenderContext, s: State, x: number, y: number, n: number): void {
  const u = rc.layout.actorH;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    s.pool.spawn({
      kind: 'spark', x, y, vx: Math.cos(a) * u * 2.2, vy: Math.sin(a) * u * 2.2, life: 0.7, size: u * 0.14,
      drag: 3, color: i % 2 === 0 ? '#ffe08a' : '#fffcf7',
    });
  }
}

/** Grey puffs rising (a shop named at the inspection; a shutter slamming). */
export function puffs(pool: ParticlePool, x: number, y: number, n: number, u: number, color = '#b9aea4'): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pool.spawn({
      kind: 'dust', x: x + Math.cos(a) * u * 0.25, y: y + Math.sin(a) * u * 0.1, vx: Math.cos(a) * u * 0.8,
      vy: -u * (0.4 + (i % 3) * 0.2), life: 1 + (i % 4) * 0.15, size: u * 0.16, drag: 1.2, color,
    });
  }
}

export function drawParticlesLayer(rc: RenderContext): void {
  const s = stateOf(rc);
  if (rc.reducedMotion) {
    s.pool.clear();
    return;
  }
  const L = rc.layout;
  const u = L.actorH;
  const d = rc.director;
  for (const c of rc.cues) {
    switch (c.kind) {
      case 'sale': {
        const slot = slotOf(L, c.shop);
        const at = counterTop(L, slot);
        s.pool.spawn({
          kind: 'coin', x: at.x, y: at.y - u * 0.1, vx: u * (rnd(s) - 0.5) * 0.8, vy: -u * 4.6, life: 1.25,
          size: u * 0.13, spin: 13, gravity: u * 13, floor: at.y, bounces: 2,
        });
        if (c.shop === 'player' && c.correct) {
          for (let i = 0; i < 2; i++) {
            s.pool.spawn({
              kind: 'heart', x: at.x + (i - 0.5) * u * 0.5, y: at.y - u * 0.3, vy: -u * (1.1 + i * 0.3), life: 1.2,
              size: u * 0.2, rot: i * 2, gravity: 0, drag: 0.4,
            });
          }
        }
        break;
      }
      case 'inspection': {
        for (const id of c.certified) {
          const slot = slotOf(L, id);
          const at = badgeAt(L, slot);
          confetti(rc, s, at.x, at.y, 22, 2.4);
          sparks(rc, s, at.x, at.y, 8);
        }
        for (const id of c.named) {
          const at = badgeAt(L, slotOf(L, id));
          puffs(s.pool, at.x, at.y, 8, u);
        }
        break;
      }
      case 'rushStart':
        for (const v of d.shops) {
          if (!v.grandOpening) continue;
          const slot = slotOf(L, v.id);
          confetti(rc, s, slot.rect.x + slot.rect.w * 0.5, slot.row === 'top' ? slot.rect.y + u : slot.rect.y - u, 40, 2);
        }
        break;
      case 'rushEnd':
        for (let i = 0; i < 6; i++) confetti(rc, s, L.width * (i + 0.5) / 6, L.road.y0, 14, 2.2);
        break;
      default:
        break;
    }
  }
  // A grand opening keeps a festive drizzle through the rush's first 25 s.
  if (rc.now < 250 && rc.wall - s.confettiAt > 1400) {
    s.confettiAt = rc.wall;
    for (const v of d.shops) {
      if (!v.grandOpening) continue;
      const slot = slotOf(L, v.id);
      const bx = slot.row === 'top' ? slot.rect.x + slot.rect.w * rnd(s) : slot.rect.x + slot.rect.w - u * 0.5;
      confetti(rc, s, bx, slot.row === 'top' ? slot.rect.y + u * 0.6 : slot.rect.y - u * 1.6, 7, 1.6);
    }
  }
  s.pool.step(Math.min(0.05, Math.max(0, rc.dt / 1000)));
  drawParticles(rc.ctx, s.pool);
}

/** Where a shop's badge sits (shops.ts draws it there). */
export function badgeAt(L: StreetLayout, slot: ShopSlot): Pt {
  const u = L.actorH;
  const r = slot.rect;
  return slot.row === 'top'
    ? { x: r.x + u * 0.42, y: r.y + r.h - u * 2.35 }
    : { x: r.x + r.w - u * 0.32, y: r.y - u * 1.75 };
}
