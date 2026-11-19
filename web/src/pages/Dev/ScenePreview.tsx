// /dev/scene (dev builds only): replays a bot-played lunch rush on the street, in real time. Pick the day, the seed,
// the play style and the speed; play, pause, restart; the frame rate shows. The URL carries the settings so a link (or
// scripts/shoot.ts) opens the same street:
//   /dev/scene?day=3&seed=7&strategy=reasonable&speed=1&autoplay=1&t=300&hud=1&reduced=0
// `t` starts at that tick (the street rebuilt from the state there), `hud=0` hides the controls, `reduced=1|0` forces
// reduced motion on or off.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Day } from '../../../../shared/sim/types';
import { StreetCanvas, type StreetCanvasHandle } from '../../scene/StreetCanvas';
import { replayOf, stateAt, strategyIds, type Replay } from './replay';
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
  };
}

export default function ScenePreview() {
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
      <StreetCanvas ref={handle} snapshot={snapshot} mode="live" simTime={() => clock.current.t}
        reducedMotion={initial.reduced} onFps={setFps} />
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
