// The `particles` overlay (Task 16): turns the frame's cues into particles — a coin popping over the counter on each
// sale (and two little hearts at the player's on a right cup), confetti over a grand opening as the rush opens and on
// and off through its first seconds, confetti and sparkles over each shop certified at the inspection, a grey puff over
// each one named, confetti over the street when the rush ends — then moves and paints them. Other renderers emit into
// the same pool (`particlesOf`): dust behind the vehicles, at the building site. Nothing with reduced motion.
import { badgeSpot } from './draw/shops';
import { slotOf, type Pt, type ShopSlot, type StreetLayout } from './layout';
import { drawParticles, ParticlePool } from './particles';
import type { Palette, RenderContext } from './Scene';

/**
 * Pool size. The busiest moment is the inspection: up to 7 shops × (CONFETTI_BURST + SPARKS) ≈ 180, plus the grand
 * opening's drizzle, coins, dust: 400 leaves room so a burst never takes over a burst still in the air.
 */
const POOL_SIZE = 400;
/** Pieces in one confetti burst, and sparks round a badge. */
const CONFETTI_BURST = 18;
const SPARKS = 8;
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

const confettiColours = new WeakMap<Palette, readonly string[]>();

function coloursOf(p: Palette): readonly string[] {
  let c = confettiColours.get(p);
  if (c === undefined) {
    c = [p.strawberry, p.tea, p.matcha, p.caramel, '#7fb8e0', '#b49ad1', p.paper];
    confettiColours.set(p, c);
  }
  return c;
}

function confetti(rc: RenderContext, s: State, x: number, y: number, n: number, spread: number): void {
  const colors = coloursOf(rc.palette);
  const u = rc.layout.actorH;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (rnd(s) - 0.5) * spread;
    const v = u * (3 + rnd(s) * 4);
    const q = s.pool.emit('confetti', x + (rnd(s) - 0.5) * u * 0.4, y, Math.cos(a) * v, Math.sin(a) * v,
      1.6 + rnd(s) * 1.2, u * (0.12 + rnd(s) * 0.08), colors[i % colors.length], u * 5, 1.6);
    q.rot = rnd(s) * 6;
    q.spin = (rnd(s) - 0.5) * 16;
  }
}

function sparks(rc: RenderContext, s: State, x: number, y: number, n: number): void {
  const u = rc.layout.actorH;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    s.pool.emit('spark', x, y, Math.cos(a) * u * 2.2, Math.sin(a) * u * 2.2, 0.7, u * 0.14,
      i % 2 === 0 ? '#ffe08a' : '#fffcf7', 0, 3);
  }
}

/** Grey puffs rising (a shop named at the inspection). */
export function puffs(pool: ParticlePool, x: number, y: number, n: number, u: number, color = '#b9aea4'): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pool.emit('dust', x + Math.cos(a) * u * 0.25, y + Math.sin(a) * u * 0.1, Math.cos(a) * u * 0.8,
      -u * (0.4 + (i % 3) * 0.2), 1 + (i % 4) * 0.15, u * 0.16, color, 0, 1.2);
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
        const coin = s.pool.emit('coin', at.x, at.y - u * 0.1, u * (rnd(s) - 0.5) * 0.8, -u * 4.6, 1.25, u * 0.13, '',
          u * 13);
        coin.spin = 13;
        coin.floor = at.y;
        coin.bounces = 2;
        if (c.shop === 'player' && c.correct) {
          for (let i = 0; i < 2; i++) {
            const h = s.pool.emit('heart', at.x + (i - 0.5) * u * 0.5, at.y - u * 0.3, 0, -u * (1.1 + i * 0.3), 1.2,
              u * 0.2, '', 0, 0.4);
            h.rot = i * 2;
          }
        }
        break;
      }
      case 'inspection': {
        for (const id of c.certified) {
          const slot = slotOf(L, id);
          const at = badgeSpot(L, slot);
          confetti(rc, s, at.x, at.y, CONFETTI_BURST, 2.4);
          sparks(rc, s, at.x, at.y, SPARKS);
        }
        for (const id of c.named) {
          const at = badgeSpot(L, slotOf(L, id));
          puffs(s.pool, at.x, at.y, 8, u);
        }
        break;
      }
      case 'rushStart':
        for (const v of d.shops) {
          if (!v.grandOpening) continue;
          const slot = slotOf(L, v.id);
          confetti(rc, s, slot.rect.x + slot.rect.w * 0.5, slot.row === 'top' ? slot.rect.y + u : slot.rect.y - u,
            CONFETTI_BURST * 2, 2);
        }
        break;
      case 'rushEnd':
        for (let i = 0; i < 6; i++) confetti(rc, s, L.width * (i + 0.5) / 6, L.road.y0, CONFETTI_BURST - 4, 2.2);
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
