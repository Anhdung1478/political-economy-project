// A customer at the player's counter (spec §6 Quầy, §9 "4 khách ở quầy là chân dung lớn"): a large portrait drawn
// with the street's own jointed character renderer (so they are the same person as on the street), an order bubble
// (size and topping icons) and a patience bar; the face and the pose follow the patience left (relaxed, tapping, arms
// crossed, fuming), and a leaving customer cheers, frowns at a wrong cup or stomps off. Every portrait on the screen
// is drawn by one shared, throttled animation loop; nothing re-renders per frame.
import { memo, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { CONFIG } from '../../../../shared/sim/config';
import type { Order, Tick, ToppingId } from '../../../../shared/sim/types';
import {
  characterPose, drawCharacterAt, shade, traitsOf, type FigureFx, type Traits,
} from '../../scene/draw/characters';
import type { Mood } from '../../scene/draw/faces';
import { newSkeleton, pose, solve, type Clip, type ClipInput } from '../../scene/rig';
import { cx } from '../../ui/cx';
import { TOPPING_NAMES } from './copy';
import { orderLabel, patienceLook, patienceUsed, type LeaveKind } from './rush';

// ── The shared portrait loop ────────────────────────────────────────────────────────────────────────────────────────

type Painter = (wall: number) => void;
const painters = new Set<Painter>();
let raf = 0;
let last = 0;
/** Portraits redraw at about 25 fps: enough for breathing and blinking, well under half the cost. */
const FRAME_MS = 40;

let paused = false;

/** The portraits are off screen (the panel is put away): the loop draws nothing until they are back. */
export function setPortraitsPaused(p: boolean): void { paused = p; }

function loop(wall: number): void {
  raf = painters.size > 0 ? requestAnimationFrame(loop) : 0;
  if (paused || wall - last < FRAME_MS) return;
  last = wall;
  painters.forEach(p => p(wall));
}

function addPainter(p: Painter): () => void {
  painters.add(p);
  if (raf === 0) raf = requestAnimationFrame(loop);
  return () => { painters.delete(p); };
}

const sk = newSkeleton();
const target = pose();
const input: ClipInput = { t: 0, loop: 0, phase: 0, pace: 0, side: false, stoop: 0, calm: false };
const fx: FigureFx = { mood: 'neutral', blink: 0, cup: false, phone: false };

/** Draws `tr` as a bust portrait into a canvas of css size w × h. */
function paintPortrait(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, tr: Traits, clip: Clip,
  mood: Mood, tSec: number, wallSec: number, calm: boolean, cup: boolean): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  input.t = tSec;
  input.loop = wallSec + tr.phaseOffset;
  input.stoop = tr.stoop;
  input.calm = calm;
  characterPose(target, clip, input, tr);
  solve(target, tr.dims, 'front', sk);
  fx.mood = mood;
  fx.blink = (wallSec + tr.phaseOffset) % (3 + (tr.phaseOffset % 2)) < 0.12 ? 1 : 0;
  fx.cup = cup;
  fx.phone = false;
  // A bust: the head near the top, cut at the hips; the frame's shorter side sets the size.
  const s = Math.min(h * 1.5, w * 1.75) * tr.height;
  drawCharacterAt(ctx, tr, w / 2, h * 0.07 + s, s, 1, 'front', target, sk, fx, null);
}

export interface PortraitState {
  clip: Clip;
  mood: Mood;
  /** Seconds since the clip started (one-shots: a hop, a stomp). */
  t: number;
  cup: boolean;
}

/**
 * A canvas portrait of `look`, drawn by the shared loop. `state(wall)` says what the person does at that moment; it
 * is read every frame, so it may follow the sim clock.
 */
