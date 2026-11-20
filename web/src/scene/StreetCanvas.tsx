// The street scene as a React component (spec §6 "Hai lớp giao diện", §9): fills its parent, picks the portrait or
// landscape layout from the parent's shape, and shows the rush.
//
// `live`: the parent gives the rush state the street opens with (`snapshot`) and pushes each tick's events as the sim
// emits them (`ref.push(events, tick)`); the picture interpolates between ticks, from `simTime` when the parent has a
// finer clock, else from when each push came. A new `snapshot` (or `ref.reset`) rebuilds the street, e.g. on return
// to a hidden tab. `ambient`: the street with no rush running, on the wall clock, with made-up walkers strolling,
// glancing at the boards and buying now and then (ambient.ts), at a lower frame rate; the walkers now and then say a short flavour line (bubbles.ts `AmbientVoice`: weather,
// cravings, school, nothing about the shops), never the sim's words; its
// street is `snapshot` (the day's shops at rest) or, without one, the first morning of a run from `seed`.
// If the canvas cannot start, or drawing keeps failing, `fallback` shows instead (spec §13); by default, live, the
// list of shops (StreetList.tsx: name, price, status, queue), and nothing behind an ambient screen.
import {
  useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref,
} from 'react';
import type { RushState, SimEvent } from '../../../shared/sim/types';
import { AmbientClock, AmbientDriver, ambientStreet } from './ambient';
import { AMBIENT_DIRECTORS, AMBIENT_MUTED } from './bubbles';
import { Director } from './director';
import { fitLayout } from './layout';
import type { TimeOfDay } from './lighting';
import { Scene } from './Scene';
import { StreetList } from './StreetList';

export interface StreetCanvasHandle {
  /**
   * One tick's events, in order; `tick` is the tick they belong to (the sim's `t`). Without `simTime`, pushes are the
   * street's clock: push every tick, an empty one too (`push([], t)`), or the picture holds one tick past the last.
   */
  push(events: readonly SimEvent[], tick: number): void;
  /** Rebuilds the street from a rush state. */
  reset(snapshot: RushState): void;
}

export interface StreetCanvasProps {
  /** The rush state the street opens with; a new one rebuilds the street. */
  snapshot: RushState | null;
  mode: 'live' | 'ambient';
  /**
   * The sim time to show, in ticks (fractional between ticks). Default: the last pushed tick plus the real time since
   * that push, up to one tick, so the street advances only as ticks are pushed (empty ones included).
   */
  simTime?: () => number;
  /** Real time per tick for that estimate (100 ms; less when played faster). */
  tickMs?: number;
  /** Forces reduced motion; default: prefers-reduced-motion. */
  reducedMotion?: boolean;
  /** The light of the hour (default noon, the rush); Phase 3's morning and evening use the others. */
  timeOfDay?: TimeOfDay;
  onFps?: (fps: number) => void;
  /** Shown when the canvas cannot start or drawing keeps failing; default: the list of shops (StreetList). */
  fallback?: ReactNode;
  /**
   * The run's seed: the speech lines are picked from its `scene/{day}` stream, and the ambient walkers (and the
   * ambient street when there is no `snapshot`) come from it. Default 1.
   */
  seed?: number;
  /** Ambient chatter on (default) or off: off while a screen covers the street (cards, report, end). */
  chatter?: boolean;
  className?: string;
  ref?: Ref<StreetCanvasHandle>;
}

const TICK_MS = 100;
/** The ambient street is played this many ticks ahead when it starts, so it opens with people about. */
const AMBIENT_WARM = 220;
/** The ambient street draws at most this many frames a second (it is a background; the CPU has better things to do). */
const AMBIENT_FPS = 30;

