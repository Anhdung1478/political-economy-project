import { describe, expect, it } from 'vitest';
import type { RushState, SimEvent } from '../../../shared/sim/types';
import { KEYS, load, reduce, save, startRun } from './runStore';
import { memoryStore } from './storage';
import { accumulate, resumeOrStart, RunController, type ClockEnv } from './useRun';

describe('accumulate', () => {
  it('turns real time into whole 100 ms ticks and keeps the remainder', () => {
    expect(accumulate(0, 16)).toEqual({ ticks: 0, acc: 16 });
    expect(accumulate(90, 16)).toEqual({ ticks: 1, acc: 6 });
    expect(accumulate(50, 250)).toEqual({ ticks: 3, acc: 0 });
  });

  it('caps the catch-up so a stalled tab never fast-forwards, keeping the phase', () => {
    expect(accumulate(0, 10_000)).toEqual({ ticks: 3, acc: 0 });
    expect(accumulate(0, 10_050)).toEqual({ ticks: 3, acc: 50 });
    expect(accumulate(0, 500, 100, 5)).toEqual({ ticks: 5, acc: 0 });
  });

  it('ignores negative or broken time', () => {
    expect(accumulate(40, -100)).toEqual({ ticks: 0, acc: 40 });
    expect(accumulate(40, Number.NaN)).toEqual({ ticks: 0, acc: 40 });
  });
});

/** A clock we drive by hand. */
function fakeEnv() {
  let cb: ((now: number) => void) | null = null;
  let hidden = false;
  let vis: (() => void) | null = null;
  const env: ClockEnv = {
    requestFrame: f => { cb = f; return 1; },
    cancelFrame: () => { cb = null; },
    hidden: () => hidden,
    onVisibility: f => { vis = f; return () => { vis = null; }; },
  };
  return {
    env,
    frame: (now: number) => { const f = cb; cb = null; f?.(now); },
    pending: () => cb !== null,
    setHidden: (h: boolean) => { hidden = h; vis?.(); },
  };
}

function setup(onError?: (e: unknown, ctx: string) => void) {
  const clock = fakeEnv();
  const store = memoryStore();
  const ctl = new RunController(startRun(3, 'r3'),
    { persist: { key: KEYS.solo, bestKey: KEYS.best }, store, env: clock.env, onError });
  const pushes: { events: readonly SimEvent[]; tick: number }[] = [];
  const resets: RushState[] = [];
  ctl.subscribe({ push: (events, tick) => pushes.push({ events, tick }), reset: s => resets.push(s) });
  ctl.start();
  return { clock, store, ctl, pushes, resets };
}

