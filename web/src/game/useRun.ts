// The one real-time clock of the game (spec §6 "Kỹ thuật", §10): turns real time into 100 ms rush ticks with
// requestAnimationFrame, stops while the tab is hidden, applies the UI's queued actions on the next tick through the
// run store, saves at each transition, and hands each tick's events to the street scene. The rules live in
// `runStore.ts`; `RunController` is the clock and plumbing, `useRun` its React binding.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { CONFIG, type SimConfig } from '../../../shared/sim/config';
import type { Action, RushState, SimEvent } from '../../../shared/sim/types';
import { afterTransition, load, transition, type Intent, type PersistOpts, type RunStoreState } from './runStore';
import { storage, type KeyValueStore } from './storage';

/** Ticks one frame may run at most; a longer gap (a stalled tab) is dropped, never fast-forwarded. */
export const MAX_CATCH_UP = 3;

/**
 * Adds `dtMs` of real time to the leftover `accMs` and returns how many whole ticks are due (at most `maxTicks`) and
 * the leftover after them. When capped, the excess time is dropped but the phase within a tick is kept.
 */
export function accumulate(accMs: number, dtMs: number, tickMs: number = CONFIG.rush.tickMs,
  maxTicks: number = MAX_CATCH_UP): { ticks: number; acc: number } {
  const total = Math.max(0, accMs) + (Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0);
  const due = Math.floor(total / tickMs);
  const ticks = Math.min(due, maxTicks);
  const rest = total - ticks * tickMs;
  return { ticks, acc: due > maxTicks ? rest % tickMs : rest };
}

/** The street scene's side of the rush: `StreetCanvasHandle` fits as is. */
export interface RushSubscriber {
  /** One batch of events in sim order; `tick` is the tick of the last of them (the sim's `t`). */
  push(events: readonly SimEvent[], tick: number): void;
  /** A new rush opened (its state at tick 0). */
  reset?(snapshot: RushState): void;
}

export interface RunView {
  state: RunStoreState;
  /** The rush as it opened this day (a stable object for `StreetCanvas`'s `snapshot`); null outside the rush. */
  opening: RushState | null;
  /** The tab is hidden: the rush clock is stopped. */
  hidden: boolean;
  /** The UI holds the clock (e.g. the day-1 trial cup before the rush starts). */
  held: boolean;
}

/** What the clock needs from the browser; tests pass a fake. */
export interface ClockEnv {
  requestFrame(cb: (now: number) => void): number;
  cancelFrame(id: number): void;
  hidden(): boolean;
  /** Calls `cb` on every visibility change; returns the unsubscribe. */
  onVisibility(cb: () => void): () => void;
}

export const browserEnv: ClockEnv = {
  requestFrame: cb => requestAnimationFrame(cb),
  cancelFrame: id => cancelAnimationFrame(id),
  hidden: () => document.visibilityState === 'hidden',
  onVisibility: cb => {
    document.addEventListener('visibilitychange', cb);
    return () => document.removeEventListener('visibilitychange', cb);
  },
};

export interface RunControllerOpts {
  persist: PersistOpts;
  store?: KeyValueStore;
  env?: ClockEnv;
  /** Real time per tick; 100 ms (less to play faster in dev). */
  tickMs?: number;
  maxCatchUp?: number;
  cfg?: SimConfig;
}

export class RunController {
  private view: RunView;
  private readonly viewListeners = new Set<() => void>();
  private readonly subscribers = new Set<RushSubscriber>();
  private queue: Action[] = [];
  private acc = 0;
  private last: number | null = null;
  private frameId: number | null = null;
  private offVisibility: (() => void) | null = null;
  private readonly store: KeyValueStore;
  private readonly env: ClockEnv;
  private readonly tickMs: number;
  private readonly maxCatchUp: number;
  private readonly cfg: SimConfig;

  constructor(initial: RunStoreState, private readonly opts: RunControllerOpts) {
    this.store = opts.store ?? storage;
    this.env = opts.env ?? browserEnv;
    this.cfg = opts.cfg ?? CONFIG;
    this.tickMs = opts.tickMs ?? this.cfg.rush.tickMs;
    this.maxCatchUp = opts.maxCatchUp ?? MAX_CATCH_UP;
    this.view = { state: initial, opening: initial.rush, hidden: false, held: false };
  }

  // --- external store (useSyncExternalStore) ---
  getView = (): RunView => this.view;
  subscribeView = (cb: () => void): (() => void) => {
    this.viewListeners.add(cb);
    return () => { this.viewListeners.delete(cb); };
  };
  private setView(patch: Partial<RunView>): void {
    this.view = { ...this.view, ...patch };
    this.viewListeners.forEach(l => l());
  }

  /** The scene subscribes for each tick's events; returns the unsubscribe. */
  subscribe = (sub: RushSubscriber): (() => void) => {
    this.subscribers.add(sub);
    return () => { this.subscribers.delete(sub); };
  };

