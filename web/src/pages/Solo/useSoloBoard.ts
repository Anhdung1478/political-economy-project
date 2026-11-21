// The solo board for a component: the live board, whether it can be reached, and the queue's results. The socket
// code is loaded on demand (dynamic import), so a device that cannot load it plays on and shows "offline".
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SoloBoard, SoloSubmit } from '../../../../shared/protocol';
import { storage } from '../../game/storage';
import type { SubmitOutcome } from '../../net/soloBoard';
import { enqueue, flushPending } from './soloQueue';

type Net = typeof import('../../net/soloBoard');
let netLoad: Promise<Net | null> | null = null;
const loadNet = (): Promise<Net | null> => (netLoad ??= import('../../net/soloBoard').catch(() => { netLoad = null; return null; }));

/** One flush at a time across the page. */
let flushing: Promise<{ runId: string; outcome: SubmitOutcome }[]> | null = null;
function flush(net: Net) {
  flushing ??= flushPending(storage, net.submitSolo).finally(() => { flushing = null; });
  return flushing;
}

export type BoardStatus = 'loading' | 'live' | 'offline';
const GIVE_UP_MS = 4000;

export interface SoloBoardState {
  board: SoloBoard | null;
  status: BoardStatus;
  /** True while the board is shown but the socket is down (it may be out of date). */
  stale: boolean;
  /** The outcome of each run sent from this page, by runId. */
  results: Record<string, SubmitOutcome>;
  /** Queues a finished run and sends it as soon as there is a connection. */
  submit(item: SoloSubmit): void;
}

export function useSoloBoard(): SoloBoardState {
  const [view, setView] = useState<{ board: SoloBoard | null; connected: boolean }>({ board: null, connected: false });
  const [broken, setBroken] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [results, setResults] = useState<Record<string, SubmitOutcome>>({});
  const net = useRef<Net | null>(null);

  const run = useCallback(() => {
    const n = net.current;
    if (!n) return;
    void flush(n).then(done => {
      if (done.length > 0) setResults(r => ({ ...r, ...Object.fromEntries(done.map(d => [d.runId, d.outcome])) }));
    });
  }, []);

  useEffect(() => {
    let off = () => {};
    let dead = false;
    void loadNet().then(n => {
      if (dead) return;
      if (!n) { setBroken(true); return; }
      net.current = n;
      off = n.watchBoard(v => { setView(v); if (v.connected) run(); });
    });
    const t = setTimeout(() => setGaveUp(true), GIVE_UP_MS);
    return () => { dead = true; off(); clearTimeout(t); };
  }, [run]);

  const submit = useCallback((item: SoloSubmit) => { enqueue(storage, item); run(); }, [run]);

  const status: BoardStatus = view.board !== null ? 'live' : broken || (gaveUp && !view.connected) ? 'offline' : 'loading';
  return { board: view.board, status, stale: view.board !== null && !view.connected, results, submit };
}
