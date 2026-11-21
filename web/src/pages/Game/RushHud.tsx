// The rush's top bar (spec §6, §9): the 90-second countdown, cash counting up as the coins land, rep, cups sold, the
// stock with low-stock warnings, the price with its one change ("Đổi giá (1 lần)") and "Đóng cửa sớm". Also the
// price-change dialog: the new price's honest consequences before it is confirmed (R20).
import { memo, useEffect, useRef, useState } from 'react';
import { CONFIG } from '../../../../shared/sim/config';
import { orderPrice } from '../../../../shared/sim/rush';
import type { K, Stock } from '../../../../shared/sim/types';
import { fmtCountdown, fmtMoney, secondsLeft } from '../../game/format';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Modal } from '../../ui/Modal';
import { hudMoney, repTip, TOPPING_NAMES } from './copy';
import { Stepper } from './controls';
import { SizeIcon, ToppingIcon } from './CounterCustomer';
import { priceRange } from './morning';
import { fmtMl, priceImpact, priceLines, stockView, TOPPINGS } from './rush';
import { StatTip } from './StatTip';

/** A number that runs up (or down) to its value, `delay` ms after it changes (so the coins land first). */
export function CountUp({ value, format, delay = 0, onBump }: {
  value: number; format: (v: number) => string; delay?: number; onBump?: () => void;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const cur = useRef(value);
  useEffect(() => {
    if (value === cur.current) return;
    from.current = cur.current;
    let raf = 0;
    let start = 0;
    const dur = 520;
    const t = window.setTimeout(() => {
      onBump?.();
      const frame = (now: number) => {
        if (start === 0) start = now;
        const k = Math.min(1, (now - start) / dur);
        const e = 1 - (1 - k) ** 3;
        cur.current = from.current + (value - from.current) * e;
        setShown(k >= 1 ? value : Math.round(cur.current * 2) / 2);
        if (k < 1) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }, delay);
    return () => {
      window.clearTimeout(t);
      cancelAnimationFrame(raf);
      cur.current = value;
      setShown(value);
    };
  }, [value]);
  return <>{format(shown)}</>;
}

export interface RushHudProps {
  ticksLeft: number;
  cash: K;
  rep: number;
  cups: number;
  stock: Stock;
  price: K;
  priceChanged: boolean;
  closed: boolean;
  /** The clock is not running yet (the practice cup). */
  waiting: boolean;
  cashRef: React.RefObject<HTMLSpanElement | null>;
  onPrice: () => void;
  onClose: () => void;
}

/** "Đóng cửa sớm". Drawn in the stock row upright and on desktop, in the first row on a phone on its side (CSS shows
 *  one of the two). */
function ShutButton({ disabled, onClick, top }: { disabled: boolean; onClick: () => void; top?: boolean }) {
  return (
    <button type="button" className={cx('rhud__shut', top && 'rhud__shut--top')} onClick={onClick} disabled={disabled}
      aria-label="Đóng cửa sớm" title="Đóng cửa sớm">
      <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
        <rect x={3} y={4} width={18} height={16} rx={2} fill="none" stroke="currentColor" strokeWidth={2} />
        <path d="M3 9 H21 M3 13 H21 M3 17 H21" stroke="currentColor" strokeWidth={1.6} />
      </svg>
      <span>Đóng cửa sớm</span>
    </button>
  );
}

function RushHudView(p: RushHudProps) {
  const secs = secondsLeft(p.ticksLeft);
  const urgent = secs <= 10 && !p.waiting && p.ticksLeft > 0;
  const sv = stockView(p.stock);
  const [bump, setBump] = useState(0);
  return (
    <header className="rhud" aria-label="Giờ bán trưa">
      <div className="rhud__row">
        <div className={cx('rhud__clock', urgent && 'is-urgent', p.waiting && 'is-waiting')} role="timer"
          aria-label={`Còn ${secs} giây`}>
          <svg className="rhud__dial" viewBox="0 0 36 36" aria-hidden="true">
            <circle cx={18} cy={18} r={15} className="rhud__dial-track" />
            <circle cx={18} cy={18} r={15} className="rhud__dial-fill" pathLength={100}
              strokeDasharray="100" strokeDashoffset={(100 * (1 - p.ticksLeft / CONFIG.rush.ticks)).toFixed(2)}
              transform="rotate(-90 18 18)" />
          </svg>
          <b key={urgent ? secs : 'n'}>{fmtCountdown(secs)}</b>
        </div>
        <span className="rhud__stat rhud__cash" aria-label={`Tiền ${hudMoney(p.cash)}`}>
          {bump > 0 && <span key={bump} className="rhud__glint" aria-hidden="true" />}
          <span aria-hidden="true" className="rhud__coin" />
          <b ref={p.cashRef}><CountUp value={p.cash} format={hudMoney} delay={560} onBump={() => setBump(b => b + 1)} /></b>
        </span>
        <StatTip className="rhud__stat" label={`Uy tín ${p.rep}`} tip={repTip()}><span aria-hidden="true">⭐</span><b>{p.rep}</b></StatTip>
        <span className="rhud__stat rhud__cups" aria-label={`Đã bán ${p.cups} ly`}><SizeIcon size="M" px={18} /><b>{p.cups}</b><small>ly</small></span>
        <span className="rhud__spacer" />
        <button type="button" className={cx('rhud__price', p.priceChanged && 'is-used')} onClick={p.onPrice}
          disabled={p.closed || p.waiting} aria-label={`Giá ly M ${fmtMoney(p.price)}. ${p.priceChanged ? 'Đã đổi giá' : 'Đổi giá, một lần'}`}>
          <span className="rhud__price-tag"><small>Ly M</small><b key={p.price}>{fmtMoney(p.price)}</b></span>
          <span className="rhud__price-act">{p.priceChanged ? 'Đã đổi' : 'Đổi giá (1 lần)'}</span>
        </button>
        <ShutButton disabled={p.closed || p.waiting} onClick={p.onClose} top />
      </div>
      <div className="rhud__stock" aria-label="Kho hàng">
        <span className={cx('rstock rstock--tea', `is-${sv.tea}`)} title={`Trà còn ${fmtMl(sv.teaMl)} (khoảng ${sv.teaCups} ly M)`}>
          <span className="rstock__gauge" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.min(1, sv.teaMl / 6000).toFixed(3)})` }} />
          </span>
          <b>{fmtMl(sv.teaMl)}</b>
          <small>{sv.tea === 'out' ? 'hết trà!' : `~${sv.teaCups} ly M`}</small>
        </span>
        {TOPPINGS.map(t => (
          <span key={t} className={cx('rstock', `is-${sv.toppings[t].level}`)} title={`${TOPPING_NAMES[t]} còn ${sv.toppings[t].n} phần`}>
            <ToppingIcon id={t} size={15} />
            <b>{sv.toppings[t].n}</b>
          </span>
        ))}
        <span className="rhud__spacer" />
        <ShutButton disabled={p.closed || p.waiting} onClick={p.onClose} />
      </div>
    </header>
  );
}

export const RushHud = memo(RushHudView);

// ── Price dialog ────────────────────────────────────────────────────────────────────────────────────────────────────

function PriceDialogView({ open, morning, current, used, ceiling, onCancel, onConfirm }: {
  open: boolean; morning: K; current: K; used: boolean; ceiling: K | null;
  onCancel: () => void; onConfirm: (price: K) => void;
}) {
  const range = priceRange(ceiling);
  const [next, setNext] = useState(current);
  useEffect(() => { if (open) setNext(current); }, [open, current]);
  const impact = priceImpact(morning, current, next, used, ceiling);
  const lines = priceLines(impact);
  const sign = impact.pct > 0 ? '+' : impact.pct < 0 ? '−' : '±';
  return (
    <Modal open={open} title="Đổi giá giữa trưa" onClose={onCancel}
      actions={(<>
        <Button variant="ghost" onClick={onCancel}>Huỷ</Button>
        <Button variant={impact.kind === 'gouge' || impact.kind === 'steep' ? 'danger' : 'primary'} disabled={!impact.ok}
          onClick={() => onConfirm(next)}>
          {impact.ok ? `Đổi sang ${fmtMoney(next)}` : 'Đổi giá'}
        </Button>
      </>)}>
      <div className="pdlg">
        <p className="pdlg__note">Chỉ đổi được <b>1 lần</b> mỗi trưa. Đồng hồ vẫn chạy trong lúc bạn chọn.</p>
        <Stepper label="Giá ly M mới" value={next} min={range.min} max={range.max} step={(v, s) => v + s * range.step}
          format={fmtMoney} onChange={setNext} className="pdlg__stepper" invalid={!impact.ok && next !== current}>
          <span>Giá ly M</span><small>sáng nay {fmtMoney(morning)}{ceiling !== null ? ` · trần ${ceiling}k` : ''}</small>
        </Stepper>
        <div className={cx('pdlg__delta', `is-${impact.kind}`)}>
          <span>{fmtMoney(morning)} → <b>{fmtMoney(next)}</b></span>
          <b className="pdlg__pct">{sign}{Math.abs(impact.pct)}%</b>
        </div>
        <div className="pdlg__menu" aria-label="Giá từng ly">
          {(['S', 'M', 'L'] as const).map(s => (
            <span key={s}><small>{s}</small><b>{orderPrice(next, { size: s, toppings: [], noIce: false })}k</b></span>
          ))}
          <span><small>+topping</small><b>+{CONFIG.pricing.toppingSurcharge}k</b></span>
        </div>
        <ul className="pdlg__lines">
          {lines.map(l => <li key={l.text} className={`is-${l.tone}`}>{l.text}</li>)}
          {impact.issue !== null && impact.issue !== 'Giá chưa đổi' && <li className="is-bad">{impact.issue}</li>}
        </ul>
      </div>
    </Modal>
  );
}

/** Rendered with the screen every tick, so memoised: nothing to redo while it stays shut. */
export const PriceDialog = memo(PriceDialogView);
