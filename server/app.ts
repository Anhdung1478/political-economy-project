// The class-session server (spec §10, §11): express + socket.io around one `Session`. Phones join, vote and send
// their days; the host opens the market, freezes the awards and resets. Every mutation is followed by a coalesced
// `state` broadcast and a throttled `host:board` to the authenticated host sockets only.
import compression from 'compression';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import type { Ack, ClientToServer, ServerToClient } from '../shared/protocol';
import { Session } from './session';

interface SocketData {
  playerId?: string;
  isHost?: boolean;
}

export interface AppOptions {
  hostKey: string;
  staticDir?: string;
  publicUrl?: string;
  /** The session to serve (loaded from the session file); a new one otherwise. */
  session?: Session;
  /** At most one `host:board` per this many ms (the board can be ~0.5 MB at 200 players). */
  boardThrottleMs?: number;
}

/** Bursts of changes (200 phones sending a day at once) go out as one `state`. */
const STATE_COALESCE_MS = 100;
const BOARD_THROTTLE_MS = 1000;
const HOSTS = 'hosts';

type Reply = (r: Ack<object>) => void;
const field = (p: unknown, key: string): unknown =>
  typeof p === 'object' && p !== null ? (p as Record<string, unknown>)[key] : undefined;

export function createApp(opts: AppOptions) {
  const app = express();
  const http = createServer(app);
  // Short heartbeats so a phone that silently lost Wi-Fi notices within ~10 s.
  const io = new Server<ClientToServer, ServerToClient, object, SocketData>(http, { pingInterval: 5000, pingTimeout: 5000 });
  const session = opts.session ?? new Session();
  const boardThrottle = opts.boardThrottleMs ?? BOARD_THROTTLE_MS;

  app.use(compression());
  app.get('/healthz', (_req, res) => { res.type('text').send('ok'); });
  app.get('/api/config', (_req, res) => { res.json({ publicUrl: opts.publicUrl ?? null }); });
  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = path.resolve(opts.staticDir);
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get(['/', '/solo', '/play', '/host'], (_req, res) => { res.sendFile(path.join(dir, 'index.html')); });
  }

  let stateTimer: NodeJS.Timeout | null = null;
  let boardTimer: NodeJS.Timeout | null = null;
  let lastBoard = 0;
  const sendBoard = () => {
    boardTimer = null;
    lastBoard = Date.now();
    if ((io.sockets.adapter.rooms.get(HOSTS)?.size ?? 0) > 0) io.to(HOSTS).emit('host:board', session.board());
  };
  const changed = () => {
    stateTimer ??= setTimeout(() => { stateTimer = null; io.emit('state', session.snapshot()); }, STATE_COALESCE_MS);
    boardTimer ??= setTimeout(sendBoard, Math.max(STATE_COALESCE_MS, lastBoard + boardThrottle - Date.now()));
  };

  /** Open sockets per player, so a player with two tabs stays connected until the last one closes. */
  const sockets = new Map<string, number>();
  const detach = (id: string) => {
    const n = (sockets.get(id) ?? 1) - 1;
    if (n > 0) { sockets.set(id, n); return; }
    sockets.delete(id);
    session.setConnected(id, false);
    changed();
  };

  io.on('connection', socket => {
    socket.emit('state', session.snapshot());

    const attach = (id: string) => {
      if (socket.data.playerId === id) return;
      if (socket.data.playerId) detach(socket.data.playerId);
      socket.data.playerId = id;
      sockets.set(id, (sockets.get(id) ?? 0) + 1);
      session.setConnected(id, true);
      changed();
    };
    /** Runs a handler; garbage that makes it throw is answered with an error, never left hanging. */
    const handle = (ack: unknown, fn: (reply: Reply) => void) => {
      const reply: Reply = r => { if (typeof ack === 'function') ack(r); };
      try { fn(reply); } catch { reply({ ok: false, error: 'badRequest' }); }
    };
    /** The player behind this socket, if it still exists. */
    const me = (): string | null => {
      const id = socket.data.playerId;
      return id !== undefined && session.hasPlayer(id) ? id : null;
    };
    const hostOnly = (fn: () => void) => () => {
      if (!socket.data.isHost) return;
      fn();
      changed();
    };

    socket.on('player:join', (p, ack) => handle(ack, reply => {
      const r = session.join(field(p, 'nickname') as string);
      if (r.ok) attach(r.playerId);
      reply(r);
    }));
    socket.on('player:resume', (p, ack) => handle(ack, reply => {
      const r = session.resume(field(p, 'token') as string);
      if (!r) { reply({ ok: false, error: 'Không tìm thấy quán của bạn' }); return; }
      attach(r.playerId);
      reply({ ok: true, ...r });
    }));
    socket.on('player:vote', (p, ack) => handle(ack, reply => {
      const id = me();
      if (!id) { reply({ ok: false, error: 'unknownPlayer' }); return; }
      const r = session.vote(id, field(p, 'code') as string,
        { choice: field(p, 'choice'), when: field(p, 'when') } as never);
      reply(r);
      if (r.ok) changed();
    }));
    socket.on('player:progress', p => handle(undefined, () => {
      const id = me();
      if (!id) return;
      if (session.progress(id, field(p, 'day') as never, field(p, 'phase') as never)) changed();
    }));
    socket.on('player:day', (p, ack) => handle(ack, reply => {
      const id = me();
      if (!id) { reply({ ok: false, error: 'unknownPlayer' }); return; }
      const r = session.submitDay(id, field(p, 'code') as string, field(p, 'runId') as string, field(p, 'summary') as never);
      reply(r);
      if (r.ok) changed();
    }));

    socket.on('host:auth', (p, ack) => handle(ack, reply => {
      if (String(field(p, 'key') ?? '') !== opts.hostKey) { reply({ ok: false, error: 'Sai mã host' }); return; }
      socket.data.isHost = true;
      void socket.join(HOSTS);
      reply({ ok: true });
      socket.emit('host:board', session.board());
    }));
    socket.on('host:open', hostOnly(() => session.open()));
    socket.on('host:awards', hostOnly(() => session.awards()));
    socket.on('host:reset', hostOnly(() => session.reset()));

    socket.on('disconnect', () => {
      const id = socket.data.playerId;
      if (id !== undefined) detach(id);
    });
  });

  const close = () => new Promise<void>(res => {
    if (stateTimer) clearTimeout(stateTimer);
    if (boardTimer) clearTimeout(boardTimer);
    io.close(() => res());
  });
  return { app, http, io, session, close };
}
