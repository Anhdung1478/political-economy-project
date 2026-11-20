// /dev/characters (dev builds only): the street's customers on one page, for judging the art directly.
//   /dev/characters?mode=grid&zoom=1          many generated characters, each labelled with its archetype
//   /dev/characters?mode=anims&zoom=3         a row per animation, looping, in the headings it is seen in
//   /dev/characters?mode=strip&look=7&frames=6&step=100&t=400
//                                             a row per animation as a strip of frozen frames, `step` ms apart
// `zoom` 1 is the phone's size (38 px people), 2 and 3 enlarge; `t` freezes the clock at that many ms (for shots);
// `seed` picks other characters; `reduced=1` shows the reduced-motion versions; `bench=1` prints the mean time to draw
// the page's characters (the last 60 frames) in its corner.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ARCHETYPES, characterPose, drawCharacterAt, traitsOf, type EmoteState, type FigureFx, type Traits,
} from '../../scene/draw/characters';
import type { Mood } from '../../scene/draw/faces';
import { newSkeleton, pose, solve, WALKING, type Clip, type ClipInput, type View } from '../../scene/rig';
import './scenePreview.css';

/** The street's person height on a phone (layout PORTRAIT). */
const PHONE_H = 38;
const LABELS: Record<string, string> = {
  student: 'học sinh', office: 'văn phòng', shipper: 'shipper', elder: 'cụ', homemaker: 'nội trợ', kol: 'KOL',
};
const SHORT: Record<string, string> = {
  student: 'HS', office: 'VP', shipper: 'ship', elder: 'cụ', homemaker: 'nội trợ', kol: 'KOL',
};

interface Row {
  label: string;
  clip: Clip;
  mood: Mood;
  /** The headings shown, one character each. */
  views: { view: View; facing: 1 | -1 }[];
  cup?: boolean;
  phone?: boolean;
  /** Walking pace (walking speeds). */
  pace?: number;
  /** One-shot clips loop over this many seconds. */
  loopS?: number;
  /** Prefer characters of this archetype (selfie: KOL; cane: elders). */
  only?: Traits['archetype'];
  cane?: boolean;
  happy?: boolean;
}

const R: { view: View; facing: 1 | -1 } = { view: 'side', facing: 1 };
const L: { view: View; facing: 1 | -1 } = { view: 'side', facing: -1 };
const F: { view: View; facing: 1 | -1 } = { view: 'front', facing: 1 };
const B: { view: View; facing: 1 | -1 } = { view: 'back', facing: 1 };

const ROWS: Row[] = [
  { label: 'đi bộ (4 hướng)', clip: 'walk', mood: 'neutral', views: [R, L, F, B] },
  { label: 'đi vội', clip: 'walk', mood: 'neutral', views: [R, F], pace: 3 },
  { label: 'đứng thở', clip: 'idle', mood: 'neutral', views: [F, R, B] },
  { label: 'xem điện thoại', clip: 'phone', mood: 'focus', views: [F, R, B], phone: true },
  { label: 'đi xem điện thoại', clip: 'walkPhone', mood: 'focus', views: [R, F], phone: true },
  { label: 'selfie (KOL)', clip: 'selfie', mood: 'happy', views: [F, R], phone: true, only: 'kol' },
  { label: 'ngẩng nhìn bảng giá', clip: 'lookBoard', mood: 'curious', views: [B, F, R] },
  { label: 'nhích lên trong hàng', clip: 'shuffle', mood: 'neutral', views: [L, L] },
  { label: 'sốt ruột: gõ chân', clip: 'tap', mood: 'annoyed', views: [L, F, B] },
  { label: 'khoanh tay', clip: 'crossed', mood: 'annoyed', views: [L, F] },
  { label: 'hết kiên nhẫn', clip: 'crossed', mood: 'angry', views: [L, F] },
  { label: 'vui: nhảy, tim bay', clip: 'happy', mood: 'happy', views: [F, F], cup: true, loopS: 1.8, happy: true },
  { label: 'vừa đi vừa uống', clip: 'walkDrink', mood: 'happy', views: [R, F, B], cup: true },
  { label: 'nhận ly sai', clip: 'puzzled', mood: 'puzzled', views: [F, F], cup: true, loopS: 1.6 },
  { label: 'bực: dậm chân', clip: 'stomp', mood: 'angry', views: [F, F], loopS: 1.2 },
  { label: 'bỏ đi dậm chân', clip: 'walkAngry', mood: 'angry', views: [R, F] },
  { label: 'thất vọng', clip: 'shrug', mood: 'annoyed', views: [F, F], loopS: 1.8 },
  { label: 'sợ: xì xào chỉ trỏ', clip: 'whisper', mood: 'scared', views: [F, R] },
  { label: 'sợ: vội bỏ đi', clip: 'walkScared', mood: 'scared', views: [R, F] },
  { label: 'cụ chống gậy', clip: 'walkCane', mood: 'neutral', views: [R, F], only: 'elder', cane: true },
];

