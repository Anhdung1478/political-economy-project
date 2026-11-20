import { useEffect, useState, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Emoji } from '../../../shared/config';
import type { Ack, ClientToServer, Phase, PollChoice, RoomSnapshot, ServerToClient } from '../../../shared/types';

export const socket: Socket<ServerToClient, ClientToServer> = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
// tryAllTransports: fall back to long-polling when a reverse proxy does not forward WebSocket upgrades.

interface RoomStore { state: RoomSnapshot | null; connected: boolean; serverOffset: number }
let current: RoomStore = { state: null, connected: socket.connected, serverOffset: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<RoomStore>) => {
  current = { ...current, ...patch };
  listeners.forEach(l => l());
};

socket.on('state', s => set({ state: s, serverOffset: s.serverNow - Date.now() }));
socket.on('connect', () => set({ connected: true }));
socket.on('disconnect', () => set({ connected: false }));
// Phones that wake from sleep reconnect straight away instead of waiting for the backoff.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !socket.connected) socket.connect();
});

/** Error text of an ack that never arrived (network), as opposed to a real refusal from the server. */
export const NET_TIMEOUT = 'Mạng chậm quá, thử lại nhé';

/** Latest room snapshot plus connection status; `serverOffset` = server clock − local clock. */
export function useRoom(): RoomStore {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
  );
}

function call<R>(event: string, payload: unknown): Promise<R> {
  const timed = socket.timeout(5000) as unknown as { emit: (...args: unknown[]) => void };
  return new Promise(resolve => {
    timed.emit(event, payload, (err: Error | null, res: R) =>
      resolve(err ? ({ ok: false, error: NET_TIMEOUT } as R) : res));
  });
}

export const api = {
  join: (nickname: string) => call<Ack<{ playerId: string; token: string }>>('player:join', { nickname }),
  resume: (token: string) => call<Ack<{ playerId: string }>>('player:resume', { token }),
  price: (price: number, cost: number) => call<Ack>('player:price', { price, cost }),
  hostAuth: (key: string) => call<Ack>('host:auth', { key }),
  vote: (choice: PollChoice) => { socket.emit('player:vote', { choice }); },
  emoji: (emoji: Emoji) => { socket.emit('player:emoji', { emoji }); },
  next: (phase: Phase, roundIndex: number) => { socket.emit('host:next', { phase, roundIndex }); },
  reset: () => { socket.emit('host:reset'); },
};

/** Runs `cb` now (if connected) and after every reconnect. */
export function useOnConnect(cb: () => void): void {
  useEffect(() => {
    if (socket.connected) cb();
    socket.on('connect', cb);
    return () => { socket.off('connect', cb); };
  }, [cb]);
}

/** Re-renders every `ms` milliseconds; returns Date.now(). */
export function useNow(ms = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

let publicUrl: Promise<string> | null = null;
/** The URL phones should open: PUBLIC_URL from the server, else this page's origin. */
export function usePlayUrl(): string {
  const [url, setUrl] = useState(`${location.origin}/play`);
  useEffect(() => {
    publicUrl ??= fetch('/api/config')
      .then(r => r.json() as Promise<{ publicUrl: string | null }>)
      .then(c => (c.publicUrl ?? location.origin).replace(/\/+$/, ''))
      .catch(() => location.origin);
    publicUrl.then(base => setUrl(`${base}/play`));
  }, []);
  return url;
}

export { storage } from '../game/storage';
