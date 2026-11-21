// Sends the finished solo runs and keeps trying while any is left: the first try at once, then after 5 s, 10 s … up
// to a minute. A run is held in memory as well as in storage, so blocked storage still sends it (it just cannot
// survive a reload). Pure apart from the injected store, sender and timers.
import { backoff, realTimers, type Timers } from '../../net/retry';
import type { SubmitOutcome } from '../../net/soloBoard';
import type { SoloSubmit } from '../../../../shared/protocol';
import type { KeyValueStore } from '../../game/storage';
import { allPending, enqueue, flushPending } from './soloQueue';

export interface SoloSync {
  /** Queues a finished run and tries to send it. */
  submit(item: SoloSubmit): void;
  /** Tries now (a connection came); no-op while a try runs. */
  run(): void;
  hasPending(): boolean;
  stop(): void;
}

export function createSoloSync(opts: {
  store: KeyValueStore;
  send: (p: SoloSubmit) => Promise<SubmitOutcome>;
  onResults: (done: { runId: string; outcome: SubmitOutcome }[]) => void;
  /** Called when a try ends with nothing left to send. */
  onIdle?: () => void;
  timers?: Timers;
  minMs?: number;
  maxMs?: number;
}): SoloSync {
  const { store, send, onResults, onIdle } = opts;
  const timers = opts.timers ?? realTimers;
  const min = opts.minMs ?? 5000;
  const max = opts.maxMs ?? 60_000;
  const mem: SoloSubmit[] = [];
  let timer: unknown = null;
  let busy = false;
  let fails = 0;
  let stopped = false;

  const run = () => {
    if (busy || stopped) return;
    if (timer !== null) { timers.clear(timer); timer = null; }
    busy = true;
    void flushPending(store, send, mem).then(done => {
      busy = false;
      if (done.length > 0) onResults(done);
      if (stopped) return;
      if (allPending(store, mem).length === 0) { fails = 0; onIdle?.(); return; }
      // Something could not be sent: try again later, a little less often each time.
      timer = timers.set(() => { timer = null; run(); }, backoff(fails++, min, max));
    });
  };
  return {
    submit(item) {
      if (!mem.some(m => m.runId === item.runId)) mem.push(item); else mem[mem.findIndex(m => m.runId === item.runId)] = item;
      enqueue(store, item);
      run();
    },
    run,
    hasPending: () => allPending(store, mem).length > 0,
    stop() { stopped = true; if (timer !== null) timers.clear(timer); },
  };
}
