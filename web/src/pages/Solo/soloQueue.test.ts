import { describe, expect, it } from 'vitest';
import type { SoloBoard } from '../../../../shared/protocol';
import { memoryStore } from '../../game/storage';
import type { SubmitOutcome } from '../../net/soloBoard';
import { ranked } from './SoloBoardView';
import { dequeue, enqueue, flushPending, loadName, loadPending, saveName, SOLO_KEYS } from './soloQueue';

const item = (runId: string, score = 10) => ({ name: 'An', score, runId });
const saved: SubmitOutcome = { kind: 'saved', rank: 1, best: 10, improved: true, onBoard: true };

describe('solo name', () => {
  it('stores a tidied name and refuses an empty or too long one', () => {
    const s = memoryStore();
    expect(loadName(s)).toBeNull();
    expect(saveName(s, '  Dũng   đẹp ')).toBe('Dũng đẹp');
    expect(loadName(s)).toBe('Dũng đẹp');
    expect(saveName(s, '   ')).toBeNull();
    expect(saveName(s, 'x'.repeat(21))).toBeNull();
    expect(loadName(s)).toBe('Dũng đẹp');
  });
});

describe('pending queue', () => {
  it('queues, replaces by runId and dequeues', () => {
    const s = memoryStore();
    enqueue(s, item('a'));
    enqueue(s, item('b', 5));
    enqueue(s, { ...item('a'), name: 'Binh' });
    expect(loadPending(s).map(p => [p.runId, p.name])).toEqual([['b', 'An'], ['a', 'Binh']]);
    dequeue(s, 'b');
    expect(loadPending(s)).toHaveLength(1);
    dequeue(s, 'a');
    expect(s.get(SOLO_KEYS.pending)).toBeNull();
  });
  it('ignores garbage in storage', () => {
    expect(loadPending(memoryStore({ [SOLO_KEYS.pending]: '[{"name":""},3,null]' }))).toEqual([]);
    expect(loadPending(memoryStore({ [SOLO_KEYS.pending]: '{oops' }))).toEqual([]);
  });
  it('flush keeps a run that could not be sent and stops at the first failure', async () => {
    const s = memoryStore();
    enqueue(s, item('a'));
    enqueue(s, item('b'));
    const sent: string[] = [];
    const offline = await flushPending(s, async p => { sent.push(p.runId); return { kind: 'retry' }; });
    expect(sent).toEqual(['a']);
    expect(offline).toHaveLength(1);
    expect(loadPending(s)).toHaveLength(2);
    // Back online: both go out and the queue empties; a refused one is dropped too.
    const online = await flushPending(s, async p => (p.runId === 'a' ? saved : { kind: 'rejected' }));
    expect(online.map(d => d.outcome.kind)).toEqual(['saved', 'rejected']);
    expect(loadPending(s)).toEqual([]);
  });
  it('a throwing sender counts as a retry', async () => {
    const s = memoryStore();
    enqueue(s, item('a'));
    await flushPending(s, () => Promise.reject(new Error('x')));
    expect(loadPending(s)).toHaveLength(1);
  });
});

describe('ranked', () => {
  it('shares a rank between equal scores', () => {
    const b: SoloBoard = { total: 4, entries: [
      { name: 'a', score: 9, at: 1 }, { name: 'b', score: 9, at: 2 }, { name: 'c', score: 5, at: 3 }, { name: 'd', score: 1, at: 4 }] };
    expect(ranked(b).map(r => r.rank)).toEqual([1, 1, 3, 4]);
  });
});
