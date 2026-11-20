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
  /** Writes a pending save now and waits for every write to finish. Never rejects. */
  flush(): Promise<void>;
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
 * so a retry or the `flush()` at shutdown still writes the newest state.
 */
export function createSaver(file: string, delayMs: number, log: Log = defaultLog, io: SaverIo = realIo): Saver {
  const tmp = `${file}.tmp`;
  let pending: (() => unknown) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const arm = () => {
    if (timer !== null) return;
    timer = setTimeout(fire, delayMs);
    // A pending save must not keep the process alive; shutdown calls `flush()`.
    timer.unref?.();
  };
  const write = async (get: () => unknown) => {
    let text: string;
    try {
      text = JSON.stringify(get());
    } catch (err) {
      log(`cannot serialize the session for ${file}`, err);
      return;
    }
    try {
      await io.mkdir(path.dirname(file));
      await io.writeFile(tmp, text);
      await io.rename(tmp, file);
    } catch (err) {
      log(`cannot save ${file}, the session stays in memory; will retry`, err);
      if (pending === null) pending = () => JSON.parse(text);
      arm();
    }
  };
  function fire(): Promise<void> {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    const get = pending;
    pending = null;
    if (get !== null) chain = chain.then(() => write(get));
    return chain;
  }

  return {
    save(get) {
      pending = get;
      arm();
    },
    flush: () => fire(),
  };
}
