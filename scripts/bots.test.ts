import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { Session } from '../server/session';
import { createSaver, loadSession, type SaverIo } from '../server/sessionFile';
import { playRun, STRATEGIES } from '../shared/sim/autoplay';
import { afterVote, botName, chooseStrategy, hostCommand, runBots, startBot, type Bot } from './bots';

describe('bot helpers', () => {
  it('names bots in turn with a marker and a lap number', () => {
    expect(botName(0)).toBe('Tuấn 🤖');
    expect(botName(20)).toBe('Tuấn 2 🤖');
    expect(botName(0, 20)).toBe('Tuấn 2 🤖');
    expect(new Set(Array.from({ length: 60 }, (_, i) => botName(i))).size).toBe(60);
  });
  it('votes after by the reporter card', () => {
    expect(afterVote('A')).toBe('invisible');
    expect(afterVote('B')).toBe('visible');
    expect(afterVote(null)).toBe('invisible');
  });
  it('picks a story-combo strategy from the mix', () => {
    let x = 7;
    const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    const ids = new Set(Array.from({ length: 200 }, () => chooseStrategy(rnd).id.split('+')[0]));
    expect(ids.has('reasonable')).toBe(true);
    expect([...ids].every(id => id in STRATEGIES)).toBe(true);
  });
});

let app: ReturnType<typeof createApp>;
let bots: Bot[] = [];
afterEach(async () => {
  bots.forEach(b => b.stop());
  bots = [];
  await app?.close();
});

