import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { EMOJIS, GAME, type Emoji, type RoundRule } from '../../../../shared/config';
import type { PublicPlayer, RoundResult } from '../../../../shared/types';
import { fmtK, fmtProfit } from '../../game/format';
import { api } from '../../net/socket';
import { cx } from '../../ui/cx';

interface Props { round: RoundRule; result: RoundResult; me: PublicPlayer; total: number }

export function RevealScreen({ round, result, me, total }: Props) {
  const mine = result.shops.find(s => s.playerId === me.id);
  const [bursts, setBursts] = useState<{ id: number; emoji: Emoji; x: number }[]>([]);

  const send = (emoji: Emoji) => {
    api.emoji(emoji);
    const id = Date.now() + Math.random();
    setBursts(b => [...b.slice(-12), { id, emoji, x: (Math.random() - 0.5) * 80 }]);
    setTimeout(() => setBursts(b => b.filter(x => x.id !== id)), 1100);
  };

  return (
    <div className="reveal">
      {mine ? (
        <>
          <div className="reveal__head">
            <span className="chip">Vòng {result.roundIndex + 1} · bán giá {fmtK(mine.price)}</span>
            <motion.h1 className={cx('reveal__profit', mine.profit < 0 && 'is-loss')}
              initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 12, delay: 0.2 }}>
              {fmtProfit(mine.profit)}
            </motion.h1>
            <p className="play__sub">{verdict(mine.sold, mine.profit)}</p>
          </div>
          <div className="cups" aria-label={`Bán được ${mine.sold}/${GAME.capacity} ly`}>
            {Array.from({ length: GAME.capacity }, (_, i) => (
              <motion.span key={i} className={cx('cup', i < mine.sold && 'is-sold')}
                initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35 + i * 0.06 }}>
                🥤
              </motion.span>
            ))}
          </div>
          <p className="cups__label"><b>{mine.sold}</b>/{GAME.capacity} ly đã bán · hạng <b>{me.rank}</b>/{total}</p>
          <p className="cups__label">🎯 Giá tối ưu vòng này: <b>{fmtK(result.optimalPrice)}</b> · trung bình chợ {fmtK(result.avgPrice)}</p>
        </>
      ) : (
        <div className="reveal__head"><h1>Bạn vào muộn 😅</h1><p className="play__sub">Vòng sau mới tính quán của bạn.</p></div>
      )}

      <div className="lesson">
        <span aria-hidden="true">{round.emoji}</span>
        <p>{round.lesson}</p>
      </div>

      <div className="emoji-bar" aria-label="Thả cảm xúc lên màn chiếu">
        <AnimatePresence>
          {bursts.map(b => (
            <motion.span key={b.id} className="emoji-bar__burst" aria-hidden="true"
              initial={{ y: 0, x: b.x, opacity: 1, scale: 0.6 }} animate={{ y: -140, opacity: 0, scale: 1.4 }}
              exit={{ opacity: 0 }} transition={{ duration: 1 }}>
              {b.emoji}
            </motion.span>
          ))}
        </AnimatePresence>
        {EMOJIS.map(e => (
          <button key={e} type="button" className="emoji-bar__btn" onClick={() => send(e)} aria-label={`Thả ${e}`}>{e}</button>
        ))}
      </div>
    </div>
  );
}

function verdict(sold: number, profit: number): string {
  if (sold === 0) return 'Không ai ghé quán. Chủ quán ngồi khóc một mình 😭';
  if (profit < 0) return 'Bán đắt hàng mà vẫn lỗ — đúng là mạnh thường quân 😇';
  if (sold === GAME.capacity) return 'Cháy hàng! Quán đông như kiến 🔥';
  return 'Có lãi, nhưng còn ly ế. Vòng sau tính lại nhé 🤔';
}
