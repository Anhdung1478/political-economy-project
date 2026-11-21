import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Ack, SoloBoard as BoardView, SoloSubmitAck } from '../shared/protocol';
import { createApp, type AppOptions } from './app';
import { createSavedSoloBoard, loadSoloBoard } from './soloBoard';

const tmp = mkdtempSync(path.join(tmpdir(), 'pts-solo-app-'));
afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

let app: ReturnType<typeof createApp>;
let url = '';
let clients: Socket[] = [];
async function start(opts: Partial<AppOptions> = {}) {
  app = createApp({ hostKey: 'secret', ...opts });
  await new Promise<void>(r => app.http.listen(0, r));
  url = `http://localhost:${(app.http.address() as AddressInfo).port}`;
}
afterEach(async () => { clients.forEach(c => c.close()); clients = []; await app.close(); });

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(s);
  const boards: BoardView[] = [];
  s.on('solo:board', b => boards.push(b));
  const emit = <T = Ack>(ev: string, payload?: unknown) =>
    new Promise<T>(res => s.emit(ev as never, payload as never, res as never));
  const untilBoard = async (pred: (b: BoardView) => boolean) => {
    const t0 = Date.now();
    while (!boards.some(pred)) {
      if (Date.now() - t0 > 3000) throw new Error(`no matching board; got ${JSON.stringify(boards)}`);
      await wait(5);
    }
    return boards.find(pred)!;
  };
  return { s, emit, boards, untilBoard };
}
const submit = (c: ReturnType<typeof client>, name: string, score: number, runId: string) =>
  c.emit<SoloSubmitAck>('solo:submit', { name, score, runId });

