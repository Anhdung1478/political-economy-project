// The phone's class logic against the real server (port 0): join and resume, the votes, the report queue with its
// resync and the R63 re-queue, rank, progress, reconnects, a host reset and a finished session.
import type { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../../server/app';
import { playRun, STRATEGIES } from '../../../../shared/sim/autoplay';
import type { RunState } from '../../../../shared/sim/types';
import { emptyQueue, QUEUE_KEY, serialize } from '../../game/reportQueue';
import { KEYS, save } from '../../game/runStore';
import { type KeyValueStore, memoryStore, webStore } from '../../game/storage';
import { type ClassSocket, createClient, type SessionClient } from '../../net/socket';
import { PlayController } from './PlayController';
import { PLAY_KEYS } from './playLogic';

let app: ReturnType<typeof createApp>;
const stops: (() => void)[] = [];
const sockets: ClassSocket[] = [];
afterEach(async () => {
  stops.splice(0).forEach(s => s());
  sockets.splice(0).forEach(s => s.close());
  await app.close();
});

async function server() {
  app = createApp({ hostKey: 'k', boardThrottleMs: 20 });
  await new Promise<void>(r => app.http.listen(0, r));
  return `http://localhost:${(app.http.address() as AddressInfo).port}`;
}
const until = async (pred: () => boolean, what = 'condition') => {
  for (let i = 0; i < 400 && !pred(); i++) await new Promise(r => setTimeout(r, 10));
  if (!pred()) throw new Error(`timed out waiting for ${what}`);
};
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * A phone, built the way the page builds it: the socket opens and the client starts listening at once (`connect()`),
 * and the controller attaches later, in an effect. We wait until the server's one `state` has arrived BEFORE attaching,
 * which is what a fast connection does (the first state used to be lost, leaving the loading dots for ever).
 */
async function phone(url: string, store: KeyValueStore = memoryStore(), wrap?: (c: SessionClient) => SessionClient) {
  const socket: ClassSocket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(socket);
  const client = createClient(socket, 1500);
  await until(() => socket.connected && client.lastState() !== null, 'the socket and its first state');
  const ctl = new PlayController(wrap ? wrap(client) : client, store, { retryMs: 20, resumeRetryMs: 30 });
  stops.push(ctl.attach());
  await until(() => ctl.getView().session !== null, 'the first state');
  return { socket, ctl, store, view: () => ctl.getView() };
}
/** The host, over a socket: `open`, `awards` and `reset` broadcast like the real ones. */
async function hostOf(url: string) {
  const s: ClassSocket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(s);
  await until(() => s.connected, 'host socket');
  const ok = await new Promise<{ ok: boolean }>(r => s.emit('host:auth', { key: 'k' }, r));
  expect(ok.ok).toBe(true);
  return {
    open: () => s.emit('host:open'), awards: () => s.emit('host:awards'), reset: () => s.emit('host:reset'),
  };
}
async function joined(url: string, name: string, store?: KeyValueStore) {
  const p = await phone(url, store);
  expect((await p.ctl.join(name)).ok).toBe(true);
  await until(() => p.view().resume === 'in', 'resume');
  return p;
}

const full = playRun(11, STRATEGIES.reasonable).run;
const withReporter = (run: RunState, reporter: 'A' | 'B' | null): RunState => ({ ...run, flags: { ...run.flags, reporter } });
/** The run at the day-`d` evening report. */
const atReport = (d: number): RunState => ({
  ...full, day: d as RunState['day'], phase: 'report', outcome: null, reports: full.reports.slice(0, d),
  flags: { ...full.flags, reporter: null },
});
const saveRun = (store: KeyValueStore, code: string, run: RunState) =>
  save(store, KEYS.class(code), { run, rush: null, planDraft: run.plan, beforeOpen: null }, { sessionCode: code });
const member = () => app.session.board().members[0];

describe('PlayController', () => {
  it('joins, keeps the token, resumes after a reload and queues the vote with the session code', async () => {
    const url = await server();
    const p = await joined(url, 'An');
    expect(p.view().name).toBe('An');
    expect(p.store.get(PLAY_KEYS.token)).not.toBeNull();
    expect(p.store.get(PLAY_KEYS.name)).toBe('An');

    p.ctl.vote('visible');
    expect(p.view().vote).toBe('visible');
    await until(() => member().vote.before === 'visible', 'the before vote');
    p.ctl.vote('invisible'); // changing the mind sends the new one
    await until(() => member().vote.before === 'invisible', 'the changed vote');

    // A reload: a new controller on the same store resumes by itself, and still knows its vote.
    const again = await phone(url, p.store);
    await until(() => again.view().resume === 'in', 'resume after reload');
    expect(again.view().name).toBe('An');
    expect(again.view().vote).toBe('invisible');
    expect(app.session.board().members).toHaveLength(1);
  });

  it('shows a refused token as the join form and the server refusal inline', async () => {
    const url = await server();
    const p = await phone(url, memoryStore({ [PLAY_KEYS.token]: 'not-a-token' }));
    await until(() => p.view().resume === 'anon', 'token refused');
    expect(p.store.get(PLAY_KEYS.token)).toBeNull();
    expect((await p.ctl.join('   ')).ok).toBe(false);
  });

  it('refuses a join after the awards and does not attach', async () => {
    const url = await server();
    const host = await hostOf(url);
    host.open();
    await until(() => app.session.snapshot().phase === 'open', 'server open');
    host.awards();
    await until(() => app.session.snapshot().phase === 'awards', 'server awards');
    const p = await phone(url);
    const r = await p.ctl.join('Muộn');
    expect(r).toEqual({ ok: false, error: 'Buổi đã kết thúc' });
    expect(p.view().resume).toBe('anon');
    expect(p.view().session?.phase).toBe('awards');
  });

  it('sends each day once the market is open, shows the rank, and sends the after vote when the run ends', async () => {
    const url = await server();
    const p = await joined(url, 'An');
    await joined(url, 'Bình'); // a second player, so ranks mean something
    const host = await hostOf(url);
    host.open();
    await until(() => app.session.snapshot().phase === 'open', 'server open');
    await until(() => p.view().session?.phase === 'open', 'open');

    p.ctl.reportDay(atReport(2));
    await until(() => member().days.length === 2, 'two days');
    // The ack follows the server's own update; the rank of day 2 is the one kept.
    await until(() => (p.store.get(PLAY_KEYS.rank) ?? '').includes('"day":2'), 'the day-2 rank');
    expect(p.view().rank).toBe(1);
    p.ctl.reportDay(atReport(3));
    await until(() => member().days.length === 3, 'three days');

    p.ctl.reportDay(withReporter(full, 'B'));
    await until(() => member().days.length === 5 && member().vote.after === 'visible', 'the run and the after vote');
    expect(member().finished).toBe(true);
    await until(() => p.ctl.pending() === 0, 'an empty queue');
  });

  it('sends the reporter vote of an early loser', async () => {
    const url = await server();
    const p = await joined(url, 'An');
    const host = await hostOf(url);
    host.open();
    await until(() => app.session.snapshot().phase === 'open', 'server open');
    await until(() => p.view().session?.phase === 'open', 'open');
    p.ctl.reporterVote('A');
    await until(() => member().vote.after === 'invisible', 'invisible after vote');
    p.ctl.reporterVote('B');
    await until(() => member().vote.after === 'visible', 'visible after vote');
  });

  it('R63: a reload at the day-5 report queues every day of the saved run, even before the first report callback', async () => {
    const url = await server();
    const first = await joined(url, 'An');
    const code = first.view().session!.code;
    const token = first.store.get(PLAY_KEYS.token)!;
    stops.splice(0).forEach(s => s());
    first.socket.close();
    const host = await hostOf(url);
    host.open();
    await until(() => app.session.snapshot().phase === 'open', 'server open');

    // A new page load: nothing queued, but the saved run holds five reported days (and the reporter answer).
    const store = memoryStore({ [PLAY_KEYS.token]: token });
    saveRun(store, code, withReporter({ ...atReport(5), phase: 'report' }, 'A'));
    const p = await phone(url, store);
    await until(() => member().days.length === 5, 'five days after the reload');
    await until(() => p.ctl.pending() === 0, 'an empty queue');
    await until(() => p.view().rank === 1, 'the rank');
    expect(member().finished).toBe(true);
  });

  it('builds the resync from the run reports: days the server lost are sent again', async () => {
    const url = await server();
    const first = await joined(url, 'An');
    const code = first.view().session!.code;
    const token = first.store.get(PLAY_KEYS.token)!;
    stops.splice(0).forEach(s => s());
    first.socket.close();
    const host = await hostOf(url);
    host.open();
    await until(() => app.session.snapshot().phase === 'open', 'server open');

    // The phone's queue believes days 1-3 were delivered; the server (restarted and lost them) has none.
    const store = memoryStore({ [PLAY_KEYS.token]: token });
    const run = atReport(4);
    saveRun(store, code, run);
    store.set(QUEUE_KEY, serialize({ ...emptyQueue(code), sent: [1, 2, 3].map(d => `${run.runId}:${d}`) }));
    await phone(url, store);
    await until(() => member().days.length === 4, 'the lost days again');
    expect(member().days.map(d => d.day)).toEqual([1, 2, 3, 4]);
  });

  it('keeps a day queued while offline, goes online only after resume, and sends progress again', async () => {
    const url = await server();
    const p = await joined(url, 'An');
    const host = await hostOf(url);
    host.open();
    await until(() => app.session.snapshot().phase === 'open', 'server open');
    await until(() => p.view().session?.phase === 'open', 'open');
    saveRun(p.store, p.view().session!.code, atReport(1));
    p.ctl.reportProgress(1, 'morning');
    await until(() => member().progress?.phase === 'morning', 'progress');

    p.socket.disconnect();
    await until(() => !p.view().connected, 'disconnect');
    p.ctl.reportDay(atReport(1));
    p.ctl.reportProgress(1, 'rush');
    await pause(100);
    expect(p.ctl.pending()).toBe(1);
    expect(member().days).toHaveLength(0);

    p.socket.connect();
    await until(() => member().days.length === 1, 'the day after reconnect and resume');
    await until(() => member().progress?.phase === 'rush', 'progress after resume');
    await until(() => p.ctl.pending() === 0, 'an empty queue');
  });

  it('after a host reset: a new session code drops the old run, vote and rank and goes back to the lobby', async () => {
    const url = await server();
    const p = await joined(url, 'An');
    const oldCode = p.view().session!.code;
    p.ctl.vote('visible');
    await until(() => member().vote.before === 'visible', 'vote');
    const host = await hostOf(url);
    host.open();
    await until(() => app.session.snapshot().phase === 'open', 'server open');
    await until(() => p.view().session?.phase === 'open', 'open');
    const runId = p.ctl.runId();
    expect(p.store.get(PLAY_KEYS.runId(oldCode))).toBe(runId);
    saveRun(p.store, oldCode, atReport(2));
    p.ctl.reportDay(atReport(2));
    await until(() => p.view().rank !== null, 'rank');

    host.reset();
    await until(() => p.view().session?.code !== oldCode, 'the new code');
    const v = p.view();
    expect(v.session?.phase).toBe('lobby');
    expect(v.resume).toBe('in'); // the connected player stays
    expect(v.vote).toBeNull();
    expect(v.rank).toBeNull();
    expect(v.hasRun).toBe(false);
    expect(p.store.get(KEYS.class(oldCode))).toBeNull();
    expect(p.store.get(PLAY_KEYS.runId(oldCode))).toBeNull();
    expect(p.ctl.runId()).not.toBe(runId);
    // The new session's vote is accepted again.
    p.ctl.vote('invisible');
    await until(() => member().vote.before === 'invisible', 'a vote in the new session');
  });

  it('gives each session its own run id, kept across reloads', async () => {
    const url = await server();
    const p = await joined(url, 'An');
    const id = p.ctl.runId();
    expect(p.ctl.runId()).toBe(id);
    const again = await phone(url, p.store);
    expect(again.ctl.runId()).toBe(id);
  });

  it('goes on with a saved run when the page loads with the server unreachable', async () => {
    const store = memoryStore({
      [PLAY_KEYS.token]: 't', [PLAY_KEYS.name]: 'An', [PLAY_KEYS.session]: JSON.stringify({ code: 'ABCD', seed: 5 }),
    });
    saveRun(store, 'ABCD', atReport(2));
    // A socket that never connects.
    const socket: ClassSocket = io('http://localhost:1', { transports: ['websocket'], reconnection: false, autoConnect: false });
    sockets.push(socket);
    const ctl = new PlayController(createClient(socket), store);
    const v = ctl.getView();
    expect(v.resume).toBe('in');
    expect(v.hasRun).toBe(true);
    expect(v.local).toEqual({ code: 'ABCD', seed: 5 });
    expect(v.session).toBeNull();
  });

  it('C1: a phone that loads alone sees the lobby from the state the server sent as it connected', async () => {
    const url = await server();
    const socket: ClassSocket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    const client = createClient(socket, 1500);
    await until(() => socket.connected && client.lastState() !== null, 'connect and the first state');
    await pause(150); // nobody else does anything: the server sends no other state
    const ctl = new PlayController(client, memoryStore());
    stops.push(ctl.attach());
    expect(ctl.getView().session?.phase).toBe('lobby');
    expect(ctl.getView().session?.code).toBe(app.session.snapshot().code);
  });

  it('I1: a finished phone sends a bounded number of votes over many states and the server stays quiet', async () => {
    const url = await server();
    const first = await joined(url, 'An');
    const code = first.view().session!.code;
    const token = first.store.get(PLAY_KEYS.token)!;
    stops.splice(0).forEach(s => s());
    first.socket.close();
    const host = await hostOf(url);
    host.open();
    await until(() => app.session.snapshot().phase === 'open', 'server open');

    // The phone comes back with a finished run (reporter answered) saved.
    const store = memoryStore({ [PLAY_KEYS.token]: token });
    saveRun(store, code, withReporter(full, 'A'));
    let votes = 0;
    const p = await phone(url, store, c => ({ ...c, vote: v => { votes++; return c.vote(v); } }));
    await until(() => member().vote.after === 'invisible' && member().days.length === 5, 'the run and its vote');
    await until(() => p.ctl.pending() === 0, 'an empty queue');
    const states = { n: 0 };
    p.socket.on('state', () => { states.n++; });
    const sent = votes;

    // Many states: other phones come and go, vote and send progress.
    const others = [];
    for (let i = 0; i < 6; i++) others.push(await joined(url, `Bạn ${i}`));
    for (const o of others) o.ctl.vote('visible');
    await pause(500);
    expect(votes - sent).toBe(0);
    expect(votes).toBeLessThanOrEqual(2);
    // Idle now: the line goes quiet (no vote, no state, nothing to resend).
    const quiet = states.n;
    await pause(500);
    expect(states.n).toBe(quiet);
    expect(votes).toBeLessThanOrEqual(2);
  });

  it('I2: with storage blocked a phone still joins once, plays through the awards and keeps its vote and run', async () => {
    const url = await server();
    const dead = webStore(() => { throw new Error('SecurityError: storage blocked'); });
    const p = await joined(url, 'Không Lưu', dead);
    expect(p.view().resume).toBe('in');
    expect(app.session.board().members).toHaveLength(1); // no ghost player
    p.ctl.vote('visible');
    await until(() => member().vote.before === 'visible', 'the vote');
    const host = await hostOf(url);
    host.open();
    await until(() => p.view().session?.phase === 'open', 'open');
    expect(p.ctl.runId()).toBe(p.ctl.runId());

    p.ctl.reportProgress(1, 'morning');
    p.ctl.reportDay(atReport(2));
    await until(() => member().days.length === 2, 'two days');
    await until(() => p.view().rank === 1, 'the rank');
    expect(member().progress).toMatchObject({ day: 1 });

    // More states (another player, then the awards) must not wipe the vote, rank or the run.
    await joined(url, 'Khác');
    host.awards();
    await until(() => p.view().session?.phase === 'awards', 'awards');
    const v = p.view();
    expect(v.vote).toBe('visible');
    expect(v.rank).toBe(1);
    expect(v.hasRun).toBe(true);
    expect(v.resume).toBe('in');
    // A resume (reconnect) still has the token in memory.
    p.socket.disconnect();
    await until(() => !p.view().connected, 'disconnect');
    p.socket.connect();
    await until(() => p.view().connected && p.view().resume === 'in', 'resumed again');
    expect(app.session.board().members).toHaveLength(2);
  });

  it('does not claim to be in while an offline phone finds the session reset', async () => {
    const url = await server();
    const code = app.session.snapshot().code;
    const store = memoryStore({
      [PLAY_KEYS.token]: 'gone', [PLAY_KEYS.name]: 'An', [PLAY_KEYS.session]: JSON.stringify({ code: 'OLD1', seed: 5 }),
    });
    saveRun(store, 'OLD1', atReport(2));
    const seen: string[] = [];
    const p = await phone(url, store);
    seen.push(p.view().resume);
    await until(() => p.view().resume === 'anon', 'token refused');
    expect(seen[0]).not.toBe('in'); // never the lobby with the old name
    expect(p.view().session?.code).toBe(code);
    expect(p.view().hasRun).toBe(false);
    expect(store.get(KEYS.class('OLD1'))).toBeNull();
    expect(p.view().name).toBe('An'); // remembered for the join form
  });
});
