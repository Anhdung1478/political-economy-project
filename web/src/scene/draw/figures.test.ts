import { describe, expect, it } from 'vitest';
import {
  actorSpace, CYCLE_FRAMES, cycleFrame, cycleKey, frameBox, framePhase, framesFor, LOOK_KEYS, lookKey, lookSpace, Lru,
  PACE_STEPS, paceStep, slotKey, staggerOf, stepPace, FRAME_MS, EXTRA_STEPS, loopStep, stepLoop, type FrameLook,
} from './figures';

const look = (o: Partial<FrameLook> = {}): FrameLook =>
  ({ clip: 'walk', view: 'side', mood: 'neutral', blink: 0, flags: 0, ...o });

describe('the LRU', () => {
  it('keeps the most recently used up to its capacity and hands the evicted one back', () => {
    const out: string[] = [];
    const l = new Lru<string>(3, v => out.push(v));
    l.set(1, 1, 'a');
    l.set(1, 2, 'b');
    l.set(2, 1, 'c');
    expect(l.get(1, 1)).toBe('a'); // a is now the most recent
    l.set(3, 1, 'd');
    expect(out).toEqual(['b']);
    expect(l.has(1, 2)).toBe(false);
    expect(l.size).toBe(3);
    l.set(4, 1, 'e');
    expect(out).toEqual(['b', 'c']);
    expect([l.get(1, 1), l.get(3, 1), l.get(4, 1)]).toEqual(['a', 'd', 'e']);
  });

  it('replaces a value under the same key without growing', () => {
    const l = new Lru<number>(2);
    l.set(5, 5, 1);
    l.set(5, 5, 2);
    expect(l.size).toBe(1);
    expect(l.get(5, 5)).toBe(2);
  });

  it('pops the least recently used and clears', () => {
    const l = new Lru<number>(4);
    for (let i = 0; i < 4; i++) l.set(0, i, i);
    l.get(0, 0);
    expect(l.pop()).toBe(1);
    expect(l.size).toBe(3);
    l.clear();
    expect(l.size).toBe(0);
    expect(l.pop()).toBeNull();
    expect(l.get(0, 0)).toBeUndefined();
  });

  it('survives heavy churn with its links intact', () => {
    const l = new Lru<number>(16);
    for (let i = 0; i < 5000; i++) {
      l.set(i % 7, i % 23, i);
      if (i % 3 === 0) l.get((i * 5) % 7, (i * 11) % 23);
    }
    expect(l.size).toBe(16);
    let n = 0;
    while (l.pop() !== null) n++;
    expect(n).toBe(16);
  });
});

describe('frame keys', () => {
  it('walk frames: sixteen per cycle, any number of cycles in, drawn at the middle of their slice', () => {
    expect(cycleFrame(0)).toBe(0);
    expect(cycleFrame(Math.PI)).toBe(CYCLE_FRAMES / 2);
    expect(cycleFrame(Math.PI * 2 * 7 + 0.01)).toBe(0);
    expect(cycleFrame(-0.01)).toBe(CYCLE_FRAMES - 1);
    for (let f = 0; f < CYCLE_FRAMES; f++) expect(cycleFrame(framePhase(f))).toBe(f);
  });

  it('pace steps: walking speed and slower is the first, a run the last, and back', () => {
    expect(paceStep(1)).toBe(0);
    expect(paceStep(0)).toBe(0);
    expect(paceStep(3)).toBe(PACE_STEPS - 1);
    expect(paceStep(9)).toBe(PACE_STEPS - 1);
    for (let s = 0; s < PACE_STEPS; s++) expect(paceStep(stepPace(s))).toBe(s);
  });

  it('a walk with a cup keys the sip, a scared walk the glance back, and back again', () => {
    expect(loopStep('walkDrink', 2.5)).toBe(0); // cup down
    expect(loopStep('walkDrink', 0.05)).toBe(1);
    expect(loopStep('walkDrink', 3.2 * 5 + 1.42)).toBe(15);
    for (let k = 0; k < EXTRA_STEPS; k++) expect(loopStep('walkDrink', stepLoop('walkDrink', k))).toBe(k);
    for (const k of [0, 1]) expect(loopStep('walkScared', stepLoop('walkScared', k))).toBe(k);
    expect(loopStep('walk', 7)).toBe(0);
  });

  it('the look part tells clip, view, mood, blink and flags apart, within its space', () => {
    const seen = new Set<number>();
    for (const clip of ['walk', 'idle', 'stomp'] as const) {
      for (const view of ['side', 'front', 'back'] as const) {
        for (const mood of ['neutral', 'angry'] as const) {
          for (const blink of [0, 1]) {
            for (let flags = 0; flags < 8; flags++) {
              const k = lookKey(look({ clip, view, mood, blink, flags }));
              expect(k).toBeGreaterThanOrEqual(0);
              expect(k).toBeLessThan(LOOK_KEYS);
              seen.add(k);
            }
          }
        }
      }
    }
    expect(seen.size).toBe(3 * 3 * 2 * 2 * 8);
  });

  it('a walk frame differs by frame and pace, an actor\'s own frame by refresh slot', () => {
    const l = look();
    expect(cycleKey(l, 3, 0)).not.toBe(cycleKey(l, 4, 0));
    expect(cycleKey(l, 3, 0)).not.toBe(cycleKey(l, 3, 1));
    expect(cycleKey(l, 3, 0) % LOOK_KEYS).toBe(lookKey(l));
    const idle = look({ clip: 'idle' });
    const ms = FRAME_MS.idle;
    expect(slotKey(idle, ms * 20, 0)).toBe(slotKey(idle, ms * 21 - 1, 0));
    expect(slotKey(idle, ms * 20, 0)).not.toBe(slotKey(idle, ms * 21, 0));
    // Huge wall clocks stay exact integers.
    expect(Number.isSafeInteger(slotKey(idle, 1e10, 99))).toBe(true);
  });

  it('looks and actors have separate key spaces; staggers spread over 100 ms', () => {
    expect(lookSpace(0xffffffff)).toBe(0xffffffff);
    expect(actorSpace(0)).toBeLessThan(0);
    expect(actorSpace(5)).not.toBe(actorSpace(6));
    const st = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const s = staggerOf(i);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(100);
      st.add(Math.floor(s / 10));
    }
    expect(st.size).toBe(10);
  });

  it('every frame of a zoom has one size, room for the tallest; the budget caps how many', () => {
    const a = frameBox(38, 2);
    expect(a.pw % 2).toBe(0);
    expect(a.ax).toBe(a.pw / 2);
    expect(a.ay).toBeGreaterThan(38 * 2 * 1.06);
    expect(a.ph).toBeGreaterThan(a.ay);
    expect(framesFor(a.pw, a.ph)).toBeGreaterThanOrEqual(64);
    expect(framesFor(a.pw, a.ph)).toBeLessThanOrEqual(400);
    expect(framesFor(2000, 2000)).toBe(64);
    expect(framesFor(10, 10)).toBe(400);
  });
});
