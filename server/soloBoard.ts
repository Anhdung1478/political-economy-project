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
/** Run ids remembered for dedupe; the oldest are forgotten first. */
const MAX_SEEN = 5000;
const defaultLog: Log = (message, err) => { console.error(`[solo] ${message}`, err ?? ''); };

export function soloBoardFilePath(env: Record<string, string | undefined> = process.env): string {
  return env.SOLO_BOARD_FILE || DEFAULT_SOLO_BOARD_FILE;
}

export interface SoloSubmitResult { rank: number; best: number; improved: boolean }
interface Saved { version: 1; entries: SoloEntry[]; seen: string[] }

export class SoloBoard {
  private readonly byKey = new Map<string, SoloEntry>();
  private readonly seen = new Set<string>();

  constructor(private readonly persist: (b: SoloBoard) => void = () => {}, saved?: unknown) {
    const s = saved as Partial<Saved> | undefined;
    if (s === undefined) return;
    if (!Array.isArray(s.entries) || !Array.isArray(s.seen)) throw new Error('bad solo board file');
    for (const e of s.entries) {
      if (typeof e?.name !== 'string' || !Number.isFinite(e.score) || !Number.isFinite(e.at)) throw new Error('bad entry');
      this.byKey.set(soloKey(e.name), { name: soloDisplay(e.name), score: e.score, at: e.at });
    }
    for (const id of s.seen) if (typeof id === 'string') this.seen.add(id);
  }

  /** Best first; ties by who got there first. */
  private sorted(): SoloEntry[] {
    return [...this.byKey.values()].sort((a, b) => b.score - a.score || a.at - b.at);
  }
  private rankOf(score: number): number {
    let n = 1;
    for (const e of this.byKey.values()) if (e.score > score) n++;
    return n;
  }

  /** `name` and `score` are already checked (`parseSoloSubmit`). */
  submit(name: string, score: number, runId: string, now = Date.now()): SoloSubmitResult {
    const key = soloKey(name);
    const cur = this.byKey.get(key);
    if (this.seen.has(runId)) {
      const best = cur?.score ?? score;
      return { rank: this.rankOf(best), best, improved: false };
    }
    this.seen.add(runId);
    if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value as string);
    const improved = cur === undefined || score > cur.score;
    if (improved) this.byKey.set(key, { name: soloDisplay(name), score, at: now });
    this.persist(this);
    const best = this.byKey.get(key)!.score;
    return { rank: this.rankOf(best), best, improved };
  }

  view(limit = SOLO_BOARD_SIZE): SoloBoardView {
    return { entries: this.sorted().slice(0, limit), total: this.byKey.size };
  }

  /** Empties the board (run ids are kept, so an old queued run does not come back after the reset). */
  reset(): void {
    this.byKey.clear();
    this.persist(this);
  }

  toJSON(): Saved { return { version: 1, entries: this.sorted(), seen: [...this.seen] }; }
}

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

/** A board that saves itself (debounced, atomic) to `file`; `flush` writes now. */
export function createSavedSoloBoard(file: string, log: Log = defaultLog, delayMs = 500) {
  const saver = createSaver(file, delayMs, log);
  const board = loadSoloBoard(file, b => saver.save(() => b.toJSON()), log);
  return { board, flush: () => saver.flush() };
}
