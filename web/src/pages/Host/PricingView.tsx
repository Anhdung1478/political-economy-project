import { motion } from 'framer-motion';
import { GAME, type RoundRule } from '../../../../shared/config';
import type { PublicPlayer } from '../../../../shared/types';
import { Countdown } from '../../ui/Countdown';
import { cx } from '../../ui/cx';

const MAX_TILES = 40;

interface Props { round: RoundRule; players: PublicPlayer[]; deadline: number | null; serverOffset: number }

export function PricingView({ round, players, deadline, serverOffset }: Props) {
  const done = players.filter(p => p.submitted).length;
  const tiles = [...players].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))).slice(0, MAX_TILES);
  return (
    <div className="pricing-host">
      <div className="pricing-host__left">
        <span className="chip">{round.emoji} {round.title}</span>
        <h1>Các chủ quán đang chọn giá…</h1>
        <Countdown deadline={deadline} serverOffset={serverOffset} total={GAME.pricingSeconds} size={240} />
        <p className="pricing-host__count"><b>{done}</b>/{players.length} quán đã chốt giá</p>
        <div className="pricing-host__bar"><motion.span animate={{ width: `${players.length ? (done / players.length) * 100 : 0}%` }} /></div>
      </div>
      <div className="tiles">
        {tiles.map(p => (
          <motion.div key={p.id} className={cx('tile-shop', p.submitted && 'is-in')}
            animate={{ rotateY: p.submitted ? 180 : 0 }} transition={{ type: 'spring', stiffness: 200, damping: 18 }}>
            <span className="tile-shop__front">{p.nickname}</span>
            <span className="tile-shop__back">✅ {p.nickname}</span>
          </motion.div>
        ))}
        {players.length > MAX_TILES && <div className="tile-shop tile-shop--more">+{players.length - MAX_TILES} quán</div>}
      </div>
    </div>
  );
}
