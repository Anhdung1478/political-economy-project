// The evening report (spec §8 "Báo cáo tối", §9 "Báo cáo"): the day's money, customers, reputation, the street and
// the lesson card, every number from the day's `DayReport`. Numbers count up, the money bars grow, every shop's price
// line draws itself from open to close, and the reputation meter steps through each item with its reason.
import { animate, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CONFIG } from '../../../../shared/sim/config';
import type { DayReport, RunState, ShopId } from '../../../../shared/sim/types';
import { fmtMoney, fmtMoneySigned, fmtNumber } from '../../game/format';
import type { Intent } from '../../game/runStore';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { InvisibleHand, VisibleHand } from '../../ui/Hands';
import { SHOP_ICONS, TEA_NAMES, themeTitle } from './copy';
import { lessonText, type LessonText } from './lessons';
import {
  STREET_TAG_TEXT, cashBefore, customerRows, meterValue, moneyRows, priceScale, repSteps, rowMoney, skimpTrade, streetRows,
  trailPath, type StreetRow,
} from './report';
import { useScrollFade } from './scrollFade';
import './afternoon.css';

type Dispatch = (i: Intent) => void;

// ── Count-up ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A number that runs up to `value` (written straight into the DOM, no re-render per frame). */
export function CountUp({ value, format = n => fmtNumber(n), delay = 0, duration = 1.1, from = 0, className }: {
  value: number; format?: (n: number) => string; delay?: number; duration?: number; from?: number; className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion() ?? false;
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (reduced || from === value) {
      el.textContent = format(value);
      return;
    }
    el.textContent = format(from);
    const c = animate(from, value, {
      duration, delay, ease: [0.2, 0.8, 0.2, 1],
      // money stays on 0.5k steps while it runs
      onUpdate: v => { el.textContent = format(Math.round(v * 2) / 2); },
      onComplete: () => { el.textContent = format(value); },
    });
    return () => c.stop();
    // the format is a fresh closure each render; the value is what matters
  }, [value, delay, duration, from, reduced]);
  return <span ref={ref} className={className} aria-label={format(value)}>{format(reduced ? value : from)}</span>;
}

// ── Sections ────────────────────────────────────────────────────────────────────────────────────────────────────────

function Section({ title, icon, children, className, delay = 0 }: {
  title: string; icon: string; children: ReactNode; className?: string; delay?: number;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.section className={cx('rsec', className)} aria-label={title}
      initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}>
      <h3 className="rsec__title"><span aria-hidden="true">{icon}</span> {title}</h3>
      {children}
    </motion.section>
  );
}

function MoneySection({ r, delay }: { r: DayReport; delay: number }) {
  const rows = moneyRows(r);
  const inside = rows.filter(x => x.kind !== 'out');
  const outside = rows.filter(x => x.kind === 'out');
  const scale = Math.max(1, ...rows.map(x => Math.abs(x.value)), Math.abs(r.summary.profit));
  const reduced = useReducedMotion() ?? false;
  const before = cashBefore(r);
  const bar = (v: number, i: number) => (
    <span className="mrow__track" aria-hidden="true">
      <motion.span className={cx('mrow__bar', v >= 0 ? 'is-pos' : 'is-neg')}
        style={{ width: `${Math.max(2, (Math.abs(v) / scale) * 100)}%` }}
        initial={reduced ? false : { scaleX: 0 }} animate={{ scaleX: 1 }}
        transition={{ delay: delay + 0.25 + i * 0.12, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }} />
    </span>
  );
  return (
    <Section title="Tiền" icon="💰" delay={delay} className="rsec--money">
      <ul className="mrows">
        {inside.map((x, i) => (
          <li key={x.key} className={cx('mrow', x.kind === 'note' && 'mrow--note')}>
            <span className="mrow__label">{x.label}{x.hint && <small>{x.hint}</small>}</span>
            {bar(x.value, i)}
            <b className={cx('mrow__val', x.value < 0 ? 'fx--bad' : 'fx--good')}>
              <CountUp value={x.value} format={rowMoney} delay={delay + 0.25 + i * 0.12} duration={0.8} />
            </b>
          </li>
        ))}
        <li className="mrow mrow--total">
          <span className="mrow__label">Lãi ngày</span>
          {bar(r.summary.profit, inside.length)}
          <b className={cx('mrow__val', r.summary.profit < 0 ? 'fx--bad' : 'fx--good')}>
            <CountUp value={r.summary.profit} format={fmtMoneySigned} delay={delay + 0.3 + inside.length * 0.12} />
          </b>
        </li>
      </ul>
      {outside.length > 0 && (
        <ul className="mrows mrows--out" aria-label="Ngoài lãi ngày">
          <li className="mrows__cap">Ngoài lãi ngày</li>
          {outside.map(x => (
            <li key={x.key} className="mrow mrow--out">
              <span className="mrow__label">{x.label}</span>
              <b className={cx('mrow__val', x.value < 0 ? 'fx--bad' : 'fx--good')}>{rowMoney(x.value)}</b>
            </li>
          ))}
        </ul>
      )}
      <p className="cashline">
        Tiền trong két <b>{fmtMoney(before)}</b> <span aria-hidden="true">→</span>{' '}
        <b className={r.summary.cash < 0 ? 'fx--bad' : ''}>
          <CountUp value={r.summary.cash} from={before} format={fmtMoney} delay={delay + 1} />
        </b>
      </p>
    </Section>
  );
}

