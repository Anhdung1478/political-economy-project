import { describe, expect, it } from 'vitest';
import { backoff, retryUntilOk, type Timers } from './retry';

function fakeTimers() {
  const q: { fn: () => void; ms: number; id: number }[] = [];
  let id = 0;
  const timers: Timers = {
    set: (fn, ms) => { q.push({ fn, ms, id: ++id }); return id; },
    clear: t => { const i = q.findIndex(x => x.id === t); if (i >= 0) q.splice(i, 1); },
  };
  return { timers, q };
}
const tick = () => new Promise(r => setTimeout(r, 0));

describe('backoff', () => {
  it('doubles from min up to max', () => {
    expect([0, 1, 2, 3, 4, 5].map(n => backoff(n, 5000, 60000))).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
  });
});

describe('retryUntilOk', () => {
  it('retries with growing pauses until the attempt succeeds, then stops', async () => {
    const { timers, q } = fakeTimers();
    let calls = 0;
    retryUntilOk(async () => ++calls >= 3, 2000, 30000, timers);
    await tick();
    expect(q.map(x => x.ms)).toEqual([2000]);
    q.shift()!.fn(); await tick();
    expect(q.map(x => x.ms)).toEqual([4000]);
    q.shift()!.fn(); await tick();
    expect(calls).toBe(3);
    expect(q).toHaveLength(0);
  });
  it('cancel stops further tries', async () => {
    const { timers, q } = fakeTimers();
    const cancel = retryUntilOk(async () => false, 1000, 8000, timers);
    await tick();
    cancel();
    expect(q).toHaveLength(0);
  });
});