export function StreetCanvas({ snapshot, mode, simTime, tickMs = TICK_MS, reducedMotion, timeOfDay, onFps, fallback,
  seed = 1, chatter = true, className, ref }: StreetCanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const director = useRef<Director | null>(null);
  const scene = useRef<Scene | null>(null);
  /** The last push: its tick and when it came. */
  const clock = useRef({ tick: 0, wall: 0 });
  /** The ambient walkers and their clock (hidden time does not count). */
  const ambient = useRef<{ driver: AmbientDriver; clock: AmbientClock } | null>(null);
  const latest = useRef({ mode, simTime, tickMs, onFps, seed, timeOfDay });
  useLayoutEffect(() => { latest.current = { mode, simTime, tickMs, onFps, seed, timeOfDay }; });
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    push(events, tick) {
      director.current?.apply(events);
      clock.current = { tick, wall: performance.now() };
      ambient.current?.driver.refreshShops();
    },
    reset(s) {
      director.current?.reset(s);
      scene.current?.clearStore();
      clock.current = { tick: s.tick, wall: performance.now() };
    },
  }), []);

  useEffect(() => {
    const el = canvas.current;
    const parent = box.current;
    if (el === null || parent === null) return;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    const fit = fitLayout(w, h);
    const d = new Director(fit.layout, fit.view);
    director.current = d;
    const time = () => {
      const l = latest.current;
      const amb = ambient.current;
      if (l.mode === 'ambient') return amb === null ? d.now : amb.clock.read(performance.now());
      if (l.simTime !== undefined) return l.simTime();
      const c = clock.current;
      return c.tick + Math.min(1, Math.max(0, (performance.now() - c.wall) / l.tickMs));
    };
    let sc: Scene;
    try {
      sc = new Scene(el, d, {
        time,
        onFps: f => latest.current.onFps?.(f),
        onFail: e => {
          console.error('street scene stopped:', e);
          setFailed(true);
        },
        seed: latest.current.seed,
        speech: true,
        maxFps: latest.current.mode === 'ambient' ? AMBIENT_FPS : 0,
        beforeFrame: t => { if (latest.current.mode === 'ambient') ambient.current?.driver.step(t); },
      });
    } catch {
      setFailed(true);
      return;
    }
    scene.current = sc;
    sc.resize(w, h);
    const ro = new ResizeObserver(() => sc.resize(parent.clientWidth, parent.clientHeight));
    ro.observe(parent);
    sc.start();
    return () => {
      ro.disconnect();
      sc.destroy();
      director.current = null;
      scene.current = null;
      ambient.current = null;
    };
  }, []);

  // A new rush state, or the other mode: live streets rebuild from the snapshot; ambient ones also start their walkers
  // (on the snapshot's street, or the seed's own when there is none), played a little ahead so the street is busy.
  useEffect(() => {
    const d = director.current;
    if (d === null) return;
    const sc = scene.current;
    sc?.setSpeech(true);
    if (mode === 'ambient') AMBIENT_DIRECTORS.add(d);
    else AMBIENT_DIRECTORS.delete(d);
    sc?.setMaxFps(mode === 'ambient' ? AMBIENT_FPS : undefined);
    if (mode === 'live') {
      ambient.current = null;
      if (snapshot === null) return;
      d.reset(snapshot);
      sc?.clearStore();
      clock.current = { tick: snapshot.tick, wall: performance.now() };
      return;
    }
    const street = snapshot ?? ambientStreet(latest.current.seed);
    if (street === null) return;
    d.reset(street);
    sc?.clearStore();
    const driver = new AmbientDriver(d, {
      seed: latest.current.seed, day: d.day, timeOfDay: latest.current.timeOfDay ?? 'noon',
      calm: sc?.reducedMotion ?? false,
    });
    driver.warm(AMBIENT_WARM);
    ambient.current = { driver, clock: new AmbientClock(d.now, performance.now()) };
  }, [snapshot, mode, seed]);

  useEffect(() => {
    scene.current?.setReducedMotion(reducedMotion);
    ambient.current?.driver.setPace(latest.current.timeOfDay ?? 'noon', scene.current?.reducedMotion ?? false);
  }, [reducedMotion]);
  useEffect(() => {
    scene.current?.setTimeOfDay(timeOfDay ?? 'noon');
    ambient.current?.driver.setPace(timeOfDay ?? 'noon', scene.current?.reducedMotion ?? false);
  }, [timeOfDay]);
  useEffect(() => { scene.current?.setSeed(seed); }, [seed]);
  useEffect(() => {
    const d = director.current;
    if (d === null) return;
    if (chatter) AMBIENT_MUTED.delete(d);
    else AMBIENT_MUTED.add(d);
  }, [chatter]);

  return (
    <div ref={box} className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {failed ? fallback ?? (mode === 'live' ? <StreetList director={director} /> : null) : (
        <canvas ref={canvas} data-scene="" role="img" aria-label="Phố trà sữa"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      )}
    </div>
  );
}
