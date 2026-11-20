// The session file (spec §11 "Server khởi động lại", §13): load at start-up, debounced atomic saves. A file that
// cannot be read or written is logged and the server goes on with the session in RAM.
import { readFileSync, renameSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { Session, type SessionOptions } from './session';

export const DEFAULT_SESSION_FILE = '.data/session.json';
export type Log = (message: string, err?: unknown) => void;
const defaultLog: Log = (message, err) => { console.error(`[session] ${message}`, err ?? ''); };

export function sessionFilePath(env: Record<string, string | undefined> = process.env): string {
  return env.SESSION_FILE || DEFAULT_SESSION_FILE;
}

/**
 * The saved session, or null when there is none (missing file) or it is unreadable (logged). A corrupt file is
 * renamed to `<file>.corrupt` (replacing an older one) so the next save does not destroy the evidence.
 */
export function loadSession(file: string, opts: SessionOptions = {}, log: Log = defaultLog): Session | null {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`cannot read ${file}, starting a new session`, err);
    return null;
  }
  try {
    return Session.fromJSON(JSON.parse(text), opts);
  } catch (err) {
    log(`${file} is corrupt, starting a new session (kept as ${file}.corrupt)`, err);
    try { renameSync(file, `${file}.corrupt`); } catch (e) { log(`cannot rename ${file} to ${file}.corrupt`, e); }
    return null;
  }
}

export interface Saver {
  /** Schedules a save; `get` is called once when the delay runs out, so only the latest state is written. */
  save(get: () => unknown): void;
  /**
   * Writes a pending save now and waits for every write to finish. Never rejects. Resolves true when every change
   * saved before the call is on disk (so a server answering after it can be killed without losing that change),
   * false when the write failed (the state stays pending and is retried) or could not be serialized.
   * Concurrent calls share writes: a call made while a write is running waits for it and at most one more.
   */
  flush(): Promise<boolean>;
}
/** The file operations a saver uses; tests replace them to simulate failures. */
export interface SaverIo {
  mkdir: (dir: string) => Promise<unknown>;
  writeFile: (file: string, text: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
}
const realIo: SaverIo = {
  mkdir: dir => fsp.mkdir(dir, { recursive: true }),
  writeFile: (file, text) => fsp.writeFile(file, text, 'utf8'),
  rename: (from, to) => fsp.rename(from, to),
};

/**
 * Debounced saves: each write goes to `<file>.tmp`, then is renamed over the file, so a crash never leaves half.
 * The first `save` arms the timer; later ones only replace the state, so a write happens at most `delayMs` after a
 * change. A failed write is logged and its state stays pending (unless a newer one arrived) with the timer re-armed,
 * so a retry or the `flush()` at shutdown still writes the newest state. The server also calls `flush()` before
 * answering an accepted report (Task 32), so most writes come from flushes and the timer only catches the rest.
 */
export function createSaver(file: string, delayMs: number, log: Log = defaultLog, io: SaverIo = realIo): Saver {
  const tmp = `${file}.tmp`;
  /** A save waiting to be written; `gen` is fixed for a failed state kept for a retry, else read at write time. */
  let pending: { get: () => unknown; gen: number | null } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  /** Counts `save` calls; `written` is the highest count whose state is on disk. */
  let requested = 0;
  let written = 0;

  const arm = () => {
    if (timer !== null) return;
    timer = setTimeout(fire, delayMs);
    // A pending save must not keep the process alive; shutdown calls `flush()`.
    timer.unref?.();
  };
  const write = async (p: { get: () => unknown; gen: number | null }) => {
    // Everything saved up to now is in the state `get` returns (saves are synchronous with the changes).
    const gen = p.gen ?? requested;
    let text: string;
    try {
      text = JSON.stringify(p.get());
    } catch (err) {
      log(`cannot serialize the session for ${file}`, err);
      return;
    }
    try {
      await io.mkdir(path.dirname(file));
      await io.writeFile(tmp, text);
      await io.rename(tmp, file);
      written = Math.max(written, gen);
    } catch (err) {
      log(`cannot save ${file}, the session stays in memory; will retry`, err);
      if (pending === null) pending = { get: () => JSON.parse(text), gen };
      arm();
    }
  };
  /** The write queued behind the running one; it takes the newest pending state when it starts. */
  let queued: Promise<void> | null = null;
  function fire(): Promise<void> {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (pending === null) return chain;
    queued ??= chain = chain.then(() => {
      queued = null;
      const p = pending;
      pending = null;
      return p === null ? undefined : write(p);
    });
    return queued;
  }

  return {
    save(get) {
      requested++;
      pending = { get, gen: null };
      arm();
    },
    flush() {
      const target = requested;
      return fire().then(() => written >= target);
    },
  };
}
