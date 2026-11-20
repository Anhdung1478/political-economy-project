// The morning's drawings (spec §9 "Các màn khác"): the shelf that fills as tea and toppings are added, and the
// delivery van that pulls up when the shop opens. SVG with Framer Motion.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';
import type { MorningPlan, TeaGrade, ToppingId } from '../../../../shared/sim/types';
import { fmtNumber } from '../../game/format';
import { TOPPING_NAMES } from './copy';
import { cupsFromTea, shelfOf } from './morning';

const TEA_COLOR: Record<TeaGrade, string> = { skimp: '#dcc08f', standard: '#b8743a', premium: '#7e4420' };
const JAR_FILL: Record<ToppingId, string> = { pearl: 'url(#pat-pearl)', jelly: 'url(#pat-jelly)', pudding: 'url(#pat-pudding)' };

const W = 320;
const BOTTLE_W = 26;
const BOTTLE_GAP = 9;
const BOTTLE_H = 46;
const BOTTLE_TOP = 14;
const JAR_W = 78;
const JAR_H = 50;
const JAR_TOP = 86;

function Bottle({ x, fill, color }: { x: number; fill: number; color: string }) {
  const body = BOTTLE_H - 12;
  const level = body * fill;
  return (
    <motion.g
      initial={{ y: -36, opacity: 0, scale: 0.7 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -12, opacity: 0, scale: 0.6 }}
      transition={{ type: 'spring', stiffness: 520, damping: 22 }}
      style={{ originX: `${x + BOTTLE_W / 2}px`, originY: `${BOTTLE_TOP + BOTTLE_H}px` }}
    >
      <rect x={x + 8} y={BOTTLE_TOP} width={BOTTLE_W - 16} height={6} rx={2} fill="#3a271c" />
      <rect x={x + 9} y={BOTTLE_TOP + 5} width={BOTTLE_W - 18} height={7} fill="#f3e6d3" stroke="#3a271c" strokeWidth={1.6} />
      <rect x={x} y={BOTTLE_TOP + 12} width={BOTTLE_W} height={body} rx={7} fill="#fffaf2" stroke="#3a271c" strokeWidth={2} />
      {/* the level scales from the bottom (never a negative height: a tween, no spring overshoot) */}
      <motion.rect x={x + 2.5} y={BOTTLE_TOP + 13} width={BOTTLE_W - 5} height={body - 2.5} rx={5} fill={color}
        style={{ originY: 1 }} initial={false} animate={{ scaleY: Math.max(0, Math.min(1, level / body)) }}
        transition={{ duration: 0.35, ease: 'easeOut' }} />
      <rect x={x + 5} y={BOTTLE_TOP + 17} width={4} height={body - 12} rx={2} fill="#fff" opacity={0.55} />
    </motion.g>
  );
}

function Jar({ x, id, fill, count }: { x: number; id: ToppingId; fill: number; count: number }) {
  return (
    <g>
      <rect x={x + 10} y={JAR_TOP - 6} width={JAR_W - 20} height={8} rx={3} fill="#c9772a" stroke="#3a271c" strokeWidth={1.6} />
      <rect x={x} y={JAR_TOP} width={JAR_W} height={JAR_H} rx={12} fill="#fffaf2" stroke="#3a271c" strokeWidth={2} />
      <motion.rect x={x + 3} y={JAR_TOP + 7} width={JAR_W - 6} height={JAR_H - 10} rx={9} fill={JAR_FILL[id]}
        style={{ originY: 1 }} initial={false} animate={{ scaleY: Math.max(0, Math.min(1, fill)) }}
        transition={{ duration: 0.35, ease: 'easeOut' }} />
      <rect x={x + 7} y={JAR_TOP + 6} width={5} height={JAR_H - 16} rx={2.5} fill="#fff" opacity={0.6} />
      <text x={x + JAR_W / 2} y={JAR_TOP + JAR_H + 25} textAnchor="middle" className="shelf__label">
        {TOPPING_NAMES[id]} · <tspan className="shelf__num">{count}</tspan>
      </text>
    </g>
  );
}