async function start() {
  app = createApp({ hostKey: 'k', boardThrottleMs: 50 });
  await new Promise<void>(r => app.http.listen(0, r));
  return `http://localhost:${(app.http.address() as AddressInfo).port}`;
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('bots against the server', () => {
  it('3 bots play a whole session and send exactly what playRun gives', async () => {
    const url = await start();
    bots = await runBots(3, { url, delay: [0, 20], strategy: STRATEGIES.reasonable });
    await wait(300);
    expect((await hostCommand(url, 'k', 'host:open')).phase).toBe('open');
    await Promise.all(bots.map(b => b.whenDone()));
    const board = app.session.board();
    expect(board.members).toHaveLength(3);
    const expected = playRun(board.seed, STRATEGIES.reasonable).reports.map(r => r.summary);
    for (const m of board.members) {
      expect(m.finished).toBe(true);
      expect(m.vote.before).not.toBeNull();
      expect(m.vote.after).not.toBeNull();
      expect(m.days).toEqual(expected);
    }
    const end = await hostCommand(url, 'k', 'host:awards');
    expect(end.awards?.awards.length).toBeGreaterThan(0);
  }, 60000);

  it('a reset mid-run keeps the class at N and every bot plays the new seed', async () => {
    const url = await start();
    bots = await runBots(3, { url, delay: [150, 200], strategy: STRATEGIES.reasonable });
    await wait(300);
    await hostCommand(url, 'k', 'host:open');
    await wait(350);
    const before = app.session.snapshot();
    const after = await hostCommand(url, 'k', 'host:reset');
    expect(after.code).not.toBe(before.code);
    await wait(300);
    expect(app.session.board().members).toHaveLength(3);
    await hostCommand(url, 'k', 'host:open');
    await Promise.all(bots.map(b => b.whenDone()));
    const board = app.session.board();
    expect(board.members).toHaveLength(3);
    expect(board.members.every(m => m.finished && m.vote.before !== null && m.vote.after !== null)).toBe(true);
    expect(board.members[0].days).toEqual(playRun(board.seed, STRATEGIES.reasonable).reports.map(r => r.summary));
  }, 60000);

  it('a day refused for good is not resent in a loop: the bot stops sending that run and finishes', async () => {
    const url = await start();
    const real = app.session.submitDay.bind(app.session);
    let calls = 0;
    app.session.submitDay = (id, code, runId, raw) => {
      calls++;
      return (raw as { day?: number } | null)?.day === 2 ? { ok: false, error: 'badSummary' } : real(id, code, runId, raw);
    };
    bots = await runBots(1, { url, delay: [0, 20], strategy: STRATEGIES.reasonable });
    await wait(300);
    await hostCommand(url, 'k', 'host:open');
    await bots[0].whenDone();
    await wait(200);
    expect(calls).toBe(2); // day 1, day 2; days 3-5 could only be refused notNext
    expect(bots[0].stats()).toEqual({ accepted: 1, refused: 1 });
    expect(app.session.board().members[0].vote.after).not.toBeNull();
  }, 20000);

  it('a day answered notOpen (transient) is resent, then every day is delivered', async () => {
    const url = await start();
    const real = app.session.submitDay.bind(app.session);
    let notOpen = 2; // e.g. a server restarted in the lobby phase for a moment
    app.session.submitDay = (id, code, runId, raw) =>
      notOpen-- > 0 ? { ok: false, error: 'notOpen' } : real(id, code, runId, raw);
    bots = await runBots(1, { url, delay: [0, 20], strategy: STRATEGIES.reasonable });
    await wait(300);
    await hostCommand(url, 'k', 'host:open');
    await bots[0].whenDone();
    const board = app.session.board();
    expect(board.members[0].days).toEqual(playRun(board.seed, STRATEGIES.reasonable).reports.map(r => r.summary));
    expect(bots[0].stats()).toEqual({ accepted: 5, refused: 0 });
  }, 20000);

  it('host commands reject a wrong key and an unreachable server', async () => {
    const url = await start();
    await expect(hostCommand(url, 'wrong', 'host:open')).rejects.toThrow(/host:auth refused/);
    await expect(hostCommand('http://localhost:1', 'k', 'host:open')).rejects.toThrow(/cannot reach/);
  }, 20000);

});

describe('bots across a hard-killed server', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

  /**
   * A server wired like `server/index.ts` on `file` (debounce long enough never to run here, so only the writes made
   * before an answer reach the file). `kill` stops it with no flush and makes its saver unable to write again.
   */
  async function boot(file: string, port = 0) {
    let dead = false;
    const alive = () => (dead ? Promise.reject(new Error('killed')) : Promise.resolve());
    const io: SaverIo = {
      mkdir: d => alive().then(() => fsp.mkdir(d, { recursive: true })),
      writeFile: (f, t) => alive().then(() => fsp.writeFile(f, t, 'utf8')),
      rename: (a, b) => alive().then(() => fsp.rename(a, b)),
    };
    const saver = createSaver(file, 60_000, () => {}, io);
    const persist = (x: Session) => saver.save(() => x.toJSON());
    const session = loadSession(file, { persist }) ?? new Session({ persist });
    app = createApp({ hostKey: 'k', boardThrottleMs: 50, session, persistNow: () => saver.flush() });
    await new Promise<void>(r => app.http.listen(port, r));
    const killed = app;
    return {
      url: `http://localhost:${(app.http.address() as AddressInfo).port}`,
      port: (app.http.address() as AddressInfo).port,
      kill: () => { dead = true; return killed.close(); },
    };
  }
  /** One bot; resolves `onDay(d)` the moment day d is answered (logged). */
  function oneBot(url: string) {
    const waiters = new Map<number, () => void>();
    const log = (m: string) => { const d = /day (\d) sent/.exec(m); if (d) waiters.get(Number(d[1]))?.(); };
    const bot = startBot({ url, name: 'Lan 🤖', delay: [60, 90], strategy: STRATEGIES.reasonable, log });
    bots.push(bot);
    const onDay = (d: number) => new Promise<void>(r => waiters.set(d, r));
    return { bot, onDay };
  }

  it('killed right after an ack and restarted on the same file, the run still delivers all 5 days', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pts-kill-'));
    const file = path.join(dir, 'session.json');
    const first = await boot(file);
    const { bot, onDay } = oneBot(first.url);
    await wait(300);
    await hostCommand(first.url, 'k', 'host:open');
    await onDay(2);
    await first.kill(); // no flush
    expect(loadSession(file)!.board().members[0].days.map(d => d.day)).toEqual([1, 2]);
    await boot(file, first.port);
    await bot.whenDone();
    const board = app.session.board();
    const expected = playRun(board.seed, STRATEGIES.reasonable).reports.map(r => r.summary);
    expect(expected).toHaveLength(5);
    expect(board.members).toHaveLength(1);
    expect(board.members[0].days).toEqual(expected);
    expect(board.members[0].vote.after).not.toBeNull();
    expect(bot.stats()).toEqual({ accepted: 5, refused: 0 });
  }, 60000);

  it('a server restarted with days missing (older file) gets them sent again in order', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pts-kill-'));
    const file = path.join(dir, 'session.json');
    const first = await boot(file);
    const { bot, onDay } = oneBot(first.url);
    await wait(300);
    await hostCommand(first.url, 'k', 'host:open');
    await onDay(1);
    const old = readFileSync(file, 'utf8');
    await onDay(3);
    await first.kill();
    writeFileSync(file, old); // days 2 and 3 are lost
    await boot(file, first.port);
    await bot.whenDone();
    const board = app.session.board();
    expect(board.members[0].days).toEqual(playRun(board.seed, STRATEGIES.reasonable).reports.map(r => r.summary));
    expect(bot.stats()).toEqual({ accepted: 5, refused: 0 });
  }, 60000);
});
