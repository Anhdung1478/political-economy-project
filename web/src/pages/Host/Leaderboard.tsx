import { motion } from 'framer-motion';
import type { PublicPlayer } from '../../../../shared/types';
import { cx } from '../../ui/cx';

const MEDAL = ['🥇', '🥈', '🥉'];

export function Leaderboard({ players, limit, compact }: { players: PublicPlayer[]; limit: number; compact?: boolean }) {
  return (
    <ol className={cx('board', compact && 'board--compact')} aria-label="Bảng xếp hạng">
      {players.slice(0, limit).map(p => (
        <motion.li key={p.id} layout transition={{ type: 'spring', stiffness: 300, damping: 30 }} className={cx('board__row', p.rank <= 3 && `board__row--${p.rank}`)}>
          <span className="board__rank">{MEDAL[p.rank - 1] ?? p.rank}</span>
          <span className="board__name"><b>{p.nickname}</b></span>
          <span className={cx('board__total', p.total < 0 && 'is-loss')}>{p.total}k</span>
        </motion.li>
      ))}
    </ol>
  );
}
