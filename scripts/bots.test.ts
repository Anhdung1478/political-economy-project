import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { playRun, STRATEGIES } from '../shared/sim/autoplay';
import { afterVote, botName, chooseStrategy, hostCommand, runBots, type Bot } from './bots';

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

  it('host commands reject a wrong key and an unreachable server', async () => {
    const url = await start();
    await expect(hostCommand(url, 'wrong', 'host:open')).rejects.toThrow(/host:auth refused/);
    await expect(hostCommand('http://localhost:1', 'k', 'host:open')).rejects.toThrow(/cannot reach/);
  }, 20000);
});