/** The shop's shelf for the plan's stock: a bottle per litre of tea, a jar per topping. */
export function Shelf({ plan }: { plan: Pick<MorningPlan, 'teaMl' | 'toppings' | 'tea'> }) {
  const shelf = shelfOf(plan);
  const color = TEA_COLOR[plan.tea];
  const rowW = shelf.bottles.length * (BOTTLE_W + BOTTLE_GAP) - BOTTLE_GAP;
  const x0 = Math.max(12, (W - Math.max(rowW, 0) - (shelf.moreBottles > 0 ? 36 : 0)) / 2);
  const cups = cupsFromTea(plan.teaMl);
  return (
    <figure className="shelf" aria-label={`Kệ hàng: ${fmtNumber(plan.teaMl)} ml trà, đủ khoảng ${cups} ly`}>
      <svg viewBox={`0 0 ${W} 166`} role="img" aria-hidden="true">
        <defs>
          <pattern id="pat-pearl" width="12" height="11" patternUnits="userSpaceOnUse">
            <rect width="12" height="11" fill="#f1dcc0" />
            <circle cx="3.5" cy="3.5" r="3.2" fill="#3a271c" /><circle cx="9.5" cy="8.5" r="3.2" fill="#4a3324" />
          </pattern>
          <pattern id="pat-jelly" width="12" height="12" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill="#e3efd6" />
            <rect x="1" y="1" width="5" height="5" rx="1" fill="#5b8f3e" /><rect x="7" y="7" width="4.5" height="4.5" rx="1" fill="#7fb35a" />
          </pattern>
          <pattern id="pat-pudding" width="14" height="12" patternUnits="userSpaceOnUse">
            <rect width="14" height="12" fill="#fbe7b0" />
            <path d="M2 9 L4 3 L9 3 L11 9 Z" fill="#e9b84a" /><rect x="4" y="2" width="5" height="2" rx="1" fill="#94531a" />
          </pattern>
        </defs>
        {/* planks */}
        <rect x="4" y={BOTTLE_TOP + BOTTLE_H} width={W - 8} height="9" rx="4" fill="#c9772a" stroke="#3a271c" strokeWidth="2" />
        <rect x="4" y={JAR_TOP + JAR_H} width={W - 8} height="9" rx="4" fill="#c9772a" stroke="#3a271c" strokeWidth="2" />
        <AnimatePresence initial={false}>
          {shelf.bottles.map((f, i) => (
            <Bottle key={i} x={x0 + i * (BOTTLE_W + BOTTLE_GAP)} fill={f} color={color} />
          ))}
        </AnimatePresence>
        {shelf.bottles.length === 0 && (
          <text x={W / 2} y={BOTTLE_TOP + 34} textAnchor="middle" className="shelf__empty">Kệ trống trơn…</text>
        )}
        {shelf.moreBottles > 0 && (
          <text x={x0 + rowW + 8} y={BOTTLE_TOP + 36} className="shelf__more">+{shelf.moreBottles}</text>
        )}
        {shelf.jars.map((j, i) => (
          <Jar key={j.id} x={18 + i * (JAR_W + 22)} id={j.id} fill={j.fill} count={j.count} />
        ))}
      </svg>
      <figcaption className="shelf__cap">
        <b>{fmtNumber(plan.teaMl)} ml</b> trà · đủ khoảng <b>{cups} ly</b>
      </figcaption>
    </figure>
  );
}

