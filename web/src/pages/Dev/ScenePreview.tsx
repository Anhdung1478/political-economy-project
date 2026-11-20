// /dev/scene (dev builds only): replays a bot-played lunch rush on the street, in real time. Pick the day, the seed,
// the play style and the speed; play, pause, restart; the frame rate shows. The URL carries the settings so a link (or
// scripts/shoot.ts) opens the same street:
//   /dev/scene?day=3&seed=7&strategy=reasonable&speed=1&autoplay=1&t=300&hud=1&reduced=0
// `t` starts at that tick (the street rebuilt from the state there), `hud=0` hides the controls, `reduced=1|0` forces
// reduced motion on or off, `tod=morning|noon|afternoon|evening` sets the light. `sheet=shops` shows the shop sheet
// instead (every shop in every state, ShopSheet.tsx). `figcache=0` draws the customers live (no frame cache), to
// measure the cache. `mode=ambient` shows the ambient street instead of the rush (the walkers of the title, morning
// and evening screens; with `street=0`, the street of no run, as on the projector). `fail=1` makes drawing throw, to
// see the list fallback (StreetList). `bench=1` times each renderer (`window.__benchTake()`). `sheet=projector` shows the host's projector with the market open (the
// ambient street behind the class counts).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Day } from '../../../../shared/sim/types';
import { setFigureCache } from '../../scene/draw/characters';
import { figureStats } from '../../scene/draw/figures';
import { getRenderers, registerRenderers, type OverlayLayer, type RenderContext } from '../../scene/Scene';
import { TIMES_OF_DAY, type TimeOfDay } from '../../scene/lighting';
import { StreetCanvas, type StreetCanvasHandle } from '../../scene/StreetCanvas';
import { replayOf, stateAt, strategyIds, type Replay } from './replay';
import { ProjectorView } from '../Host/ProjectorView';
import '../Host/host.css';
import ShopSheet from './ShopSheet';
import './scenePreview.css';

const SPEEDS = [0.5, 1, 2, 4];
const DAYS: Day[] = [1, 2, 3, 4, 5];
const THEMES = ['khai trương', 'quán mới', 'giá trần', 'thuế', 'tin đồn'];
/** The rush ends at 900; the street plays on a little so the last walkers leave. */
const END = 900;
const TAIL = 60;

interface Params {
  day: Day; seed: number; strategy: string; speed: number; autoplay: boolean; t: number; hud: boolean;
  reduced: boolean | undefined;
  tod: TimeOfDay;
}

function readParams(): Params {
  const q = new URLSearchParams(location.search);
  const int = (k: string, fallback: number, lo: number, hi: number) => {
    const v = Number(q.get(k));
    return q.has(k) && Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  };
  const speed = Number(q.get('speed'));
  const strategy = q.get('strategy') ?? 'reasonable';
  const reduced = q.get('reduced');
  return {
    day: int('day', 1, 1, 5) as Day,
    seed: int('seed', 1, 0, 2 ** 31 - 1),
    strategy: strategyIds().includes(strategy) ? strategy : 'reasonable',
    speed: speed >= 0.5 && speed <= 4 ? speed : 1,
    autoplay: q.get('autoplay') !== '0',
    t: int('t', 0, 0, END),
    hud: q.get('hud') !== '0',
    reduced: reduced === null ? undefined : reduced === '1',
    tod: (TIMES_OF_DAY as readonly string[]).includes(q.get('tod') ?? '') ? q.get('tod') as TimeOfDay : 'noon',
  };
}

