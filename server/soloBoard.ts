// The solo leaderboard: one best score per name (name keyed trimmed, spaces collapsed, case-insensitive), the top
// SOLO_BOARD_SIZE shown. A run is counted once (`runId`), so a phone resending from its offline queue is harmless.
// Scores are trusted from the device, like class mode's (spec §11): the board is for fun, not for prizes.
// Saved to a JSON file with the same atomic writes as the session file; a corrupt file is kept as `.corrupt`.
import { readFileSync, renameSync } from 'node:fs';
import {
  SOLO_BOARD_SIZE, soloDisplay, soloKey, type SoloBoard as SoloBoardView, type SoloEntry,
} from '../shared/protocol';
import { createSaver, type Log } from './sessionFile';

export const DEFAULT_SOLO_BOARD_FILE = '.data/solo-board.json';
/** Names kept (the best ones); the board shows SOLO_BOARD_SIZE of them. */
export const SOLO_STORE_MAX = 2000;
/** The file is written at most this often; a submission is answered after the write that holds it. */
const SAVE_EVERY_MS = 1000;
/** Run ids remembered for dedupe; the oldest are forgotten first. */
const MAX_SEEN = 5000;
const defaultLog: Log = (message, err) => { console.error(`[solo] ${message}`, err ?? ''); };

export function soloBoardFilePath(env: Record<string, string | undefined> = process.env): string {
  return env.SOLO_BOARD_FILE || DEFAULT_SOLO_BOARD_FILE;
}

export interface SoloSubmitResult { rank: number; best: number; improved: boolean; onBoard: boolean }
/** What `submit` returns inside the server: the answer, and whether this call changed the board (not a resend). */
export type SoloSubmitOutcome = SoloSubmitResult & { changed: boolean };
/** What a submission answered, kept per runId so a resend gets the same reading back (not "no change"). */
interface Seen { key: string; best: number; improved: boolean }
/** Why a submission was refused: its runId already counted for another name. */
export interface SoloRefused { refused: 'runIdUsed' }
interface Saved { version: 2; entries: SoloEntry[]; seen: [string, string, number, boolean][] }

/**
 * At most `maxEntries` names are kept (the best ones): junk names cannot grow the board, the file or the work per
 * submission without bound. `order` is the entries sorted best first, so a rank is a binary search.
 */
export class SoloBoard {
  private readonly byKey = new Map<string, SoloEntry>();
  private order: SoloEntry[] = [];
  private readonly seen = new Map<string, Seen>();

  constructor(
    private readonly persist: (b: SoloBoard) => void = () => {},
    saved?: unknown,
    readonly maxEntries = SOLO_STORE_MAX,
  ) {
    const s = saved as Partial<Saved> | undefined;
    if (s === undefined) return;
    if (!Array.isArray(s.entries) || !Array.isArray(s.seen)) throw new Error('bad solo board file');
    for (const e of s.entries) {
      if (typeof e?.name !== 'string' || !Number.isFinite(e.score) || !Number.isFinite(e.at)) throw new Error('bad entry');
      const key = soloKey(e.name);
      if (key.length > 0 && !this.byKey.has(key)) this.byKey.set(key, { name: soloDisplay(e.name), score: e.score, at: e.at });
    }
    this.order = [...this.byKey.values()].sort(before).slice(0, maxEntries);
    this.byKey.clear();
    for (const e of this.order) this.byKey.set(soloKey(e.name), e);
    for (const r of s.seen) {
      if (Array.isArray(r) && typeof r[0] === 'string' && typeof r[1] === 'string' && Number.isFinite(r[2])) {
        this.seen.set(r[0], { key: r[1], best: r[2] as number, improved: r[3] === true });
      }
    }
  }

