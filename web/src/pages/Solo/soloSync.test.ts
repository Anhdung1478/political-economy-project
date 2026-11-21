import { describe, expect, it } from 'vitest';
import { memoryStore, type KeyValueStore } from '../../game/storage';
import type { Timers } from '../../net/retry';
import type { SubmitOutcome } from '../../net/soloBoard';
import { loadPending } from './soloQueue';
import { createSoloSync } from './soloSync';

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
const item = { name: 'An', score: 10, runId: 'r1' };
const saved: SubmitOutcome = { kind: 'saved', rank: 1, best: 10, improved: true, onBoard: true };
const retry: SubmitOutcome = { kind: 'retry' };
/** Storage that holds nothing, like a blocked one. */
const blocked: KeyValueStore = { get: () => null, set: () => {} };

describe('createSoloSync', () => {
  it('retries a failed send with growing pauses, then stops once it is saved', async () => {
    const { timers, q } = fakeTimers();
    const store = memoryStore();
    let ok = false;
    const sent: string[] = [];
    const results: string[] = [];
    const s = createSoloSync({
      store, timers, minMs: 5000, maxMs: 60000,
      send: async p => { sent.push(p.runId); return ok ? saved : retry; },
      onResults: d => results.push(...d.map(x => x.outcome.kind)),
    });
    s.submit(item); await tick();
    expect(q.map(x => x.ms)).toEqual([5000]);
    q.shift()!.fn(); await tick();
    expect(q.map(x => x.ms)).toEqual([10000]);
    ok = true;
    q.shift()!.fn(); await tick();
    expect(q).toHaveLength(0);
    expect(sent).toEqual(['r1', 'r1', 'r1']);
    expect(results).toEqual(['retry', 'retry', 'saved']);
    expect(loadPending(store)).toEqual([]);
    expect(s.hasPending()).toBe(false);
  });

  it('still sends when storage is blocked, and retries from memory', async () => {
    const { timers, q } = fakeTimers();
    let ok = false;
    const s = createSoloSync({ store: blocked, timers, send: async () => (ok ? saved : retry), onResults: () => {} });
    s.submit(item); await tick();
    expect(s.hasPending()).toBe(true);
    ok = true;
    q.shift()!.fn(); await tick();
    expect(s.hasPending()).toBe(false);
  });

  it('reports idle when nothing is left, and a connection wakes it at once', async () => {
    const { timers, q } = fakeTimers();
    let idle = 0;
    let ok = false;
    const s = createSoloSync({
      store: memoryStore(), timers, send: async () => (ok ? saved : retry), onResults: () => {}, onIdle: () => { idle++; },
    });
    s.submit(item); await tick();
    expect(idle).toBe(0);
    ok = true;
    s.run(); await tick();
    expect(idle).toBe(1);
    expect(q).toHaveLength(0);
  });
});