const CUSTOMER_ICONS = { served: '🙂', wrong: '❓', walkouts: '⌛', missed: '📭' } as const;

function CustomerSection({ r, delay }: { r: DayReport; delay: number }) {
  return (
    <Section title="Khách" icon="👥" delay={delay} className="rsec--customers">
      <ul className="ctiles">
        {customerRows(r).map((c, i) => (
          <li key={c.key} className={cx('ctile', c.value > 0 && `ctile--${c.tone}`)}>
            <span className="ctile__icon" aria-hidden="true">{CUSTOMER_ICONS[c.key]}</span>
            <b className="ctile__n"><CountUp value={c.value} delay={delay + 0.2 + i * 0.1} duration={0.8} /></b>
            <span className="ctile__label">{c.label}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function RepSection({ r, delay }: { r: DayReport; delay: number }) {
  const steps = useMemo(() => repSteps(r), [r]);
  const reduced = useReducedMotion() ?? false;
  const [shown, setShown] = useState(reduced ? steps.length : 0);
  useEffect(() => {
    if (reduced || steps.length === 0) { setShown(steps.length); return undefined; }
    let n = 0;
    let t = window.setTimeout(function tick() {
      n += 1;
      setShown(n);
      if (n < steps.length) t = window.setTimeout(tick, 520);
    }, (delay + 0.5) * 1000);
    return () => window.clearTimeout(t);
  }, [steps, delay, reduced]);
  const value = meterValue(steps, shown, r.repBefore);
  const trade = skimpTrade(r);
  return (
    <Section title="Uy tín" icon="⭐" delay={delay} className="rsec--rep">
      <div className="repmeter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.summary.rep}
        aria-label={`Uy tín ${r.repBefore} thành ${r.summary.rep}`}>
        <span className="repmeter__track">
          <motion.span className="repmeter__fill" animate={{ width: `${value}%` }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 22 }} />
          <span className="repmeter__ghost" style={{ left: `${r.repBefore}%` }} aria-hidden="true" />
        </span>
        <span className="repmeter__nums">
          <span>{r.repBefore}</span>
          <span aria-hidden="true">→</span>
          <motion.b key={value} initial={reduced ? false : { scale: 1.35 }} animate={{ scale: 1 }}
            className={cx(value < r.repBefore ? 'fx--bad' : value > r.repBefore ? 'fx--good' : undefined)}>{value}</motion.b>
        </span>
      </div>
      {steps.length === 0
        ? <p className="rsec__empty">Hôm nay uy tín không đổi.</p>
        : (
          <ol className="replist">
            {steps.map((s, i) => (
              <motion.li key={`${s.label}-${i}`} className={cx('repitem', i < shown ? 'is-on' : 'is-off', i === shown - 1 && 'is-now')}
                animate={{ opacity: i < shown ? 1 : 0.35 }}>
                <span className={cx('fx', s.delta < 0 ? 'fx--bad' : 'fx--good')}>{s.delta > 0 ? '+' : '−'}{Math.abs(s.delta)}</span>
                <span className="repitem__label">{s.label}</span>
                <small className="repitem__when">{s.when === 'morning' ? 'sáng' : 'tối'}</small>
              </motion.li>
            ))}
          </ol>
        )}
      {trade !== null && (
        <p className="skimp-note">
          <b>Trà {TEA_NAMES.skimp.toLowerCase()}:</b> đỡ được {fmtMoney(trade.saved)} tiền trà, đổi lại −{Math.abs(trade.rep)} uy tín,
          tức mất khoảng {fmtMoney(-trade.brand)} giá trị thương hiệu cuối ván.
        </p>
      )}
    </Section>
  );
}

export const SHOP_COLORS: Record<ShopId, string> = {
  player: '#c9772a', batu: '#a9714b', giare: '#de4f5a', cochap: '#6e5b4d', luotsong: '#3f84c2', sinhvien: '#8c6bb8',
  tapdoan: '#2f3b52',
};

function StreetSection({ r, run, delay }: { r: DayReport; run: RunState; delay: number }) {
  const rows = useMemo(() => streetRows(r, run.shops), [r, run.shops]);
  const reduced = useReducedMotion() ?? false;
  const selling = rows.filter(x => x.trail.length > 0);
  const ceiling = CONFIG.days[r.summary.day].ceiling;
  const scale = priceScale(ceiling === null ? rows : [...rows, { trail: [[0, ceiling]] } as unknown as StreetRow]);
  const W = 300;
  const H = 120;
  const y = (p: number) => H - ((p - scale.lo) / (scale.hi - scale.lo)) * H;
  const mid = CONFIG.rumor.inspectionTick / CONFIG.rush.ticks;
  return (
    <Section title="Phố hôm nay" icon="🏪" delay={delay} className="rsec--street">
      <div className="pchart">
        <svg viewBox={`-26 -8 ${W + 34} ${H + 26}`} className="pchart__svg" role="img"
          aria-label={`Đường giá của ${selling.length} quán từ mở cửa tới đóng cửa`}>
          {[scale.lo, Math.round((scale.lo + scale.hi) / 2), scale.hi].map(p => (
            <g key={p}>
              <line x1={0} x2={W} y1={y(p)} y2={y(p)} className="pchart__grid" />
              <text x={-5} y={y(p) + 3.5} className="pchart__y">{p}k</text>
            </g>
          ))}
          {ceiling !== null && (
            <g>
              <line x1={0} x2={W} y1={y(ceiling)} y2={y(ceiling)} className="pchart__ceiling" />
              <text x={W} y={y(ceiling) - 4} className="pchart__ceiling-t">Trần {ceiling}k</text>
            </g>
          )}
          <text x={0} y={H + 15} className="pchart__x">Mở cửa</text>
          <text x={W * mid} y={H + 15} className="pchart__x" textAnchor="middle">
            Giây {Math.round((CONFIG.rumor.inspectionTick * CONFIG.rush.tickMs) / 1000)}
          </text>
          <text x={W} y={H + 15} className="pchart__x" textAnchor="end">Đóng cửa</text>
          {selling.map((row, i) => (
            <motion.path key={row.id} d={trailPath(row.trail, scale, W, H)}
              className={cx('pchart__line', row.id === 'player' && 'is-player')}
              stroke={SHOP_COLORS[row.id]}
              transform={`translate(0 ${(i - selling.length / 2) * 0.9})`}
              initial={reduced ? false : { pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
              transition={{ delay: delay + 0.3 + i * 0.18, duration: 1.1, ease: 'easeInOut' }} />
          ))}
        </svg>
      </div>
      <ul className="srows">
        {rows.map(row => (
          <li key={row.id} className={cx('srow', row.id === 'player' && 'srow--player', row.trail.length === 0 && 'srow--off')}>
            <span className="srow__dot" style={{ background: SHOP_COLORS[row.id] }} aria-hidden="true" />
            <span className="srow__name"><span aria-hidden="true">{SHOP_ICONS[row.id]}</span> {row.name}</span>
            <span className="srow__price">
              {row.open === null ? '—' : row.open === row.close ? fmtMoney(row.open) : `${fmtMoney(row.open)} → ${fmtMoney(row.close ?? row.open)}`}
            </span>
            <span className="srow__sold">{row.trail.length === 0 ? '' : `${row.sold} ly`}</span>
            <span className="srow__tags">
              {row.tags.map(t => (
                <span key={t} className={cx('tag', t === 'soldOut' ? 'tag--good' : t === 'new' ? 'tag--info' : t === 'resting' ? 'tag--warn' : 'tag--bad')}>
                  {STREET_TAG_TEXT[t]}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {(r.emptyHanded > 0 || ceiling !== null) && (
        <p className={cx('empty-line', ceiling !== null && 'empty-line--hot')}>
          <span aria-hidden="true">🚶</span> <b><CountUp value={r.emptyHanded} delay={delay + 1} /></b> khách về tay không
          {r.eligible > 0 && <> trong {r.eligible} khách đủ tiền mua</>}.
        </p>
      )}
    </Section>
  );
}

export function LessonCard({ lesson, day, delay = 0 }: { lesson: LessonText; day: number; delay?: number }) {
  const reduced = useReducedMotion() ?? false;
  const Hand = lesson.hand === 'invisible' ? InvisibleHand : VisibleHand;
  return (
    <motion.section className={cx('lesson', `lesson--${lesson.hand}`)} aria-labelledby={`lesson-${day}`}
      initial={reduced ? false : { opacity: 0, rotate: -2.5, y: 24 }} animate={{ opacity: 1, rotate: 0, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 160, damping: 18 }}>
      <div className="lesson__head">
        <Hand size={46} float={!reduced} className="lesson__hand" />
        <div>
          <span className="lesson__kicker">Bài học ngày {day} · {lesson.kicker}</span>
          <h3 className="lesson__title" id={`lesson-${day}`}>{lesson.title}</h3>
        </div>
      </div>
      <ul className="lesson__stats">
        {lesson.stats.map(s => (
          <li key={s.label} className={cx('lstat', s.tone && `lstat--${s.tone}`)}>
            <small>{s.label}</small><b>{s.value}</b>
          </li>
        ))}
      </ul>
      {lesson.story.map(p => <p key={p} className="lesson__p">{p}</p>)}
      <p className="lesson__moral">{lesson.moral}</p>
    </motion.section>
  );
}

// ── The screen ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReportScreenProps {
  run: RunState;
  dispatch: Dispatch;
  /** Class mode: the player's rank among those who finished this day. */
  rank?: { rank: number; of?: number } | null;
}

export function ReportScreen({ run, dispatch, rank }: ReportScreenProps) {
  const r = run.reports.find(x => x.summary.day === run.day);
  const lesson = useMemo(() => (r === undefined ? null : lessonText(r, run)), [r, run]);
  const lessonRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [lessonSeen, setLessonSeen] = useState(false);
  const fadeA = useScrollFade();
  const fadeB = useScrollFade();
  const fadeC = useScrollFade();
  useEffect(() => {
    const el = lessonRef.current;
    if (el === null || typeof IntersectionObserver === 'undefined') { setLessonSeen(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setLessonSeen(true); },
      { root: bodyRef.current, threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  if (r === undefined || lesson === null) return null;
  const s = r.summary;
  const last = run.outcome === 'lostTrust' || run.day >= CONFIG.run.dayCount;
  const theme = themeTitle(CONFIG.days[s.day].theme, { day: s.day, ceiling: CONFIG.days[s.day].ceiling,
    taxPerCup: CONFIG.days[s.day].taxPerCup, rumor: CONFIG.days[s.day].rumor, cartel: false, customerFactor: 1 });
  const next = () => {
    if (!lessonSeen && lessonRef.current !== null) {
      lessonRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setLessonSeen(true);
      return;
    }
    dispatch({ type: 'nextDay' });
  };
  const nextLabel = !lessonSeen ? 'Đọc bài học hôm nay ↓'
    : run.outcome === 'lostTrust' ? 'Đóng cửa quán…' : last ? 'Xem kết ván' : `Sang ngày ${s.day + 1}`;

  return (
    <div className="report" data-report-day={s.day}>
      <header className="report__head panel">
        <div className="report__title">
          <span className="report__kicker">🌙 Tối ngày {s.day} · {theme}</span>
          <h2 className="report__h">
            Lãi ngày{' '}
            <CountUp value={s.profit} format={fmtMoneySigned} delay={0.2} duration={1.3}
              className={cx('report__profit', s.profit < 0 ? 'fx--bad' : 'fx--good')} />
          </h2>
        </div>
        <div className="report__chips">
          <span className="rchip">💰 <b>{fmtMoney(s.cash)}</b></span>
          <span className={cx('rchip', s.rep < r.repBefore && 'rchip--bad')}>⭐ {r.repBefore} → <b>{s.rep}</b></span>
          <span className="rchip">🥤 <b>{s.cups}</b> ly</span>
          {rank != null && <span className="rchip rchip--rank">🏆 Hạng <b>#{rank.rank}</b>{rank.of != null && <> / {rank.of}</>}</span>}
        </div>
        {s.lost && <p className="report__lost" role="alert">Uy tín về 0: khách không còn tin quán nữa.</p>}
      </header>
      <div className="report__body" ref={bodyRef}>
        <div className="report__col report__col--a" ref={fadeA}>
          <MoneySection r={r} delay={0.15} />
          <CustomerSection r={r} delay={0.3} />
        </div>
        <div className="report__col report__col--b" ref={fadeB}>
          <RepSection r={r} delay={0.45} />
          <StreetSection r={r} run={run} delay={0.6} />
        </div>
        <div className="report__col report__col--c" ref={el => { lessonRef.current = el; fadeC(el); }}>
          <LessonCard lesson={lesson} day={s.day} delay={0.8} />
        </div>
      </div>
      <footer className="report__foot">
        <Button variant={run.outcome === 'lostTrust' ? 'danger' : 'primary'} size="lg" block onClick={next}
          className="report__next">{nextLabel}</Button>
      </footer>
    </div>
  );
}
