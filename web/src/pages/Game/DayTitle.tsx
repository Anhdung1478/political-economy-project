// The start of each day (spec §9 "Mở đầu mỗi ngày"): a cinematic title card, "Ngày 3 · Giá trần 20k", sliding over
// the street while the light turns from night to morning. Letterbox bars close in, the card slides across, holds,
// and leaves; a tap, Enter, Space or Escape skips it.
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { DayRules, ThemeId } from '../../../../shared/sim/types';
import { dayTitle } from './copy';

export interface DayTitleProps {
  theme: ThemeId;
  rules: DayRules;
  /** One line under the title (the day's main rule). */
  line?: string;
  /** Called once the title has played (or was skipped). */
  onDone: () => void;
  /** Called when the light should turn to morning (a little after the title starts). */
  onDawn?: () => void;
  /** Dev: keep the title on screen. */
  hold?: boolean;
}

const HOLD_MS = 2600;
const DAWN_MS = 650;

export function DayTitle({ theme, rules, line, onDone, onDawn, hold }: DayTitleProps) {
  const reduced = useReducedMotion();
  const t = dayTitle(theme, rules);
  const done = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  const latest = useRef({ finish, onDawn });
  latest.current = { finish, onDawn };

  useEffect(() => {
    const dawn = window.setTimeout(() => latest.current.onDawn?.(), reduced ? 0 : DAWN_MS);
    const end = hold ? null : window.setTimeout(() => latest.current.finish(), reduced ? 1400 : HOLD_MS);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        latest.current.finish();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.clearTimeout(dawn);
      if (end !== null) window.clearTimeout(end);
      window.removeEventListener('keydown', key);
    };
  }, [hold, reduced]);

  const slide = reduced ? { duration: 0.2 } : { type: 'spring' as const, stiffness: 120, damping: 20, mass: 0.9 };

  return (
    <motion.div ref={root} tabIndex={-1} className="day-title" role="dialog" aria-modal="true"
      aria-label={`${t.kicker}: ${t.title}`} data-day-title="" onClick={finish}
      initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.45, delay: 0.25 } }}>
      {/* the night lifting off the street */}
      <motion.div className="day-title__night" aria-hidden="true"
        initial={{ opacity: 0.85 }} animate={{ opacity: 0 }}
        transition={{ duration: reduced ? 0.2 : 1.8, delay: reduced ? 0 : 0.35, ease: 'easeInOut' }} />
      <motion.div className="day-title__sun" aria-hidden="true"
        initial={{ opacity: 0, x: '-30%', y: '20%' }} animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{ duration: reduced ? 0.2 : 2.2, ease: 'easeOut' }} />
      <motion.div className="day-title__bar day-title__bar--top" aria-hidden="true"
        initial={{ y: '-100%' }} animate={{ y: 0 }} exit={{ y: '-100%' }} transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }} />
      <motion.div className="day-title__bar day-title__bar--bottom" aria-hidden="true"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }} />

      <motion.div className="day-title__card"
        initial={{ x: '110vw', rotate: 4 }} animate={{ x: 0, rotate: -1.5 }}
        exit={{ x: '-110vw', rotate: -6, transition: { duration: 0.55, ease: [0.6, 0, 0.8, 0.4] } }}
        transition={{ ...slide, delay: reduced ? 0 : 0.25 }}>
        <motion.span className="day-title__kicker"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 0.6 }}>
          {t.kicker}
        </motion.span>
        <span className="day-title__emoji" aria-hidden="true">{t.emoji}</span>
        <h1 className="day-title__title">{t.title}</h1>
        {line !== undefined && (
          <motion.p className="day-title__line"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: reduced ? 0 : 0.95 }}>
            {line}
          </motion.p>
        )}
        <span className="day-title__dots" aria-hidden="true">
          {[1, 2, 3, 4, 5].map(d => <i key={d} className={d < rules.day ? 'is-past' : d === rules.day ? 'is-now' : ''} />)}
        </span>
      </motion.div>
      <span className="day-title__skip">Chạm để bỏ qua</span>
    </motion.div>
  );
}
