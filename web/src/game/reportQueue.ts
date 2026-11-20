// The phone's report queue (spec §11): the votes and the finished days of a class run wait here until the server
// answers, in order, one at a time, without duplicates, and survive a reload. Any reply from the server (ok or not,
// `wrongSession` included) means "handled, drop it"; only a timeout means "send again". The queue belongs to one
// session code: when the session changes (host Reset), the old queue is dropped.
import { type Ack, parseDaySummary, parseVote, type Vote } from '../../../shared/protocol';
import type { DaySummary } from '../../../shared/sim/types';
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
}

export const emptyQueue = (code: string | null = null): ReportQueue => ({ code, seq: 0, items: [], inFlight: null, sent: [] });

/** The storage key of a session's queue. */
export const queueKey = (code: string) => `pts.queue.${code}`;

const dayKey = (p: DayPayload) => `${p.runId}:${p.summary.day}`;

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

/** The server answered item `id` (ok or not): drop it. */
export function ack(q: ReportQueue, id: string): ReportQueue {
  const item = q.items.find(i => i.id === id);
  if (!item) return q;
  return {
    ...q,
    items: q.items.filter(i => i !== item),
    inFlight: q.inFlight === id ? null : q.inFlight,
    sent: item.kind === 'day' ? [...q.sent, dayKey(item.payload)] : q.sent,
  };
}

/** No answer for item `id`: it stays first and is sent again by the next `next`. */
export function timeout(q: ReportQueue, id: string): ReportQueue {
  return q.inFlight === id ? { ...q, inFlight: null } : q;
}

export function serialize(q: ReportQueue): string {
  return JSON.stringify({ v: 1, code: q.code, seq: q.seq, items: q.items, sent: q.sent });
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
    return { code, seq: o.seq as number, items: items as QueueItem[], inFlight: null, sent: o.sent as string[] };
  } catch {
    return emptyQueue(code);
  }
}

export interface OutboxOptions {
  store: KeyValueStore;
  /** Sends one item; resolves with the server's reply, or a reply `isTimeout` recognises. */
  send: (item: QueueItem) => Promise<Ack>;
  isTimeout: (r: Ack) => boolean;
  /** Every real reply, e.g. the rank of a day. */
  onReply?: (item: QueueItem, reply: Ack) => void;
  /** Wait before resending after a timeout. */
  retryMs?: number;
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

  const save = () => { if (q.code !== null) opts.store.set(queueKey(q.code), serialize(q)); };
  const pump = () => {
    if (!isOnline) return;
    const n = next(q);
    if (!n) return;
    q = n.queue;
    const { item } = n;
    void opts.send(item).then(r => {
      if (opts.isTimeout(r)) {
        q = timeout(q, item.id);
        if (retry === null) retry = setTimeout(() => { retry = null; pump(); }, retryMs);
        return;
      }
      q = ack(q, item.id);
      save();
      opts.onReply?.(item, r);
      pump();
    });
  };

  return {
    setCode(code) {
      if (q.code === code) return;
      if (q.code !== null) opts.store.set(queueKey(q.code), null);
      q = restore(opts.store.get(queueKey(code)), code);
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