export function Portrait({ look, state, reduced, className, traits }: {
  look: number; state: (wall: number) => PortraitState; reduced: boolean; className?: string; traits?: Traits;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ state, reduced, traits });
  latest.current = { state, reduced, traits };
  useEffect(() => {
    const el = canvas.current;
    if (el === null) return;
    const ctx = el.getContext('2d');
    if (ctx === null) return;
    const tr = latest.current.traits ?? traitsOf(look);
    let size = { w: 0, h: 0, dpr: 1 };
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      size = { w, h, dpr };
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const off = addPainter(wall => {
      const st = latest.current.state(wall);
      paintPortrait(ctx, size.w, size.h, size.dpr, tr, st.clip, st.mood, st.t, wall / 1000, latest.current.reduced, st.cup);
    });
    return () => {
      off();
      ro.disconnect();
    };
  }, [look]);
  return <canvas ref={canvas} className={cx('rportrait', className)} aria-hidden="true" />;
}

// ── Order icons ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function ToppingIcon({ id, size = 18 }: { id: ToppingId; size?: number }) {
  return (
    <svg className={`tico tico--${id}`} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      {id === 'pearl' && (<>
        <circle cx={6.5} cy={12} r={4.2} fill="#3a271c" />
        <circle cx={13.5} cy={12} r={4.2} fill="#3a271c" />
        <circle cx={10} cy={6.5} r={4.2} fill="#4e3426" />
        <circle cx={8.6} cy={5.2} r={1.2} fill="rgba(255,255,255,0.55)" />
      </>)}
      {id === 'jelly' && (<>
        <rect x={2.5} y={8} width={8} height={8} rx={2} fill="#8cc06b" stroke="#5b8f3e" strokeWidth={1.2} transform="rotate(-10 6.5 12)" />
        <rect x={9.5} y={4} width={8} height={8} rx={2} fill="#b7dca0" stroke="#5b8f3e" strokeWidth={1.2} transform="rotate(12 13.5 8)" />
      </>)}
      {id === 'pudding' && (<>
        <path d="M4 16 L6 7 Q10 4 14 7 L16 16 Z" fill="#f2c14e" stroke="#c9922a" strokeWidth={1.2} strokeLinejoin="round" />
        <path d="M6 7 Q10 4 14 7 Q10 10 6 7 Z" fill="#a8641f" />
      </>)}
    </svg>
  );
}

/** A cup with the size letter, scaled by size. */
export function SizeIcon({ size, px = 22 }: { size: 'S' | 'M' | 'L'; px?: number }) {
  const k = size === 'S' ? 0.78 : size === 'M' ? 0.9 : 1;
  return (
    <svg className="sico" width={px} height={px} viewBox="0 0 24 24" aria-hidden="true">
      <g transform={`translate(12 23) scale(${k}) translate(-12 -23)`}>
        <path d="M5 4 L19 4 L17 22 L7 22 Z" fill="#fffcf7" stroke="#2a1d15" strokeWidth={1.6} strokeLinejoin="round" />
        <path d="M6 10 L18 10 L17 22 L7 22 Z" fill="#c99560" />
        <rect x={3.5} y={2.5} width={17} height={3} rx={1.5} fill="#2a1d15" />
      </g>
    </svg>
  );
}

export function OrderBubble({ order, compact }: { order: Order; compact?: boolean }) {
  return (
    <span className={cx('rorder', compact && 'rorder--compact')} aria-label={`Đơn: ${orderLabel(order)}`}>
      <span className="rorder__size"><SizeIcon size={order.size} px={compact ? 16 : 22} /><b>{order.size}</b></span>
      {order.toppings.map(t => (
        <span key={t} className="rorder__top" title={TOPPING_NAMES[t]}><ToppingIcon id={t} size={compact ? 14 : 18} /></span>
      ))}
      {order.toppings.length === 0 && <span className="rorder__none">không topping</span>}
    </span>
  );
}

// ── The counter customer ────────────────────────────────────────────────────────────────────────────────────────────

const LEAVE_POSE: Record<LeaveKind, PortraitState> = {
  cheer: { clip: 'happy', mood: 'happy', t: 0, cup: true },
  wrong: { clip: 'puzzled', mood: 'puzzled', t: 0, cup: true },
  angry: { clip: 'stomp', mood: 'angry', t: 0, cup: false },
  gone: { clip: 'shrug', mood: 'annoyed', t: 0, cup: false },
};

