import { motion } from 'framer-motion';
import type { Award, PublicPlayer } from '../../../../shared/types';
import { Confetti } from '../../ui/Confetti';
import { Leaderboard } from './Leaderboard';

export function AwardsView({ awards, players }: { awards: Award[]; players: PublicPlayer[] }) {
  const who = (id: string) => players.find(p => p.id === id);
  return (
    <div className="awards-host">
      <Confetti count={60} />
      <h1>Lễ trao giải Chợ Trà Sữa 🏆</h1>
      <div className="awards-host__grid">
        {awards.map((a, i) => (
          <motion.div key={a.id} className={`award-card award-card--${a.id}`}
            initial={{ y: 80, rotate: i % 2 ? 8 : -8, opacity: 0 }} animate={{ y: 0, rotate: i % 2 ? 1.5 : -1.5, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 160, damping: 14, delay: 0.3 + i * 0.35 }}>
            <span className="award-card__emoji" aria-hidden="true">{a.emoji}</span>
            <h2>{a.title}</h2>
            <p className="award-card__who">{who(a.playerId)?.nickname ?? '???'}</p>
            <p className="award-card__shop">{who(a.playerId)?.shopName}</p>
            <p className="award-card__detail">{a.detail}</p>
          </motion.div>
        ))}
      </div>
      <motion.div className="awards-host__board" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.9 }}>
        <Leaderboard players={players} limit={5} />
      </motion.div>
    </div>
  );
}
