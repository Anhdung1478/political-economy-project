import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import type { RoomSnapshot } from '../shared/types';
import { createApp } from './app';

let app: ReturnType<typeof createApp>;
let url = '';
const clients: Socket[] = [];

beforeAll(async () => {
  app = createApp({ hostKey: 'secret' });
  await new Promise<void>(r => app.http.listen(0, r));
  url = `http://localhost:${(app.http.address() as AddressInfo).port}`;
});
afterAll(async () => {
  clients.forEach(c => c.close());
  await app.close();
});

function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  let last: RoomSnapshot | null = null;
  s.on('state', st => (last = st));
  clients.push(s);
  const until = (pred: (st: RoomSnapshot) => boolean) =>
    new Promise<RoomSnapshot>((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout')), 3000);
      const check = () => {
        if (last && pred(last)) { clearTimeout(t); s.off('state', check); res(last); }
      };
      s.on('state', check);
      check();
    });
  const emit = <T>(ev: string, payload?: unknown) =>
    new Promise<T>(res => s.emit(ev as never, payload as never, res as never));
  return { s, until, emit };
}

describe('server', () => {
  it('serves health + config', async () => {
    expect(await (await fetch(`${url}/healthz`)).text()).toBe('ok');
    expect(await (await fetch(`${url}/api/config`)).json()).toEqual({ publicUrl: null });
  });

  it('rejects a wrong host key and ignores host commands from non-hosts', async () => {
    const c = client();
    expect(await c.emit('host:auth', { key: 'nope' })).toEqual({ ok: false, error: expect.any(String) });
    c.s.emit('host:next', { phase: 'lobby', roundIndex: -1 });
    await new Promise(r => setTimeout(r, 150));
    expect(app.room.phase).toBe('lobby');
  });

  it('plays a full game with two phones', async () => {
    const host = client(), a = client(), b = client();
    expect((await host.emit<{ ok: boolean }>('host:auth', { key: 'secret' })).ok).toBe(true);
    const ja = await a.emit<{ ok: true; token: string; playerId: string }>('player:join', { nickname: 'An' });
    await b.emit('player:join', { nickname: 'Bình' });
    a.s.emit('player:vote', { choice: 'visible' });
    await host.until(s => s.players.length >= 2 && s.poll.visible === 1);

    const step = (phase: string, roundIndex: number) => host.s.emit('host:next', { phase, roundIndex } as never);
    step('lobby', -1);
    step('lobby', -1); // double click: must be ignored
    await host.until(s => s.phase === 'event');
    await new Promise(r => setTimeout(r, 150));
    expect(app.room.phase).toBe('event');
    step('event', 0);
    await host.until(s => s.phase === 'pricing');
    expect((await a.emit<{ ok: boolean }>('player:price', { price: 22 })).ok).toBe(true);
    await host.until(s => s.players.some(p => p.submitted));
    step('pricing', 0);
    const rev = await host.until(s => s.phase === 'reveal');
    expect(rev.lastResult!.shops.find(x => x.playerId === ja.playerId)!.price).toBe(22);

    for (let r = 1; r < 5; r++) {
      step('reveal', r - 1); step('event', r); step('pricing', r);
      await host.until(s => s.phase === 'reveal' && s.roundIndex === r);
    }
    step('reveal', 4);
    const end = await host.until(s => s.phase === 'awards');
    expect(end.awards.length).toBeGreaterThan(0);

    const resumed = client();
    expect(await resumed.emit('player:resume', { token: ja.token })).toEqual({ ok: true, playerId: ja.playerId });

    host.s.emit('host:reset');
    await host.until(s => s.phase === 'lobby');
  });

  it('forwards whitelisted emoji to hosts only', async () => {
    const host = client(), p = client();
    await host.emit('host:auth', { key: 'secret' });
    await p.emit('player:join', { nickname: 'Emo' });
    const got = new Promise(res => host.s.once('emoji', res));
    p.s.emit('player:emoji', { emoji: '🥤' });
    expect(await got).toMatchObject({ emoji: '🥤' });
  });
});
