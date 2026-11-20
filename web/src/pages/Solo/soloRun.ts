// Solo's small pure helpers: a fresh run's seed and id, and what the title offers from what the device has saved.
import { KEYS, load, loadBest } from '../../game/runStore';
import type { KeyValueStore } from '../../game/storage';

/** A random 32-bit seed (as a non-negative integer, so it survives JSON and the sim's integer checks). */
export function randomSeed(fill: (a: Uint32Array) => Uint32Array = a => crypto.getRandomValues(a)): number {
  return fill(new Uint32Array(1))[0]! >>> 0;
}

export function newRunId(now: number = Date.now(), seed: number = randomSeed()): string {
  return `solo-${now.toString(36)}-${seed.toString(36)}`;
}

export interface TitleInfo {
  /** An unfinished run is saved: the day it stands at, else null. */
  resumeDay: number | null;
  best: number | null;
}

/** What the title shows: a run to resume (saved and not at its end) and the personal best. */
export function titleInfo(store: KeyValueStore): TitleInfo {
  const saved = load(store, KEYS.solo);
  const resumeDay = saved !== null && saved.run.phase !== 'end' ? saved.run.day : null;
  return { resumeDay, best: loadBest(store, KEYS.best) };
}

/** Forgets the saved run (and its day-title mark) so a new run starts fresh instead of resuming. */
export function clearSavedRun(store: KeyValueStore): void {
  store.set(KEYS.solo, null);
  store.set(`${KEYS.solo}.title`, null);
}
