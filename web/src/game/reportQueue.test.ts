import { describe, expect, it } from 'vitest';
import { daySummary } from '../../../shared/protocol.fixtures';
import type { Ack } from '../../../shared/protocol';
import type { Day, DaySummary } from '../../../shared/sim/types';
import {
  ack, createOutbox, emptyQueue, enqueue, next, QUEUE_KEY, restore, resync, serialize, setCode, timeout,
  type QueueItem, type ReportQueue,
} from './reportQueue';
import { memoryStore } from './storage';

const day = (d: 1 | 2 | 3 | 4 | 5, runId = 'r1') => ({ runId, summary: daySummary({ day: d }) });
const vote = (when: 'before' | 'after', choice: 'invisible' | 'visible' = 'visible') => ({ when, choice });

function drain(q: ReportQueue): { q: ReportQueue; sent: QueueItem[] } {
  const sent: QueueItem[] = [];
  for (let n = next(q); n; n = next(q)) {
    sent.push(n.item);
    q = ack(n.queue, n.item.id);
  }
  return { q, sent };
}

describe('report queue', () => {
  it('sends items in order, one at a time, tagged with the session code', () => {
    let q = emptyQueue();
    q = enqueue(q, 'ABCD', 'vote', vote('before'));
    q = enqueue(q, 'ABCD', 'day', day(1));
    q = enqueue(q, 'ABCD', 'day', day(2));
    const first = next(q)!;
    expect(first.item).toMatchObject({ kind: 'vote', code: 'ABCD' });
    // While the first is in flight, nothing else goes out.
    expect(next(first.queue)).toBeNull();
    const { sent } = drain(q);
    expect(sent.map(i => i.kind)).toEqual(['vote', 'day', 'day']);
    expect(sent.map(i => (i.kind === 'day' ? i.payload.summary.day : 0))).toEqual([0, 1, 2]);
    expect(new Set(sent.map(i => i.id)).size).toBe(3);
  });

  it('drops an item on any reply and resends only after a timeout', () => {
    let q = enqueue(emptyQueue(), 'ABCD', 'day', day(1));
    q = enqueue(q, 'ABCD', 'day', day(2));
    const a = next(q)!;
    q = timeout(a.queue, a.item.id);
    const again = next(q)!;
    expect(again.item.id).toBe(a.item.id);
    q = ack(again.queue, a.item.id); // an error reply (e.g. wrongSession) is handled the same way
    expect(q.items.map(i => (i.kind === 'day' ? i.payload.summary.day : 0))).toEqual([2]);
    expect(next(q)!.item.kind).toBe('day');
  });

  it('ignores stale acks and timeouts', () => {
    let q = enqueue(emptyQueue(), 'ABCD', 'day', day(1));
    const a = next(q)!;
    q = ack(a.queue, 'nope');
    expect(q.items).toHaveLength(1);
    expect(next(q)).toBeNull(); // still in flight
    q = timeout(q, 'nope');
    expect(next(q)).toBeNull();
  });

  it('never queues the same day twice', () => {
    let q = enqueue(emptyQueue(), 'ABCD', 'day', day(1));
    q = enqueue(q, 'ABCD', 'day', day(1));
    expect(q.items).toHaveLength(1);
    // Already sent and acked: queued again it would be a duplicate too.
    q = drain(q).q;
    q = enqueue(q, 'ABCD', 'day', day(1));
    expect(q.items).toHaveLength(0);
    q = enqueue(q, 'ABCD', 'day', day(2));
    expect(q.items).toHaveLength(1);
  });

  it('keeps one pending vote per moment: a newer choice replaces a queued one', () => {
    let q = enqueue(emptyQueue(), 'ABCD', 'vote', vote('before', 'visible'));
    q = enqueue(q, 'ABCD', 'vote', vote('before', 'invisible'));
    expect(q.items).toHaveLength(1);
    expect(q.items[0].payload).toEqual(vote('before', 'invisible'));
    // Same choice again: nothing to send.
    q = enqueue(q, 'ABCD', 'vote', vote('before', 'invisible'));
    expect(q.items).toHaveLength(1);
    // In flight: a change is queued after it rather than rewriting what is on the wire.
    const f = next(q)!;
    q = enqueue(f.queue, 'ABCD', 'vote', vote('before', 'visible'));
    expect(q.items).toHaveLength(2);
    q = enqueue(q, 'ABCD', 'vote', vote('after'));
    expect(q.items).toHaveLength(3);
  });

  it('drops the queue of an old session code', () => {
    let q = enqueue(emptyQueue(), 'ABCD', 'day', day(1));
    q = setCode(q, 'ABCD');
    expect(q.items).toHaveLength(1);
    q = setCode(q, 'WXYZ');
    expect(q).toMatchObject({ code: 'WXYZ', items: [] });
    // Enqueuing under a new code also starts over.
    q = enqueue(enqueue(q, 'WXYZ', 'day', day(1)), 'EFGH', 'day', day(1, 'r2'));
    expect(q.items.map(i => i.code)).toEqual(['EFGH']);
    // A day 1 of a new session is not a duplicate of the old one.
    expect(q.items).toHaveLength(1);
  });

  it('survives a reload through serialize/restore, for the same code only', () => {
    let q = enqueue(emptyQueue(), 'ABCD', 'vote', vote('before'));
    q = enqueue(q, 'ABCD', 'day', day(1));
    q = enqueue(q, 'ABCD', 'day', day(2));
    q = drain(q).q; // everything acked
    q = enqueue(q, 'ABCD', 'day', day(3));
    const f = next(q)!; // in flight when the page reloads
    const text = serialize(f.queue);
    const back = restore(text, 'ABCD');
    expect(back.items).toHaveLength(1);
    // In flight is not kept: after a reload it is sent again (a duplicate the server ignores).
    expect(next(back)!.item.id).toBe(f.item.id);
    // Ids keep counting, and acked days stay remembered.
    const more = enqueue(back, 'ABCD', 'day', day(2));
    expect(more.items).toHaveLength(1);
    const d4 = enqueue(back, 'ABCD', 'day', day(4));
    expect(d4.items[1].id).not.toBe(d4.items[0].id);
    expect(restore(text, 'WXYZ')).toEqual(emptyQueue('WXYZ'));
    expect(restore('not json', 'ABCD')).toEqual(emptyQueue('ABCD'));
    expect(restore(null, 'ABCD')).toEqual(emptyQueue('ABCD'));
    expect(restore(JSON.stringify({ v: 1, code: 'ABCD', seq: 1, items: [{ junk: true }], sent: [] }), 'ABCD'))
      .toEqual(emptyQueue('ABCD'));
  });
});

