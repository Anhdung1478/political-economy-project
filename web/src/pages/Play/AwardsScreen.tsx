import { motion } from 'framer-motion';
import type { Award, PublicPlayer } from '../../../../shared/types';
import { Confetti } from '../../ui/Confetti';

export function AwardsScreen({ me, awards, players }: { me: PublicPlayer; awards: Award[]; players: PublicPlayer[] }) {
  const mine = awards.filter(a => a.playerId === me.id);
  const name = (id: string) => players.find(p => p.id === id)?.nickname ?? '???';
  return (
    <div className="awards-phone">
      {(me.rank === 1 || mine.length > 0) && <Confetti />}
      <motion.div className="rank-badge" initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 12 }}>
        <small>Hạng</small>
        <b>#{me.rank}</b>
        <small>/ {players.length}</small>
      </motion.div>
      <h1>{me.rank === 1 ? 'Vua trà sữa là bạn! 👑' : me.rank <= 3 ? 'Lên podium rồi! 🎉' : 'Game over — cảm ơn đã chơi!'}</h1>
      <p className="play__sub">Tổng lãi của <b>{me.nickname}</b>: <b>{me.total}k</b></p>

      <div className="award-list">
        {awards.map((a, i) => (
          <motion.div key={a.id} className={a.playerId === me.id ? 'award-row is-me' : 'award-row'}
            initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.3 + i * 0.12 }}>
            <span className="award-row__emoji" aria-hidden="true">{a.emoji}</span>
            <span><b>{a.title}</b><small>{name(a.playerId)} · {a.detail}</small></span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
