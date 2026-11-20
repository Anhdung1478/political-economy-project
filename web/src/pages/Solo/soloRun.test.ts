import { describe, expect, it } from 'vitest';
import { KEYS, save, startRun } from '../../game/runStore';
import { memoryStore } from '../../game/storage';
import { clearSavedRun, newRunId, randomSeed, titleInfo } from './soloRun';

describe('solo helpers', () => {
  it('seeds are 32-bit non-negative integers', () => {
    expect(randomSeed(a => { a[0] = 0xffffffff; return a; })).toBe(4294967295);
    const s = randomSeed();
    expect(Number.isInteger(s) && s >= 0 && s < 2 ** 32).toBe(true);
  });
  it('run ids differ by seed', () => {
    expect(newRunId(1, 5)).not.toBe(newRunId(1, 6));
    expect(newRunId(1, 5)).toMatch(/^solo-/);
  });
  it('title offers nothing on an empty device', () => {
    expect(titleInfo(memoryStore())).toEqual({ resumeDay: null, best: null });
  });
  it('title offers resume for an unfinished run and the best', () => {
    const store = memoryStore({ [KEYS.best]: '1234' });
    save(store, KEYS.solo, startRun(7, 'r1'));
    expect(titleInfo(store)).toEqual({ resumeDay: 1, best: 1234 });
    store.set(`${KEYS.solo}.title`, 'r1:1');
    clearSavedRun(store);
    expect(store.get(`${KEYS.solo}.title`)).toBeNull();
    expect(titleInfo(store).resumeDay).toBeNull();
  });
  it('a finished run is not resumable', () => {
    const store = memoryStore();
    const s = startRun(7, 'r1');
    save(store, KEYS.solo, { ...s, run: { ...s.run, phase: 'end' } });
    expect(titleInfo(store).resumeDay).toBeNull();
  });
});
