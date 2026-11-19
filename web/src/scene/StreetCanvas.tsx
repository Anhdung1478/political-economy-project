// The street scene as a React component (spec §6 "Hai lớp giao diện", §9): fills its parent, picks the portrait or
// landscape layout from the parent's shape, and shows the rush.
//
// `live`: the parent gives the rush state the street opens with (`snapshot`) and pushes each tick's events as the sim
// emits them (`ref.push(events, tick)`); the picture interpolates between ticks, from `simTime` when the parent has a
// finer clock, else from when each push came. A new `snapshot` (or `ref.reset`) rebuilds the street, e.g. on return
// to a hidden tab. `ambient`: the street with no rush running, on the wall clock (Task 17 fills it with walkers).
// If the canvas cannot start, `fallback` shows instead (spec §13; Task 17's list of shops).
import {
  useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref,
} from 'react';
import type { RushState, SimEvent } from '../../../shared/sim/types';
import { Director } from './director';
import { fitLayout } from './layout';
import { Scene } from './Scene';

export interface StreetCanvasHandle {
  /** One tick's events, in order; `tick` is the tick they belong to (the sim's `t`). */
  push(events: readonly SimEvent[], tick: number): void;
  /** Rebuilds the street from a rush state. */
  reset(snapshot: RushState): void;
}

export interface StreetCanvasProps {
  /** The rush state the street opens with; a new one rebuilds the street. */
  snapshot: RushState | null;
  mode: 'live' | 'ambient';
  /** The sim time to show, in ticks (fractional between ticks); default: estimated from the pushes. */
  simTime?: () => number;
  /** Real time per tick for that estimate (100 ms; less when played faster). */
  tickMs?: number;
  /** Forces reduced motion; default: prefers-reduced-motion. */
  reducedMotion?: boolean;
  onFps?: (fps: number) => void;
  /** Shown when the canvas cannot start. */
  fallback?: ReactNode;
  className?: string;
  ref?: Ref<StreetCanvasHandle>;
}

const TICK_MS = 100;

export function StreetCanvas({ snapshot, mode, simTime, tickMs = TICK_MS, reducedMotion, onFps, fallback, className,
  ref }: StreetCanvasProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const director = useRef<Director | null>(null);
  const scene = useRef<Scene | null>(null);
  /** The last push: its tick and when it came. */
  const clock = useRef({ tick: 0, wall: 0 });
  const ambientStart = useRef(0);
  const latest = useRef({ mode, simTime, tickMs, onFps });
  useLayoutEffect(() => { latest.current = { mode, simTime, tickMs, onFps }; });
  const [failed, setFailed] = useState(false);

  useImperativeHandle(ref, () => ({
    push(events, tick) {
      director.current?.apply(events);
      clock.current = { tick, wall: performance.now() };
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
    ambientStart.current = performance.now();
    const time = () => {
      const l = latest.current;
      if (l.mode === 'ambient') return (performance.now() - ambientStart.current) / TICK_MS;
      if (l.simTime !== undefined) return l.simTime();
      const c = clock.current;
      return c.tick + Math.min(1, Math.max(0, (performance.now() - c.wall) / l.tickMs));
    };
    let sc: Scene;
    try {
      sc = new Scene(el, d, { time, onFps: f => latest.current.onFps?.(f) });
    } catch {
      setFailed(true);
      return;
    }
    director.current = d;
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
    };
  }, []);

  useEffect(() => {
    if (snapshot === null || director.current === null) return;
    director.current.reset(snapshot);
    scene.current?.clearStore();
    clock.current = { tick: snapshot.tick, wall: performance.now() };
  }, [snapshot]);

  useEffect(() => { scene.current?.setReducedMotion(reducedMotion); }, [reducedMotion]);

  return (
    <div ref={box} className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {failed ? fallback ?? null : (
        <canvas ref={canvas} data-scene="" role="img" aria-label="Phố trà sữa"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      )}
    </div>
  );
}