describe('RunController', () => {
  it('does not tick outside the rush', () => {
    const { clock, ctl, pushes } = setup();
    clock.frame(0);
    clock.frame(1000);
    expect(pushes).toHaveLength(0);
    expect(ctl.getView().state.run.phase).toBe('morning');
  });

  it('opens the shop: the scene resets to the opening rush, which the view keeps, and the morning is saved', () => {
    const { ctl, resets, store } = setup();
    ctl.dispatch({ type: 'open' });
    const v = ctl.getView();
    expect(v.state.run.phase).toBe('rush');
    expect(v.opening).toBe(v.state.rush);
    expect(resets).toEqual([v.state.rush]);
    expect(load(store, KEYS.solo)?.run.phase).toBe('morning');
  });

  it('ticks every 100 ms of real time, pushing each tick to the scene, with queued actions on the next tick', () => {
    const { clock, ctl, pushes } = setup();
    ctl.dispatch({ type: 'open' });
    const opening = ctl.getView().opening;
    clock.frame(1000); // first frame: no time counted yet
    expect(pushes).toHaveLength(0);
    ctl.act({ type: 'craft', input: { k: 'size', size: 'M' } });
    clock.frame(1150);
    expect(ctl.getView().state.rush?.tick).toBe(1);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].tick).toBe(0);
    expect(pushes[0].events.some(e => e.type === 'craftStep')).toBe(true);
    expect(ctl.simTime()).toBeCloseTo(0.5);
    clock.frame(1200);
    expect(pushes.map(p => p.tick)).toEqual([0, 1]);
    // The opening snapshot stays the same object while the rush runs.
    expect(ctl.getView().opening).toBe(opening);
  });

  it('runs at most a few ticks per frame after a long stall', () => {
    const { clock, ctl } = setup();
    ctl.dispatch({ type: 'open' });
    clock.frame(0);
    clock.frame(60_000);
    expect(ctl.getView().state.rush?.tick).toBe(3);
  });

  it('stops the clock while the tab is hidden and resumes without catching up', () => {
    const { clock, ctl } = setup();
    ctl.dispatch({ type: 'open' });
    clock.frame(0);
    clock.frame(100);
    expect(ctl.getView().state.rush?.tick).toBe(1);
    clock.setHidden(true);
    expect(ctl.getView().hidden).toBe(true);
    clock.frame(5000);
    expect(ctl.getView().state.rush?.tick).toBe(1);
    clock.setHidden(false);
    clock.frame(30_000);
    clock.frame(30_100);
    expect(ctl.getView().state.rush?.tick).toBe(2);
  });

  it('holds the clock on request', () => {
    const { clock, ctl } = setup();
    ctl.dispatch({ type: 'open' });
    ctl.setHold(true);
    clock.frame(0);
    clock.frame(500);
    expect(ctl.getView().state.rush?.tick).toBe(0);
    ctl.setHold(false);
    clock.frame(600);
    clock.frame(700);
    expect(ctl.getView().state.rush?.tick).toBe(1);
  });

  it('closes early with the queued actions, pushes the rest of the street, and stops ticking', () => {
    const { clock, ctl, pushes } = setup();
    ctl.dispatch({ type: 'open' });
    ctl.act({ type: 'craft', input: { k: 'size', size: 'S' } });
    ctl.dispatch({ type: 'closeEarly' });
    const last = pushes.at(-1)!;
    expect(last.events.some(e => e.type === 'craftStep')).toBe(true);
    expect(last.events.at(-1)).toMatchObject({ type: 'rushEnd', early: true });
    expect(last.tick).toBe(900);
    const n = pushes.length;
    clock.frame(0);
    clock.frame(1000);
    expect(pushes).toHaveLength(n);
    ctl.dispatch({ type: 'endRush' });
    expect(ctl.getView().state.run.phase).toBe('cards');
    expect(ctl.getView().opening).toBeNull();
  });

  it('notifies the view listeners on each change and ignores refused intents', () => {
    const { ctl } = setup();
    let n = 0;
    ctl.subscribeView(() => { n++; });
    const v = ctl.getView();
    ctl.dispatch({ type: 'nextDay' });
    expect(ctl.getView()).toBe(v);
    expect(n).toBe(0);
    ctl.dispatch({ type: 'setPlanPrice', price: 34 });
    expect(n).toBe(1);
    expect(ctl.getView().state.planDraft.price).toBe(34);
  });

  it('stops its frame loop', () => {
    const { clock, ctl } = setup();
    ctl.dispatch({ type: 'open' });
    clock.frame(0);
    ctl.stop();
    clock.frame(1000);
    expect(ctl.getView().state.rush?.tick).toBe(0);
  });
});

describe('RunController, fix round 1', () => {
  it('saves the starting state on start, so a first-morning reload finds the same run', () => {
    const { store } = setup();
    expect(load(store, KEYS.solo)).toStrictEqual(startRun(3, 'r3'));
  });

  it('saves draft edits made in the morning', () => {
    const { ctl, store } = setup();
    ctl.dispatch({ type: 'setPlanPrice', price: 37 });
    expect(load(store, KEYS.solo)?.planDraft.price).toBe(37);
  });

  it('runs frames only while a rush is live: none in the morning, none once the outro tick has played', () => {
    const { clock, ctl } = setup();
    expect(clock.pending()).toBe(false);
    ctl.dispatch({ type: 'open' });
    expect(clock.pending()).toBe(true);
  });

  it('natural end: the last push carries 900 and simTime runs on to 901 before the loop stops', () => {
    const { clock, ctl, pushes } = setup();
    ctl.dispatch({ type: 'open' });
    let now = 0;
    clock.frame(now);
    while (!ctl.getView().state.rush?.done) { now += 100; clock.frame(now); }
    expect(pushes.at(-1)?.tick).toBe(900);
    expect(pushes.at(-1)?.events.at(-1)).toMatchObject({ type: 'rushEnd', early: false });
    const t0 = ctl.simTime();
    expect(t0).toBeGreaterThanOrEqual(900);
    expect(clock.pending()).toBe(true);
    now += 50; clock.frame(now);
    expect(ctl.simTime()).toBeGreaterThan(t0);
    now += 200; clock.frame(now);
    expect(ctl.simTime()).toBe(901);
    expect(clock.pending()).toBe(false);
  });

  it('close early: simTime goes from 900 to 901 over the outro tick, then the loop stops', () => {
    const { clock, ctl } = setup();
    ctl.dispatch({ type: 'open' });
    clock.frame(0);
    clock.frame(250);
    expect(ctl.simTime()).toBeCloseTo(1.5);
    ctl.dispatch({ type: 'closeEarly' });
    expect(ctl.simTime()).toBe(900);
    clock.frame(1000);
    clock.frame(1040);
    expect(ctl.simTime()).toBeCloseTo(900.4);
    clock.frame(1200);
    expect(ctl.simTime()).toBe(901);
    expect(clock.pending()).toBe(false);
  });

  it('starts at 0 and never runs backwards across the first step', () => {
    const { clock, ctl } = setup();
    ctl.dispatch({ type: 'open' });
    clock.frame(0);
    clock.frame(60);
    expect(ctl.simTime()).toBe(0);
    clock.frame(130);
    expect(ctl.simTime()).toBeCloseTo(0.3);
  });

  it('resets a scene that subscribes mid-rush to the rush as it stands', () => {
    const { clock, ctl } = setup();
    let early = 0;
    ctl.subscribe({ push: () => {}, reset: () => { early++; } });
    expect(early).toBe(0); // no rush yet: nothing to reset to
    ctl.dispatch({ type: 'open' });
    clock.frame(0);
    clock.frame(300);
    const got: RushState[] = [];
    ctl.subscribe({ push: () => {}, reset: s => got.push(s) });
    expect(got).toEqual([ctl.getView().state.rush]);
    expect(got[0].tick).toBe(3);
  });

  it('reports a queued action that makes the step throw, and keeps the others', () => {
    const errors: string[] = [];
    const { clock, ctl, pushes } = setup((_e, ctx) => { errors.push(ctx); });
    ctl.dispatch({ type: 'open' });
    ctl.act({ type: 'craft' } as never);
    ctl.act({ type: 'craft', input: { k: 'size', size: 'M' } });
    clock.frame(0);
    clock.frame(100);
    expect(ctl.getView().state.rush?.tick).toBe(1);
    expect(pushes.at(-1)?.events.some(e => e.type === 'craftStep')).toBe(true);
    expect(errors.some(e => e.startsWith('action dropped'))).toBe(true);
  });
});