describe('solo board over the socket', () => {
  it('watch answers with the board; a submission is acked with rank and broadcast to watchers only', async () => {
    await start();
    const watcher = client();
    const idle = client();
    expect(await watcher.emit('solo:watch', {})).toEqual({ ok: true, board: { entries: [], total: 0 } });
    expect(await submit(idle, 'An', 100, 'r1')).toEqual({ ok: true, rank: 1, best: 100, improved: true, onBoard: true });
    const b = await watcher.untilBoard(x => x.total === 1);
    expect(b.entries[0]).toMatchObject({ name: 'An', score: 100 });
    await wait(50);
    expect(idle.boards).toHaveLength(0);
  });

  it('keeps the best per name and answers a resent runId without a broadcast', async () => {
    await start();
    const c = client();
    await c.emit('solo:watch', {});
    await submit(c, 'An', 100, 'r1');
    await c.untilBoard(x => x.total === 1);
    const before = c.boards.length;
    expect(await submit(c, ' an ', 50, 'r2')).toEqual({ ok: true, rank: 1, best: 100, improved: false, onBoard: true });
    expect(await submit(c, 'An', 100, 'r1')).toEqual({ ok: true, rank: 1, best: 100, improved: true, onBoard: true });
    await wait(400);
    expect(c.boards.length).toBe(before);
  });

  it('stops broadcasting after solo:unwatch', async () => {
    await start();
    const w = client();
    const p = client();
    await w.emit('solo:watch', {});
    w.s.emit('solo:unwatch');
    await wait(50);
    await submit(p, 'An', 1, 'r1');
    await wait(400);
    expect(w.boards).toHaveLength(0);
  });

  it('refuses bad payloads and rate limits one socket', async () => {
    await start({ soloRateLimit: 3 });
    const c = client();
    expect(await c.emit('solo:submit', { name: '', score: 1, runId: 'x' })).toEqual({ ok: false, error: 'badRequest' });
    expect(await c.emit('solo:submit', { name: 'An', score: NaN, runId: 'x' })).toEqual({ ok: false, error: 'badRequest' });
    expect(await c.emit('solo:submit', null)).toEqual({ ok: false, error: 'badRequest' });
    expect(await submit(c, 'An', 1, 'r1')).toEqual({ ok: false, error: 'rateLimited' });
    // Another socket has its own allowance.
    expect((await submit(client(), 'An', 1, 'r1')).ok).toBe(true);
  });

  it('limits one IP address across sockets, and everybody together', async () => {
    await start({ soloIpLimit: 3, soloRateLimit: 100 });
    const a = client();
    expect((await submit(a, 'A', 1, '1')).ok).toBe(true);
    expect((await submit(client(), 'B', 1, '2')).ok).toBe(true);
    expect((await submit(a, 'C', 1, '3')).ok).toBe(true);
    // Same address (localhost), a fresh socket: over the limit.
    expect(await submit(client(), 'D', 1, '4')).toEqual({ ok: false, error: 'rateLimited' });
    clients.forEach(c => c.close());
    await app.close();
    await start({ soloGlobalLimit: 2, soloIpLimit: 100, soloRateLimit: 100 });
    expect((await submit(client(), 'A', 1, '1')).ok).toBe(true);
    expect((await submit(client(), 'B', 1, '2')).ok).toBe(true);
    expect(await submit(client(), 'C', 1, '3')).toEqual({ ok: false, error: 'rateLimited' });
  });

  it('takes the address from X-Forwarded-For only when the proxy is trusted', async () => {
    const via = (ip: string) => {
      const s = connect(url, { transports: ['websocket'], forceNew: true, extraHeaders: { 'x-forwarded-for': `9.9.9.9, ${ip}` } });
      clients.push(s);
      return new Promise<Ack>(res => s.emit('solo:submit' as never, { name: ip, score: 1, runId: ip } as never, res as never));
    };
    await start({ soloIpLimit: 1, soloRateLimit: 100 });
    // Not trusted: both come from the same socket address, so the second is limited.
    expect((await via('1.1.1.1')).ok).toBe(true);
    expect(await via('2.2.2.2')).toEqual({ ok: false, error: 'rateLimited' });
    clients.forEach(c => c.close());
    await app.close();
    await start({ soloIpLimit: 1, soloRateLimit: 100, trustProxy: true });
    expect((await via('1.1.1.1')).ok).toBe(true);
    expect((await via('2.2.2.2')).ok).toBe(true);
    expect(await via('2.2.2.2')).toEqual({ ok: false, error: 'rateLimited' });
  });

  it('refuses a runId used by another name', async () => {
    await start();
    const c = client();
    await submit(c, 'An', 5, 'r1');
    expect(await submit(c, 'Binh', 9, 'r1')).toEqual({ ok: false, error: 'runIdUsed' });
  });

  it('answers durable:false when the file could not be saved', async () => {
    await start({ soloPersistNow: () => Promise.resolve(false) });
    expect(await submit(client(), 'An', 5, 'r1')).toMatchObject({ ok: true, durable: false, rank: 1 });
  });

  it('persists to the file before answering', async () => {
    const file = path.join(tmp, 'persist', 'solo.json');
    const saved = createSavedSoloBoard(file, () => {}, 10);
    await start({ soloBoard: saved.board, soloPersistNow: saved.flush });
    expect((await submit(client(), 'An', 77, 'r1')).ok).toBe(true);
    expect(loadSoloBoard(file).view().entries[0]).toMatchObject({ name: 'An', score: 77 });
  });

  it('only an authenticated host can reset, and the empty board is broadcast', async () => {
    await start();
    const w = client();
    const p = client();
    await w.emit('solo:watch', {});
    await submit(p, 'An', 5, 'r1');
    await w.untilBoard(x => x.total === 1);
    expect((await p.emit<Ack>('host:soloReset', {})).ok).toBe(false);
    expect(await w.emit('solo:watch', {})).toMatchObject({ board: { total: 1 } });
    const h = client();
    expect((await h.emit('host:auth', { key: 'secret' })).ok).toBe(true);
    expect((await h.emit('host:soloReset', {})).ok).toBe(true);
    await w.untilBoard(x => x.total === 0);
  });
});
