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
import { type KeyValueStore, memoryStore } from '../../game/storage';
import { type ClassSocket, createClient } from '../../net/socket';
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

/** A phone: its own socket, store and controller (attached, not yet connected unless `connected`). */
async function phone(url: string, store: KeyValueStore = memoryStore()) {
  const socket: ClassSocket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  sockets.push(socket);
  const ctl = new PlayController(createClient(socket, 1500), store, { retryMs: 20, resumeRetryMs: 30 });
  stops.push(ctl.attach());
  await until(() => ctl.getView().session !== null, 'the first state');
  return { socket, ctl, store, view: () => ctl.getView() };
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
    app.session.open();
    app.session.awards();
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
    app.session.open();
    await until(() => p.view().session?.phase === 'open', 'open');

    p.ctl.reportDay(atReport(2));
    await until(() => member().days.length === 2, 'two days');
    expect(p.view().rank).toBe(1);
    expect(p.store.get(PLAY_KEYS.rank)).toContain('"day":2');
    p.ctl.reportDay(atReport(3));
    await until(() => member().days.length === 3, 'three days');

    p.ctl.reportDay(withReporter(full, 'B'));
    await until(() => member().days.length === 5 && member().vote.after === 'visible', 'the run and the after vote');
    expect(member().finished).toBe(true);
    expect(p.ctl.pending()).toBe(0);
  });

  it('sends the reporter vote of an early loser', async () => {
    const url = await server();
    const p = await joined(url, 'An');
    app.session.open();
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
    app.session.open();

    // A new page load: nothing queued, but the saved run holds five reported days (and the reporter answer).
    const store = memoryStore({ [PLAY_KEYS.token]: token });
    saveRun(store, code, withReporter({ ...atReport(5), phase: 'report' }, 'A'));
    const p = await phone(url, store);
    await until(() => member().days.length === 5, 'five days after the reload');
    await until(() => p.ctl.pending() === 0, 'an empty queue');
    expect(p.view().rank).toBe(1);
    expect(member().finished).toBe(true);
  });

  it('builds the resync from the run reports: days the server lost are sent again', async () => {
    const url = await server();
    const first = await joined(url, 'An');
    const code = first.view().session!.code;
    const token = first.store.get(PLAY_KEYS.token)!;
    stops.splice(0).forEach(s => s());
    first.socket.close();
    app.session.open();

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
    app.session.open();
    await until(() => p.view().session?.phase === 'open', 'open');
    saveRun(p.store, p.view().session!.code, atReport(1));
    p.ctl.reportProgress('morning');
    await until(() => member().progress?.phase === 'morning', 'progress');

    p.socket.disconnect();
    await until(() => !p.view().connected, 'disconnect');
    p.ctl.reportDay(atReport(1));
    p.ctl.reportProgress('rush');
    await pause(100);
    expect(p.ctl.pending()).toBe(1);
    expect(member().days).toHaveLength(0);

    p.socket.connect();
    await until(() => member().days.length === 1, 'the day after reconnect and resume');
    await until(() => member().progress?.phase === 'rush', 'progress after resume');
    expect(p.ctl.pending()).toBe(0);
  });

  it('after a host reset: a new session code drops the old run, vote and rank and goes back to the lobby', async () => {
    const url = await server();
    const p = await joined(url, 'An');
    const oldCode = p.view().session!.code;
    p.ctl.vote('visible');
    await until(() => member().vote.before === 'visible', 'vote');
    app.session.open();
    await until(() => p.view().session?.phase === 'open', 'open');
    const runId = p.ctl.runId();
    expect(p.store.get(PLAY_KEYS.runId(oldCode))).toBe(runId);
    saveRun(p.store, oldCode, atReport(2));
    p.ctl.reportDay(atReport(2));
    await until(() => p.view().rank !== null, 'rank');

    app.session.reset();
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
    expect(ctl.seed()).toBe(5);
    expect(v.session).toBeNull();
  });
});