describe('resumeOrStart', () => {
  it('resumes the saved run, or starts the fallback', () => {
    const store = memoryStore();
    const fallback = () => startRun(1, 'a');
    expect(resumeOrStart(store, { key: KEYS.solo }, fallback)).toStrictEqual(fallback());
    const s = reduce(startRun(2, 'b'), { type: 'setPlanPrice', price: 40 });
    save(store, KEYS.solo, s);
    expect(resumeOrStart(store, { key: KEYS.solo }, fallback)).toStrictEqual(s);
    expect(resumeOrStart(store, { key: null }, fallback)).toStrictEqual(fallback());
  });
});

describe('RunController, final fix wave', () => {
  it('opens with the clock held: no tick until the rush screen releases it, then the rush starts at tick 0', () => {
    const { clock, ctl, pushes } = setup();
    ctl.openHeld();
    expect(ctl.getView().state.rush?.tick).toBe(0);
    expect(ctl.getView().held).toBe(true);
    expect(clock.pending()).toBe(false);
    // the morning screen leaving: real time passes, nothing ticks
    clock.frame(0);
    clock.frame(350);
    expect(ctl.getView().state.rush?.tick).toBe(0);
    const before = pushes.length;
    // the rush screen mounts and lets go
    ctl.setHold(false);
    expect(clock.pending()).toBe(true);
    clock.frame(400);
    expect(ctl.simTime()).toBe(0);
    clock.frame(450);
    expect(ctl.getView().state.rush?.tick).toBe(0);
    clock.frame(500);
    expect(ctl.getView().state.rush?.tick).toBe(1);
    expect(pushes.slice(before)).toHaveLength(1);
  });

  it('keeps the hold as it was when the open is refused', () => {
    const { ctl } = setup();
    ctl.dispatch({ type: 'setTeaMl', teaMl: 1e9 });
    ctl.openHeld();
    expect(ctl.getView().state.rush).toBeNull();
    expect(ctl.getView().held).toBe(false);
  });

  it('keeps the shell view the same object across rush ticks, and changes it with the run or the flags', () => {
    const { clock, ctl } = setup();
    const morning = ctl.getShell();
    ctl.dispatch({ type: 'setPlanPrice', price: 33 });
    expect(ctl.getShell()).not.toBe(morning);
    ctl.dispatch({ type: 'open' });
    const open = ctl.getShell();
    expect(open.rushOn).toBe(true);
    expect(open.run.phase).toBe('rush');
    clock.frame(0);
    clock.frame(100);
    clock.frame(200);
    expect(ctl.getRush()?.tick).toBe(2);
    expect(ctl.getShell()).toBe(open);
    ctl.setHold(true);
    expect(ctl.getShell()).not.toBe(open);
    expect(ctl.getShell().held).toBe(true);
    ctl.setHold(false);
    ctl.dispatch({ type: 'closeEarly' });
    ctl.dispatch({ type: 'endRush' });
    expect(ctl.getShell().rushOn).toBe(false);
    expect(ctl.getRush()).toBeNull();
  });
});
