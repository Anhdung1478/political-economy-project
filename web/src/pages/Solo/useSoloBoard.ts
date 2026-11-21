// The solo board for a component: the live board, whether it can be reached, and the queue's results. The socket
// code is loaded on demand (dynamic import), so a device that cannot load it plays on and shows "offline".
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SoloBoard, SoloSubmit } from '../../../../shared/protocol';
import { storage } from '../../game/storage';
import type { SubmitOutcome } from '../../net/soloBoard';
import { createSoloSync, type SoloSync } from './soloSync';

type Net = typeof import('../../net/soloBoard');
let netLoad: Promise<Net | null> | null = null;
const loadNet = (): Promise<Net | null> => (netLoad ??= import('../../net/soloBoard').catch(() => { netLoad = null; return null; }));


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
  const sync = useRef<SoloSync | null>(null);
  /** Runs finished before the socket code arrived. */
  const early = useRef<SoloSubmit[]>([]);

  useEffect(() => {
    let off = () => {};
    let dead = false;
    void loadNet().then(n => {
      if (dead) return;
      if (!n) { setBroken(true); return; }
      const s = createSoloSync({
        store: storage,
        send: n.submitSolo,
        onResults: done => setResults(r => ({ ...r, ...Object.fromEntries(done.map(d => [d.runId, d.outcome])) })),
        onIdle: () => n.closeIfIdle(),
      });
      sync.current = s;
      n.setKeepAlive(s.hasPending);
      for (const item of early.current.splice(0)) s.submit(item);
      off = n.watchBoard(v => { setView(v); if (v.connected) s.run(); });
    });
    const t = setTimeout(() => setGaveUp(true), GIVE_UP_MS);
    return () => { dead = true; off(); sync.current?.stop(); sync.current = null; clearTimeout(t); };
  }, []);

  const submit = useCallback((item: SoloSubmit) => {
    // Before the socket code is loaded the run waits here (and in storage); with it, the sync sends and retries.
    if (sync.current) sync.current.submit(item); else early.current.push(item);
  }, []);

  const status: BoardStatus = view.board !== null ? 'live' : broken || (gaveUp && !view.connected) ? 'offline' : 'loading';
  return { board: view.board, status, stale: view.board !== null && !view.connected, results, submit };
}
