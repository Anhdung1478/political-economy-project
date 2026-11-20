// The phone's report queue (spec §11): the votes and the finished days of a class run wait here until the server
// answers, in order, one at a time, without duplicates, and survive a reload. Any reply from the server (ok or not,
// `wrongSession` included) means "handled, drop it"; a timeout, `unknownPlayer` or an accepted-but-unsaved reply
// (`durable: false`) means "send again". A day refused `notNext` with a lower `expected` day (the server restarted
// and lost days) puts the missing days back in front, taken from the run's reports (`resync`). The queue belongs to
// one session code: when the session changes (host Reset), the old queue is dropped.
import { type Ack, isDurable, notNextExpected, parseDaySummary, parseVote, type Vote } from '../../../shared/protocol';
import type { Day, DaySummary } from '../../../shared/sim/types';
import type { KeyValueStore } from './storage';

export interface DayPayload { runId: string; summary: DaySummary }
export interface Payloads { day: DayPayload; vote: Vote }
export type QueueKind = keyof Payloads;
export type QueueItem = { [K in QueueKind]: { id: string; kind: K; code: string; payload: Payloads[K] } }[QueueKind];

export interface ReportQueue {
  /** The session the items belong to; null before the first `state`. */
  code: string | null;
  /** Counter for item ids. */
  seq: number;
  items: QueueItem[];
  /** The item on the wire, if any; not saved (after a reload it is simply sent again). */
  inFlight: string | null;
  /** The days already answered (`runId:day`), so a day queued again is not sent twice. */
  sent: string[];
  /** The days refused for good (`runId:day`, any refusal but `notNext`): never resent, and the later days of that
   *  run are not sent either (the server would only answer them `notNext`). */
  refused: string[];
  /** How many times the server asked for each day again (`runId:day`), capped at `MAX_RESYNCS`. */
  resyncs: Record<string, number>;
}

export const emptyQueue = (code: string | null = null): ReportQueue =>
  ({ code, seq: 0, items: [], inFlight: null, sent: [], refused: [], resyncs: {} });

/** A day the server asks for again more often than this is given up (a bug or a server that keeps losing it). */
export const MAX_RESYNCS = 3;

/** The one storage key of the queue; the session code is inside, so an old session's queue is overwritten. */
export const QUEUE_KEY = 'pts.queue';

/**
 * Replies that mean "not handled yet", resent after the retry delay: the socket is not attached to its player
 * (before `player:resume`), or the market is not open yet (`notOpen`: transient, e.g. a server restarted in the lobby
 * phase, so never a final refusal).
 */
const RETRY_ERRORS: readonly string[] = ['unknownPlayer', 'notOpen'];

const dayKey = (p: DayPayload) => `${p.runId}:${p.summary.day}`;
const keyOf = (runId: string, day: number) => `${runId}:${day}`;
/** A day of this run before `day` was refused for good, so `day` can never be accepted. */
const blocked = (q: ReportQueue, runId: string, day: number) =>
  q.refused.some(k => { const i = k.lastIndexOf(':'); return k.slice(0, i) === runId && Number(k.slice(i + 1)) < day; });

/** The same queue for `code`, or an empty one when the code changed. */
export function setCode(q: ReportQueue, code: string): ReportQueue {
  return q.code === code ? q : emptyQueue(code);
}

/**
 * Adds a report for session `code` (the code of the last `state`). A day already queued or answered is ignored. A
 * vote replaces a queued, not yet sent vote for the same moment; the same choice again is ignored.
 */
export function enqueue<K extends QueueKind>(q: ReportQueue, code: string, kind: K, payload: Payloads[K]): ReportQueue {
  q = setCode(q, code);
  const item = { id: `${code}-${q.seq + 1}`, kind, code, payload } as QueueItem;
  if (item.kind === 'day') {
    const key = dayKey(item.payload);
    if (q.sent.includes(key) || q.items.some(i => i.kind === 'day' && dayKey(i.payload) === key)) return q;
    if (blocked(q, item.payload.runId, item.payload.summary.day)) return q;
  } else {
    const v = item.payload;
    const same = [...q.items].reverse().find(i => i.kind === 'vote' && i.payload.when === v.when);
    if (same?.kind === 'vote' && same.payload.choice === v.choice) return q;
    if (same && same.id !== q.inFlight) {
      return { ...q, items: q.items.map(i => (i === same ? { ...same, payload: v } as QueueItem : i)) };
    }
  }
  return { ...q, seq: q.seq + 1, items: [...q.items, item] };
}

