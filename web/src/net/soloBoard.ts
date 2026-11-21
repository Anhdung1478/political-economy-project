// The solo leaderboard over the shared socket. Solo's page loads this module lazily (dynamic import), only for the
// board, so the game itself never depends on the network (spec §10). Importing it opens nothing; `watchBoard` does.
import type { SoloBoard, SoloSubmit } from '../../../shared/protocol';
import { retryUntilOk } from './retry';
import { connect } from './socket';

export interface BoardView { board: SoloBoard | null; connected: boolean }
/** What came of sending a run: kept by the server; to send again later; or refused for good (a bad payload). */
export type SubmitOutcome =
  | { kind: 'saved'; rank: number; best: number; improved: boolean; onBoard: boolean }
  | { kind: 'retry' }
  | { kind: 'rejected' };

const listeners = new Set<(v: BoardView) => void>();
let view: BoardView = { board: null, connected: false };
let stop: (() => void) | null = null;
/** Whether a run is still waiting to be sent (set by the page): the socket stays up for it. */
let keepAlive: () => boolean = () => false;
export const setKeepAlive = (fn: () => boolean) => { keepAlive = fn; };

/** Drops the connection when nobody watches the board and no run waits to be sent. */
export function closeIfIdle(): void {
  if (listeners.size === 0 && !keepAlive()) connect().socket.disconnect();
}
const publish = (patch: Partial<BoardView>) => { view = { ...view, ...patch }; listeners.forEach(l => l(view)); };

function start(): () => void {
  const c = connect();
  // Closed by `closeIfIdle` earlier: a manual disconnect does not come back by itself.
  if (!c.socket.connected && !c.socket.active) c.socket.connect();
  let cancelWatch = () => {};
  const onBoard = (b: SoloBoard) => publish({ board: b });
  const onDown = () => publish({ connected: false });
  c.socket.on('solo:board', onBoard);
  c.socket.on('disconnect', onDown);
  // Rooms are lost with the connection, so every (re)connect watches again.
  const off = c.onConnect(() => {
    publish({ connected: true });
    // A lost ack (the watch itself may have worked) is asked again after a pause, until one arrives.
    cancelWatch();
    cancelWatch = retryUntilOk(async () => {
      const r = await c.soloWatch();
      if (r.ok) publish({ board: r.board });
      return r.ok;
    }, 2000, 30_000);
  });
  return () => {
    cancelWatch();
    off();
    c.socket.off('solo:board', onBoard);
    c.socket.off('disconnect', onDown);
    c.soloUnwatch();
    publish({ connected: false });
    closeIfIdle();
  };
}

/** Calls `cb` with the current view now and at every change; the connection opens with the first watcher. */
export function watchBoard(cb: (v: BoardView) => void): () => void {
  listeners.add(cb);
  stop ??= start();
  cb(view);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && stop) { stop(); stop = null; }
  };
}

export async function submitSolo(p: SoloSubmit): Promise<SubmitOutcome> {
  const r = await connect().soloSubmit(p);
  if (r.ok) return r.durable === false ? { kind: 'retry' } : { kind: 'saved', rank: r.rank, best: r.best, improved: r.improved, onBoard: r.onBoard };
  // `badRequest` will never be accepted on resend; a timeout, a rate limit or anything else may be.
  return r.error === 'badRequest' || r.error === 'runIdUsed' ? { kind: 'rejected' } : { kind: 'retry' };
}
