import type { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { daySummary } from '../../../shared/protocol.fixtures';
import { createApp } from '../../../server/app';
import { createOutbox } from '../game/reportQueue';
import { memoryStore } from '../game/storage';
import { type ClassSocket, createClient, isNetTimeout, NET_TIMEOUT } from './socket';

let app: ReturnType<typeof createApp> | null = null;
const sockets: ClassSocket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach(s => s.close());
  await app?.close();
  app = null;
});

async function server() {
  app = createApp({ hostKey: 'k', boardThrottleMs: 20 });
  await new Promise<void>(r => app!.http.listen(0, r));
  return `http://localhost:${(app.http.address() as AddressInfo).port}`;
}
function socketTo(url: string, autoConnect = true): ClassSocket {
  const s: ClassSocket = io(url, { transports: ['websocket'], forceNew: true, autoConnect, reconnection: false });
  sockets.push(s);
  return s;
}
const connected = (s: ClassSocket) => new Promise<void>(r => (s.connected ? r() : s.once('connect', () => r())));
const until = async (pred: () => boolean) => {
  for (let i = 0; i < 300 && !pred(); i++) await new Promise(r => setTimeout(r, 10));
  expect(pred()).toBe(true);
};

describe('socket client', () => {
  it('answers an emit while disconnected with the local timeout at once, without buffering it', async () => {
    const url = await server();
    const s = socketTo(url, false);
    const c = createClient(s, 5000);
    const t0 = Date.now();
    const r = await c.day({ code: 'X', runId: 'r', summary: daySummary() });
    expect(r).toEqual({ ok: false, error: NET_TIMEOUT });
    expect(Date.now() - t0).toBeLessThan(100);
    s.connect();
    await connected(s);
    expect(s.sendBuffer).toHaveLength(0);
  });

  it('keeps a day queued while disconnected and delivers it after reconnect and resume', async () => {
    const url = await server();
    const s = socketTo(url);
    await connected(s);
    const c = createClient(s, 2000);
    const j = await c.join('An');
    if (!j.ok) throw new Error(j.error);
    app!.session.open();
    const code = app!.session.snapshot().code;
    const ranks: number[] = [];
    const box = createOutbox({
      store: memoryStore(),
      send: item => (item.kind === 'day' ? c.day({ code: item.code, ...item.payload }) : c.vote({ code: item.code, ...item.payload })),
      isTimeout: isNetTimeout,
      onReply: (_i, r) => { if (r.ok && 'rank' in r) ranks.push(r.rank as number); },
      retryMs: 20,
    });
    box.setCode(code);
    box.online(true); // the page still believes it is online when the socket drops
    s.disconnect();
    box.push('day', { runId: 'run', summary: daySummary({ day: 1 }) });
    await new Promise(r => setTimeout(r, 60));
    expect(box.pending()).toBe(1);

    // Reconnect: a new socket id, not attached until resume. Anything that slips through gets unknownPlayer and stays.
    s.connect();
    await connected(s);
    await new Promise(r => setTimeout(r, 60));
    expect(box.pending()).toBe(1);
    expect((await c.resume(j.token)).ok).toBe(true);
    await until(() => box.pending() === 0);
    box.push('day', { runId: 'run', summary: daySummary({ day: 2 }) });
    await until(() => box.pending() === 0);
    expect(ranks).toEqual([1, 1]);
    expect(app!.session.board().members[0].days.map(d => d.day)).toEqual([1, 2]);
  });
});
