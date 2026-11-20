// The end of the run (spec §8 "Màn kết", §9 "Màn kết"): the epilogue (the street recovering) or "Mất hết lòng tin"
// with the shutter coming down and what lost the trust; the score (profit + brand value) with a profit chart by day;
// the player's choices and their lessons; the shops that did not survive and why. Confetti when the five days are
// done. Solo: the personal best and "Chơi lại". Class: the rank and "chờ trao giải" (props), and the reporter card for
// a player who lost early, so everyone gets to vote (§7).
import { motion, useReducedMotion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { CARDS } from '../../../../shared/sim/cards';
import { CONFIG } from '../../../../shared/sim/config';
import { ending, score } from '../../../../shared/sim/run';
import type { Choice, RunState } from '../../../../shared/sim/types';
import { fmtMoney, fmtMoneySigned } from '../../game/format';
import { Button } from '../../ui/Button';
import { Confetti } from '../../ui/Confetti';
import { cx } from '../../ui/cx';
import { CardView } from './CardScreen';
import { choiceLessons, epilogue, exitMoral, shopExits } from './lessons';
import { CountUp } from './ReportScreen';
import { repLabel } from './report';
import { useScrollFade } from './scrollFade';
import './afternoon.css';

export interface EndScreenProps {
  run: RunState;
  mode: 'solo' | 'class';
  /** Solo: the best total on this device before this run was recorded; null when this run is the first. */
  best?: number | null;
  onNewRun?: () => void;
  /** Class mode: the player's rank on the board. */
  rank?: number | null;
  /** Class mode: the awards have not been given yet. */
  awaitingAwards?: boolean;
  /** The reporter card answered on the end screen by a player who lost before day 5 (§7 last line). */
  onReporterVote?: (choice: Choice) => void;
  /** Class mode: reports not delivered yet. Leaving for solo would strand them, so "Chơi lại (solo)" waits. */
  unsent?: number;
}

function ProfitChart({ profits, delay }: { profits: number[]; delay: number }) {
  const reduced = useReducedMotion() ?? false;
  const days = CONFIG.run.dayCount;
  const max = Math.max(1, ...profits.map(Math.abs));
  const neg = profits.some(p => p < 0);
  const H = 110;
  const zero = neg ? H * (max / (2 * max)) : H;
  const scale = neg ? H / (2 * max) : H / max;
  const bw = 34;
  const gap = 18;
  const W = days * bw + (days - 1) * gap;
  return (
    <svg className="pbars" viewBox={`0 -18 ${W} ${H + 40}`} role="img"
      aria-label={`Lãi theo ngày: ${profits.map((p, i) => `ngày ${i + 1} ${fmtMoneySigned(p)}`).join(', ')}`}>
      <line x1={0} x2={W} y1={zero} y2={zero} className="pbars__zero" />
      {Array.from({ length: days }, (_, i) => {
        const p = profits[i];
        const x = i * (bw + gap);
        if (p === undefined) {
          return (
            <g key={i}>
              <rect x={x} y={zero - 6} width={bw} height={6} rx={3} className="pbars__none" />
              <text x={x + bw / 2} y={H + 16} className="pbars__day">N{i + 1}</text>
            </g>
          );
        }
        const h = Math.max(2, Math.abs(p) * scale);
        const y = p >= 0 ? zero - h : zero;
        return (
          <g key={i}>
            <motion.rect x={x} y={y} width={bw} height={h} rx={6} className={p >= 0 ? 'pbars__pos' : 'pbars__neg'}
              style={{ transformOrigin: `${x + bw / 2}px ${zero}px`, transformBox: 'view-box' }}
              initial={reduced ? false : { scaleY: 0 }} animate={{ scaleY: 1 }}
              transition={{ delay: delay + i * 0.15, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }} />
            <text x={x + bw / 2} y={p >= 0 ? y - 5 : y + h + 12} className="pbars__v">{fmtMoneySigned(p)}</text>
            <text x={x + bw / 2} y={H + 16} className="pbars__day">N{i + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** The roller shutter coming down over the shop (the loss). */
function Shutter() {
  const reduced = useReducedMotion() ?? false;
  return (
    <div className="shutter" aria-hidden="true">
      <motion.div className="shutter__door"
        initial={reduced ? false : { y: '-102%' }} animate={{ y: ['-102%', '0%', '-5%', '0%'] }}
        transition={{ duration: 1.35, times: [0, 0.72, 0.86, 1], ease: ['easeIn', 'easeOut', 'easeIn'], delay: 0.3 }}>
        <motion.div className="shutter__sign"
          initial={reduced ? false : { opacity: 0, rotate: -12, scale: 1.6 }} animate={{ opacity: 1, rotate: -5, scale: 1 }}
          transition={{ delay: 1.7, type: 'spring', stiffness: 260, damping: 14 }}>
          ĐÓNG CỬA
        </motion.div>
        <span className="shutter__handle" />
      </motion.div>
      <motion.div className="shutter__dust" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: [0, 0.8, 0] }}
        transition={{ delay: 1.55, duration: 0.9 }} />
    </div>
  );
}

export function EndScreen({ run, mode, best, onNewRun, rank, awaitingAwards, onReporterVote, unsent = 0 }: EndScreenProps) {
  const reduced = useReducedMotion() ?? false;
  const end = useMemo(() => ending(run), [run]);
  const sc = score(run);
  const epi = epilogue(run);
  const lessons = choiceLessons(run);
  const exits = shopExits(run);
  const moral = exitMoral(exits);
  const lost = end.outcome === 'lostTrust';
  const needsVote = lost && run.flags.reporter === null;
  const [vote, setVote] = useState<Choice | null>(null);
  // Only a run that beat the best before it; never a tie, never the first run (nothing to beat).
  const newBest = best != null && sc.total > best;
  // Upgrades and card money move cash but are not in any day's profit (§16 row 13).
  const outside = sc.profit - end.profitByDay.reduce((a, b) => a + b, 0);
  const fadeA = useScrollFade();
  const fadeB = useScrollFade();
  const fadeC = useScrollFade();
  const fadeAll = useScrollFade();

  const exitsSection = (
          <section className="rsec end-exits" aria-label="Quán không trụ được">
            <h3 className="rsec__title"><span aria-hidden="true">🏚️</span> Quán không trụ được</h3>
            {exits.length === 0
              ? <p className="rsec__empty">Không quán nào phải sang nhượng.</p>
              : (
                <ul className="exits">
                  {exits.map(e => (
                    <li key={e.id} className="exit">
                      <span className="exit__sign" aria-hidden="true">SANG NHƯỢNG</span>
                      <b>{e.name}</b> <small>đóng cửa tối ngày {e.closedOn}</small>
                      <span className="exit__why">{e.why}</span>
                    </li>
                  ))}
                </ul>
              )}
            {moral !== null && <p className="exits__moral">{moral}</p>}
          </section>
  );

  return (
    <div className={cx('end', lost ? 'end--lost' : 'end--won')} ref={fadeAll}>
      {!lost && !reduced && <Confetti count={60} />}
      <header className="end__hero panel">
        {lost && <Shutter />}
        <motion.div className="end__hero-in" initial={reduced || !lost ? false : { opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 1.9, duration: 0.4 }}>
          <motion.span className="end__kicker" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: lost ? 2 : 0.2 }}>
            {lost ? `🔒 Hết ván ở ngày ${run.day}` : '🏁 Hết 5 ngày'}
          </motion.span>
          <motion.h2 className="end__title" initial={reduced ? false : { opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: lost ? 2.1 : 0.3, type: 'spring', stiffness: 200, damping: 16 }}>
            {epi.title}
          </motion.h2>
          {epi.lines.map((l, i) => (
            <motion.p key={l} className="end__line" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: (lost ? 2.3 : 0.6) + i * 0.25 }}>{l}</motion.p>
          ))}
        </motion.div>
      </header>

      <div className="end__body">
        <div className="end__col end__col--a" ref={fadeA}>
          <section className="rsec end-score" aria-label="Điểm">
            <h3 className="rsec__title"><span aria-hidden="true">🏆</span> Điểm</h3>
            <div className="end-score__total">
              <CountUp value={sc.total} format={fmtMoney} delay={lost ? 2.4 : 0.6} duration={1.6} className="end-score__n" />
              {mode === 'solo' && newBest && <span className="tag tag--warn end-score__best">Kỷ lục mới!</span>}
            </div>
            <p className="end-score__parts">
              <span>Tổng lãi <b className={sc.profit < 0 ? 'fx--bad' : 'fx--good'}>{fmtMoneySigned(sc.profit)}</b></span>
              <span aria-hidden="true">+</span>
              <span>Thương hiệu <b>{fmtMoney(sc.brand)}</b> <small>({run.rep} uy tín × {CONFIG.run.brandPerRep}k)</small></span>
            </p>
            <ProfitChart profits={end.profitByDay} delay={lost ? 2.6 : 0.8} />
            {outside !== 0 && (
              <p className="end-score__note">
                Cột là lãi từng ngày. Tổng lãi còn tính {fmtMoneySigned(outside)} tiền nâng cấp và tiền từ thẻ,
                vì chúng nằm ngoài lãi ngày.
              </p>
            )}
            {mode === 'solo' && best != null && !newBest && <p className="end-score__record">Kỷ lục của bạn: <b>{fmtMoney(best)}</b></p>}
          </section>

          {lost && (
            <section className="rsec end-losses" aria-label="Những việc đã làm mất lòng tin">
              <h3 className="rsec__title"><span aria-hidden="true">💔</span> Những việc làm mất lòng tin</h3>
              <ol className="replist">
                {end.repLosses.map((i, n) => (
                  <motion.li key={n} className="repitem is-on" initial={reduced ? false : { opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 2.5 + n * 0.08 }}>
                    <span className="fx fx--bad">−{Math.abs(i.delta)}</span>
                    <span className="repitem__label">{repLabel(i)}</span>
                    <small className="repitem__when">ngày {i.day}</small>
                  </motion.li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <div className="end__col end__col--b" ref={fadeB}>
          {lessons.length > 0 && (
            <section className="rsec end-choices" aria-label="Lựa chọn của bạn">
              <h3 className="rsec__title"><span aria-hidden="true">🃏</span> Lựa chọn của bạn và bài học</h3>
              <ul className="choices-sum">
                {lessons.map(l => (
                  <li key={l.key} className={cx('csum', `csum--${l.tone}`)}>
                    <span className="csum__topic">{l.topic}</span>
                    <b className="csum__did">{l.did}</b>
                    <span className="csum__lesson">{l.lesson}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {lost && exits.length > 0 && exitsSection}
        </div>

        {!lost && <div className="end__col end__col--c" ref={fadeC}>{exitsSection}</div>}
        {needsVote && (
          <div className="end__col end__col--c" ref={fadeC}>
            <section className="rsec end-vote" aria-label="Thẻ phóng viên">
              <h3 className="rsec__title"><span aria-hidden="true">🎤</span> Trước khi về, phóng viên hỏi bạn</h3>
              {vote === null
                ? <CardView card={CARDS.reporter} index={0} total={1} day={run.day} inline
                  onChoose={c => { setVote(c); onReporterVote?.(c); }} />
                : <p className="end-vote__done">Đã ghi: {vote === 'A' ? CARDS.reporter.a.label : CARDS.reporter.b.label}. Cảm ơn bạn!</p>}
            </section>
          </div>
        )}
      </div>

      <footer className="end__foot">
        {mode === 'solo'
          ? onNewRun && <Button variant="primary" size="lg" block onClick={onNewRun}>Chơi lại</Button>
          : (
            <>
              <p className="end__wait" role="status">
                {rank != null && <span className="rchip rchip--rank">🏆 Hạng <b>#{rank}</b></span>}
                <span>{awaitingAwards === false ? 'Xem bảng giải trên màn hình lớn!' : 'Chờ thầy cô trao giải…'}</span>
              </p>
              {onNewRun && (
                <Button variant="secondary" size="md" block onClick={onNewRun} disabled={unsent > 0} aria-busy={unsent > 0}>
                  {unsent > 0 ? 'Đang gửi kết quả…' : 'Chơi lại (solo)'}
                </Button>
              )}
            </>
          )}
      </footer>
    </div>
  );
}
