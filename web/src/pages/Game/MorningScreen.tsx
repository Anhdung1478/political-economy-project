// The morning (spec §5): the ward's bulletin, then the plan: the price of an M cup, the stock (quick fill, the shelf,
// tea millilitres and topping portions), the tea grade, an upgrade; the till shows what it all costs against the
// cash, the capacity line and "Mở cửa". The shelf fills as stock is added; "Mở cửa" calls the delivery van, then the
// shop opens. On a phone held upright yesterday's street table starts folded, so the price is in the first view.
//
// Edits are kept locally and reach the run store (which saves the draft) after a short pause, so a slider drag or a
// held stepper does not write to storage on every input event. Everything shown is computed from the local plan.
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import {
  useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent,
} from 'react';
import { CONFIG } from '../../../../shared/sim/config';
import { capacityEstimate, morningBrief, planCost, validatePlan } from '../../../../shared/sim/day';
import type {
  MorningPlan, PlanIssue, RunState, TeaGrade, ToppingId, UpgradeId,
} from '../../../../shared/sim/types';
import { fmtMoney, fmtNumber } from '../../game/format';
import type { Intent } from '../../game/runStore';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import {
  SHOP_ICONS, TEA_ICONS, TEA_NAMES, TOPPING_NAMES, UPGRADE_ICONS, UPGRADE_NAMES, dayTitle, upgradeLine,
} from './copy';
import { Stepper } from './controls';
import { DeliveryVan, Shelf } from './MorningArt';
import {
  ISSUE_FIELD, bulletinRows, clampPrice, entryNote, hintLine, issueText, newsLine, peekKeyAction, planIntents, priceRange, ruleLines,
  samePlan, stepCount, stepTea, streetAverage, streetSummary, type Entrant,
} from './morning';

/** Pause after the last edit before the draft is saved. */
const SAVE_DELAY_MS = 300;
/** After `open` is dispatched, the screen must be leaving within this; otherwise the store refused it. */
const OPEN_CHECK_MS = 400;

const TEAS: readonly TeaGrade[] = ['skimp', 'standard', 'premium'];
const TOPPINGS: readonly ToppingId[] = CONFIG.customers.toppingOrder;
const UPGRADES: readonly UpgradeId[] = ['staff', 'machine', 'banner'];

const portrait = () => typeof window !== 'undefined' && window.matchMedia?.('(orientation: portrait)').matches === true;

export interface MorningScreenProps {
  run: RunState;
  planDraft: MorningPlan;
  dispatch: (intent: Intent) => void;
  /** Shops opening today with their price (from the street), for the bulletin's note. */
  entrants: readonly Entrant[];
  /** Move the keyboard focus to the price when the screen appears (after the day title). */
  focusPrice?: boolean;
}

