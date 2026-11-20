import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Ack, HostBoard, SessionSnapshot } from '../shared/protocol';
import { daySummary } from '../shared/protocol.fixtures';
import type { Day } from '../shared/sim/types';
import { createApp, type AppOptions } from './app';
import { Session } from './session';
import { createSaver, loadSession } from './sessionFile';

const tmp = mkdtempSync(path.join(tmpdir(), 'pts-app-'));
writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><title>pts</title>');
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

let app: ReturnType<typeof createApp>;
let url = '';
let clients: Socket[] = [];

async function start(opts: Partial<AppOptions> = {}) {
  app = createApp({ hostKey: 'secret', staticDir: tmp, boardThrottleMs: 50, ...opts });
  await new Promise<void>(r => app.http.listen(0, r));
  url = `http://localhost:${(app.http.address() as AddressInfo).port}`;
}
afterEach(async () => {
  clients.forEach(c => c.close());
  clients = [];
  await app.close();
});

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  let last: SessionSnapshot | null = null;
  let board: HostBoard | null = null;
  let boards = 0;
  let states = 0;
  s.on('state', st => { last = st; states++; });
  s.on('host:board', b => { board = b; boards++; });
  clients.push(s);
  const until = (pred: (st: SessionSnapshot) => boolean) =>
    new Promise<SessionSnapshot>((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout; last state ${JSON.stringify(last)}`)), 3000);
      const check = () => {
        if (last && pred(last)) { clearTimeout(t); s.off('state', check); res(last); }
      };
      s.on('state', check);
      check();
    });
  const untilBoard = (pred: (b: HostBoard) => boolean) =>
    new Promise<HostBoard>((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout; last board ${JSON.stringify(board)}`)), 3000);
      const check = () => {
        if (board && pred(board)) { clearTimeout(t); s.off('host:board', check); res(board); }
      };
      s.on('host:board', check);
      check();
    });
  const emit = <T = Ack>(ev: string, payload?: unknown) =>
    new Promise<T>(res => s.emit(ev as never, payload as never, res as never));
  return { s, until, untilBoard, emit, boards: () => boards, states: () => states, state: () => last };
}

async function host() {
  const h = client();
  expect((await h.emit('host:auth', { key: 'secret' })).ok).toBe(true);
  return h;
}
async function player(name: string) {
  const c = client();
  const j = await c.emit<Ack<{ playerId: string; token: string }>>('player:join', { nickname: name });
  if (!j.ok) throw new Error(j.error);
  return { ...c, id: j.playerId, token: j.token };
}
const sendDay = (c: ReturnType<typeof client>, code: string, d: Day, score: number, runId = 'run-1') =>
  c.emit<Ack<{ rank: number }>>('player:day', { code, runId, summary: daySummary({ day: d, score }) });

describe('http', () => {
  it('serves health, config and the SPA routes', async () => {
    await start({ publicUrl: 'https://x.test' });
    expect(await (await fetch(`${url}/healthz`)).text()).toBe('ok');
    expect(await (await fetch(`${url}/api/config`)).json()).toEqual({ publicUrl: 'https://x.test' });
    for (const route of ['/', '/solo', '/play', '/host']) {
      const r = await fetch(`${url}${route}`);
      expect(r.status, route).toBe(200);
      expect(await r.text()).toContain('<title>pts</title>');
    }
    expect((await fetch(`${url}/dev/scene`)).status).toBe(404);
  });
});

