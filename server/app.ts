import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { EMOJIS, GAME, type Emoji } from '../shared/config';
import type { ClientToServer, ServerToClient } from '../shared/types';
import { GameRoom } from './game/engine';

interface SocketData {
  playerId?: string;
  isHost?: boolean;
  tokens: number;
  refill: number;
}

export interface AppOptions {
  hostKey: string;
  staticDir?: string;
  publicUrl?: string;
}

export function createApp(opts: AppOptions) {
  const app = express();
  const http = createServer(app);
  const io = new Server<ClientToServer, ServerToClient, object, SocketData>(http);
  const room = new GameRoom();

  app.get('/healthz', (_req, res) => { res.type('text').send('ok'); });
  app.get('/api/config', (_req, res) => { res.json({ publicUrl: opts.publicUrl ?? null }); });
  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get(['/', '/host', '/play'], (_req, res) => { res.sendFile(path.join(dir, 'index.html')); });
  }

  // Coalesce bursts of mutations (e.g. 50 phones submitting at once) into one broadcast.
  let queued = false;
  const broadcast = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; io.emit('state', room.snapshot()); }, 50);
  };

  let timer: NodeJS.Timeout | undefined;
  const armTimer = () => {
    clearTimeout(timer);
    if (room.phase !== 'pricing' || room.deadline === null) return;
    const round = room.roundIndex;
    timer = setTimeout(() => {
      if (room.phase === 'pricing' && room.roundIndex === round) { room.next(); broadcast(); }
    }, Math.max(0, room.deadline - Date.now()));
  };

  let emojiSeq = 0;
  io.on('connection', socket => {
    socket.data.tokens = GAME.emojiPerSecond;
    socket.data.refill = Date.now();
    socket.emit('state', room.snapshot());

    const reply = (ack: unknown, value: unknown) => { if (typeof ack === 'function') ack(value); };
    const attach = (playerId: string) => {
      socket.data.playerId = playerId;
      room.setConnected(playerId, true);
      broadcast();
    };

    socket.on('player:join', (p, ack) => {
      const r = room.join(String(p?.nickname ?? ''));
      if (r.ok) attach(r.playerId);
      reply(ack, r);
    });
    socket.on('player:resume', (p, ack) => {
      const id = room.resume(String(p?.token ?? ''));
      if (id) { attach(id); reply(ack, { ok: true, playerId: id }); }
      else reply(ack, { ok: false, error: 'Không tìm thấy quán của bạn' });
    });
    socket.on('player:vote', p => {
      if (!socket.data.playerId) return;
      room.vote(socket.data.playerId, p?.choice);
      broadcast();
    });
    socket.on('player:price', (p, ack) => {
      if (!socket.data.playerId) return reply(ack, { ok: false, error: 'Bạn chưa vào chợ' });
      const r = room.submitPrice(socket.data.playerId, Number(p?.price));
      reply(ack, r);
      if (r.ok) broadcast();
    });
    socket.on('player:emoji', p => {
      if (!socket.data.playerId || !EMOJIS.includes(p?.emoji as Emoji)) return;
      const now = Date.now();
      socket.data.tokens = Math.min(
        GAME.emojiPerSecond,
        socket.data.tokens + ((now - socket.data.refill) / 1000) * GAME.emojiPerSecond,
      );
      socket.data.refill = now;
      if (socket.data.tokens < 1) return;
      socket.data.tokens -= 1;
      io.to('hosts').emit('emoji', { emoji: p.emoji, id: ++emojiSeq });
    });

    socket.on('host:auth', (p, ack) => {
      if (String(p?.key ?? '') !== opts.hostKey) return reply(ack, { ok: false, error: 'Sai mã host' });
      socket.data.isHost = true;
      socket.join('hosts');
      reply(ack, { ok: true });
    });
    socket.on('host:next', () => {
      if (!socket.data.isHost) return;
      room.next();
      armTimer();
      broadcast();
    });
    socket.on('host:reset', () => {
      if (!socket.data.isHost) return;
      clearTimeout(timer);
      room.reset();
      broadcast();
    });

    socket.on('disconnect', () => {
      const id = socket.data.playerId;
      if (!id) return;
      const stillHere = [...io.sockets.sockets.values()].some(s => s.id !== socket.id && s.data.playerId === id);
      if (!stillHere) { room.setConnected(id, false); broadcast(); }
    });
  });

  const close = () => new Promise<void>(res => { clearTimeout(timer); io.close(() => res()); });
  return { app, http, io, room, close };
}
