// The solo name and the offline queue of finished runs, on this device. Pure (a KeyValueStore in, nothing about the
// network): `flushPending` is handed the function that sends. A run stays queued until the server keeps it, and the
// server counts each runId once, so sending twice is harmless.
import { LIMITS, parseSoloSubmit, soloDisplay, type SoloSubmit } from '../../../../shared/protocol';
import type { KeyValueStore } from '../../game/storage';
import type { SubmitOutcome } from '../../net/soloBoard';

export const SOLO_KEYS = { name: 'pts.solo.name', pending: 'pts.solo.pending' } as const;
const MAX_PENDING = 20;

export function loadName(store: KeyValueStore): string | null {
  const v = store.get(SOLO_KEYS.name);
  const n = v === null ? '' : soloDisplay(v);
  return n.length > 0 && n.length <= LIMITS.nickname ? n : null;
}
/** Stores the name as shown (trimmed); returns it, or null when it is empty or too long (nothing stored). */
export function saveName(store: KeyValueStore, name: string): string | null {
  const n = soloDisplay(name);
  if (n.length === 0 || n.length > LIMITS.nickname) return null;
  store.set(SOLO_KEYS.name, n);
  return n;
}

export function loadPending(store: KeyValueStore): SoloSubmit[] {
  try {
    const v: unknown = JSON.parse(store.get(SOLO_KEYS.pending) ?? '[]');
    if (!Array.isArray(v)) return [];
    return v.flatMap(x => { const p = parseSoloSubmit(x); return p ? [p] : []; });
  } catch { return []; }
}
const savePending = (store: KeyValueStore, list: SoloSubmit[]) =>
  store.set(SOLO_KEYS.pending, list.length === 0 ? null : JSON.stringify(list.slice(-MAX_PENDING)));

/** Queues a run (a run already queued is replaced, so the name can still be set right). */
export function enqueue(store: KeyValueStore, item: SoloSubmit): void {
  savePending(store, [...loadPending(store).filter(p => p.runId !== item.runId), item]);
}
export function dequeue(store: KeyValueStore, runId: string): void {
  savePending(store, loadPending(store).filter(p => p.runId !== runId));
}

/** Every run waiting: those in storage and those held in memory (blocked storage keeps nothing). */
export function allPending(store: KeyValueStore, mem: SoloSubmit[]): SoloSubmit[] {
  const stored = loadPending(store);
  return [...stored, ...mem.filter(m => !stored.some(s => s.runId === m.runId))];
}

/**
 * Sends every waiting run in order; a run leaves the queue (storage and `mem`) when saved or refused for good.
 * `mem` is mutated: it is what still gets sent when storage cannot hold the queue.
 */
export async function flushPending(
  store: KeyValueStore, send: (p: SoloSubmit) => Promise<SubmitOutcome>, mem: SoloSubmit[] = [],
): Promise<{ runId: string; outcome: SubmitOutcome }[]> {
  const done: { runId: string; outcome: SubmitOutcome }[] = [];
  for (const item of allPending(store, mem)) {
    let outcome: SubmitOutcome;
    try { outcome = await send(item); } catch { outcome = { kind: 'retry' }; }
    if (outcome.kind !== 'retry') {
      dequeue(store, item.runId);
      const i = mem.findIndex(m => m.runId === item.runId);
      if (i >= 0) mem.splice(i, 1);
    }
    done.push({ runId: item.runId, outcome });
    // Offline: the rest would only time out the same way.
    if (outcome.kind === 'retry') break;
  }
  return done;
}
