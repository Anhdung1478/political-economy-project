// The awards on the projector (spec §11 "Giải"): the four awards with the winner and what won it, then the top 5.
// Frozen when the host pressed Trao giải; an award nobody qualified for says so.
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { AWARDS, type AwardsResult } from '../../../../shared/protocol';
import { fmtMoney } from '../../game/format';
import { Confetti } from '../../ui/Confetti';
import { awardDetail } from './hostFormat';

const MEDALS = ['🥇', '🥈', '🥉'];
/** A few bursts while the class looks at the awards, then quiet. */
const BURSTS = 4;
const BURST_EVERY_MS = 5000;

export function AwardsView({ awards }: { awards: AwardsResult }) {
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (burst >= BURSTS - 1) return;
    const t = setTimeout(() => setBurst(b => b + 1), BURST_EVERY_MS);
    return () => clearTimeout(t);
  }, [burst]);
  return (
    <div className="proj-awards">
      <Confetti key={burst} count={60} />
      <h1 className="proj-awards__title">Trao giải Phố Trà Sữa</h1>
      <div className="proj-awards__grid">
        {AWARDS.map((info, i) => {
          const a = awards.awards.find(x => x.id === info.id);
          return (
            <motion.article key={info.id} className={`award card${a ? '' : ' award--none'}`}
              initial={{ y: 40, opacity: 0, rotate: i % 2 ? 2 : -2 }} animate={{ y: 0, opacity: 1, rotate: 0 }}
              transition={{ delay: 0.25 + i * 0.35, type: 'spring', stiffness: 220, damping: 20 }}>
              <span className="award__emoji" aria-hidden="true">{info.emoji}</span>
              <h2>{info.title}</h2>
              {a ? <>
                <p className="award__name">{a.name}</p>
                <p className="award__detail">{awardDetail(a)}</p>
              </> : <p className="award__detail">Chưa ai đủ điều kiện</p>}
            </motion.article>
          );
        })}
      </div>
      {awards.top.length > 0 && (
        <motion.ol className="proj-top card" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 + AWARDS.length * 0.35 }}>
          <li className="proj-top__head">Top 5 theo điểm</li>
          {awards.top.map(t => (
            <li key={t.playerId} className="proj-top__row">
              <span className="proj-top__rank">{MEDALS[t.rank - 1] ?? `#${t.rank}`}</span>
              <span className="proj-top__name">{t.name}</span>
              <span className="proj-top__score">{fmtMoney(t.score)}</span>
            </li>
          ))}
        </motion.ol>
      )}
    </div>
  );
}