/** The delivery van: drives in from the left, unloads, then calls `onArrived`. */
export function DeliveryVan({ onArrived }: { onArrived: () => void }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!reduced) return;
    const t = window.setTimeout(onArrived, 250);
    return () => window.clearTimeout(t);
  }, [reduced, onArrived]);
  return (
    <motion.div className="van" aria-hidden="true"
      initial={{ x: '-120vw' }}
      animate={{ x: 0 }}
      exit={{ x: '120vw', transition: { duration: 0.6, ease: [0.5, 0, 0.9, 0.4] } }}
      transition={{ duration: reduced ? 0 : 1.05, ease: [0.16, 0.9, 0.3, 1.04] }}
      onAnimationComplete={() => { if (!reduced) window.setTimeout(onArrived, 520); }}
    >
      <svg viewBox="0 0 220 120" className="van__svg">
        <ellipse cx="110" cy="112" rx="96" ry="6" fill="rgba(42,29,21,0.22)" />
        <g className="van__body">
          <path d="M14 30 Q14 18 26 18 H138 V96 H14 Z" fill="#fffcf7" stroke="#2a1d15" strokeWidth="4" strokeLinejoin="round" />
          <path d="M138 38 H170 Q180 38 186 48 L202 70 Q206 76 206 84 V96 H138 Z" fill="#5b8f3e" stroke="#2a1d15" strokeWidth="4" strokeLinejoin="round" />
          <path d="M148 46 H168 Q174 46 177 51 L188 68 H148 Z" fill="#cfe7f2" stroke="#2a1d15" strokeWidth="3" strokeLinejoin="round" />
          <rect x="14" y="78" width="124" height="10" fill="#c9772a" />
          <text x="76" y="52" textAnchor="middle" className="van__brand">TRÀ SỮA</text>
          <text x="76" y="68" textAnchor="middle" className="van__sub">giao tận quán</text>
          <circle cx="198" cy="86" r="4" fill="#e9b872" stroke="#2a1d15" strokeWidth="2" />
        </g>
        <g className="van__wheel" style={{ transformOrigin: '50px 98px' }}>
          <circle cx="50" cy="98" r="15" fill="#2a1d15" /><circle cx="50" cy="98" r="6" fill="#e9b872" />
          <rect x="48" y="85" width="4" height="8" fill="#6e5b4d" />
        </g>
        <g className="van__wheel" style={{ transformOrigin: '170px 98px' }}>
          <circle cx="170" cy="98" r="15" fill="#2a1d15" /><circle cx="170" cy="98" r="6" fill="#e9b872" />
          <rect x="168" y="85" width="4" height="8" fill="#6e5b4d" />
        </g>
      </svg>
      <motion.div className="van__boxes"
        initial={{ y: 0, opacity: 0 }}
        animate={{ y: [0, -46, -30], opacity: [0, 1, 1] }}
        transition={{ delay: reduced ? 0 : 1.0, duration: 0.5, ease: 'easeOut' }}>
        <svg viewBox="0 0 120 44" aria-hidden="true">
          <Box x={2} />
          {/* a cup of milk tea between the boxes */}
          <g transform="translate(46 2)">
            <rect x="9" y="0" width="3" height="12" rx="1.5" fill="#de4f5a" transform="rotate(12 10 6)" />
            <path d="M2 10 H26 L23 40 Q22 42 20 42 H8 Q6 42 5 40 Z" fill="#f3d7a8" stroke="#2a1d15" strokeWidth="2.4" strokeLinejoin="round" />
            <rect x="1" y="8" width="26" height="5" rx="2.5" fill="#fffcf7" stroke="#2a1d15" strokeWidth="2.4" />
            <circle cx="10" cy="35" r="2.4" fill="#3a271c" /><circle cx="16" cy="37" r="2.4" fill="#3a271c" /><circle cx="19" cy="32" r="2.2" fill="#3a271c" />
          </g>
          <Box x={78} />
        </svg>
      </motion.div>
    </motion.div>
  );
}

/** A cardboard box with tape. */
function Box({ x }: { x: number }) {
  return (
    <g transform={`translate(${x} 10)`}>
      <rect x="0" y="0" width="40" height="32" rx="3" fill="#d9a066" stroke="#2a1d15" strokeWidth="2.4" />
      <path d="M0 9 H40" stroke="#2a1d15" strokeWidth="2" />
      <rect x="16" y="0" width="8" height="32" fill="#e9c48f" />
      <path d="M16 0 V32 M24 0 V32" stroke="#2a1d15" strokeWidth="1.4" />
    </g>
  );
}