export default function ScenePreview() {
  // `figcache=0`: customers drawn live, for an A/B bench of the frame cache (draw/figures.ts).
  const q = new URLSearchParams(location.search);
  setFigureCache(q.get('figcache') !== '0');
  if (q.get('bench') === '1') benchRenderers();
  // For an A/B bench that flips the cache within one page (same machine load, same moment of the rush).
  (window as { __setFigureCache?: (on: boolean) => void }).__setFigureCache = setFigureCache;
  // `fail=1`: every frame throws, so the scene gives up and shows its list (dev only, this page only).
  if (q.get('fail') === '1') registerRenderers({ drawStreet: () => { throw new Error('dev: drawing fails on purpose'); } });
  if (q.get('sheet') === 'shops') return <ShopSheet />;
  if (q.get('sheet') === 'projector') {
    return <ProjectorView state={{ phase: 'open', code: 'PHO7', seed: readParams().seed, awards: null,
      counts: { joined: 32, playing: 21, finished: 9, lostTrust: 2 } }} />;
  }
  return q.get('mode') === 'ambient' ? <AmbientPreview /> : <StreetPreview />;
}

/**
 * `bench=1`: times each renderer (JS time per frame, ms) into `window.__bench` (totals and frames since the last
 * read of `__benchTake()`), for the performance notes.
 */
function benchRenderers() {
  const w = window as { __benchDone?: boolean; __bench?: Record<string, number>; __benchTake?: () => Record<string, number> };
  if (w.__benchDone) return;
  w.__benchDone = true;
  const acc: Record<string, number> = { frames: 0 };
  const time = <A extends unknown[], R>(name: string, f: (...a: A) => R) => (...a: A): R => {
    const t0 = performance.now();
    try { return f(...a); } finally { acc[name] = (acc[name] ?? 0) + performance.now() - t0; }
  };
  const r = getRenderers();
  const overlays: Partial<Record<OverlayLayer, (rc: RenderContext) => void>> = {};
  for (const [k, f] of Object.entries(r.overlays)) if (f) overlays[k as OverlayLayer] = time(k, f);
  registerRenderers({
    drawStreet: time('street', (rc: RenderContext) => { acc.frames++; r.drawStreet(rc); }),
    drawShop: time('shops', r.drawShop), drawCustomer: time('customers', r.drawCustomer), props: time('props', r.props),
    drawProp: time('propsDraw', r.drawProp), overlays,
  });
  w.__benchTake = () => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(acc)) if (k !== 'frames') out[k] = Math.round((v / Math.max(1, acc.frames)) * 100) / 100;
    out.frames = acc.frames;
    out.paintedPerFrame = Math.round((figureStats.painted / Math.max(1, acc.frames)) * 100) / 100;
    out.paintMsPerFrame = Math.round((figureStats.paintMs / Math.max(1, acc.frames)) * 100) / 100;
    figureStats.painted = 0;
    figureStats.paintMs = 0;
    for (const k of Object.keys(acc)) acc[k] = 0;
    return out;
  };
}

/** The ambient street: the day's shops at rest (or no run's, `street=0`) with the made-up walkers. */
function AmbientPreview() {
  const p = useMemo(readParams, []);
  const snapshot = useMemo(() => {
    if (new URLSearchParams(location.search).get('street') === '0') return null;
    const r = replayOf(p.seed, p.day, p.strategy).rush;
    return { ...r, customers: [], rt: [], arrivalOrder: [], nextArrival: 0, nextEnter: 0,
      shops: r.shops.map(s => ({ ...s, queue: [] })) };
  }, [p]);
  const [fps, setFps] = useState(0);
  return (
    <div className="scene-dev">
      <StreetCanvas snapshot={snapshot} mode="ambient" seed={p.seed} timeOfDay={p.tod} reducedMotion={p.reduced}
        onFps={setFps} />
      {p.hud && (
        <div className="scene-dev__hud">
          <div className="scene-dev__bar">
            <span className="scene-dev__status">Phố nền · N{p.day} · {p.tod} · {fps} fps</span>
          </div>
        </div>
      )}
    </div>
  );
}

