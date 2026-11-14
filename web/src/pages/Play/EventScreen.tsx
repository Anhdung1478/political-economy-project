import { motion } from 'framer-motion';
import type { RoundRule } from '../../../../shared/config';
import { HAND_LABEL, roundChips } from '../../game/format';

export function EventScreen({ round, index, total }: { round: RoundRule; index: number; total: number }) {
  return (
    <div className="event">
      <span className="chip">Vòng {index + 1}/{total} · {HAND_LABEL[round.hand]}</span>
      <motion.div className={`event-card event-card--${round.hand}`}
        initial={{ rotateY: 90, scale: 0.9 }} animate={{ rotateY: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.1 }}>
        <span className="event-card__emoji" aria-hidden="true">{round.emoji}</span>
        <h1>{round.title}</h1>
        <p>{round.description}</p>
        <div className="event-card__chips">
          {roundChips(round).map(c => <span key={c.text} className={c.tone ? `chip chip--${c.tone}` : 'chip'}>{c.text}</span>)}
        </div>
      </motion.div>
      <p className="play__sub event__hint">Nhìn lên màn chiếu 👀 — sắp được chọn giá rồi.</p>
    </div>
  );
}