interface Params {
  mode: 'grid' | 'anims' | 'strip'; zoom: number; seed: number; n: number; t: number | null; frames: number;
  step: number; look: number | null; reduced: boolean; bench: boolean;
}

function readParams(): Params {
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
  const mode = q.get('mode');
  return {
    mode: mode === 'anims' || mode === 'strip' ? mode : 'grid',
    zoom: Math.min(4, Math.max(1, num('zoom', 1))),
    seed: Math.max(0, Math.floor(num('seed', 1))),
    n: Math.min(200, Math.max(1, Math.floor(num('n', 60)))),
    t: q.has('t') ? num('t', 0) : null,
    frames: Math.min(12, Math.max(1, Math.floor(num('frames', 6)))),
    step: Math.max(10, num('step', 100)),
    look: q.has('look') ? Math.floor(num('look', 0)) >>> 0 : null,
    reduced: q.get('reduced') === '1',
    bench: q.get('bench') === '1',
  };
}

/** A look for character i of a seed (the sim draws looks the same way: 32-bit unsigned). */
const lookOf = (seed: number, i: number) => {
  let h = Math.imul((seed * 7919) ^ (i * 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

/** Looks of the given archetype (or with a cane), searched from the seed. */
function looksFor(seed: number, n: number, ok: (t: Traits) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; out.length < n && i < 5000; i++) {
    const l = lookOf(seed + 101, i);
    if (ok(traitsOf(l))) out.push(l);
  }
  return out;
}

const sk = newSkeleton();
const target = pose();
const input: ClipInput = { t: 0, loop: 0, phase: 0, pace: 0, side: true, stoop: 0, calm: false };
const fx: FigureFx = { mood: 'neutral', blink: 0, cup: false, phone: false };
const emote: EmoteState = { clip: 'idle', mood: 'neutral', t: 0, loop: 0, sinceHappy: Infinity, calm: false };

/** Walking in place: 3 heights a second at walking pace, one cycle per 1.3 heights (as on the street). */
const WALK_HPS = 3;
const CYCLE_HEIGHTS = 1.3;

function drawOne(ctx: CanvasRenderingContext2D, tr: Traits, x: number, y: number, s: number, row: Row,
  view: View, facing: 1 | -1, ms: number, reduced: boolean): void {
  const sec = ms / 1000;
  const pace = row.pace ?? 1;
  input.t = row.loopS !== undefined ? sec % row.loopS : sec;
  input.loop = sec + tr.phaseOffset;
  input.pace = WALKING.has(row.clip) ? pace : 0;
  input.phase = ((sec * WALK_HPS * pace) / (CYCLE_HEIGHTS * Math.sqrt(pace))) * Math.PI * 2;
  input.side = view === 'side';
  input.stoop = tr.stoop;
  input.calm = reduced;
  characterPose(target, row.clip, input, tr);
  solve(target, tr.dims, view, sk);
  fx.mood = row.mood;
  fx.blink = 0;
  fx.cup = row.cup === true;
  fx.phone = row.phone === true;
  emote.clip = row.clip;
  emote.mood = row.mood;
  emote.t = input.t;
  emote.loop = input.loop;
  emote.sinceHappy = row.happy === true ? input.t : Infinity;
  emote.calm = reduced;
  drawCharacterAt(ctx, tr, x, y, s * tr.height, facing, view, target, sk, fx, emote);
}

const IDLE_ROW: Row = { label: '', clip: 'idle', mood: 'neutral', views: [F] };
const MOOD_CYCLE: Mood[] = ['neutral', 'happy', 'curious', 'focus', 'annoyed', 'angry', 'puzzled', 'scared'];

export default function CharacterSheet() {
  const initial = useMemo(readParams, []);
  const [zoom, setZoom] = useState(initial.zoom);
  const [mode, setMode] = useState(initial.mode);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    q.set('mode', mode);
    q.set('zoom', String(zoom));
    history.replaceState(null, '', `${location.pathname}?${q}`);
  }, [mode, zoom]);

  useEffect(() => {
    const c = canvas.current;
    const b = box.current;
    if (c === null || b === null) return;
    const ctx = c.getContext('2d');
    if (ctx === null) return;
    const s = PHONE_H * zoom;
    const { seed, n, frames, step, reduced } = initial;
    const width = Math.max(320, b.clientWidth);
    const font = (px: number, w = 600) => `${w} ${px}px "Be Vietnam Pro", system-ui, sans-serif`;
    const labelW = Math.max(110, 64 + zoom * 30);

    // Lay out: cells of the grid, or rows of animations.
    let height: number;
    let draw: (ms: number) => void;
    if (mode === 'grid') {
      const cw = s * 1.15;
      const ch = s * 1.55 + 14;
      const cols = Math.max(1, Math.floor((width - 16) / cw));
      const looks = Array.from({ length: n }, (_, i) => lookOf(seed, i));
      height = Math.ceil(n / cols) * ch + 20;
      draw = ms => {
        looks.forEach((l, i) => {
          const tr = traitsOf(l);
          const x = 8 + (i % cols) * cw + cw / 2;
          const y = 10 + Math.floor(i / cols) * ch + s * 1.32;
          // Faces shown in turn, so the sheet also shows every expression on many faces.
          const row = i % 3 === 0 ? IDLE_ROW : { ...IDLE_ROW, mood: MOOD_CYCLE[(i + Math.floor(ms / 2500)) % 8] };
          const view: View = i % 5 === 4 ? 'side' : 'front';
          drawOne(ctx, tr, x, y, s, row, view, i % 2 === 0 ? 1 : -1, ms + i * 137, reduced);
          if (initial.bench) return;   // time the characters only
          ctx.fillStyle = '#6e5b4d';
          ctx.font = font(zoom === 1 ? 8 : 7 + zoom * 2.5);
          ctx.textAlign = 'center';
          ctx.fillText((zoom === 1 ? SHORT : LABELS)[tr.archetype], x, y + 12 + zoom * 2);
        });
      };
    } else {
      const strip = mode === 'strip';
      const colW = s * 1.25;
      const rowH = s * 1.6 + 6;
      const perRow = (r: Row) => (strip ? frames : r.views.length);
      const castFor = (r: Row, k: number): number[] => {
        if (initial.look !== null && r.only === undefined) return Array.from({ length: k }, () => initial.look as number);
        if (r.only !== undefined) return looksFor(seed, k, t => t.archetype === r.only && (r.cane !== true || t.cane));
        // A spread of archetypes along each row.
        return Array.from({ length: k }, (_, i) =>
          looksFor(seed + ROWS.indexOf(r) * 13 + i, 1, t => t.archetype === ARCHETYPES[(ROWS.indexOf(r) + i) % 6])[0]);
      };
      const casts = ROWS.map(r => castFor(r, strip ? 1 : r.views.length));
      height = ROWS.length * rowH + 20;
      draw = ms => {
        ROWS.forEach((r, ri) => {
          const y = 10 + ri * rowH + s * 1.36;
          ctx.fillStyle = ri % 2 === 0 ? 'rgba(238, 214, 182, 0.35)' : 'rgba(255, 252, 247, 0)';
          ctx.fillRect(0, y - s * 1.36 - 4, width, rowH);
          ctx.fillStyle = '#2a1d15';
          ctx.font = font(12, 700);
          ctx.textAlign = 'left';
          ctx.fillText(r.label, 8, y - s * 0.55);
          for (let k = 0; k < perRow(r); k++) {
            const v = strip ? r.views[0] : r.views[k];
            const tr = traitsOf(strip ? casts[ri][0] : casts[ri][k]);
            const t = strip ? (initial.t ?? 0) + k * step : ms + k * 300;
            drawOne(ctx, tr, labelW + k * colW + colW / 2, y, s, r, v.view, v.facing, t, reduced);
          }
        });
      };
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.style.width = `${width}px`;
    c.style.height = `${height}px`;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    let raf = 0;
    const times: number[] = [];
    const frame = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fff6ea';
      ctx.fillRect(0, 0, width, height);
      const t0 = performance.now();
      draw(initial.t ?? now);
      if (initial.bench) {
        times.push(performance.now() - t0);
        if (times.length > 60) times.shift();
        const mean = times.reduce((a, b) => a + b, 0) / times.length;
        ctx.fillStyle = '#a8323c';
        ctx.font = font(14, 700);
        ctx.textAlign = 'right';
        ctx.fillText(`${mean.toFixed(2)} ms / frame`, width - 8, 30);
      }
      c.dataset.ready = '1';
      if (initial.t === null) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [mode, zoom, initial]);

  return (
    <div ref={box} style={{ minHeight: '100vh', background: 'var(--cream)', paddingTop: 44 }}>
      <div className="scene-dev__hud" style={{ position: 'fixed' }}>
        <div className="scene-dev__bar">
          {(['grid', 'anims', 'strip'] as const).map(m => (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
              style={{ width: 'auto', padding: '0 8px', opacity: mode === m ? 1 : 0.55 }}>{m}</button>
          ))}
          {[1, 2, 3].map(z => (
            <button key={z} type="button" onClick={() => setZoom(z)} aria-pressed={zoom === z}
              style={{ width: 'auto', padding: '0 8px', opacity: zoom === z ? 1 : 0.55 }}>
              {z === 1 ? `${PHONE_H}px` : `${z}×`}
            </button>
          ))}
        </div>
      </div>
      <canvas ref={canvas} data-sheet="" style={{ display: 'block' }} />
    </div>
  );
}