  /** A rush action for the next tick (craft, deliver, trash, setPrice, closeEarly), in the order queued. */
  act = (action: Action): void => {
    const { state } = this.view;
    if (state.rush === null || state.rush.done) return;
    this.queue.push(action);
  };

  /**
   * Applies a player intent now (plan edits, open, close early, end rush, cards, next day, new run). Closing early
   * takes the actions still queued first. Rush ticks come from the clock; dispatching `tick` steps once at once.
   */
  dispatch = (intent: Intent): void => {
    let i = intent;
    if (i.type === 'closeEarly') {
      i = { type: 'closeEarly', actions: [...this.queue, ...(i.actions ?? [])] };
      this.queue = [];
    }
    this.apply(i);
  };

  /** Holds or releases the rush clock. */
  setHold = (held: boolean): void => {
    if (held === this.view.held) return;
    this.last = null;
    this.setView({ held });
  };

  /** The sim time to draw, in ticks: the last stepped tick plus the share of the next tick elapsed. */
  simTime = (): number => {
    const rush = this.view.state.rush;
    if (rush === null || rush.tick === 0) return rush?.tick ?? 0;
    return rush.tick - 1 + (rush.done ? 0 : Math.min(1, this.acc / this.tickMs));
  };

  private apply(intent: Intent): void {
    const prev = this.view.state;
    const prevTick = prev.rush?.tick ?? 0;
    const { state, events } = transition(prev, intent, this.cfg);
    if (state === prev) return;
    afterTransition(this.store, this.opts.persist, prev, state, this.cfg);
    const opened = prev.rush === null && state.rush !== null;
    if (opened || state.rush === null) {
      this.queue = [];
      this.acc = 0;
      this.last = null;
    }
    this.setView({ state, opening: opened ? state.rush : state.rush === null ? null : this.view.opening });
    if (opened && state.rush !== null) {
      const snap = state.rush;
      this.subscribers.forEach(s => s.reset?.(snap));
    }
    // A tick is pushed even when quiet, so the scene's clock follows; other intents only when they emitted.
    if (events.length > 0 || intent.type === 'tick') {
      const tick = events.length > 0 ? events[events.length - 1].t : prevTick;
      this.subscribers.forEach(s => s.push(events, tick));
    }
  }

  private running(): boolean {
    const { state, held, hidden } = this.view;
    return state.rush !== null && !state.rush.done && !held && !hidden;
  }

  /** One animation frame at time `now` (ms); public for tests. */
  frame = (now: number): void => {
    this.frameId = null;
    if (!this.running()) {
      this.last = null;
    } else {
      const dt = this.last === null ? 0 : now - this.last;
      this.last = now;
      const { ticks, acc } = accumulate(this.acc, dt, this.tickMs, this.maxCatchUp);
      this.acc = acc;
      for (let n = 0; n < ticks && this.running(); n++) {
        const actions = this.queue;
        this.queue = [];
        this.apply({ type: 'tick', actions });
      }
    }
    if (this.offVisibility !== null) this.frameId = this.env.requestFrame(this.frame);
  };

  private onVisibility = (): void => {
    const hidden = this.env.hidden();
    this.last = null;
    if (hidden !== this.view.hidden) this.setView({ hidden });
  };

  /** Starts the frame loop and the visibility watch; safe to call twice. */
  start(): void {
    if (this.offVisibility !== null) return;
    this.offVisibility = this.env.onVisibility(this.onVisibility);
    this.onVisibility();
    this.frameId = this.env.requestFrame(this.frame);
  }

  stop(): void {
    this.offVisibility?.();
    this.offVisibility = null;
    if (this.frameId !== null) this.env.cancelFrame(this.frameId);
    this.frameId = null;
    this.last = null;
  }
}

/** The saved run under `persist.key` if there is one (and it belongs to `persist.sessionCode`), else `fallback()`. */
export function resumeOrStart(store: KeyValueStore, persist: PersistOpts, fallback: () => RunStoreState): RunStoreState {
  if (persist.key === null) return fallback();
  return load(store, persist.key, { sessionCode: persist.sessionCode }) ?? fallback();
}

export interface UseRunOptions extends Omit<RunControllerOpts, 'env'> {
  /** The state to start from, read once on mount (e.g. `resumeOrStart(...)` or `startRun(seed, runId)`). */
  initial: () => RunStoreState;
}

export interface RunHandle extends RunView {
  dispatch(intent: Intent): void;
  act(action: Action): void;
  subscribe(sub: RushSubscriber): () => void;
  simTime(): number;
  setHold(held: boolean): void;
}

/** The run, driven in real time. One per game screen; the options are read on mount. */
export function useRun(opts: UseRunOptions): RunHandle {
  const [ctl] = useState(() => new RunController(opts.initial(), opts));
  useEffect(() => {
    ctl.start();
    return () => ctl.stop();
  }, [ctl]);
  const view = useSyncExternalStore(ctl.subscribeView, ctl.getView);
  return { ...view, dispatch: ctl.dispatch, act: ctl.act, subscribe: ctl.subscribe, simTime: ctl.simTime,
    setHold: ctl.setHold };
}