/** The item to send now (the oldest), marked in flight; null when empty or while another is in flight. */
export function next(q: ReportQueue): { queue: ReportQueue; item: QueueItem } | null {
  if (q.inFlight !== null || q.items.length === 0) return null;
  const item = q.items[0];
  return { queue: { ...q, inFlight: item.id }, item };
}

/**
 * The server answered item `id` (ok or not): drop it. A day refused for good (any refusal but `notNext`, given as
 * `reply`) is remembered, and the queued later days of its run are dropped too: they can only be refused `notNext`.
 */
export function ack(q: ReportQueue, id: string, reply?: Ack): ReportQueue {
  const item = q.items.find(i => i.id === id);
  if (!item) return q;
  const final = item.kind === 'day' && reply !== undefined && !reply.ok && notNextExpected(reply) === undefined;
  const hopeless = (i: QueueItem) => final && item.kind === 'day' && i.kind === 'day'
    && i.payload.runId === item.payload.runId && i.payload.summary.day > item.payload.summary.day;
  return {
    ...q,
    items: q.items.filter(i => i !== item && !hopeless(i)),
    inFlight: q.inFlight === id ? null : q.inFlight,
    sent: item.kind === 'day' ? [...q.sent, dayKey(item.payload)] : q.sent,
    refused: final && item.kind === 'day' ? [...q.refused, dayKey(item.payload)] : q.refused,
  };
}

/**
 * Item `id` (a day) was refused `notNext` because the server waits for day `expected`, an earlier one: puts the days
 * of the same run from `expected` on, taken from `summaries` (any order; only the unbroken stretch from `expected`),
 * at the front in day order, replacing queued copies, and forgets they were answered. Null (nothing to resend) when
 * `summaries` lacks day `expected`, when that day was refused for good (resending it would loop), or when it was
 * already asked for `MAX_RESYNCS` times.
 */
export function resync(q: ReportQueue, id: string, summaries: readonly DaySummary[], expected: Day): ReportQueue | null {
  const item = q.items.find(i => i.id === id);
  if (item?.kind !== 'day') return null;
  const { runId } = item.payload;
  const key = keyOf(runId, expected);
  const count = q.resyncs[key] ?? 0;
  if (q.refused.includes(key) || blocked(q, runId, expected) || count >= MAX_RESYNCS) return null;
  const byDay = new Map(summaries.map(s => [s.day, s]));
  const fresh: DaySummary[] = [];
  for (let d = expected; byDay.has(d); d++) fresh.push(byDay.get(d)!);
  if (fresh.length === 0) return null;
  const days = new Set<number>(fresh.map(s => s.day));
  const replaced = (i: QueueItem) => i.kind === 'day' && i.payload.runId === runId && days.has(i.payload.summary.day);
  const front = fresh.map((summary, k) => ({ id: `${item.code}-${q.seq + 1 + k}`, kind: 'day', code: item.code,
    payload: { runId, summary } }) as QueueItem);
  return {
    ...q,
    seq: q.seq + fresh.length,
    items: [...front, ...q.items.filter(i => !replaced(i))],
    inFlight: q.inFlight === id ? null : q.inFlight,
    sent: q.sent.filter(k => !fresh.some(s => k === dayKey({ runId, summary: s }))),
    resyncs: { ...q.resyncs, [key]: count + 1 },
  };
}

/** No answer for item `id`: it stays first and is sent again by the next `next`. */
export function timeout(q: ReportQueue, id: string): ReportQueue {
  return q.inFlight === id ? { ...q, inFlight: null } : q;
}

export function serialize(q: ReportQueue): string {
  return JSON.stringify({ v: 1, code: q.code, seq: q.seq, items: q.items, sent: q.sent, refused: q.refused,
    resyncs: q.resyncs });
}

function restoreItem(x: unknown, code: string): QueueItem | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.code !== code) return null;
  if (o.kind === 'vote') {
    const v = parseVote(o.payload);
    return v && { id: o.id, kind: 'vote', code, payload: v };
  }
  if (o.kind === 'day') {
    const p = o.payload as Record<string, unknown> | null;
    const summary = typeof p === 'object' && p !== null ? parseDaySummary(p.summary) : null;
    if (!summary || typeof p?.runId !== 'string') return null;
    return { id: o.id, kind: 'day', code, payload: { runId: p.runId, summary } };
  }
  return null;
}

