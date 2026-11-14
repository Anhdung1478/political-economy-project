import { motion } from 'framer-motion';
import { useMemo } from 'react';

const COLORS = ['var(--matcha)', 'var(--caramel)', 'var(--strawberry)', 'var(--tea)', 'var(--boba)'];

/** One burst of confetti and boba pearls falling across the parent (position: relative). */
export function Confetti({ count = 36 }: { count?: number }) {
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => ({
    i,
    x: Math.random() * 100,
    drift: (Math.random() - 0.5) * 160,
    delay: Math.random() * 0.4,
    rot: Math.random() * 720 - 360,
    round: Math.random() < 0.35,
    color: COLORS[i % COLORS.length],
    dur: 1.6 + Math.random() * 1.2,
  })), [count]);
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map(p => (
        <motion.span
          key={p.i}
          className={p.round ? 'confetti__pearl' : 'confetti__bit'}
          style={{ left: `${p.x}%`, background: p.color }}
          initial={{ y: -30, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: '110vh', x: p.drift, rotate: p.rot, opacity: [1, 1, 0] }}
          transition={{ duration: p.dur, delay: p.delay, ease: [0.2, 0.6, 0.4, 1] }}
        />
      ))}
    </div>
  );
}
