// The one real-time clock of the game (spec §6 "Kỹ thuật", §10): turns real time into 100 ms rush ticks with
// requestAnimationFrame, stops while the tab is hidden, applies the UI's queued actions on the next tick through the
// run store, saves at each transition, and hands each tick's events to the street scene. The rules live in
// `runStore.ts`; `RunController` is the clock and plumbing, `useRun` its React binding. The screen around the game
// re-renders only when the run, the draft or the clock's flags change (`ShellView`); the rush's tick-by-tick state is
// read by the rush screen alone (`useRush`), so ten ticks a second do not re-render the whole game.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { CONFIG, type SimConfig } from '../../../shared/sim/config';
import type { Action, MorningPlan, RunState, RushState, SimEvent } from '../../../shared/sim/types';
import {
  afterTransition, load, reportError, save, transition, type Intent, type PersistOpts, type RunStoreState,
} from './runStore';
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

/**
 * The view without the rush's tick-by-tick state: a new object only when the run, the draft, the rush coming or going,
 * `opening`, `hidden` or `held` change. Game re-renders on this; rush ticks leave it as it is.
 */
export interface ShellView {
  run: RunState;
  planDraft: MorningPlan;
  /** A rush is on; its live state is read with `useRush`. */
  rushOn: boolean;
  opening: RushState | null;
  hidden: boolean;
  held: boolean;
}

const shellOf = (v: RunView): ShellView => ({
  run: v.state.run, planDraft: v.state.planDraft, rushOn: v.state.rush !== null, opening: v.opening, hidden: v.hidden,
  held: v.held,
});

const sameShell = (s: ShellView, v: RunView): boolean => s.run === v.state.run && s.planDraft === v.state.planDraft
  && s.rushOn === (v.state.rush !== null) && s.opening === v.opening && s.hidden === v.hidden && s.held === v.held;

/** Where the live rush is read from (the controller): `useRush` subscribes to it. */
export interface RushSource {
  subscribeView(cb: () => void): () => void;
  getRush(): RushState | null;
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
  /** Where sim errors go (a step that throws, actions dropped); default `console.error`. */
  onError?: (error: unknown, context: string) => void;
}

export class RunController {
  private view: RunView;
  private shell: ShellView;
  private readonly viewListeners = new Set<() => void>();
  private readonly subscribers = new Set<RushSubscriber>();
  private queue: Action[] = [];
  /** Real time since the last step (ms); after the rush is done, the outro time, up to one tick. */
  private acc = 0;
  private last: number | null = null;
  /** The tick of the last push to the scene; −1 before the first step of a rush. */
  private pushedTick = -1;
  private frameId: number | null = null;
  private offVisibility: (() => void) | null = null;
  private readonly store: KeyValueStore;
  private readonly env: ClockEnv;
  private readonly tickMs: number;
  private readonly maxCatchUp: number;
  private readonly cfg: SimConfig;
  private readonly onError: (error: unknown, context: string) => void;

  constructor(initial: RunStoreState, private readonly opts: RunControllerOpts) {
    this.store = opts.store ?? storage;
    this.env = opts.env ?? browserEnv;
    this.cfg = opts.cfg ?? CONFIG;
    this.tickMs = opts.tickMs ?? this.cfg.rush.tickMs;
    this.maxCatchUp = opts.maxCatchUp ?? MAX_CATCH_UP;
    this.onError = opts.onError ?? reportError;
    this.view = { state: initial, opening: initial.rush, hidden: false, held: false };
    this.shell = shellOf(this.view);
    if (initial.rush !== null) this.pushedTick = initial.rush.tick - 1;
  }

  // --- external store (useSyncExternalStore) ---
  getView = (): RunView => this.view;
  /** The view as Game sees it: the same object across rush ticks. */
  getShell = (): ShellView => this.shell;
  /** The live rush (a new object every tick), or null outside the rush. */
  getRush = (): RushState | null => this.view.state.rush;
  subscribeView = (cb: () => void): (() => void) => {
    this.viewListeners.add(cb);
    return () => { this.viewListeners.delete(cb); };
  };
  private setView(patch: Partial<RunView>): void {
    this.view = { ...this.view, ...patch };
    if (!sameShell(this.shell, this.view)) this.shell = shellOf(this.view);
    this.viewListeners.forEach(l => l());
  }

  /**
   * The scene subscribes for each tick's events; returns the unsubscribe. A subscriber joining while a rush is on
   * (a canvas mounting mid-rush) is reset to the rush as it stands.
   */
  subscribe = (sub: RushSubscriber): (() => void) => {
    this.subscribers.add(sub);
    const rush = this.view.state.rush;
    if (rush !== null) sub.reset?.(rush);
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
    this.ensureLoop();
  };

