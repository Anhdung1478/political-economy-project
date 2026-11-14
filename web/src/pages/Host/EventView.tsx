import { motion } from 'framer-motion';
import type { RoundRule } from '../../../../shared/config';
import { HAND_LABEL, roundChips } from '../../game/format';
import { InvisibleHand, VisibleHand } from '../../ui/Hands';

export function EventView({ round, index, total, shops }: { round: RoundRule; index: number; total: number; shops: number }) {
  return (
    <div className="event-host">
      <motion.div className="event-host__hand"
        initial={{ x: -120, rotate: -25, opacity: 0 }} animate={{ x: 0, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 120, damping: 12, delay: 0.15 }}>
        {round.hand === 'invisible' ? <InvisibleHand size={260} float /> : round.hand === 'visible' ? <VisibleHand size={260} float /> : <span className="event-host__worm" aria-hidden="true">🤢</span>}
      </motion.div>
      <motion.div className={`event-host__card event-host__card--${round.hand}`}
        initial={{ rotateY: 100, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 140, damping: 16, delay: 0.3 }}>
        <span className="chip">Vòng {index + 1}/{total} · {HAND_LABEL[round.hand]}</span>
        <span className="event-host__emoji" aria-hidden="true">{round.emoji}</span>
        <h1>{round.title}</h1>
        <p>{round.description}</p>
        <div className="event-host__chips">
          {roundChips(round, shops).map(c => <span key={c.text} className={c.tone ? `chip chip--${c.tone}` : 'chip'}>{c.text}</span>)}
        </div>
      </motion.div>
    </div>
  );
}
