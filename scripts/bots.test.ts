import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { afterVote, botName, hostCommand, runBots } from './bots';

describe('bot helpers', () => {
  it('names bots in turn with a marker and a lap number', () => {
    expect(botName(0)).toBe('Tuấn 🤖');
    expect(botName(20)).toBe('Tuấn 2 🤖');
    expect(new Set(Array.from({ length: 60 }, (_, i) => botName(i))).size).toBe(60);
  });
  it('votes after by the reporter card', () => {
    expect(afterVote('A')).toBe('invisible');
    expect(afterVote('B')).toBe('visible');
    expect(afterVote(null)).toBe('invisible');
  });
});

let app: ReturnType<typeof createApp>;
afterEach(async () => { await app?.close(); });

describe('bots against the server', () => {
  it('3 bots play a whole session', async () => {
    app = createApp({ hostKey: 'k', boardThrottleMs: 50 });
    await new Promise<void>(r => app.http.listen(0, r));
    const url = `http://localhost:${(app.http.address() as AddressInfo).port}`;
    const bots = await runBots(3, { url, delay: [0, 20] });
    await new Promise(r => setTimeout(r, 300));
    const opened = await hostCommand(url, 'k', 'host:open');
    expect(opened.phase).toBe('open');
    await Promise.all(bots.map(b => b.done));
    const board = app.session.board();
    expect(board.members).toHaveLength(3);
    expect(board.members.every(m => m.days.length > 0 && m.vote.before !== null && m.vote.after !== null)).toBe(true);
    const end = await hostCommand(url, 'k', 'host:awards');
    expect(end.awards?.awards.length).toBeGreaterThan(0);
    bots.forEach(b => b.stop());
  }, 60000);
});
