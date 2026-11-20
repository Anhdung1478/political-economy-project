// The class-session connection (spec §10, §11). Only /play and /host open it, through `connect()` (or `useSession()`);
// importing this module opens nothing. Solo never imports it (the clock and play-URL hooks live in `ui/`).
import { useEffect, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack, ClientToServer, HostBoard, Progress, ServerToClient, SessionSnapshot, Vote,
} from '../../../shared/protocol';
import type { DaySummary } from '../../../shared/sim/types';

export type ClassSocket = Socket<ServerToClient, ClientToServer>;

/** Error text of an ack that never arrived (network), as opposed to a real refusal from the server. */
export const NET_TIMEOUT = 'Mạng chậm quá, thử lại nhé';
/** How long an ack may take before it counts as lost. */
export const ACK_TIMEOUT_MS = 5000;

/** The latest server state as seen by this tab. */
export interface SessionStore {
  /** The last `state`; null until the first one arrives. */
  state: SessionSnapshot | null;
  /** The last `host:board` (host sockets only). */
  board: HostBoard | null;
  connected: boolean;
}

export interface SessionClient {
  socket: ClassSocket;
  join(nickname: string): Promise<Ack<{ playerId: string; token: string }>>;
  resume(token: string): Promise<Ack<{ playerId: string; name: string }>>;
  /** Send through the report queue (`createOutbox`), which tags each item with its session code. */
  vote(p: Vote & { code: string }): Promise<Ack>;
  day(p: { code: string; runId: string; summary: DaySummary }): Promise<Ack<{ rank: number }>>;
  progress(p: Progress): void;
  hostAuth(key: string): Promise<Ack>;
  open(): void;
  awards(): void;
  reset(): void;
  /** Runs `cb` now if connected and after every (re)connect; returns the unsubscribe. */
  onConnect(cb: () => void): () => void;
}

/** Whether an ack is the local timeout rather than a reply from the server. */
export const isNetTimeout = (r: Ack<object>) => !r.ok && r.error === NET_TIMEOUT;

let current: SessionStore = { state: null, board: null, connected: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<SessionStore>) => {
  current = { ...current, ...patch };
  listeners.forEach(l => l());
};

/** Events answered with an ack, their payloads and their replies, from `ClientToServer`. */
type AckEvent = {
  [E in keyof ClientToServer]: Parameters<ClientToServer[E]> extends [unknown, unknown] ? E : never
}[keyof ClientToServer];
type PayloadOf<E extends AckEvent> = Parameters<ClientToServer[E]>[0];
type ReplyOf<E extends AckEvent> = Parameters<Parameters<ClientToServer[E]>[1]>[0];

/**
 * The typed client over a socket. An ack-ed event is never buffered while disconnected: socket.io would flush it on
 * reconnect before `player:resume`, the server would answer `unknownPlayer`, and the report would be lost. It
 * resolves to the local timeout at once instead, so the report queue keeps the item.
 */
export function createClient(socket: ClassSocket, ackTimeoutMs = ACK_TIMEOUT_MS): SessionClient {
  function call<E extends AckEvent>(event: E, payload: PayloadOf<E>): Promise<ReplyOf<E>> {
    const timedOut = { ok: false, error: NET_TIMEOUT } as ReplyOf<E>;
    if (!socket.connected) return Promise.resolve(timedOut);
    const timed = socket.timeout(ackTimeoutMs) as unknown as {
      emit: (ev: E, p: PayloadOf<E>, cb: (err: Error | null, r: ReplyOf<E>) => void) => void;
    };
    return new Promise(resolve => {
      timed.emit(event, payload, (err, r) => resolve(err ? timedOut : r));
    });
  }
  return {
    socket,
    join: nickname => call('player:join', { nickname }),
    resume: token => call('player:resume', { token }),
    vote: p => call('player:vote', p),
    day: p => call('player:day', p),
    progress: p => { if (socket.connected) socket.emit('player:progress', p); },
    hostAuth: key => call('host:auth', { key }),
    open: () => { socket.emit('host:open'); },
    awards: () => { socket.emit('host:awards'); },
    reset: () => { socket.emit('host:reset'); },
    onConnect(cb) {
      if (socket.connected) cb();
      socket.on('connect', cb);
      return () => { socket.off('connect', cb); };
    },
  };
}

let client: SessionClient | null = null;

/** The connection to the class server, opened on the first call; later calls return the same client. */
export function connect(): SessionClient {
  if (client) return client;
  // tryAllTransports: fall back to long-polling when a reverse proxy does not forward WebSocket upgrades.
  const socket: ClassSocket = io({ transports: ['websocket', 'polling'], tryAllTransports: true });
  socket.on('state', s => set({ state: s }));
  socket.on('host:board', b => set({ board: b }));
  socket.on('connect', () => set({ connected: true }));
  socket.on('disconnect', () => set({ connected: false }));
  // Phones that wake from sleep reconnect straight away instead of waiting for the backoff.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !socket.connected) socket.connect();
  });
  client = createClient(socket);
  return client;
}

/** The latest `state`, board and connection status; the connection opens when the first component subscribes. */
export function useSession(): SessionStore {
  return useSyncExternalStore(
    cb => { connect(); listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
  );
}

/** Runs `cb` now (if connected) and after every reconnect; opens the connection on first use. */
export function useOnConnect(cb: () => void): void {
  useEffect(() => connect().onConnect(cb), [cb]);
}
