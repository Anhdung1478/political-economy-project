// The session file (spec §11 "Server khởi động lại", §13): load at start-up, debounced atomic saves. A file that
// cannot be read or written is logged and the server goes on with the session in RAM.
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Session, type SessionOptions } from './session';

export const DEFAULT_SESSION_FILE = '.data/session.json';
export type Log = (message: string, err?: unknown) => void;
const defaultLog: Log = (message, err) => { console.error(`[session] ${message}`, err ?? ''); };

export function sessionFilePath(env: Record<string, string | undefined> = process.env): string {
  return env.SESSION_FILE || DEFAULT_SESSION_FILE;
}

/** The saved session, or null when there is none (missing file) or it is unreadable (logged). */
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
    log(`${file} is corrupt, starting a new session`, err);
    return null;
  }
}

export interface Saver {
  /** Schedules a save; `get` is called once when the delay runs out, so only the latest state is written. */
  save(get: () => unknown): void;
  /** Writes a pending save now and waits for every write to finish. Never rejects. */
  flush(): Promise<void>;
}

/** Debounced saves: each write goes to `<file>.tmp`, then is renamed over the file, so a crash never leaves half. */
export function createSaver(file: string, delayMs: number, log: Log = defaultLog): Saver {
  const tmp = `${file}.tmp`;
  let pending: (() => unknown) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const write = async (get: () => unknown) => {
    try {
      const text = JSON.stringify(get());
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(tmp, text, 'utf8');
      await rename(tmp, file);
    } catch (err) {
      log(`cannot save ${file}, the session stays in memory`, err);
    }
  };
  const fire = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    const get = pending;
    pending = null;
    if (get !== null) chain = chain.then(() => write(get));
    return chain;
  };

  return {
    save(get) {
      pending = get;
      if (timer === null) timer = setTimeout(fire, delayMs);
    },
    flush: () => fire(),
  };
}
