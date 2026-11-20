import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from './session';
import { DEFAULT_SESSION_FILE, type Saver, type SaverIo, createSaver, loadSession, sessionFilePath } from './sessionFile';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'pts-session-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('sessionFilePath', () => {
  it('reads SESSION_FILE with a default under .data', () => {
    expect(DEFAULT_SESSION_FILE).toBe('.data/session.json');
    expect(sessionFilePath({})).toBe('.data/session.json');
    expect(sessionFilePath({ SESSION_FILE: '/tmp/x.json' })).toBe('/tmp/x.json');
    expect(sessionFilePath({ SESSION_FILE: '' })).toBe('.data/session.json');
  });
});

describe('loadSession', () => {
  it('returns null for a missing file without logging', () => {
    const log = vi.fn();
    expect(loadSession(path.join(dir, 'none.json'), {}, log)).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });
  it('logs and returns null for a file that is not JSON', () => {
    const file = path.join(dir, 's.json');
    writeFileSync(file, '{not json');
    const log = vi.fn();
    expect(loadSession(file, {}, log)).toBeNull();
    expect(log).toHaveBeenCalledOnce();
    // Kept as <name>.corrupt so the next save does not destroy it.
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.corrupt`, 'utf8')).toBe('{not json');
  });
  it('logs and returns null for JSON that is not a session', () => {
    const file = path.join(dir, 's.json');
    writeFileSync(file, JSON.stringify({ hello: 'world' }));
    const log = vi.fn();
    expect(loadSession(file, {}, log)).toBeNull();
    expect(log).toHaveBeenCalledOnce();
  });
  it('loads a saved session', () => {
    const s = new Session();
    s.join('An');
    s.open();
    const file = path.join(dir, 's.json');
    writeFileSync(file, JSON.stringify(s.toJSON()));
    const back = loadSession(file, {});
    expect(back?.snapshot()).toEqual(s.snapshot());
  });
});

describe('createSaver', () => {
  it('debounces many saves into one write of the latest state', async () => {
    const file = path.join(dir, 'nested', 'deeper', 's.json');
    const saver = createSaver(file, 20);
    const get = vi.fn(() => ({ n: 3 }));
    saver.save(() => ({ n: 1 }));
    saver.save(() => ({ n: 2 }));
    saver.save(get);
    expect(existsSync(file)).toBe(false);
    await new Promise(r => setTimeout(r, 60));
    await saver.flush();
    expect(get).toHaveBeenCalledOnce();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ n: 3 });
  });

  it('writes through a temp file and leaves no temp file behind', async () => {
    const file = path.join(dir, 's.json');
    const saver = createSaver(file, 1000);
    saver.save(() => ({ a: 1 }));
    await saver.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1 });
    expect(readdirSync(dir)).toEqual(['s.json']);
  });

  it('flush writes at once and does nothing when nothing is pending', async () => {
    const file = path.join(dir, 's.json');
    const saver = createSaver(file, 60_000);
    await saver.flush();
    expect(existsSync(file)).toBe(false);
    saver.save(() => ({ b: 2 }));
    await saver.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ b: 2 });
  });

  it('logs a failed write, keeps the old file and keeps working', async () => {
    const file = path.join(dir, 's.json');
    writeFileSync(file, JSON.stringify({ old: true }));
    mkdirSync(`${file}.tmp`);
    const log = vi.fn();
    const saver = createSaver(file, 5, log);
    saver.save(() => ({ next: true }));
    await saver.flush();
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ old: true });
    rmSync(`${file}.tmp`, { recursive: true });
    saver.save(() => ({ next: 2 }));
    await saver.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ next: 2 });
  });

  it('keeps a failed state pending and writes it on the next flush (EPERM on rename)', async () => {
    const file = path.join(dir, 's.json');
    const log = vi.fn();
    let failRename = true;
    const io: SaverIo = {
      mkdir: d => fsp.mkdir(d, { recursive: true }),
      writeFile: (f, t) => fsp.writeFile(f, t, 'utf8'),
      rename: async (a, b) => {
        if (failRename) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
        await fsp.rename(a, b);
      },
    };
    const saver = createSaver(file, 60_000, log, io);
    saver.save(() => ({ v: 'newest' }));
    await saver.flush();
    expect(log).toHaveBeenCalledOnce();
    expect(existsSync(file)).toBe(false);
    failRename = false;
    await saver.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ v: 'newest' });
  });

  it('a newer state that arrived during a failed write wins over the failed one', async () => {
    const file = path.join(dir, 's.json');
    let failRename = true;
    let saver: Saver | null = null;
    const io: SaverIo = {
      mkdir: d => fsp.mkdir(d, { recursive: true }),
      writeFile: async (f, t) => {
        await fsp.writeFile(f, t, 'utf8');
        if (failRename) saver?.save(() => ({ v: 'newer' }));
      },
      rename: async (a, b) => {
        if (failRename) { failRename = false; throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); }
        await fsp.rename(a, b);
      },
    };
    saver = createSaver(file, 60_000, () => {}, io);
    saver.save(() => ({ v: 'old' }));
    await saver.flush();
    await saver.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ v: 'newer' });
  });

  it('logs a state that cannot be serialized instead of throwing', async () => {
    const log = vi.fn();
    const saver = createSaver(path.join(dir, 's.json'), 5, log);
    saver.save(() => { throw new Error('bad state'); });
    await expect(saver.flush()).resolves.toBe(false);
    expect(log).toHaveBeenCalledOnce();
  });

  it('flush tells whether every change saved so far is on disk', async () => {
    const file = path.join(dir, 's.json');
    let fail = true;
    const io: SaverIo = {
      mkdir: d => fsp.mkdir(d, { recursive: true }),
      writeFile: (f, t) => fsp.writeFile(f, t, 'utf8'),
      rename: async (a, b) => { if (fail) throw new Error('EPERM'); await fsp.rename(a, b); },
    };
    const saver = createSaver(file, 60_000, () => {}, io);
    expect(await saver.flush()).toBe(true); // nothing ever changed
    saver.save(() => ({ v: 1 }));
    expect(await saver.flush()).toBe(false);
    expect(await saver.flush()).toBe(false); // the retry fails too
    fail = false;
    expect(await saver.flush()).toBe(true); // the retry writes the failed state
    expect(await saver.flush()).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ v: 1 });
  });

  it('concurrent flushes share writes: a change during a write gets one more write, not one each', async () => {
    const file = path.join(dir, 's.json');
    let writes = 0;
    let release: () => void = () => {};
    let started: () => void = () => {};
    const firstStarted = new Promise<void>(r => { started = r; });
    const io: SaverIo = {
      mkdir: d => fsp.mkdir(d, { recursive: true }),
      writeFile: async (f, t) => {
        writes++;
        if (writes === 1) await new Promise<void>(r => { release = r; started(); });
        await fsp.writeFile(f, t, 'utf8');
      },
      rename: (a, b) => fsp.rename(a, b),
    };
    let n = 0;
    const saver = createSaver(file, 60_000, () => {}, io);
    saver.save(() => ({ n }));
    const first = saver.flush();
    await firstStarted;
    const later: Promise<boolean>[] = [];
    for (let i = 0; i < 10; i++) { n++; saver.save(() => ({ n })); later.push(saver.flush()); }
    release();
    expect(await first).toBe(true);
    expect(await Promise.all(later)).toEqual(Array(10).fill(true));
    expect(writes).toBe(2);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ n: 10 });
  });

  it('round-trips a session saved through the persist callback', async () => {
    const file = path.join(dir, 's.json');
    const saver = createSaver(file, 5);
    const s = new Session({ persist: x => saver.save(() => x.toJSON()) });
    s.join('An');
    s.open();
    await saver.flush();
    expect(loadSession(file, {})?.snapshot()).toEqual(s.snapshot());
  });
});