describe('resync', () => {
  const days = (...ds: Day[]) => ds.map(d => daySummary({ day: d }));
  const dayOf = (i: QueueItem) => (i.kind === 'day' ? i.payload.summary.day : 0);
  it('puts the missing days first, in order, and forgets that they were answered', () => {
    let q = emptyQueue();
    for (const d of [1, 2, 3] as Day[]) q = enqueue(q, 'ABCD', 'day', day(d));
    q = drain(q).q;
    q = enqueue(q, 'ABCD', 'day', day(4));
    q = enqueue(q, 'ABCD', 'vote', vote('after'));
    const inFlight = next(q)!;
    const fixed = resync(inFlight.queue, inFlight.item.id, days(4, 2, 3, 2), 2)!;
    expect(fixed.inFlight).toBeNull();
    expect(fixed.items.map(i => `${i.kind}${dayOf(i)}`)).toEqual(['day2', 'day3', 'day4', 'vote0']);
    expect(fixed.sent).toEqual(['r1:1']);
    expect(new Set(fixed.items.map(i => i.id)).size).toBe(4);
  });
  it('keeps the item when the source stops before it, and refuses a source without the expected day', () => {
    let q = enqueue(emptyQueue(), 'ABCD', 'day', day(4));
    const n = next(q)!;
    q = resync(n.queue, n.item.id, days(2, 3), 2)!;
    expect(q.items.map(dayOf)).toEqual([2, 3, 4]);
    const m = next(q)!;
    expect(resync(m.queue, m.item.id, days(3), 2)).toBeNull();
    expect(resync(m.queue, m.item.id, [], 2)).toBeNull();
    // A gap stops the list: day 4 is not taken from the source, the queued one stays.
    const r = resync(m.queue, m.item.id, days(2, 4, 5), 2)!;
    expect(r.items.map(dayOf)).toEqual([2, 3, 4]);
  });
});

