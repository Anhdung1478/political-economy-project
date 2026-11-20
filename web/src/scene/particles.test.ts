import { describe, expect, it } from 'vitest';
import { fadeOut, ParticlePool } from './particles';

describe('the particle pool', () => {
  it('spawns into preallocated particles and reuses them: no new objects', () => {
    const pool = new ParticlePool(8);
    const objects = new Set(pool.items);
    for (let i = 0; i < 50; i++) {
      pool.spawn({ kind: 'confetti', x: i, y: 0, life: 0.5, size: 1 });
      pool.step(0.1);
    }
    expect(pool.items).toHaveLength(8);
    for (const p of pool.items) expect(objects.has(p)).toBe(true);
  });

  it('drops the dead and keeps the living packed at the front', () => {
    const pool = new ParticlePool(10);
    pool.spawn({ kind: 'dust', x: 0, y: 0, life: 0.15, size: 1 });
    pool.spawn({ kind: 'coin', x: 1, y: 0, life: 1, size: 1 });
    pool.spawn({ kind: 'dust', x: 2, y: 0, life: 0.15, size: 1 });
    pool.spawn({ kind: 'heart', x: 3, y: 0, life: 1, size: 1 });
    pool.step(0.2);
    expect(pool.count).toBe(2);
    expect(pool.items.slice(0, 2).map(p => p.kind).sort()).toEqual(['coin', 'heart']);
  });

  it('when full, takes over the particle furthest through its life', () => {
    const pool = new ParticlePool(3);
    pool.spawn({ kind: 'dust', x: 0, y: 0, life: 10, size: 1 });
    pool.step(1);
    pool.spawn({ kind: 'dust', x: 1, y: 0, life: 2, size: 1 });
    pool.spawn({ kind: 'dust', x: 2, y: 0, life: 10, size: 1 });
    pool.step(1);
    // Now: x0 at 2/10, x1 at 1/2, x2 at 1/10. The next spawn replaces x1.
    pool.spawn({ kind: 'coin', x: 9, y: 0, life: 1, size: 1 });
    expect(pool.count).toBe(3);
    expect(pool.items.map(p => p.x).sort((a, b) => a - b)).toEqual([0, 2, 9]);
  });

  it('moves with velocity, gravity and drag; a coin bounces on its floor, then rests', () => {
    const pool = new ParticlePool(2);
    const c = pool.spawn({ kind: 'coin', x: 0, y: 0, vy: -10, life: 5, size: 1, gravity: 40, floor: 0, bounces: 1 });
    let lowest = 0;
    let rose = false;
    for (let i = 0; i < 300; i++) {
      pool.step(1 / 60);
      lowest = Math.max(lowest, c.y);
      if (c.y < -0.5) rose = true;
    }
    expect(rose).toBe(true);
    expect(lowest).toBeLessThanOrEqual(1e-9);
    expect(c.y).toBe(0);
    expect(c.vy).toBe(0);
  });

  it('fades out over the end of its life', () => {
    const pool = new ParticlePool(1);
    const p = pool.spawn({ kind: 'heart', x: 0, y: 0, life: 1, size: 1 });
    expect(fadeOut(p)).toBe(1);
    p.age = 0.85;
    expect(fadeOut(p)).toBeCloseTo(0.5);
  });
});