export function MorningScreen({ run, planDraft, dispatch, entrants, focusPrice }: MorningScreenProps) {
  const brief = useMemo(() => morningBrief(run), [run]);
  const [local, setLocal] = useState(planDraft);
  const [leaving, setLeaving] = useState(false);
  const [openError, setOpenError] = useState(false);
  const [tableOpen, setTableOpen] = useState(() => !portrait());
  const [cue, setCue] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const priceRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const stored = useRef(planDraft);
  const localRef = useRef(local);
  localRef.current = local;
  const present = useIsPresent();
  const presentRef = useRef(present);
  presentRef.current = present;
  const tableId = useId();

  // "Xem phố": the plan slides away to show the whole street. Never saved; a fresh morning starts with the plan up.
  const [peek, setPeek] = useState(false);
  const peekBtn = useRef<HTMLButtonElement>(null);
  const peekMoved = useRef(false);
  useEffect(() => {
    if (peekMoved.current) peekBtn.current?.focus({ preventScroll: true });
  }, [peek]);
  const setPeekTo = useCallback((v: boolean) => {
    peekMoved.current = true;
    setPeek(v);
  }, []);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const act = peekKeyAction({
        key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, repeat: e.repeat,
        defaultPrevented: e.defaultPrevented,
        target: el === null ? null : { tagName: el.tagName, isContentEditable: el.isContentEditable, role: el.getAttribute('role') },
      }, peek);
      if (act === null || leaving) return;
      e.preventDefault();
      setPeekTo(act === 'show' ? false : !peek);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [peek, leaving, setPeekTo]);

  /** Sends the local edits to the store now. */
  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    for (const i of planIntents(stored.current, localRef.current)) dispatch(i);
  }, [dispatch]);

  // The store's draft moved (a quick fill, a flush, a new morning): adopt it unless edits are waiting.
  useEffect(() => {
    stored.current = planDraft;
    if (timer.current === null && !samePlan(planDraft, localRef.current)) setLocal(planDraft);
  }, [planDraft]);

  useEffect(() => flush, [flush]);

  // Focus the price after the title; on a phone held upright, point to the price if it starts out of view.
  useEffect(() => {
    if (focusPrice) priceRef.current?.querySelector<HTMLElement>('[role="spinbutton"]')?.focus({ preventScroll: true });
    const root = body.current;
    const price = priceRef.current;
    if (root === null || price === null || getComputedStyle(root).display === 'contents') return;
    setCue(price.getBoundingClientRect().top > root.getBoundingClientRect().bottom - 8);
  }, [focusPrice]);
  const toPrice = () => {
    setCue(false);
    priceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const edit = (patch: Partial<MorningPlan>) => {
    if (leaving) return;
    const next = { ...localRef.current, ...patch };
    localRef.current = next;
    setLocal(next);
    setOpenError(false);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };
  const setTopping = (id: ToppingId, count: number) => edit({ toppings: { ...localRef.current.toppings, [id]: count } });

  const quickFill = (level: 'low' | 'mid' | 'high') => {
    if (leaving) return;
    flush();
    dispatch({ type: 'quickFill', level });
  };

  const issues = useMemo(() => validatePlan(run, local), [run, local]);
  const cost = useMemo(() => planCost(run, local), [run, local]);
  const capacity = useMemo(() => capacityEstimate(run, local), [run, local]);
  const issuesAt = (field: (typeof ISSUE_FIELD)[PlanIssue]) => issues.filter(i => ISSUE_FIELD[i] === field);

  const open = () => {
    if (leaving || issues.length > 0) return;
    flush();
    setOpenError(false);
    setLeaving(true);
  };
  /** The van is in: open the shop. If the store refuses (the saved draft is not this plan, or not valid), come back. */
  const runRef = useRef(run);
  runRef.current = run;
  const onArrived = useCallback(() => {
    const back = () => { setLeaving(false); setOpenError(true); };
    if (!samePlan(stored.current, localRef.current) || validatePlan(runRef.current, stored.current).length > 0) {
      back();
      return;
    }
    dispatch({ type: 'open' });
    window.setTimeout(() => { if (presentRef.current) back(); }, OPEN_CHECK_MS);
  }, [dispatch]);

  const onTeaKey = (e: KeyboardEvent) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    const next = TEAS[(TEAS.indexOf(localRef.current.tea) + d + TEAS.length) % TEAS.length];
    edit({ tea: next });
    (e.currentTarget.querySelector(`[data-tea="${next}"]`) as HTMLElement | null)?.focus();
  };

  const range = priceRange(brief.rules.ceiling);
  const title = dayTitle(brief.theme, brief.rules);
  const rows = bulletinRows(brief);
  const summary = streetSummary(brief);
  const note = entryNote(brief, entrants);
  const average = streetAverage(brief);
  const fills = { low: CONFIG.morning.quickFillCups.low, mid: CONFIG.morning.quickFillCups.mid, high: capacity };
  const floor = CONFIG.run.creditFloor;
  const atFloor = brief.cash <= floor;

  return (
    <>
    <div className={cx('morning', leaving && 'is-leaving', peek && 'is-peek')}>
      <div className="morning__body" ref={body} inert={peek} onScroll={() => cue && setCue(false)}>
        <section className="morning__news panel scrolly" aria-labelledby="news-title">
          <header className="news__mast">
            <span>Bản tin phường</span>
            <span className="news__mast-day">Sáng ngày {brief.day}</span>
          </header>
          <h2 id="news-title" className="news__headline"><span aria-hidden="true">{title.emoji}</span> {title.title}</h2>
          <ul className="news__rules">
            {ruleLines(brief).map(l => <li key={l}>{l}</li>)}
          </ul>
          {note !== null && <p className="news__entry" role="note"><span aria-hidden="true">📣</span> {note}</p>}
          {brief.news.length > 0 && (
            <ul className="news__mail" aria-label="Chuyện hôm trước">
              {brief.news.map((n, i) => {
                const line = newsLine(n);
                return (
                  <li key={i}>
                    <span aria-hidden="true">{line.icon}</span>
                    <span>
                      {line.text}{' '}
                      {line.effects.map(e => (
                        <b key={e} className={cx('fx', e.startsWith('−') ? 'fx--bad' : 'fx--good')}>{e}</b>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {rows.length > 0 ? (
            <div className="street">
              <button type="button" className="street__toggle" aria-expanded={tableOpen} aria-controls={tableId}
                onClick={() => setTableOpen(o => !o)}>
                <b>Phố hôm qua chốt giá</b>
                {!tableOpen && summary !== null && <span className="street__sum">{summary}</span>}
                <span className="street__chev" aria-hidden="true">▾</span>
              </button>
              {tableOpen && (
                <table className="news__table" id={tableId}>
                  <colgroup><col /><col className="c-num" /><col className="c-num" /><col className="c-note" /></colgroup>
                  <thead><tr><th scope="col">Quán</th><th scope="col">Giá</th><th scope="col">Bán</th><th scope="col"><span className="sr-only">Ghi chú</span></th></tr></thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className={cx(r.you && 'is-you', r.dim && 'is-dim')}>
                        <th scope="row"><span aria-hidden="true">{SHOP_ICONS[r.id]}</span> {r.name}</th>
                        <td className="num">{r.price}</td>
                        <td className="num">{r.sold}</td>
                        <td>{r.note && <span className={cx('tag', `tag--${r.note.tone}`)}>{r.note.text}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <p className="news__first">Phố vừa mở hàng, chưa ai có số hôm qua. Bà Tư bảo giá phố quanh quanh {fmtMoney(CONFIG.morning.defaultPrice)}.</p>
          )}
        </section>

        <section className="morning__plan panel scrolly" aria-label="Kế hoạch sáng nay">
          <fieldset className="field-block blk-price" disabled={leaving}>
            <legend className="block__title">
              Giá ly M <small>không topping</small>
              {brief.rules.ceiling !== null && <span className="tag tag--bad price__cap">Trần {fmtMoney(brief.rules.ceiling)}</span>}
            </legend>
            <div className="price" ref={priceRef}>
              <Stepper label="Giá ly M (nghìn đồng)" value={local.price} min={range.min} max={range.max}
                step={(v, s) => clampPrice(v + s * range.step, brief.rules.ceiling)} format={fmtMoney}
                onChange={price => edit({ price })} invalid={issuesAt('price').length > 0} className="stepper--big" />
              <input type="range" className="slider__input price__range" aria-label="Kéo để chọn giá ly M"
                aria-valuetext={fmtMoney(local.price)} min={range.min} max={range.max} step={range.step}
                value={Math.min(range.max, Math.max(range.min, local.price))}
                style={{ '--fill': `${((Math.min(range.max, local.price) - range.min) / (range.max - range.min)) * 100}%` } as CSSProperties}
                onChange={e => edit({ price: Number(e.target.value) })} />
              <p className="price__meta">
                {average !== null && <span>Hôm qua cả phố (gồm quán bạn) trung bình <b>{fmtMoney(average)}</b></span>}
                <span>S −{fmtMoney(-CONFIG.pricing.sizeSurcharge.S)}, L +{fmtMoney(CONFIG.pricing.sizeSurcharge.L)}, mỗi topping +{fmtMoney(CONFIG.pricing.toppingSurcharge)}</span>
              </p>
            </div>
            <Issues list={issuesAt('price')} ceiling={brief.rules.ceiling} className="issue--inline" />
          </fieldset>

          <fieldset className="field-block blk-stock" disabled={leaving}>
            <legend className="block__title">Nhập hàng</legend>
            <div className="quick" role="group" aria-label="Nhập nhanh">
              {(['low', 'mid', 'high'] as const).map(level => (
                <button key={level} type="button" className="quick__btn" onClick={() => quickFill(level)}>
                  <b>{level === 'low' ? 'Ít' : level === 'mid' ? 'Vừa' : 'Nhiều'}</b>
                  <small>~{fills[level]} ly</small>
                </button>
              ))}
            </div>
            <Shelf plan={local} />
            <p className="hint"><span aria-hidden="true">💡</span> {hintLine(brief)}</p>
            <div className="stock-wrap"><div className="stock">
              <Stepper label="Trà (ml)" value={local.teaMl} step={(v, s) => stepTea(v, s)} format={v => fmtNumber(v)}
                valueText={v => `${fmtNumber(v)} ml`} onChange={teaMl => edit({ teaMl })} invalid={issuesAt('tea').length > 0}>
                <span>🍵 Trà (ml)</span>
              </Stepper>
              {TOPPINGS.map(id => (
                <Stepper key={id} label={`${TOPPING_NAMES[id]} (phần)`} value={local.toppings[id]} step={stepCount}
                  format={v => `${v}`} onChange={n => setTopping(id, n)} invalid={issuesAt('toppings').length > 0}>
                  <span>{TOPPING_NAMES[id]}</span><small>{fmtMoney(brief.toppingCost)}/phần</small>
                </Stepper>
              ))}
            </div></div>
            {brief.toppingCost !== CONFIG.supplies.toppingCost && (
              <p className="hint hint--warn">Topping "giá sốc" chỉ {fmtMoney(brief.toppingCost)}/phần… nguồn gốc thì đừng hỏi.</p>
            )}
            <Issues list={[...issuesAt('tea'), ...issuesAt('toppings')]} ceiling={brief.rules.ceiling} className="issue--inline" />
          </fieldset>

          <fieldset className="field-block blk-tea" disabled={leaving}>
            <legend className="block__title">Loại trà</legend>
            <div className="tea" role="radiogroup" aria-label="Loại trà" onKeyDown={onTeaKey}>
              {TEAS.map(t => {
                const g = CONFIG.supplies.teaGrades[t];
                const on = local.tea === t;
                return (
                  <button key={t} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-tea={t}
                    className={cx('tea__opt', `tea__opt--${t}`, on && 'is-on')}
                    onClick={() => edit({ tea: t })}>
                    <span className="tea__icon" aria-hidden="true">{TEA_ICONS[t]}</span>
                    <b>{TEA_NAMES[t]}</b>
                    <small>{fmtMoney(g.costPer100Ml)}/100 ml</small>
                    <small className={g.rep < 0 ? 'fx--bad' : g.rep > 0 ? 'fx--good' : ''}>
                      {g.rep === 0 ? 'uy tín ±0' : `${g.rep > 0 ? '+' : '−'}${Math.abs(g.rep)} uy tín`}
                    </small>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="field-block blk-upgrade" disabled={leaving}>
            <legend className="block__title">Nâng cấp <small>tối đa 1 món mỗi sáng</small></legend>
            <div className="upgrades">
              {UPGRADES.map(u => {
                const owned = run.upgrades.includes(u);
                const on = local.upgrade === u;
                return (
                  <button key={u} type="button" aria-pressed={on} disabled={owned} title={upgradeLine(u)}
                    className={cx('upgrade', on && 'is-on', owned && 'is-owned')}
                    onClick={() => edit({ upgrade: on ? null : u })}>
                    <span className="upgrade__icon" aria-hidden="true">{UPGRADE_ICONS[u]}</span>
                    <b>{UPGRADE_NAMES[u]}</b>
                    <small className="upgrade__long">{upgradeLine(u)}</small>
                    <small className="upgrade__short">{upgradeShort(u)}</small>
                    <span className="upgrade__price">{owned ? 'Đã có' : fmtMoney(CONFIG.upgrades[u].cost)}</span>
                  </button>
                );
              })}
            </div>
            <Issues list={issuesAt('upgrade')} ceiling={brief.rules.ceiling} className="issue--inline" />
          </fieldset>
        </section>
      </div>

      <footer className="morning__foot panel" inert={peek}>
        <AnimatePresence>
          {cue && !leaving && (
            <motion.button key="cue" type="button" className="plan-cue" onClick={toPrice}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
              Đặt giá <span aria-hidden="true">↓</span>
            </motion.button>
          )}
        </AnimatePresence>
        <div className="foot-info">
          <p className="capacity"><span aria-hidden="true">⚡</span> Sức pha hôm nay: khoảng <b>{capacity} ly</b></p>
          <div className="foot-issues">
            <Issues list={issuesAt('cost')} ceiling={brief.rules.ceiling} />
            <Issues list={issues.filter(i => ISSUE_FIELD[i] !== 'cost')} ceiling={brief.rules.ceiling} className="issue--desk" />
            {atFloor && (
              <p className="issue" role="status">
                Tiền đã chạm đáy mua chịu ({fmtMoney(floor)}): chỉ mở cửa được với kệ trống.{' '}
                <button type="button" className="linkish" disabled={leaving}
                  onClick={() => edit({ teaMl: 0, toppings: { pearl: 0, jelly: 0, pudding: 0 }, upgrade: null })}>Dọn kệ</button>
              </p>
            )}
            {openError && <p className="issue" role="alert">Xe hàng quay đầu: chưa mở được cửa. Kiểm tra lại kế hoạch rồi bấm Mở cửa lần nữa.</p>}
          </div>
        </div>
        <div className="money">
          <div className="money__row">
            <span>Nhập hàng</span>
            <motion.b key={cost.total} initial={{ y: -5, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }}>−{fmtMoney(cost.total)}</motion.b>
          </div>
          <div className="money__parts">
            trà {fmtMoney(cost.tea)} · topping {fmtMoney(cost.toppings)}{cost.upgrade > 0 && ` · nâng cấp ${fmtMoney(cost.upgrade)}`}
          </div>
          <div className="money__row">
            <span className="money__from">Tiền {fmtMoney(brief.cash)}&nbsp;→</span>
            <b className={cost.cashAfter < 0 ? 'fx--bad' : ''}>{fmtMoney(cost.cashAfter)}</b>
          </div>
          {cost.cashAfter < 0 && issues.every(i => i !== 'credit') && (
            <div className="money__parts money__credit">Đang mua chịu, hạn mức tới {fmtMoney(floor)}.</div>
          )}
        </div>
        <Button variant="primary" size="xl" block className="open-btn" disabled={issues.length > 0 || leaving}
          onClick={open} aria-describedby={issues.length > 0 ? 'plan-issues' : undefined}>
          {leaving ? 'Xe hàng tới rồi…' : 'Mở cửa'}
        </Button>
        {issues.length > 0 && (
          <p id="plan-issues" className="sr-only">Chưa mở được: {issues.map(i => issueText(i, brief.rules.ceiling)).join(' ')}</p>
        )}
      </footer>

      <AnimatePresence>{leaving && <DeliveryVan key="van" onArrived={onArrived} />}</AnimatePresence>
    </div>
    {!leaving && (
      <button ref={peekBtn} type="button" className={cx('peek', peek && 'is-on')} aria-expanded={!peek}
        aria-keyshortcuts="H" onClick={() => setPeekTo(!peek)}>
        <span className="peek__icon" aria-hidden="true">{peek ? '📝' : '👁'}</span>
        <span>{peek ? 'Lập kế hoạch' : 'Xem phố'}</span>
        <kbd className="peek__key" aria-hidden="true">H</kbd>
      </button>
    )}
    <p className="sr-only" role="status">{peek ? 'Đã ẩn kế hoạch để xem phố. Bấm H hoặc Esc để hiện lại.' : ''}</p>
    </>
  );
}

/** A short effect line for compact upgrade tiles (numbers from the config). */
function upgradeShort(u: UpgradeId): string {
  switch (u) {
    case 'staff': return `Phụ pha ${CONFIG.craft.staffTicks / 10}s/ly`;
    case 'machine': return 'Rót trà ×2 nhanh';
    case 'banner': return `+${CONFIG.upgrades.banner.rep} uy tín`;
  }
}

function Issues({ list, ceiling, className }: { list: readonly PlanIssue[]; ceiling: number | null; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {list.map(i => (
        <motion.p key={i} className={cx('issue', className)} role="alert"
          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
          <span aria-hidden="true">⚠️</span> {issueText(i, ceiling)}
        </motion.p>
      ))}
    </AnimatePresence>
  );
}
