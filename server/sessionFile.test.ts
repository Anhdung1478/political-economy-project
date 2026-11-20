import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Session } from './session';
import { DEFAULT_SESSION_FILE, createSaver, loadSession, sessionFilePath } from './sessionFile';

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

  it('logs a state that cannot be serialized instead of throwing', async () => {
    const log = vi.fn();
    const saver = createSaver(path.join(dir, 's.json'), 5, log);
    saver.save(() => { throw new Error('bad state'); });
    await expect(saver.flush()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
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
