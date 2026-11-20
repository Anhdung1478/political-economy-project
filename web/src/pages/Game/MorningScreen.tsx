// The morning (spec §5): the ward's bulletin, then the plan: the price of an M cup, the tea grade and millilitres,
// the topping portions, an upgrade, what it all costs against the cash, the capacity line, yesterday's hint and the
// three quick-fill buttons. The shelf fills as stock is added; "Mở cửa" calls the delivery van, then the shop opens.
//
// Edits are kept locally and reach the run store (which saves the draft) after a short pause, so a slider drag or a
// held stepper does not write to storage on every input event. Everything shown is computed from the local plan.
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  ISSUE_FIELD, bulletinRows, clampPrice, entryNote, hintLine, issueText, newsLine, planIntents, priceRange, ruleLines,
  samePlan, stepCount, stepTea, type Entrant,
} from './morning';

/** Pause after the last edit before the draft is saved. */
const SAVE_DELAY_MS = 300;

const TEAS: readonly TeaGrade[] = ['skimp', 'standard', 'premium'];
const TOPPINGS: readonly ToppingId[] = CONFIG.customers.toppingOrder;
const UPGRADES: readonly UpgradeId[] = ['staff', 'machine', 'banner'];

export interface MorningScreenProps {
  run: RunState;
  planDraft: MorningPlan;
  dispatch: (intent: Intent) => void;
  /** Shops opening today with their price (from the street), for the bulletin's note. */
  entrants: readonly Entrant[];
}