  /** 1 + the entries with a strictly better score. */
  private rankOf(score: number): number {
    let lo = 0;
    let hi = this.order.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.order[mid]!.score > score) lo = mid + 1; else hi = mid;
    }
    return lo + 1;
  }
  private insert(e: SoloEntry) {
    let lo = 0;
    let hi = this.order.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (before(this.order[mid]!, e) <= 0) lo = mid + 1; else hi = mid;
    }
    this.order.splice(lo, 0, e);
  }
  private remember(runId: string, r: Seen) {
    this.seen.set(runId, r);
    if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.keys().next().value as string);
  }

  /** `name` and `score` are already checked (`parseSoloSubmit`). */
  submit(name: string, score: number, runId: string, now = Date.now()): SoloSubmitOutcome | SoloRefused {
    const key = soloKey(name);
    const cur = this.byKey.get(key);
    const was = this.seen.get(runId);
    if (was !== undefined) {
      if (was.key !== key) return { refused: 'runIdUsed' };
      // A resend: the answer of the first time, with the rank and best as they stand now.
      const best = cur?.score ?? was.best;
      return { rank: this.rankOf(best), best, improved: was.improved, onBoard: cur !== undefined, changed: false };
    }
    let improved = false;
    if (cur === undefined) {
      // A new name enters only if there is room or it beats the last one.
      const last = this.order[this.order.length - 1];
      if (this.order.length < this.maxEntries || (last !== undefined && score > last.score)) {
        if (this.order.length >= this.maxEntries) this.byKey.delete(soloKey(this.order.pop()!.name));
        const e = { name: soloDisplay(name), score, at: now };
        this.byKey.set(key, e);
        this.insert(e);
        improved = true;
      }
    } else if (score > cur.score) {
      this.order.splice(this.order.indexOf(cur), 1);
      const e = { name: soloDisplay(name), score, at: now };
      this.byKey.set(key, e);
      this.insert(e);
      improved = true;
    }
    const on = this.byKey.get(key);
    const best = on?.score ?? score;
    this.remember(runId, { key, best, improved });
    this.persist(this);
    return { rank: this.rankOf(best), best, improved, onBoard: on !== undefined, changed: improved };
  }

  view(limit = SOLO_BOARD_SIZE): SoloBoardView {
    return { entries: this.order.slice(0, limit), total: this.order.length };
  }

  /** Empties the board (run ids are kept, so an old queued run does not come back after the reset). */
  reset(): void {
    this.byKey.clear();
    this.order = [];
    this.persist(this);
  }

  toJSON(): Saved {
    return { version: 2, entries: this.order, seen: [...this.seen].map(([id, r]) => [id, r.key, r.best, r.improved]) };
  }
}

/** Best first; ties by who got there first. */
const before = (a: SoloEntry, b: SoloEntry) => b.score - a.score || a.at - b.at;

/** The saved board, or an empty one (missing file; an unreadable one is renamed `<file>.corrupt` and logged). */
export function loadSoloBoard(file: string, persist?: (b: SoloBoard) => void, log: Log = defaultLog): SoloBoard {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`cannot read ${file}, starting an empty board`, err);
    return new SoloBoard(persist);
  }
  try {
    return new SoloBoard(persist, JSON.parse(text));
  } catch (err) {
    log(`${file} is corrupt, starting an empty board (kept as ${file}.corrupt)`, err);
    try { renameSync(file, `${file}.corrupt`); } catch (e) { log(`cannot rename ${file}`, e); }
    return new SoloBoard(persist);
  }
}

/**
 * A board that saves itself (debounced, atomic) to `file`. `flush` writes now (shutdown); `commit` waits for the next
 * batched write, at most one per SAVE_EVERY_MS however many submissions arrive, and resolves whether it saved.
 */
export function createSavedSoloBoard(file: string, log: Log = defaultLog, delayMs = 500, batchMs = SAVE_EVERY_MS) {
  const saver = createSaver(file, delayMs, log);
  const board = loadSoloBoard(file, b => saver.save(() => b.toJSON()), log);
  let waiting: Promise<boolean> | null = null;
  const commit = () => (waiting ??= new Promise<boolean>(res => {
    const t = setTimeout(() => { waiting = null; void saver.flush().then(res); }, batchMs);
    t.unref?.();
  }));
  return { board, flush: () => saver.flush(), commit };
}