export interface CounterCustomerProps {
  customer: number;
  look: number;
  order: Order;
  /** −1 for the practice customer (no patience). */
  joinedTick: Tick;
  index: number;
  leaving: LeaveKind | null;
  leftAt: number;
  /** Sim time in fractional ticks. */
  time: () => number;
  reduced: boolean;
  /** A cup is being dragged over them / they can take the selected cup. */
  hot: boolean;
  target: boolean;
  onPick: (customer: number) => void;
}

function CounterCustomerView(p: CounterCustomerProps) {
  const bar = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const latest = useRef(p);
  latest.current = p;

  // What they do now: leaving → their reaction; waiting → by the patience they have left (also moves the bar).
  const state = (wall: number): PortraitState => {
    const q = latest.current;
    if (q.leaving !== null) return { ...LEAVE_POSE[q.leaving], t: (wall - q.leftAt) / 1000 };
    if (q.joinedTick < 0) return { clip: 'idle', mood: 'happy', t: 0, cup: false };
    const used = patienceUsed(q.time(), q.joinedTick);
    const look = patienceLook(used);
    const el = bar.current;
    if (el !== null) {
      el.style.transform = `scaleX(${(1 - used).toFixed(3)})`;
      const tone = look.tone;
      if (el.dataset.tone !== tone) el.dataset.tone = tone;
      if (card.current !== null && card.current.dataset.tone !== tone) card.current.dataset.tone = tone;
    }
    return { clip: look.clip, mood: look.mood, t: 0, cup: false };
  };

  const pick = () => { if (p.leaving === null) p.onPick(p.customer); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick();
    }
  };
  const stop = (e: PointerEvent) => e.stopPropagation();

  return (
    <div ref={card} role="button" tabIndex={p.leaving === null ? 0 : -1}
      className={cx('rccard', p.leaving && `rccard--${p.leaving}`, p.hot && 'is-hot', p.target && 'is-target')}
      data-drop-customer={p.leaving === null ? p.customer : undefined} data-customer={p.customer}
      data-order={`${p.order.size}:${p.order.toppings.join('+')}`}
      aria-label={`Khách ${p.index + 1}: ${orderLabel(p.order)}${p.target ? ' — chạm để giao ly' : ''}`}
      onClick={pick} onKeyDown={onKey} onPointerDown={stop}>
      <div className="rccard__bubble"><OrderBubble order={p.order} compact /></div>
      <div className="rccard__frame">
        <Portrait look={p.look} state={state} reduced={p.reduced} />
        {p.leaving === 'wrong' && <span className="rccard__mark rccard__mark--q" aria-hidden="true">?</span>}
        {p.leaving === 'angry' && <span className="rccard__mark rccard__mark--angry" aria-hidden="true">💢</span>}
        {p.leaving === 'cheer' && <span className="rccard__mark rccard__mark--heart" aria-hidden="true">❤</span>}
        <span className="rccard__key" aria-hidden="true">{p.index + 1}</span>
      </div>
      {p.joinedTick >= 0 && (
        <span className="rccard__patience" aria-hidden="true"><span ref={bar} className="rccard__fill" /></span>
      )}
    </div>
  );
}

export const CounterCustomer = memo(CounterCustomerView);

// ── The staff helper ────────────────────────────────────────────────────────────────────────────────────────────────

let staffTraits: Traits | null = null;
/** A helper in the shop's matcha shirt, the same person every day. */
export function staffLook(): { look: number; traits: Traits } {
  if (staffTraits === null) {
    let found = 4242;
    for (let l = 1; l < 6000; l++) {
      const t = traitsOf(l);
      if ((t.archetype === 'student' || t.archetype === 'office') && t.hat === 'none' && t.glasses === 'none' && t.bag === 'none') {
        found = l;
        break;
      }
    }
    const base = traitsOf(found);
    // Its own look number: the renderer caches drawn parts by look, and this shirt differs from the base's.
    staffTraits = { ...base, look: 0x7ffffff1, top: '#5b8f3e', topEdge: shade('#5b8f3e', 0.66), pattern: 'none', neck: 'collar', neckColor: '#fff6ea' };
  }
  return { look: staffTraits.look, traits: staffTraits };
}

export const PATIENCE_TICKS = CONFIG.rush.patienceTicks;