/** The saved queue of session `code`, or an empty one when there is none, it is damaged, or of another session. */
export function restore(text: string | null, code: string): ReportQueue {
  try {
    const o = JSON.parse(text ?? 'null') as Record<string, unknown> | null;
    if (!o || o.v !== 1 || o.code !== code || !Number.isInteger(o.seq) || !Array.isArray(o.items)
      || !Array.isArray(o.sent) || !o.sent.every(s => typeof s === 'string')) return emptyQueue(code);
    const items = o.items.map(i => restoreItem(i, code));
    if (items.some(i => i === null)) return emptyQueue(code);
    // `refused` and `resyncs` came later: a queue saved without them (or with garbage) starts them empty.
    const refused = Array.isArray(o.refused) && o.refused.every(s => typeof s === 'string') ? o.refused as string[] : [];
    const resyncs = typeof o.resyncs === 'object' && o.resyncs !== null && !Array.isArray(o.resyncs)
      && Object.values(o.resyncs).every(n => Number.isInteger(n)) ? o.resyncs as Record<string, number> : {};
    return { code, seq: o.seq as number, items: items as QueueItem[], inFlight: null, sent: o.sent as string[], refused, resyncs };
  } catch {
    return emptyQueue(code);
  }
}

export interface OutboxOptions {
  store: KeyValueStore;
  /** Sends one item; resolves with the server's reply, or a reply `isTimeout` recognises. A rejection counts as a
   *  timeout. */
  send: (item: QueueItem) => Promise<Ack>;
  isTimeout: (r: Ack) => boolean;
  /** Every real reply, e.g. the rank of a day. `unknownPlayer` is not one: the item is kept and sent again. */
  onReply?: (item: QueueItem, reply: Ack) => void;
  /** Wait before resending after a timeout. */
  retryMs?: number;
  /**
   * The summaries of run `runId` from day `from` on (the Play screen gives them from `run.reports`; [] for another
   * run). Asked when the server waits for an earlier day than the one sent (it restarted and lost some).
   */
  resync?: (runId: string, from: Day) => readonly DaySummary[];
}

export interface Outbox {
  /** The session code of the latest `state`: loads its saved queue, drops the old one. */
  setCode(code: string): void;
  /** Queues a report for the current session; ignored before the first `setCode`. */
  push<K extends QueueKind>(kind: K, payload: Payloads[K]): void;
  /** Connection status: sending starts when online. */
  online(on: boolean): void;
  /** Reports not answered yet. */
  pending(): number;
}

/** Drives a queue: saves it on every change and sends one item at a time while online. */
export function createOutbox(opts: OutboxOptions): Outbox {
  const retryMs = opts.retryMs ?? 2000;
  let q = emptyQueue();
  let isOnline = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const save = () => { if (q.code !== null) opts.store.set(QUEUE_KEY, serialize(q)); };
  /** While set, nothing is sent (not even on `push` or `online`): the wait before a day asked for again. */
  let hold: ReturnType<typeof setTimeout> | null = null;
  const later = () => {
    if (retry === null) retry = setTimeout(() => { retry = null; pump(); }, retryMs);
  };
  const holdThenPump = () => {
    if (hold === null) hold = setTimeout(() => { hold = null; pump(); }, retryMs);
  };
  const retryLater = (id: string) => {
    q = timeout(q, id);
    later();
  };
  const pump = () => {
    if (!isOnline || hold !== null) return;
    const n = next(q);
    if (!n) return;
    q = n.queue;
    const { item } = n;
    const sent = (() => { try { return opts.send(item); } catch (err) { return Promise.reject(err); } })();
    sent.then(r => {
      if (opts.isTimeout(r) || (!r.ok && RETRY_ERRORS.includes(r.error)) || !isDurable(r)) { retryLater(item.id); return; }
      const expected = item.kind === 'day' ? notNextExpected(r) : undefined;
      if (item.kind === 'day' && expected != null && expected < item.payload.summary.day) {
        const fixed = (() => {
          try { return resync(q, item.id, opts.resync?.(item.payload.runId, expected) ?? [], expected); } catch (err) {
            console.error('[reportQueue] resync failed', err);
            return null;
          }
        })();
        if (fixed) {
          q = fixed;
          save();
          // The first time at once; a day asked for again waits the normal retry delay.
          if ((fixed.resyncs[keyOf(item.payload.runId, expected)] ?? 0) > 1) holdThenPump(); else pump();
          return;
        }
      }
      q = ack(q, item.id, r);
      save();
      try { opts.onReply?.(item, r); } catch (err) { console.error('[reportQueue] onReply failed', err); }
      pump();
    }, () => retryLater(item.id));
  };

  return {
    setCode(code) {
      if (q.code === code) return;
      q = restore(opts.store.get(QUEUE_KEY), code);
      save();
      pump();
    },
    push(kind, payload) {
      if (q.code === null) return;
      q = enqueue(q, q.code, kind, payload);
      save();
      pump();
    },
    online(on) {
      isOnline = on;
      pump();
    },
    pending: () => q.items.length,
  };
}