export function MorningScreen({ run, planDraft, dispatch, entrants }: MorningScreenProps) {
  const brief = useMemo(() => morningBrief(run), [run]);
  const [local, setLocal] = useState(planDraft);
  const [leaving, setLeaving] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const planRef = useRef<HTMLElement>(null);
  const [planSeen, setPlanSeen] = useState(true);
  const timer = useRef<number | null>(null);
  const stored = useRef(planDraft);
  const localRef = useRef(local);
  localRef.current = local;

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

  // Phone upright: the plan sits under the bulletin; a cue points to it until it scrolls into view.
  useEffect(() => {
    const root = body.current;
    const target = planRef.current;
    if (root === null || target === null || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setPlanSeen(true); }, { root, threshold: 0.12 });
    setPlanSeen(root.scrollHeight <= root.clientHeight + 4 || getComputedStyle(root).display === 'contents');
    io.observe(target);
    return () => io.disconnect();
  }, []);
  const toPlan = () => planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const edit = (patch: Partial<MorningPlan>) => {
    if (leaving) return;
    const next = { ...localRef.current, ...patch };
    localRef.current = next;
    setLocal(next);
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
    setLeaving(true);
  };
  const onArrived = useCallback(() => dispatch({ type: 'open' }), [dispatch]);

  const range = priceRange(brief.rules.ceiling);
  const title = dayTitle(brief.theme, brief.rules);
  const rows = bulletinRows(brief);
  const note = entryNote(brief, entrants);
  const yesterdayAvg = (() => {
    const xs = brief.street.flatMap(r => (r.closePrice === null ? [] : [r.closePrice]));
    return xs.length === 0 ? null : Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 2) / 2;
  })();
  const fills = { low: CONFIG.morning.quickFillCups.low, mid: CONFIG.morning.quickFillCups.mid, high: capacity };
  const floor = CONFIG.run.creditFloor;
  const atFloor = brief.cash <= floor;

  return (
    <div className={cx('morning', leaving && 'is-leaving')}>
      <div className="morning__body" ref={body}>
        <section className="morning__news panel" aria-labelledby="news-title">
          <header className="news__mast">
            <span>Bản tin phường</span>
            <span>Sáng ngày {brief.day}</span>
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
            <table className="news__table">
              <caption>Phố hôm qua chốt giá</caption>
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
          ) : (
            <p className="news__first">Phố vừa mở hàng, chưa ai có số hôm qua. Bà Tư bảo giá phố quanh quanh {fmtMoney(CONFIG.morning.defaultPrice)}.</p>
          )}
        </section>

        <section className="morning__plan panel" aria-label="Kế hoạch sáng nay" ref={planRef}>
          <fieldset className="field-block" disabled={leaving}>
            <legend className="block__title">Giá ly M <small>không topping</small></legend>
            <div className="price">
              <Stepper label="Giá ly M (nghìn đồng)" value={local.price} min={range.min} max={range.max}
                step={(v, s) => clampPrice(v + s * range.step, brief.rules.ceiling)} format={fmtMoney}
                onChange={price => edit({ price })} invalid={issuesAt('price').length > 0} className="stepper--big" />
              <input type="range" className="slider__input price__range" aria-label="Kéo để chọn giá ly M"
                aria-valuetext={fmtMoney(local.price)} min={range.min} max={range.max} step={range.step}
                value={Math.min(range.max, Math.max(range.min, local.price))}
                style={{ '--fill': `${((Math.min(range.max, local.price) - range.min) / (range.max - range.min)) * 100}%` } as CSSProperties}
                onChange={e => edit({ price: Number(e.target.value) })} />
              <p className="price__meta">
                {brief.rules.ceiling !== null && <span className="tag tag--bad">Trần {fmtMoney(brief.rules.ceiling)}</span>}
                <span>S rẻ hơn {fmtMoney(-CONFIG.pricing.sizeSurcharge.S)}, L đắt hơn {fmtMoney(CONFIG.pricing.sizeSurcharge.L)}, mỗi topping +{fmtMoney(CONFIG.pricing.toppingSurcharge)}</span>
                {yesterdayAvg !== null && <span>Hôm qua phố trung bình <b>{fmtMoney(yesterdayAvg)}</b></span>}
              </p>
            </div>
            <Issues list={issuesAt('price')} ceiling={brief.rules.ceiling} />
          </fieldset>

          <fieldset className="field-block" disabled={leaving}>
            <legend className="block__title">Nhập hàng</legend>
            <Shelf plan={local} />
            <div className="quick" role="group" aria-label="Nhập nhanh">
              {(['low', 'mid', 'high'] as const).map(level => (
                <button key={level} type="button" className="quick__btn" onClick={() => quickFill(level)}>
                  <b>{level === 'low' ? 'Ít' : level === 'mid' ? 'Vừa' : 'Nhiều'}</b>
                  <small>~{fills[level]} ly</small>
                </button>
              ))}
            </div>
            <p className="hint"><span aria-hidden="true">💡</span> {hintLine(brief)}</p>

            <div className="tea" role="radiogroup" aria-label="Loại trà">
              {TEAS.map(t => {
                const g = CONFIG.supplies.teaGrades[t];
                return (
                  <button key={t} type="button" role="radio" aria-checked={local.tea === t}
                    className={cx('tea__opt', `tea__opt--${t}`, local.tea === t && 'is-on')}
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

            <div className="stock">
              <Stepper label="Trà (ml)" value={local.teaMl} step={(v, s) => stepTea(v, s)} format={v => fmtNumber(v)}
                valueText={v => `${fmtNumber(v)} ml`} onChange={teaMl => edit({ teaMl })} invalid={issuesAt('tea').length > 0}>
                <span>🍵 Trà (ml)</span><small>bước {fmtNumber(CONFIG.supplies.teaStepMl)} ml</small>
              </Stepper>
              {TOPPINGS.map(id => (
                <Stepper key={id} label={`${TOPPING_NAMES[id]} (phần)`} value={local.toppings[id]} step={stepCount}
                  format={v => `${v}`} onChange={n => setTopping(id, n)} invalid={issuesAt('toppings').length > 0}>
                  <span>{TOPPING_NAMES[id]}</span><small>{fmtMoney(brief.toppingCost)}/phần</small>
                </Stepper>
              ))}
            </div>
            {brief.toppingCost !== CONFIG.supplies.toppingCost && (
              <p className="hint hint--warn">Topping "giá sốc" chỉ {fmtMoney(brief.toppingCost)}/phần… nguồn gốc thì đừng hỏi.</p>
            )}
            <Issues list={[...issuesAt('tea'), ...issuesAt('toppings')]} ceiling={brief.rules.ceiling} />
          </fieldset>

          <fieldset className="field-block" disabled={leaving}>
            <legend className="block__title">Nâng cấp <small>tối đa 1 món mỗi sáng</small></legend>
            <div className="upgrades">
              {UPGRADES.map(u => {
                const owned = run.upgrades.includes(u);
                const on = local.upgrade === u;
                return (
                  <button key={u} type="button" aria-pressed={on} disabled={owned}
                    className={cx('upgrade', on && 'is-on', owned && 'is-owned')}
                    onClick={() => edit({ upgrade: on ? null : u })}>
                    <span className="upgrade__icon" aria-hidden="true">{UPGRADE_ICONS[u]}</span>
                    <b>{UPGRADE_NAMES[u]}</b>
                    <small>{upgradeLine(u)}</small>
                    <span className="upgrade__price">{owned ? 'Đã có' : fmtMoney(CONFIG.upgrades[u].cost)}</span>
                  </button>
                );
              })}
            </div>
            <Issues list={issuesAt('upgrade')} ceiling={brief.rules.ceiling} />
          </fieldset>
        </section>
      </div>

      <footer className="morning__foot panel">
        <AnimatePresence>
          {!planSeen && !leaving && (
            <motion.button key="cue" type="button" className="plan-cue" onClick={toPlan}
              initial={{ opacity: 0, y: 12, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 12, x: '-50%' }}>
              Đặt giá và nhập hàng <span aria-hidden="true">↓</span>
            </motion.button>
          )}
        </AnimatePresence>
        <p className="capacity"><span aria-hidden="true">⚡</span> Sức pha hôm nay: khoảng <b>{capacity} ly</b></p>
        <Issues list={issuesAt('cost')} ceiling={brief.rules.ceiling} />
        {atFloor && (
          <p className="issue" role="status">
            Tiền đã chạm đáy mua chịu ({fmtMoney(floor)}): chỉ mở cửa được với kệ trống.{' '}
            <button type="button" className="linkish" disabled={leaving}
              onClick={() => edit({ teaMl: 0, toppings: { pearl: 0, jelly: 0, pudding: 0 }, upgrade: null })}>Dọn kệ</button>
          </p>
        )}
        <div className="money">
          <div className="money__row">
            <span>Nhập hàng</span>
            <motion.b key={cost.total} initial={{ y: -5, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }}>−{fmtMoney(cost.total)}</motion.b>
          </div>
          <div className="money__parts">
            trà {fmtMoney(cost.tea)} · topping {fmtMoney(cost.toppings)}{cost.upgrade > 0 && ` · nâng cấp ${fmtMoney(cost.upgrade)}`}
          </div>
          <div className="money__row">
            <span>Tiền {fmtMoney(brief.cash)} →</span>
            <b className={cost.cashAfter < 0 ? 'fx--bad' : ''}>{fmtMoney(cost.cashAfter)}</b>
          </div>
          {cost.cashAfter < 0 && issues.every(i => i !== 'credit') && (
            <div className="money__parts">Đang mua chịu, hạn mức tới {fmtMoney(floor)}.</div>
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
  );
}

function Issues({ list, ceiling }: { list: readonly PlanIssue[]; ceiling: number | null }) {
  return (
    <AnimatePresence initial={false}>
      {list.map(i => (
        <motion.p key={i} className="issue" role="alert"
          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
          <span aria-hidden="true">⚠️</span> {issueText(i, ceiling)}
        </motion.p>
      ))}
    </AnimatePresence>
  );
}
