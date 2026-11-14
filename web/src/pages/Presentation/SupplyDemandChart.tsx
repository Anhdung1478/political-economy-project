import { motion } from 'framer-motion';
import { useState } from 'react';
import { Button } from '../../ui/Button';

/*
 * Data space: Q (quantity) and P (price) both 0..10.
 * Supply  P = 1 + 0.8 Q          Demand  P = 9 − 0.8 (Q − shift)
 */
const W = 560, H = 400;
const x = (q: number) => 70 + q * 44;
const y = (p: number) => 350 - p * 30;
const supply = (q: number) => 1 + 0.8 * q;
const demand = (q: number, shift: number) => 9 - 0.8 * (q - shift);
const CEILING = 3.4;

const spring = { type: 'spring', stiffness: 120, damping: 18 } as const;

export function SupplyDemandChart({ mode }: { mode: 'free' | 'ceiling' }) {
  const [shift, setShift] = useState(0);
  const eqQ = 5 + shift / 2;
  const eqP = supply(eqQ);
  const qs = (CEILING - 1) / 0.8;          // quantity supplied at the ceiling
  const qd = (9 - CEILING) / 0.8;          // quantity demanded at the ceiling

  return (
    <div className="sd">
      <svg viewBox={`0 0 ${W} ${H}`} className="sd__svg" role="img"
        aria-label={mode === 'free' ? 'Biểu đồ cung cầu và điểm cân bằng' : 'Biểu đồ giá trần gây thiếu hụt'}>
        {/* axes */}
        <path d={`M${x(0)} ${y(10.6)}V${y(0)}H${x(10.6)}`} fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
        <text x={x(0) - 14} y={y(10.4)} className="sd__axis" textAnchor="end">Giá</text>
        <text x={x(10.6)} y={y(0) + 30} className="sd__axis" textAnchor="end">Lượng</text>

        {/* supply */}
        <motion.line x1={x(0.6)} y1={y(supply(0.6))} x2={x(10)} y2={y(supply(10))}
          stroke="var(--matcha)" strokeWidth="6" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: 0.3 }} />
        <text x={x(10) + 6} y={y(supply(10)) + 6} className="sd__label" fill="var(--matcha-deep)">Cung</text>

        {/* demand */}
        <motion.line stroke="var(--caramel)" strokeWidth="6" strokeLinecap="round"
          initial={{ pathLength: 0, x1: x(0.6), y1: y(demand(0.6, 0)), x2: x(10), y2: y(demand(10, 0)) }}
          animate={{ pathLength: 1, x1: x(0.6 + shift), y1: y(demand(0.6 + shift, shift)), x2: x(Math.min(10.4, 10 + shift)), y2: y(demand(Math.min(10.4, 10 + shift), shift)) }}
          transition={{ pathLength: { duration: 0.9, delay: 0.5 }, default: spring }} />
        <motion.text className="sd__label" fill="var(--caramel-deep)"
          animate={{ x: x(0.6 + shift) - 4, y: y(demand(0.6 + shift, shift)) - 14 }} transition={spring}>Cầu</motion.text>

        {mode === 'free' && (
          <g>
            <motion.path fill="none" stroke="var(--ink-faint)" strokeWidth="2" strokeDasharray="6 6"
              animate={{ d: `M${x(0)} ${y(eqP)}H${x(eqQ)}V${y(0)}` }} transition={spring} />
            <motion.circle r="11" fill="var(--ink)" stroke="var(--paper)" strokeWidth="4"
              animate={{ cx: x(eqQ), cy: y(eqP) }} transition={spring} />
            <motion.circle r="11" fill="none" stroke="var(--ink)" strokeWidth="2" className="sd__pulse"
              animate={{ cx: x(eqQ), cy: y(eqP) }} transition={spring} />
            <motion.text className="sd__label" animate={{ x: x(eqQ) + 18, y: y(eqP) + 6 }} transition={spring}>E</motion.text>
            <motion.text className="sd__tick" textAnchor="end" animate={{ x: x(0) - 10, y: y(eqP) + 6 }} transition={spring}>P*</motion.text>
            <motion.text className="sd__tick" textAnchor="middle" animate={{ x: x(eqQ), y: y(0) + 26 }} transition={spring}>Q*</motion.text>
          </g>
        )}

        {mode === 'ceiling' && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.3, duration: 0.5 }}>
            <rect x={x(qs)} y={y(CEILING) - 16} width={x(qd) - x(qs)} height={32} rx={10} fill="var(--strawberry-soft)" />
            <line x1={x(0)} y1={y(CEILING)} x2={x(10.2)} y2={y(CEILING)} stroke="var(--strawberry)" strokeWidth="4" strokeDasharray="10 8" />
            <text x={x(10.2)} y={y(CEILING) - 12} className="sd__label" fill="var(--strawberry-deep)" textAnchor="end">Giá trần</text>
            <circle cx={x(qs)} cy={y(CEILING)} r="8" fill="var(--matcha)" stroke="var(--paper)" strokeWidth="3" />
            <circle cx={x(qd)} cy={y(CEILING)} r="8" fill="var(--caramel)" stroke="var(--paper)" strokeWidth="3" />
            <text x={(x(qs) + x(qd)) / 2} y={y(CEILING) + 46} className="sd__label" fill="var(--strawberry-deep)" textAnchor="middle">Thiếu hụt</text>
            <path d={`M${x(qs)} ${y(CEILING) + 10}V${y(0)}M${x(qd)} ${y(CEILING) + 10}V${y(0)}`} stroke="var(--ink-faint)" strokeWidth="2" strokeDasharray="5 6" />
            <text x={x(qs)} y={y(0) + 26} className="sd__tick" textAnchor="middle">Cung</text>
            <text x={x(qd)} y={y(0) + 26} className="sd__tick" textAnchor="middle">Cầu</text>
          </motion.g>
        )}
      </svg>
      {mode === 'free' && (
        <div className="sd__controls">
          <Button variant={shift === 0 ? 'caramel' : 'secondary'} onClick={() => setShift(s => (s === 0 ? 2 : 0))}>
            {shift === 0 ? '📈 Cầu tăng' : '↩︎ Về như cũ'}
          </Button>
          <span className="sd__readout">Giá cân bằng: <b>{(eqP * 5).toFixed(0)}k</b></span>
        </div>
      )}
    </div>
  );
}
