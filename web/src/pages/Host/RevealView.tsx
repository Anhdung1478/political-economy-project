import { motion } from 'framer-motion';
import { GAME, type RoundRule } from '../../../../shared/config';
import type { PublicPlayer, RoundResult, ShopResult } from '../../../../shared/types';
import { fmtK, fmtProfit } from '../../game/format';
import { cx } from '../../ui/cx';
import { commentary } from './commentary';
import { Leaderboard } from './Leaderboard';

const MAX_ROWS = 8;

/** 🥄 skimped this round · 😬 capped by lost reputation · 💛 loyal fans bought. */
const badges = (s: ShopResult, round: RoundRule) => [
  s.cost < round.cost && '🥄',
  s.capacity < GAME.capacity && '😬',
  s.loyal > 0 && '💛',
].filter(Boolean).join(' ');

/** Up to `n` shops spread evenly over the price order, so cheap sell-outs and pricey flops both show. */
function sample(shops: ShopResult[], n: number): ShopResult[] {
  const sorted = [...shops].sort((a, b) => a.price - b.price || b.sold - a.sold);
  if (sorted.length <= n) return sorted;
  return Array.from({ length: n }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / (n - 1))]);
}

export function RevealView({ round, result, players }: { round: RoundRule; result: RoundResult; players: PublicPlayer[] }) {
  const rows = sample(result.shops, MAX_ROWS);
  const nameOf = (id: string) => players.find(p => p.id === id)?.nickname ?? '…';
  const lines = commentary(result, players, round);

  return (
    <div className="reveal-host">
      <section className="market card" aria-label="Kết quả chợ">
        <header className="market__head">
          <h2>Khách đi từ quán rẻ nhất →</h2>
          {result.shops.length > MAX_ROWS && <span className="chip">{MAX_ROWS}/{result.shops.length} quán tiêu biểu</span>}
        </header>
        <ol className="market__rows">
          {rows.map((s, i) => (
            <motion.li key={s.playerId} className={cx('market__row', s.sold === 0 && 'is-flop')}
              initial={{ x: -30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: i * 0.08 }}>
              <span className="market__price">{fmtK(s.price)}</span>
              <span className="market__name">{nameOf(s.playerId)} {badges(s, round)}</span>
              <span className="market__cups" aria-label={`${s.sold} ly`}>
                {Array.from({ length: GAME.capacity }, (_, c) => (
                  <motion.i key={c} className={c < s.sold ? 'is-sold' : undefined}
                    initial={{ scale: 0.3, opacity: 0.2 }} animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.5 + i * 0.22 + c * 0.03, type: 'spring', stiffness: 500, damping: 18 }} />
                ))}
              </span>
              <motion.span className={cx('market__profit', s.profit < 0 && 'is-loss')}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 + i * 0.22 }}>
                {s.sold === 0 ? '😭 ế' : fmtProfit(s.profit)}
              </motion.span>
            </motion.li>
          ))}
        </ol>
      </section>

      <div className="reveal-host__side">
        <div className="stats">
          <Stat tone="matcha" label="Giá tối ưu vòng này" value={`🎯 ${fmtK(result.optimalPrice)}`} />
          <Stat label="Giá trung bình" value={fmtK(result.avgPrice)} />
          <Stat label="Khách mua được" value={`${result.served}/${result.customers}`} />
          {result.unserved > 0 && <Stat tone="strawberry" label="Xếp hàng mà không mua được" value={`😤 ${result.unserved}`} />}
          {result.pricedOut > 0 && <Stat label="Chê đắt, bỏ về" value={`💸 ${result.pricedOut}`} />}
          {result.taxCollected > 0 && <Stat tone="caramel" label="Nhà nước thu thuế" value={`🏛️ ${fmtK(result.taxCollected)}`} />}
        </div>
        <p className="legend-host">🥄 ăn bớt nguyên liệu · 😬 mất uy tín, bán ít ly hơn · 💛 có khách quen</p>
        <motion.div className="lesson-host" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 1.6 }}>
          <span aria-hidden="true">💡</span><p>{round.lesson}</p>
        </motion.div>
        <ul className="ticker">
          {lines.map((l, i) => (
            <motion.li key={l} initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 2 + i * 0.5 }}>{l}</motion.li>
          ))}
        </ul>
        <Leaderboard players={players} limit={3} compact />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'strawberry' | 'caramel' | 'matcha' }) {
  return (
    <div className={cx('stat-host', tone && `stat-host--${tone}`)}>
      <b>{value}</b><small>{label}</small>
    </div>
  );
}