describe('outbox', () => {
  type Sent = { item: QueueItem; reply: (r: Ack | 'timeout' | Error) => void };
  function setup(initial: Record<string, string> = {}, onReply?: (item: QueueItem, r: Ack) => void,
    source?: (runId: string, from: Day) => DaySummary[]) {
    const store = memoryStore(initial);
    const sent: Sent[] = [];
    const replies: [QueueItem, Ack][] = [];
    const box = createOutbox({
      store,
      send: item => new Promise((res, rej) => sent.push({
        item, reply: r => (r instanceof Error ? rej(r) : res(r === 'timeout' ? { ok: false, error: 'timeout' } : r)),
      })),
      isTimeout: r => !r.ok && r.error === 'timeout',
      onReply: onReply ?? ((item, r) => replies.push([item, r])),
      retryMs: 1,
      resync: source,
    });
    const tick = () => new Promise(r => setTimeout(r, 5));
    return { store, sent, replies, box, tick };
  }

  it('sends when online, one at a time, and persists what is left', async () => {
    const { sent, replies, box, store, tick } = setup();
    box.setCode('ABCD');
    box.push('day', day(1));
    box.push('day', day(2));
    expect(sent).toHaveLength(0); // offline
    box.online(true);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(store.get(QUEUE_KEY)!).items).toHaveLength(2);
    sent[0].reply({ ok: true, rank: 3 } as Ack);
    await tick();
    expect(replies[0][1]).toEqual({ ok: true, rank: 3 });
    expect(sent).toHaveLength(2);
    sent[1].reply('timeout');
    await tick();
    expect(sent).toHaveLength(3); // retried
    expect(sent[2].item.id).toBe(sent[1].item.id);
    box.online(false);
    sent[2].reply({ ok: false, error: 'wrongSession' });
    await tick();
    expect(box.pending()).toBe(0);
    expect(JSON.parse(store.get(QUEUE_KEY)!).items).toHaveLength(0);
  });

  it('keeps an item answered unknownPlayer (not attached yet) and resends it', async () => {
    const { sent, replies, box, tick } = setup();
    box.setCode('ABCD');
    box.push('day', day(1));
    box.online(true);
    sent[0].reply({ ok: false, error: 'unknownPlayer' });
    await tick();
    expect(box.pending()).toBe(1);
    expect(replies).toHaveLength(0);
    expect(sent).toHaveLength(2);
    expect(sent[1].item.id).toBe(sent[0].item.id);
    sent[1].reply({ ok: true, rank: 1 } as Ack);
    await tick();
    expect(box.pending()).toBe(0);
  });

  it('treats a failed send as a timeout', async () => {
    const { sent, box, tick } = setup();
    box.setCode('ABCD');
    box.push('day', day(1));
    box.online(true);
    sent[0].reply(new Error('boom'));
    await tick();
    expect(box.pending()).toBe(1);
    expect(sent).toHaveLength(2);
  });

  it('keeps sending when onReply throws', async () => {
    const { sent, box, tick } = setup({}, () => { throw new Error('ui bug'); });
    box.setCode('ABCD');
    box.push('day', day(1));
    box.push('day', day(2));
    box.online(true);
    sent[0].reply({ ok: true, rank: 1 } as Ack);
    await tick();
    expect(sent).toHaveLength(2);
    expect(box.pending()).toBe(1);
  });

  it('keeps one saved queue, so a reload after a reset leaves nothing stale', () => {
    const first = setup();
    first.box.setCode('ABCD');
    first.box.push('day', day(1));
    // Page reloaded after the host pressed Reset: the first state carries the new code.
    const { box, store } = setup({ [QUEUE_KEY]: first.store.get(QUEUE_KEY)! });
    box.setCode('WXYZ');
    expect(box.pending()).toBe(0);
    const saved = store.get(QUEUE_KEY);
    expect(saved === null || JSON.parse(saved).code === 'WXYZ').toBe(true);
    box.push('vote', vote('before'));
    expect(JSON.parse(store.get(QUEUE_KEY)!)).toMatchObject({ code: 'WXYZ', items: [{ kind: 'vote' }] });
  });

  it('restores a saved queue and clears the old code on a reset', async () => {
    const first = setup();
    first.box.setCode('ABCD');
    first.box.push('vote', vote('before'));
    const saved = first.store.get(QUEUE_KEY)!;
    const { box, sent, store } = setup({ [QUEUE_KEY]: saved });
    box.setCode('ABCD');
    expect(box.pending()).toBe(1);
    box.setCode('WXYZ');
    expect(box.pending()).toBe(0);
    expect(JSON.parse(store.get(QUEUE_KEY)!)).toMatchObject({ code: 'WXYZ', items: [] });
    box.online(true);
    expect(sent).toHaveLength(0);
  });

  it('keeps an accepted item the server could not save (durable: false) and resends it', async () => {
    const { sent, replies, box, tick } = setup();
    box.setCode('ABCD');
    box.push('day', day(1));
    box.online(true);
    sent[0].reply({ ok: true, rank: 1, durable: false } as Ack);
    await tick();
    expect(box.pending()).toBe(1);
    expect(replies).toHaveLength(0);
    expect(sent[1].item.id).toBe(sent[0].item.id);
    sent[1].reply({ ok: true, rank: 1 } as Ack);
    await tick();
    expect(box.pending()).toBe(0);
    expect(replies).toHaveLength(1);
  });

  it('resends the days a restarted server lost (notNext with a lower expected day), then goes on', async () => {
    const reports = [1, 2, 3, 4].map(d => daySummary({ day: d as Day, score: d * 100 }));
    const asked: [string, Day][] = [];
    const { sent, replies, box, tick } = setup({}, undefined, (runId, from) => {
      asked.push([runId, from]);
      return runId === 'r1' ? reports.filter(r => r.day >= from) : [];
    });
    box.setCode('ABCD');
    box.online(true);
    for (const d of [1, 2, 3] as Day[]) {
      box.push('day', day(d));
      sent[sent.length - 1].reply({ ok: true, rank: 1 } as Ack);
      await tick();
    }
    // The server restarted and lost days 2 and 3.
    box.push('day', day(4));
    sent[3].reply({ ok: false, error: 'notNext', expected: 2 } as Ack);
    await tick();
    expect(asked).toEqual([['r1', 2]]);
    expect(replies).toHaveLength(3); // the refusal is not a reply to show
    for (const want of [2, 3, 4]) {
      const s = sent[sent.length - 1];
      expect(s.item.kind === 'day' && s.item.payload.summary).toEqual(reports[want - 1]);
      s.reply({ ok: true, rank: 1 } as Ack);
      await tick();
    }
    expect(box.pending()).toBe(0);
    expect(sent).toHaveLength(7);
  });

  it('drops a day the server already has (notNext with a higher expected day) or cannot resync', async () => {
    const { sent, replies, box, tick } = setup({}, undefined, () => []);
    box.setCode('ABCD');
    box.push('day', day(2));
    box.push('day', day(3, 'r2'));
    box.online(true);
    sent[0].reply({ ok: false, error: 'notNext', expected: 4 } as Ack);
    await tick();
    expect(box.pending()).toBe(1);
    sent[1].reply({ ok: false, error: 'notNext', expected: 1 } as Ack); // nothing to resend from
    await tick();
    expect(box.pending()).toBe(0);
    expect(replies.map(r => r[1])).toEqual([
      { ok: false, error: 'notNext', expected: 4 }, { ok: false, error: 'notNext', expected: 1 }]);
  });
});