describe('class session over sockets', () => {
  it('joins, resumes, votes with the session code, opens and takes days in order with ranks', async () => {
    await start();
    const h = await host();
    const a = await player('An');
    const b = await player('Bình');
    const st = await h.until(s => s.counts.joined === 2);
    expect(st.phase).toBe('lobby');
    const code = st.code;

    expect(await a.emit('player:vote', { code, choice: 'visible', when: 'before' })).toEqual({ ok: true });
    expect(await b.emit('player:vote', { code: 'NOPE', choice: 'visible', when: 'before' }))
      .toEqual({ ok: false, error: 'wrongSession' });
    // A day before the market opens is refused, but answered.
    expect(await sendDay(a, code, 1, 100)).toEqual({ ok: false, error: 'notOpen' });

    // Resume from another socket.
    const again = client();
    expect(await again.emit('player:resume', { token: a.token })).toEqual({ ok: true, playerId: a.id, name: 'An' });
    expect(await again.emit('player:resume', { token: 'nope' })).toMatchObject({ ok: false });

    h.s.emit('host:open');
    await a.until(s => s.phase === 'open');
    expect(await sendDay(a, code, 1, 100)).toEqual({ ok: true, rank: 1 });
    expect(await sendDay(b, code, 1, 200, 'run-b')).toEqual({ ok: true, rank: 1 });
    expect(await sendDay(a, code, 1, 100)).toEqual({ ok: true, rank: 2 }); // duplicate: ignored, current rank
    expect(await sendDay(a, code, 3, 100)).toEqual({ ok: false, error: 'notNext' });
    expect(await sendDay(a, code, 2, 100, 'run-2')).toEqual({ ok: false, error: 'otherRun' });
    expect(await sendDay(a, code, 2, 300)).toEqual({ ok: true, rank: 1 });
    a.s.emit('player:progress', { day: 3, phase: 'morning' });
    const board = await h.untilBoard(bd => bd.members.find(m => m.id === a.id)?.progress?.day === 3);
    expect(board.members.find(m => m.id === a.id)!.days).toHaveLength(2);
    expect(board.members.find(m => m.id === a.id)!.vote.before).toBe('visible');
  });

  it('answers every ack, even for garbage, wrong phase or no player', async () => {
    await start();
    const c = client();
    await c.until(() => true);
    expect(await c.emit('player:vote', null)).toEqual({ ok: false, error: 'unknownPlayer' });
    expect(await c.emit('player:day', 42)).toEqual({ ok: false, error: 'unknownPlayer' });
    expect((await c.emit('player:join', { nickname: { x: 1 } })).ok).toBe(false);
    expect((await c.emit('player:join', null)).ok).toBe(false);
    expect((await c.emit('player:resume', 'x')).ok).toBe(false);
    expect((await c.emit('host:auth', undefined)).ok).toBe(false);
    expect((await c.emit('host:auth', { key: 'nope' })).ok).toBe(false);
    const p = await player('Chi');
    const code = p.state()!.code;
    expect(await p.emit('player:day', { code, runId: 'r', summary: { junk: true } })).toMatchObject({ ok: false });
    // Host commands from a non-host are ignored.
    c.s.emit('host:open');
    p.s.emit('host:open');
    p.s.emit('player:progress', 'garbage');
    await wait(150);
    expect(app.session.snapshot().phase).toBe('lobby');
    // The server is still alive.
    expect((await c.emit('player:join', { nickname: 'Dũng' })).ok).toBe(true);
  });

  it('freezes awards with ranks, refuses joins after, and a reset changes code and seed', async () => {
    await start();
    const h = await host();
    const a = await player('An');
    const b = await player('Bình');
    const { code, seed } = await h.until(s => s.counts.joined === 2);
    h.s.emit('host:open');
    await h.until(s => s.phase === 'open');
    await sendDay(a, code, 1, 500);
    await sendDay(b, code, 1, 300, 'run-b');
    h.s.emit('host:awards');
    h.s.emit('host:awards'); // idempotent
    const aw = await a.until(s => s.phase === 'awards');
    expect(aw.awards!.ranks).toEqual({ [a.id]: 1, [b.id]: 2 });
    expect(aw.awards!.top.map(t => t.name)).toEqual(['An', 'Bình']);
    expect(aw.awards!.awards.find(x => x.id === 'tycoon')!.name).toBe('An');
    expect(await client().emit('player:join', { nickname: 'Late' })).toEqual({ ok: false, error: 'Buổi đã kết thúc' });

    h.s.emit('host:reset');
    const fresh = await a.until(s => s.phase === 'lobby');
    expect(fresh.code).not.toBe(code);
    expect(fresh.seed).not.toBe(seed);
    expect(fresh.awards).toBeNull();
    // An old queue flushing after the reset is refused, but answered.
    expect(await sendDay(a, code, 2, 900)).toEqual({ ok: false, error: 'wrongSession' });
    expect(await a.emit('player:vote', { code, choice: 'invisible', when: 'after' })).toEqual({ ok: false, error: 'wrongSession' });
  });

  it('broadcasts progress only when it changed', async () => {
    await start();
    const h = await host();
    const a = await player('An');
    h.s.emit('host:open');
    await h.until(s => s.phase === 'open');
    a.s.emit('player:progress', { day: 1, phase: 'rush' });
    await h.until(s => s.counts.playing === 1);
    await wait(150);
    const n = h.states();
    for (let i = 0; i < 3; i++) a.s.emit('player:progress', { day: 1, phase: 'rush' });
    await wait(250);
    expect(h.states()).toBe(n);
  });

  it('sends the host board only to authenticated sockets', async () => {
    await start();
    const outsider = client();
    const wrong = client();
    expect((await wrong.emit('host:auth', { key: 'nope' })).ok).toBe(false);
    const h = await host();
    await h.untilBoard(() => true); // sent right after auth
    await player('An');
    await h.untilBoard(b => b.members.length === 1);
    await wait(150);
    expect(outsider.boards()).toBe(0);
    expect(wrong.boards()).toBe(0);
  });

  it('throttles the host board', async () => {
    await start({ boardThrottleMs: 400 });
    const h = await host();
    await h.untilBoard(() => true);
    const before = h.boards();
    const a = await player('An');
    for (let i = 0; i < 10; i++) await a.emit('player:vote', { code: a.state()!.code, choice: i % 2 ? 'visible' : 'invisible', when: 'before' });
    await wait(200);
    expect(h.boards() - before).toBeLessThanOrEqual(1);
    await h.untilBoard(b => b.members.length === 1);
  });

  it('marks a player disconnected only when their last tab closes', async () => {
    await start();
    const h = await host();
    const a = await player('An');
    const tab2 = client();
    expect((await tab2.emit('player:resume', { token: a.token })).ok).toBe(true);
    const connected = (b: HostBoard) => b.members.find(m => m.id === a.id)?.connected;
    a.s.close();
    await wait(200);
    expect(connected(await h.untilBoard(() => true))).toBe(true);
    expect(app.session.board().members[0].connected).toBe(true);
    tab2.s.close();
    await h.untilBoard(b => connected(b) === false);
  });

  it('saves the session through the saver and loads it back', async () => {
    const file = path.join(tmp, 'data', 'session.json');
    const saver = createSaver(file, 20);
    const session = new Session({ persist: s => saver.save(() => s.toJSON()) });
    await start({ session });
    const h = await host();
    const a = await player('An');
    const { code } = await h.until(s => s.counts.joined === 1);
    await a.emit('player:vote', { code, choice: 'invisible', when: 'before' });
    h.s.emit('host:open');
    await h.until(s => s.phase === 'open');
    expect((await sendDay(a, code, 1, 700)).ok).toBe(true);
    await saver.flush();
    const back = loadSession(file)!;
    expect(back.snapshot()).toMatchObject({ phase: 'open', code, seed: session.snapshot().seed });
    const m = back.board().members[0];
    expect(m).toMatchObject({ id: a.id, name: 'An', connected: false, score: 700, vote: { before: 'invisible', after: null } });
    expect(back.resume(a.token)).toEqual({ playerId: a.id, name: 'An' });
  });
});