  /**
   * Opens the shop with the clock held, so no tick runs while the morning screen is still leaving: the rush screen
   * releases it once it is on screen (every day; the day-1 practice cup keeps it held until it is done). A refused
   * open leaves the hold as it was.
   */
  openHeld = (): void => {
    const was = this.view.held;
    this.setHold(true);
    this.dispatch({ type: 'open' });
    if (this.view.state.rush === null) this.setHold(was);
  };

  /** Holds or releases the rush clock. */
  setHold = (held: boolean): void => {
    if (held === this.view.held) return;
    this.last = null;
    this.setView({ held });
    this.ensureLoop();
  };

  /**
   * The sim time to draw, in ticks: the tick of the last push plus the share of the next tick elapsed. After the
   * rush is done it runs on for one more tick, so the scene plays the last tick's events and `rushEnd`.
   */
  simTime = (): number => Math.max(0, this.pushedTick + Math.min(1, this.acc / this.tickMs));

  private apply(intent: Intent): void {
    const prev = this.view.state;
    const prevTick = prev.rush?.tick ?? 0;
    const { state, events } = transition(prev, intent, this.cfg, this.onError);
    if (state === prev) return;
    afterTransition(this.store, this.opts.persist, prev, state, this.cfg);
    const opened = prev.rush === null && state.rush !== null;
    if (opened) this.pushedTick = -1;
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
      this.pushedTick = tick;
      // A batch that ends the rush at once (close early, end rush mid-way) starts the outro tick from now.
      if (intent.type !== 'tick') {
        this.acc = 0;
        this.last = null;
      }
      this.subscribers.forEach(s => s.push(events, tick));
    }
  }

  /** The clock is needed: a rush is ticking, or its outro tick is still playing, and nothing pauses it. */
  private live(): boolean {
    const { state, held, hidden } = this.view;
    if (this.offVisibility === null || state.rush === null || held || hidden) return false;
    return !state.rush.done || this.acc < this.tickMs;
  }

  /** Requests a frame when the clock is needed and none is pending; the loop stops by itself otherwise. */
  private ensureLoop(): void {
    if (this.frameId === null && this.live()) this.frameId = this.env.requestFrame(this.frame);
  }

  /** One animation frame at time `now` (ms); public for tests. */
  frame = (now: number): void => {
    this.frameId = null;
    if (!this.live()) {
      this.last = null;
      return;
    }
    const dt = this.last === null ? 0 : now - this.last;
    this.last = now;
    if (this.view.state.rush?.done) {
      // The outro tick: time runs on for the scene, nothing steps.
      this.acc = Math.min(this.tickMs, this.acc + (Number.isFinite(dt) ? Math.max(0, dt) : 0));
    } else {
      const { ticks, acc } = accumulate(this.acc, dt, this.tickMs, this.maxCatchUp);
      this.acc = acc;
      for (let n = 0; n < ticks && this.view.state.rush?.done === false; n++) {
        const actions = this.queue;
        this.queue = [];
        this.apply({ type: 'tick', actions });
      }
    }
    this.ensureLoop();
  };

  private onVisibility = (): void => {
    const hidden = this.env.hidden();
    this.last = null;
    if (hidden !== this.view.hidden) this.setView({ hidden });
    this.ensureLoop();
  };

  /**
   * Starts the visibility watch (and the frame loop while a rush is on); safe to call twice. Saves the starting
   * state once, so a reload on the first morning of a random-seed run comes back to the same run.
   */
  start(): void {
    if (this.offVisibility !== null) return;
    this.offVisibility = this.env.onVisibility(this.onVisibility);
    const { key, sessionCode } = this.opts.persist;
    if (key !== null) save(this.store, key, this.view.state, { sessionCode });
    this.onVisibility();
    this.ensureLoop();
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

/**
 * The run for a screen. `held` is the UI's own switch: it survives `open` and `newRun`, so a screen that holds the
 * clock (`openHeld`, the day-1 trial cup) must release it with `setHold(false)`, or the rush never ticks.
 */
export interface RunHandle extends ShellView, RushSource {
  dispatch(intent: Intent): void;
  act(action: Action): void;
  subscribe(sub: RushSubscriber): () => void;
  simTime(): number;
  setHold(held: boolean): void;
  openHeld(): void;
}

/** The run, driven in real time. One per game screen; the options are read on mount. */
export function useRun(opts: UseRunOptions): RunHandle {
  const [ctl] = useState(() => new RunController(opts.initial(), opts));
  useEffect(() => {
    ctl.start();
    return () => ctl.stop();
  }, [ctl]);
  const shell = useSyncExternalStore(ctl.subscribeView, ctl.getShell);
  return { ...shell, dispatch: ctl.dispatch, act: ctl.act, subscribe: ctl.subscribe, simTime: ctl.simTime,
    setHold: ctl.setHold, openHeld: ctl.openHeld, subscribeView: ctl.subscribeView, getRush: ctl.getRush };
}

/** The live rush, re-rendering on every tick (the rush screen only); null outside the rush. */
export function useRush(source: RushSource): RushState | null {
  return useSyncExternalStore(source.subscribeView, source.getRush);
}
