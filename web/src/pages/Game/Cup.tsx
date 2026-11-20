// The cup on the counter (spec §9 "Bảng pha chế"): it drops onto the counter with a bounce, ice falls cube by cube,
// tea pours in a stream with the level rising and sloshing in the colour of the day's tea grade, toppings drop and
// bounce at the bottom, and a lid and a straw go on when the cup is done. Drawn in SVG; React lays out what is in the
// cup, one requestAnimationFrame loop moves it from the sim clock (so it pauses with the clock and stays in step
// with the engine's step timing, R14).
import { memo, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import type { CraftState, Size, TeaGrade, ToppingId } from '../../../../shared/sim/types';
import { stepProgress } from './rush';

export const TEA_COLORS: Record<TeaGrade, { fill: string; deep: string; foam: string }> = {
  skimp: { fill: '#dcc7a5', deep: '#c9ae86', foam: '#efe3cf' },
  standard: { fill: '#c99560', deep: '#a8733f', foam: '#e9cba3' },
  premium: { fill: '#a9693a', deep: '#7f4a24', foam: '#d9a774' },
};

const W = 160;
const FLOOR = 186;
const CX = 80;
const GEOM: Record<Size, { h: number; tw: number }> = { S: { h: 106, tw: 82 }, M: { h: 126, tw: 90 }, L: { h: 146, tw: 98 } };

interface Geom { h: number; tw: number; bw: number; top: number; left: number; right: number; path: string; fillH: number }

function geomOf(size: Size): Geom {
  const { h, tw } = GEOM[size];
  const bw = tw * 0.7;
  const top = FLOOR - h;
  const l = CX - tw / 2;
  const r = CX + tw / 2;
  const bl = CX - bw / 2;
  const br = CX + bw / 2;
  const path = `M${l} ${top} L${r} ${top} L${br - 1} ${FLOOR - 8} Q${br - 2} ${FLOOR} ${br - 10} ${FLOOR} `
    + `L${bl + 10} ${FLOOR} Q${bl + 2} ${FLOOR} ${bl + 1} ${FLOOR - 8} Z`;
  return { h, tw, bw, top, left: l, right: r, path, fillH: h * 0.8 };
}

/** Half the inner width of the cup at height y. */
function halfAt(g: Geom, y: number): number {
  const k = Math.min(1, Math.max(0, (FLOOR - y) / g.h));
  return (g.bw + (g.tw - g.bw) * k) / 2 - 7;
}

/** A small deterministic jitter in −1..1. */
const jit = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

const easeOutBounce = (x: number): number => {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
const easeOutBack = (x: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

const ICE = 5;
const PIECES: Record<ToppingId, number> = { pearl: 10, jelly: 6, pudding: 3 };
const BAND = 15;

interface Piece { topping: ToppingId; band: number; k: number; n: number; x: number; y: number; r: number }

function piecesOf(g: Geom, toppings: readonly ToppingId[]): Piece[] {
  const out: Piece[] = [];
  toppings.forEach((t, band) => {
    const n = PIECES[t];
    const yMid = FLOOR - 9 - band * BAND;
    const half = halfAt(g, yMid) - 2;
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0.5 : k / (n - 1);
      const x = CX - half + u * half * 2 + jit(k + band * 13) * 3;
      const y = yMid + jit(k * 7 + band) * 3.5 - (k % 2) * (t === 'pearl' ? 5 : 2);
      out.push({ topping: t, band, k, n, x, y, r: jit(k + 99) * 30 });
    }
  });
  return out;
}

export interface CupProps {
  craft: CraftState;
  machine: boolean;
  tea: TeaGrade;
  /** Sim time in fractional ticks (the rush clock or the practice clock). */
  time: () => number;
  reduced: boolean;
  /** Ready to hand over: glows. */
  ready: boolean;
  /** Set by the cup: call it to make the tea slosh (a drag, a shake). */
  sloshRef?: MutableRefObject<((amount: number) => void) | null>;
}

/** What React lays out: everything but the motion. */
function layoutKey(c: CraftState): string {
  const cup = c.cup;
  const a = c.anim;
  return `${cup ? `${cup.size}${cup.iced ? 'i' : ''}${cup.teaMl > 0 ? 't' : ''}${cup.toppings.join('')}` : '-'}`
    + `|${a ? `${a.step}${a.endsAt}` : ''}|${c.buffer.length}`;
}

function CupView({ craft, machine, tea, time, reduced, ready, sloshRef }: CupProps) {
  const cup = craft.cup;
  const size = cup?.size ?? null;
  const g = useMemo(() => (size === null ? null : geomOf(size)), [size]);
  const toppingKey = cup?.toppings.join(',') ?? '';
  const pieces = useMemo(() => (g === null ? [] : piecesOf(g, toppingKey === '' ? [] : toppingKey.split(',') as ToppingId[])),
    [g, toppingKey]);
  const colors = TEA_COLORS[tea];

  const root = useRef<SVGGElement>(null);
  const body = useRef<SVGGElement>(null);
  const liquid = useRef<SVGPathElement>(null);
  const foam = useRef<SVGPathElement>(null);
  const stream = useRef<SVGRectElement>(null);
  const pitcher = useRef<SVGGElement>(null);
  const lid = useRef<SVGGElement>(null);
  const ice = useRef<(SVGGElement | null)[]>([]);
  const pieceEls = useRef<(SVGGElement | null)[]>([]);

  const latest = useRef({ craft, machine, time, reduced, g, pieces });
  useLayoutEffect(() => { latest.current = { craft, machine, time, reduced, g, pieces }; });

  // Slosh: an amount that decays; a lid that drops in when the cup is done.
  const motion = useRef({ slosh: 0, lidSince: -1, lastWall: 0, wasPouring: false });
  useEffect(() => {
    if (sloshRef === undefined) return;
    sloshRef.current = (a: number) => { motion.current.slosh = Math.min(10, motion.current.slosh + a); };
    return () => { sloshRef.current = null; };
  }, [sloshRef]);

  useEffect(() => {
    let raf = 0;
    const frame = (wall: number) => {
      raf = requestAnimationFrame(frame);
      const L = latest.current;
      const m = motion.current;
      // At rest (nothing running, the tea settled) the cup only breathes: 20 updates a second are plenty, and each
      // one repaints the SVG.
      const resting = L.craft.anim === null && m.slosh < 0.3 && (m.lidSince < 0 || wall - m.lidSince > 450);
      if (resting && wall - m.lastWall < 50) return;
      const dt = m.lastWall === 0 ? 16 : Math.min(64, wall - m.lastWall);
      m.lastWall = wall;
      const geo = L.g;
      const c = L.craft;
      if (geo === null || c.cup === null) {
        m.lidSince = -1;
        return;
      }
      const now = L.time();
      const anim = c.anim;
      const step = anim?.step ?? null;
      const p = stepProgress(anim, now, c.cup.size, L.machine);
      const calm = L.reduced;

      // The cup set down: it drops in with a squash.
      if (body.current !== null) {
        let y = 0;
        let sy = 1;
        if (step === 'size' && !calm) {
          const k = clamp01(p / 0.85);
          y = -70 * (1 - easeOutBounce(k));
          sy = k > 0.55 ? 1 - Math.sin(((k - 0.55) / 0.45) * Math.PI) * 0.07 : 1;
        }
        body.current.setAttribute('transform', `translate(0 ${y.toFixed(1)}) translate(${CX} ${FLOOR}) scale(${(2 - sy).toFixed(3)} ${sy.toFixed(3)}) translate(${-CX} ${-FLOOR})`);
      }

      // Tea level.
      const hasTea = c.cup.teaMl > 0;
      const pouring = step === 'tea';
      const level = !hasTea ? 0 : pouring ? clamp01((p - 0.06) / 0.9) : 1;
      const surf = FLOOR - 6 - level * geo.fillH;
      if (pouring) m.slosh = Math.max(m.slosh, 3.2);
      if (m.wasPouring && !pouring) m.slosh = Math.max(m.slosh, 4.5);
      m.wasPouring = pouring;
      m.slosh *= Math.exp(-dt / 700);
      const amp = calm ? 0 : 0.8 + m.slosh;
      const ph = wall / 260;
      if (liquid.current !== null) {
        if (level <= 0) liquid.current.setAttribute('d', '');
        else {
          const x0 = geo.left - 6;
          const x1 = geo.right + 6;
          let d = `M${x0} ${(surf + Math.sin(ph) * amp).toFixed(1)}`;
          const n = 8;
          for (let i = 1; i <= n; i++) {
            const x = x0 + ((x1 - x0) * i) / n;
            const y = surf + Math.sin(ph + i * 0.9) * amp + Math.sin(ph * 1.7 - i * 1.3) * amp * 0.4;
            d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
          }
          d += ` L${x1} 200 L${x0} 200 Z`;
          liquid.current.setAttribute('d', d);
          if (foam.current !== null) {
            const fy = surf + Math.sin(ph + 4) * amp * 0.6;
            foam.current.setAttribute('d', `M${x0} ${(fy - 1).toFixed(1)} L${x1} ${(fy - 1).toFixed(1)} L${x1} ${(fy + 4).toFixed(1)} L${x0} ${(fy + 4).toFixed(1)} Z`);
          }
        }
      }

      // The pitcher tips in and pours a stream down to the surface.
      if (pitcher.current !== null && stream.current !== null) {
        const show = pouring ? (calm ? 1 : Math.min(clamp01(p / 0.08), clamp01((1 - p) / 0.08))) : 0;
        const tilt = -48 * show;
        pitcher.current.setAttribute('opacity', show.toFixed(2));
        pitcher.current.setAttribute('transform', `translate(${(CX + 34 + (1 - show) * 30).toFixed(1)} ${geo.top - 34}) rotate(${tilt.toFixed(1)})`);
        const on = pouring && p > 0.05 && p < 0.96;
        stream.current.setAttribute('opacity', on ? '1' : '0');
        if (on) {
          const top = geo.top - 22;
          const wob = calm ? 0 : Math.sin(wall / 45) * 0.8;
          stream.current.setAttribute('x', (CX + 9 + wob).toFixed(1));
          stream.current.setAttribute('y', top.toFixed(1));
          stream.current.setAttribute('width', (5.5 + wob * 0.6).toFixed(1));
          stream.current.setAttribute('height', Math.max(0, surf - top + 4).toFixed(1));
        }
      }

      // Ice: cubes drop one by one, then float up with the tea.
      for (let i = 0; i < ICE; i++) {
        const el = ice.current[i];
        if (el === null || el === undefined) continue;
        if (!c.cup.iced) {
          el.setAttribute('opacity', '0');
          continue;
        }
        const row = i < 3 ? 0 : 1;
        const baseY = FLOOR - 16 - row * 15;
        const half = halfAt(geo, baseY) - 8;
        const xi = row === 0 ? CX + (i - 1) * half * 0.85 : CX + (i === 3 ? -0.45 : 0.45) * half;
        const floatY = surf + 7 + (i % 2) * 6 + (calm ? 0 : Math.sin(wall / 500 + i) * 1.4);
        let y = level > 0 ? Math.min(baseY, floatY) : baseY;
        let op = 1;
        if (step === 'ice') {
          const start = (i / ICE) * 0.62;
          const k = clamp01((p - start) / 0.34);
          if (k <= 0) op = 0;
          else if (!calm) y = geo.top - 40 + (y - geo.top + 40) * easeOutBounce(k);
        }
        el.setAttribute('opacity', String(op));
        el.setAttribute('transform', `translate(${xi.toFixed(1)} ${y.toFixed(1)}) rotate(${(jit(i) * 18 + (calm ? 0 : Math.sin(wall / 700 + i) * 4)).toFixed(1)})`);
      }

      // Toppings: the newest drops in, slower once in the tea, and bounces at the bottom.
      const pcs = L.pieces;
      const lastBand = (c.cup.toppings.length - 1);
      for (let j = 0; j < pcs.length; j++) {
        const el = pieceEls.current[j];
        if (el === null || el === undefined) continue;
        const pc = pcs[j];
        let y = pc.y;
        let op = 1;
        if (step === 'topping' && pc.band === lastBand) {
          const start = (pc.k / pc.n) * 0.4;
          const k = clamp01((p - start) / 0.5);
          if (k <= 0) op = 0;
          else if (!calm) y = geo.top - 34 + (pc.y - geo.top + 34) * easeOutBounce(k);
          if (k > 0 && k < 1 && !calm) m.slosh = Math.max(m.slosh, 2);
        }
        el.setAttribute('opacity', String(op));
        el.setAttribute('transform', `translate(${pc.x.toFixed(1)} ${y.toFixed(1)}) rotate(${pc.r.toFixed(0)})`);
      }

      // Lid and straw once the cup is done (tea in, nothing running).
      if (lid.current !== null) {
        const done = hasTea && anim === null;
        if (done && m.lidSince < 0) m.lidSince = wall;
        if (!done) m.lidSince = -1;
        const k = m.lidSince < 0 ? 0 : calm ? 1 : clamp01((wall - m.lidSince) / 380);
        lid.current.setAttribute('opacity', k > 0 ? '1' : '0');
        lid.current.setAttribute('transform', `translate(0 ${(-46 * (1 - easeOutBack(k))).toFixed(1)})`);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const iceRefs = useMemo(() => Array.from({ length: ICE }, (_, i) => (el: SVGGElement | null) => { ice.current[i] = el; }), []);

  if (cup === null || g === null) {
    return (
      <svg className="rcup rcup--empty" viewBox={`0 0 ${W} 200`} aria-hidden="true">
        <ellipse cx={CX} cy={FLOOR + 3} rx={44} ry={6} className="rcup__shadow" />
        <path d={geomOf('M').path} className="rcup__ghost" />
      </svg>
    );
  }

  return (
    <svg className={`rcup${ready ? ' rcup--ready' : ''}`} viewBox={`0 0 ${W} 200`} aria-hidden="true">
      <defs>
        <clipPath id={`cupclip-${cup.size}`}><path d={g.path} /></clipPath>
        <linearGradient id={`tea-${tea}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={colors.fill} />
          <stop offset="1" stopColor={colors.deep} />
        </linearGradient>
        <pattern id="straw-stripes" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
          <rect width="12" height="12" fill="#de4f5a" />
          <rect width="5" height="12" fill="#fff6ea" />
        </pattern>
      </defs>
      <ellipse cx={CX} cy={FLOOR + 3} rx={g.bw / 2 + 10} ry={6} className="rcup__shadow" />
      <g ref={root}>
        <g ref={body}>
          <g clipPath={`url(#cupclip-${cup.size})`}>
            <rect x={0} y={0} width={W} height={200} fill="rgba(255,255,255,0.55)" />
            <path ref={liquid} fill={`url(#tea-${tea})`} />
            <path ref={foam} fill={colors.foam} opacity={0.55} />
            {pieces.map((pc, j) => (
              <g key={`${pc.band}-${pc.k}`} ref={el => { pieceEls.current[j] = el; }} opacity={0}>
                {pc.topping === 'pearl' && (<>
                  <circle r={5.4} fill="#3a271c" />
                  <circle r={1.6} cx={-1.6} cy={-1.8} fill="rgba(255,255,255,0.5)" />
                </>)}
                {pc.topping === 'jelly' && (<>
                  <rect x={-5} y={-5} width={10} height={10} rx={2.5} fill="rgba(120,180,90,0.85)" stroke="#5b8f3e" strokeWidth={1} />
                  <rect x={-3} y={-3.5} width={3} height={2} rx={1} fill="rgba(255,255,255,0.6)" />
                </>)}
                {pc.topping === 'pudding' && (<>
                  <ellipse rx={10} ry={6.5} fill="#f2c14e" stroke="#c9922a" strokeWidth={1} />
                  <ellipse rx={7} ry={2.4} cy={-3.4} fill="#a8641f" opacity={0.75} />
                </>)}
              </g>
            ))}
            {iceRefs.map((ref, i) => (
              <g key={i} ref={ref} opacity={0}>
                <rect x={-9} y={-9} width={18} height={18} rx={4.5} fill="rgba(232,246,255,0.78)" stroke="rgba(111,168,201,0.75)" strokeWidth={1.4} />
                <path d="M-5 -4 L1 -6" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
              </g>
            ))}
            {/* the glass's shine */}
            <rect x={g.left + 10} y={g.top + 8} width={6} height={g.h - 28} rx={3} fill="rgba(255,255,255,0.55)" />
          </g>
          <path d={g.path} className="rcup__glass" />
          <line x1={g.left + 4} x2={g.right - 4} y1={FLOOR - 6 - g.fillH} y2={FLOOR - 6 - g.fillH} className="rcup__mark" />
          <g transform={`translate(${CX} ${FLOOR - g.h * 0.42})`} className="rcup__sticker">
            <circle r={12} />
            <text y={4.5} textAnchor="middle">{cup.size}</text>
          </g>
          <g ref={lid} opacity={0}>
            <rect x={g.left + 18} y={g.top - 92} width={11} height={108} rx={5} fill="url(#straw-stripes)" stroke="#a8323c" strokeWidth={1.2}
              transform={`rotate(14 ${g.left + 24} ${g.top})`} />
            <path d={`M${g.left - 3} ${g.top + 1} Q${CX} ${g.top - 30} ${g.right + 3} ${g.top + 1} Z`} className="rcup__lid" />
            <rect x={g.left - 5} y={g.top - 2} width={g.tw + 10} height={7} rx={3.5} className="rcup__rim" />
          </g>
        </g>
        <rect ref={stream} fill={colors.fill} opacity={0} rx={2.5} />
        <g ref={pitcher} opacity={0}>
          <path d="M-14 -18 L14 -18 L18 18 Q18 24 12 24 L-12 24 Q-18 24 -18 18 Z" fill="#fffcf7" stroke="#6e5b4d" strokeWidth={2} />
          <path d="M-14 -18 L-24 -26 L-12 -12 Z" fill="#fffcf7" stroke="#6e5b4d" strokeWidth={2} strokeLinejoin="round" />
          <path d="M14 -10 Q28 -6 26 6 Q24 14 16 12" fill="none" stroke="#6e5b4d" strokeWidth={3} strokeLinecap="round" />
          <rect x={-15} y={-2} width={31} height={22} rx={3} fill={colors.fill} opacity={0.85} />
        </g>
      </g>
    </svg>
  );
}

/** Re-rendered only when what is in the cup or the running step changes; the motion runs on its own. */
export const Cup = memo(CupView, (a, b) => layoutKey(a.craft) === layoutKey(b.craft) && a.machine === b.machine
  && a.tea === b.tea && a.reduced === b.reduced && a.ready === b.ready && a.time === b.time);