function StreetPreview() {
  const initial = useMemo(readParams, []);
  const [day, setDay] = useState<Day>(initial.day);
  const [seed, setSeed] = useState(initial.seed);
  const [strategy, setStrategy] = useState(initial.strategy);
  const [speed, setSpeed] = useState(initial.speed);
  const [playing, setPlaying] = useState(initial.autoplay);
  const [from, setFrom] = useState(initial.t);
  const [nonce, setNonce] = useState(0);
  const [panel, setPanel] = useState(false);
  const [fps, setFps] = useState(0);
  const [shownTick, setShownTick] = useState(initial.t);

  const replay = useMemo<Replay | Error>(() => {
    try {
      return replayOf(seed, day, strategy);
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }, [seed, day, strategy]);
  // A fresh object on every restart, so the street rebuilds even at the same tick.
  const snapshot = useMemo(
    () => (replay instanceof Error ? null : from > 0 ? stateAt(replay, from) : { ...replay.rush }),
    [replay, from, nonce]);

  const handle = useRef<StreetCanvasHandle>(null);
  /** Sim time shown (ticks) and the next frame to push. */
  const clock = useRef({ t: 0, next: 0 });
  const ctl = useRef({ playing, speed });
  useEffect(() => { ctl.current = { playing, speed }; }, [playing, speed]);

  useEffect(() => {
    if (snapshot === null || replay instanceof Error) return;
    const next = replay.frames.findIndex(f => f.t >= snapshot.tick);
    clock.current = { t: snapshot.tick, next: next < 0 ? replay.frames.length : next };
  }, [snapshot, replay]);

  // The player: sim time follows the wall clock at the chosen speed; each tick's events go to the street as their
  // tick comes. A long gap (a hidden tab) does not jump the rush ahead.
  useEffect(() => {
    if (replay instanceof Error) return;
    const frames = replay.frames;
    let raf = 0;
    let last = performance.now();
    let hud = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(100, now - last);
      last = now;
      const c = clock.current;
      if (ctl.current.playing && c.t < END + TAIL) {
        c.t = Math.min(END + TAIL, c.t + (dt / 100) * ctl.current.speed);
        while (c.next < frames.length && frames[c.next].t <= c.t) {
          const f = frames[c.next++];
          handle.current?.push(f.events, f.t);
        }
      }
      if (now - hud > 200) {
        hud = now;
        setShownTick(c.t);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [replay]);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    q.set('day', String(day));
    q.set('seed', String(seed));
    q.set('strategy', strategy);
    q.set('speed', String(speed));
    history.replaceState(null, '', `${location.pathname}?${q}`);
  }, [day, seed, strategy, speed]);

  const restart = () => {
    setFrom(0);
    setNonce(n => n + 1);
    setPlaying(true);
  };

  return (
    <div className="scene-dev">
      <StreetCanvas ref={handle} snapshot={snapshot} mode="live" simTime={() => clock.current.t} seed={seed}
        reducedMotion={initial.reduced} timeOfDay={initial.tod} onFps={setFps} />
      {initial.hud && (
        <div className="scene-dev__hud">
          <div className="scene-dev__bar">
            <button type="button" onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Dừng' : 'Chạy'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button type="button" onClick={restart} aria-label="Chạy lại">↺</button>
            <span className="scene-dev__status">
              N{day} {THEMES[day - 1]} · {(Math.min(END, shownTick) / 10).toFixed(1)}s · {fps} fps
            </span>
            <button type="button" onClick={() => setPanel(p => !p)} aria-expanded={panel} aria-label="Tuỳ chọn">⚙</button>
          </div>
          {panel && (
            <div className="scene-dev__panel">
              <label>Ngày
                <select value={day} onChange={e => { setDay(Number(e.target.value) as Day); setFrom(0); }}>
                  {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label>Seed
                <input type="number" min={0} value={seed}
                  onChange={e => { setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0))); setFrom(0); }} />
              </label>
              <label>Lối chơi
                <select value={strategy} onChange={e => { setStrategy(e.target.value); setFrom(0); }}>
                  {strategyIds().map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>Tốc độ
                <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
                  {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
                </select>
              </label>
            </div>
          )}
        </div>
      )}
      {replay instanceof Error && <div className="scene-dev__error">{replay.message}</div>}
    </div>
  );
}
