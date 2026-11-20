// The lunch rush (spec §6, §9 "Bảng pha chế", "Bố cục"): the live street is the base layer (Game draws it); over it the
// top bar (countdown, cash, rep, stock, the one price change, close early) and the craft panel, which opens and closes
// (phone upright: slides up from the bottom over ~60% and the street shrinks to the strip above it; phone on its side:
// slides in from the right over ~50%; desktop from 1100 px: beside the street). Closed, a slim bar shows who waits.
// The clock runs whether the panel is open or not. Day 1 starts with a guided practice cup before the clock runs.
// Sales, wrong cups and walk-outs come back as the sim's events (`subscribe`), and play as reactions at the counter
// with coins flying to the cash. At 90 s, or after "Đóng cửa sớm", an outro plays over the street, then the screen
// itself dispatches `endRush` (R55). A hidden tab pauses the clock and the screen waits for a tap to go on.
import { useReducedMotion } from 'framer-motion';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CONFIG } from '../../../../shared/sim/config';
import { canDeliver, checkInput, counterView, craftInput, craftTick } from '../../../../shared/sim/rush';
import type { Action, CraftState, InputReject, RunState, RushState, SimEvent } from '../../../../shared/sim/types';
import { fmtMoney } from '../../game/format';
import { useRush, type RunHandle, type RushSource } from '../../game/useRun';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Modal } from '../../ui/Modal';
import { CraftPanel, type PracticeHint } from './CraftPanel';
import { OrderBubble, setPortraitsPaused } from './CounterCustomer';
import { PriceDialog, RushHud } from './RushHud';
import {
  counterRow, handOver, inputOf, leaveKind, outcomeOf, patienceUsed, practiceLine, practiceNext, PRACTICE_ORDER,
  projectCraft, projectCup, rejectText, rushCash, saleLabel, type CraftButtonId, type Departure, type HandOver, type LiveSlot,
} from './rush';
import './rush.css';

/**
 * Everything the rush screen gets from Game: where to read the live rush (`source`; the screen subscribes itself, so
 * Game does not re-render on every tick) and the run, the rush as it opened (`opening`, the street's snapshot),
 * `dispatch` (closeEarly, endRush), `act` (craft, deliver, trash, setPrice for the next tick), the clock hold
 * (`setHold`/`held`: Game opens with the clock held and the screen releases it on mount, or keeps it for the day-1
 * practice cup and the pause after a hidden tab), `hidden` (tab hidden, clock paused), `simTime` and `subscribe`
 * (each tick's events).
 */
export interface RushScreenProps extends Pick<RunHandle,
  'opening' | 'dispatch' | 'act' | 'setHold' | 'held' | 'hidden' | 'simTime' | 'subscribe'> {
  source: RushSource;
  run: RunState;
}

type RushViewProps = Omit<RushScreenProps, 'source'> & { rush: RushState };

/** The outro over the street before the afternoon. */
const OUTRO_MS = 2600;
/** How long a customer who just left stays at the counter for their reaction. */
const LEAVE_MS = 1000;
/** The street shrinks to the strip above the panel once it has slid up. */
const SLIDE_MS = 320;
/** The practice customer's look and id. */
const PRACTICE_LOOK = 90210;
const PRACTICE_ID = -1;

/** The same object while its JSON stays the same: keeps memoised children quiet between ticks. */
function useStable<T>(value: T): T {
  const ref = useRef<{ key: string; value: T } | null>(null);
  const key = JSON.stringify(value);
  if (ref.current === null || ref.current.key !== key) ref.current = { key, value };
  return ref.current.value;
}

/** "Đóng cửa sớm?": what closing does, before it is done. */
const CloseDialog = memo(function CloseDialog({ open, onCancel, onConfirm }: {
  open: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Modal open={open} title="Đóng cửa sớm?" onClose={onCancel}
      actions={(<>
        <Button variant="ghost" onClick={onCancel}>Bán tiếp</Button>
        <Button variant="danger" onClick={onConfirm}>Đóng cửa</Button>
      </>)}>
      <p>Khách đang chờ sẽ sang quán khác (không trừ uy tín). Ly đang pha và hàng còn lại bỏ đi; phần còn lại của phố được tính ngay.</p>
    </Modal>
  );
});

interface Practice {
  on: boolean;
  craft: CraftState;
  tick: number;
  /** When the last practice tick ran (ms). */
  wall: number;
  result: HandOver | null;
}

const EMPTY_CRAFT: CraftState = { cup: null, anim: null, buffer: [] };
const NO_ACTIONS: readonly Action[] = [];

/** A refusal from the sim, in words that fit what happened between the press and the tick. */
function refusalText(action: Action['type'], why: InputReject): string {
  if (action === 'deliver' && why === 'notInFirstFour') return 'Khách vừa rời quầy';
  if (action === 'deliver' && why === 'busy') return 'Ly chưa xong, chưa giao được';
  if (action === 'craft' && (why === 'noTea' || why === 'noTopping')) return `${rejectText(why, null, null)}: các bước bấm trước đã huỷ`;
  if (action === 'craft' && (why === 'order' || why === 'duplicate' || why === 'noCup')) return 'Bước này không còn hợp với ly, đã bỏ qua';
  return rejectText(why, null, null);
}

/** The live rush, re-rendered on each tick; while the screen leaves (the rush is over) it keeps the last one. */
export function RushScreen({ source, ...rest }: RushScreenProps) {
  const live = useRush(source);
  const last = useRef(live);
  if (live !== null) last.current = live;
  const rush = last.current;
  return rush === null ? null : <RushView rush={rush} {...rest} />;
}

function RushView({ rush, run, dispatch, act, setHold, hidden, simTime, subscribe }: RushViewProps) {
  const reduced = useReducedMotion() ?? false;
  const player = rush.shops.find(s => s.id === 'player');
  const price = player?.price ?? rush.player.morningPrice;
  const closed = player?.status === 'closedEarly' || rush.done;
  const soldOut = player?.status === 'soldOut';

  // ── The day-1 practice cup (before the clock runs) ──
  const [practice, setPractice] = useState<Practice>(() => ({
    on: rush.day === 1 && !rush.done && rush.tick < 30, craft: EMPTY_CRAFT, tick: 0, wall: 0, result: null,
  }));
  const practiceRef = useRef(practice);
  practiceRef.current = practice;
  /** The practice counter and its tick, updated by the handlers at once (two presses in one task both count). */
  const pCraft = useRef<CraftState>(EMPTY_CRAFT);
  const pTick = useRef(0);
  const setPracticeCraft = useCallback((c: CraftState, extra: Partial<Practice> = {}) => {
    pCraft.current = c;
    setPractice(p => ({ ...p, ...extra, craft: c }));
  }, []);
  useEffect(() => {
    if (!practice.on) return;
    const id = window.setInterval(() => {
      const r = craftTick(pCraft.current, null, pTick.current, rush.player.machine);
      pTick.current += 1;
      setPracticeCraft(r.craft, { tick: pTick.current, wall: performance.now() });
    }, CONFIG.rush.tickMs);
    return () => window.clearInterval(id);
  }, [practice.on, rush.player.machine]);
  const practiceTime = useCallback(() => {
    const p = practiceRef.current;
    return p.tick + Math.min(1, Math.max(0, (performance.now() - p.wall) / CONFIG.rush.tickMs));
  }, []);

  // ── Pause after a hidden tab: the clock waits for a tap ──
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (hidden && !rush.done) setPaused(true);
  }, [hidden, rush.done]);

  // ── The clock hold: practice or pause ──
  const wantHold = (practice.on || paused) && !rush.done;
  useLayoutEffect(() => { setHold(wantHold); }, [wantHold, setHold]);
  useEffect(() => () => setHold(false), [setHold]);

  // ── The panel ──
  const [panelOpen, setPanelOpen] = useState(true);
  const [streetSmall, setStreetSmall] = useState(true);
  const [outro, setOutro] = useState<null | { early: boolean }>(null);
  const showPanel = (panelOpen || practice.on) && outro === null;
  useEffect(() => {
    if (!showPanel) {
      setStreetSmall(false);
      return;
    }
    const t = window.setTimeout(() => setStreetSmall(true), reduced ? 0 : SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [showPanel, reduced]);

  useEffect(() => {
    setPortraitsPaused(!showPanel);
    return () => setPortraitsPaused(false);
  }, [showPanel]);

  // ── The counter: live customers, plus those who just left, still reacting ──
  const cv = counterView(rush);
  const live: LiveSlot[] = cv.first.map(f => ({ customer: f.customer, order: f.order, joinedTick: rush.rt[f.customer].joinedTick }));
  const [departing, setDeparting] = useState<Departure[]>([]);
  useEffect(() => {
    if (departing.length === 0) return;
    const next = Math.min(...departing.map(d => d.at)) + LEAVE_MS;
    const t = window.setTimeout(() => {
      const now = performance.now();
      setDeparting(ds => ds.filter(d => now - d.at < LEAVE_MS - 5));
    }, Math.max(0, next - performance.now()));
    return () => window.clearTimeout(t);
  }, [departing]);
  const row = practice.on
    ? counterRow([{ customer: PRACTICE_ID, order: PRACTICE_ORDER, joinedTick: -1 }].filter(() => practice.result === null),
      departing.filter(d => d.customer === PRACTICE_ID), 0)
    : counterRow(live, departing, cv.rest);
  const counterItems = useStable(row.items);
  const counterRef = useRef(counterItems);
  counterRef.current = counterItems;
  const lookOf = useCallback((id: number) => (id === PRACTICE_ID ? PRACTICE_LOOK : rush.customers[id]?.look ?? id),
    [rush.customers]);

  // ── Effects layer: coins to the cash, floating amounts ──
  const fx = useRef<HTMLDivElement>(null);
  const cashRef = useRef<HTMLSpanElement>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const spawn = useCallback((from: Element | null, h: HandOver, coins: number) => {
    const layer = fx.current;
    if (layer === null || from === null) return;
    const base = layer.getBoundingClientRect();
    const a = from.getBoundingClientRect();
    const sx = a.left + a.width / 2 - base.left;
    const sy = a.top + a.height * 0.35 - base.top;
    // the amount, rising
    const tag = document.createElement('span');
    tag.className = `fx-amount ${h.correct ? 'is-good' : 'is-bad'}`;
    tag.innerHTML = h.correct ? `<b>${saleLabel(h.paid)}</b>`
      : `<b>${saleLabel(h.paid)}</b><em>−${fmtMoney(h.cut)} · ${h.cutLabel}</em>`;
    tag.style.left = `${sx}px`;
    // above the order bubble, so both stay readable
    tag.style.top = `${Math.max(4, a.top - base.top - 8)}px`;
    layer.appendChild(tag);
    const life = reducedRef.current ? 1200 : 1500;
    tag.animate(reducedRef.current
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [
        { transform: 'translate(-50%, 0) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%, -26px) scale(1.12)', opacity: 1, offset: 0.18 },
        { transform: 'translate(-50%, -40px) scale(1)', opacity: 1, offset: 0.75 },
        { transform: 'translate(-50%, -60px) scale(0.96)', opacity: 0 },
      ], { duration: life, easing: 'ease-out', fill: 'forwards' }).onfinish = () => tag.remove();
    // the coins
    const cash = cashRef.current;
    if (cash === null || reducedRef.current) return;
    const c = cash.getBoundingClientRect();
    const tx = c.left + 8 - base.left;
    const ty = c.top + c.height / 2 - base.top;
    for (let i = 0; i < coins; i++) {
      const coin = document.createElement('span');
      coin.className = 'fx-coin';
      coin.style.left = `${sx}px`;
      coin.style.top = `${sy}px`;
      layer.appendChild(coin);
      const spread = (i - (coins - 1) / 2) * 16;
      const midX = (tx - sx) * 0.35 + spread;
      const midY = Math.min(ty - sy, 0) * 0.5 - 70 - Math.abs(spread);
      coin.animate([
        { transform: 'translate(-50%, -50%) scale(0.3) rotate(0deg)', opacity: 0 },
        { transform: `translate(calc(-50% + ${spread * 0.6}px), calc(-50% - 26px)) scale(1.1) rotate(90deg)`, opacity: 1, offset: 0.15 },
        { transform: `translate(calc(-50% + ${midX}px), calc(-50% + ${midY}px)) scale(1) rotate(260deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${tx - sx}px), calc(-50% + ${ty - sy}px)) scale(0.55) rotate(420deg)`, opacity: 0.9 },
      ], { duration: 640 + i * 45, delay: i * 50, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' }).onfinish = () => coin.remove();
    }
  }, []);

  // ── The sim's events: reactions at the counter, coins, refusals ──
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const [staffServedAt, setStaffServedAt] = useState(-1e9);
  const noticeId = useRef(0);
  useEffect(() => subscribe({
    push: (events: readonly SimEvent[]) => {
      const now = performance.now();
      const leaves: Departure[] = [];
      for (const e of events) {
        if (e.type === 'customerServed' && e.shop === 'player') {
          const idx = counterRef.current.findIndex(i => i.customer === e.customer);
          const h = outcomeOf(e.correct, e.paid, e.full);
          const card = document.querySelector(`[data-customer="${e.customer}"]`);
          if (e.by === 'staff') setStaffServedAt(now);
          if (idx >= 0) {
            const it = counterRef.current[idx];
            leaves.push({ customer: e.customer, order: it.order, joinedTick: it.joinedTick, index: idx,
              kind: leaveKind(e), at: now });
          }
          const source = card ?? (e.by === 'staff' ? document.querySelector('.rstaff') : document.querySelector('.cstage__counter'));
          // after the reaction card is in place
          requestAnimationFrame(() => spawn(source, h, e.correct ? (e.by === 'staff' ? 4 : 6) : 3));
        } else if (e.type === 'customerAbandon' && e.shop === 'player') {
          const idx = counterRef.current.findIndex(i => i.customer === e.customer);
          if (idx >= 0) {
            const it = counterRef.current[idx];
            leaves.push({ customer: e.customer, order: it.order, joinedTick: it.joinedTick, index: idx,
              kind: leaveKind(e), at: now });
          }
        } else if (e.type === 'inputRejected' && e.why !== 'closed') {
          noticeId.current += 1;
          setNotice({ id: noticeId.current, text: refusalText(e.action, e.why) });
        }
      }
      if (leaves.length > 0) setDeparting(ds => [...ds.filter(d => !leaves.some(l => l.customer === d.customer)), ...leaves]);
    },
  }), [subscribe, spawn]);

  // ── Player actions ──
  // What was sent for the next tick: the panel judges its buttons against the counter with these folded in, so a
  // second press inside one tick is taken (the sim applies a tick's actions in order), and a second hand-over or bin
  // before the tick lands is not sent at all.
  const machine = rush.player.machine;
  const [pending, setPending] = useState<{ tick: number; actions: Action[] }>({ tick: -1, actions: [] });
  const pendingRef = useRef(pending);
  const rushRef = useRef(rush);
  rushRef.current = rush;
  const tickRef = useRef(rush.tick);
  tickRef.current = rush.tick;
  const send = useCallback((a: Action) => {
    act(a);
    const t = tickRef.current;
    const prev = pendingRef.current;
    const next = { tick: t, actions: prev.tick === t ? [...prev.actions, a] : [a] };
    pendingRef.current = next;
    setPending(next);
  }, [act]);
  /** The counter as the sim will see it, with everything sent so far (read at the moment of a press). */
  const counterNow = useCallback(() => {
    const r = rushRef.current;
    const pend = pendingRef.current.tick === r.tick ? pendingRef.current.actions : NO_ACTIONS;
    return projectCraft(r.player.craft, r.player.stock, pend, r.tick, r.player.machine);
  }, []);
  const closedRef = useRef(closed);
  closedRef.current = closed;
  const pendingNow = pending.tick === rush.tick ? pending.actions : NO_ACTIONS;
  const projected = useMemo(() => projectCraft(rush.player.craft, rush.player.stock, pendingNow, rush.tick, machine),
    [rush.player.craft, rush.player.stock, pendingNow, rush.tick, machine]);
  // Each press is judged against the counter as it stands after everything already sent, and refused with its reason
  // (the panel shows it); the sim still judges every action it gets.
  const onInput = useCallback((id: CraftButtonId): string | null => {
    const input = inputOf(id);
    if (practiceRef.current.on) {
      const c = pCraft.current;
      const why = checkInput(c, input, null);
      if (why !== null) return rejectText(why, input, projectCup(c));
      setPracticeCraft(craftInput(c, input, null, pTick.current, machine).craft);
      return null;
    }
    const now = counterNow();
    const why = closedRef.current ? 'closed' : checkInput(now.craft, input, now.stock);
    if (why !== null) return rejectText(why, input, projectCup(now.craft));
    send({ type: 'craft', input });
    return null;
  }, [send, machine, counterNow, setPracticeCraft]);
  const onTrash = useCallback((): string | null => {
    const c = practiceRef.current.on ? pCraft.current : counterNow().craft;
    if (c.cup === null) return 'Không có ly nào để bỏ';
    if (practiceRef.current.on) setPracticeCraft(EMPTY_CRAFT);
    else send({ type: 'trash' });
    return null;
  }, [send, counterNow, setPracticeCraft]);
  const onDeliver = useCallback((customer: number): string | null => {
    if (practiceRef.current.on) {
      const c = pCraft.current;
      if (customer !== PRACTICE_ID || c.cup === null || !canDeliver(c)) return 'Ly chưa xong';
      const h = handOver(price, PRACTICE_ORDER, c.cup);
      const now = performance.now();
      setDeparting(ds => [...ds, { customer: PRACTICE_ID, order: PRACTICE_ORDER, joinedTick: -1, index: 0,
        kind: h.correct ? 'cheer' : 'wrong', at: now }]);
      setPracticeCraft({ cup: null, anim: { step: 'deliver', endsAt: pTick.current + CONFIG.craft.deliverTicks }, buffer: [] },
        { result: h });
      return null;
    }
    if (!canDeliver(counterNow().craft)) return 'Ly chưa xong, chưa giao được';
    send({ type: 'deliver', customer });
    return null;
  }, [send, price, counterNow, setPracticeCraft]);
  const startRush = useCallback(() => {
    setPractice(p => ({ ...p, on: false }));
    setDeparting(ds => ds.filter(d => d.customer !== PRACTICE_ID));
  }, []);
  const retryPractice = useCallback(() => setPracticeCraft(EMPTY_CRAFT, { result: null }), [setPracticeCraft]);

  // ── Price and closing ──
  const [priceOpen, setPriceOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const confirmPrice = useCallback((next: number) => {
    act({ type: 'setPrice', price: next });
    setPriceOpen(false);
  }, [act]);
  const cancelPrice = useCallback(() => setPriceOpen(false), []);
  const cancelClose = useCallback(() => setCloseOpen(false), []);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const confirmClose = useCallback(() => {
    setCloseOpen(false);
    setClosedAt(CONFIG.rush.ticks - tickRef.current);
    dispatch({ type: 'closeEarly' });
  }, [dispatch]);
  useEffect(() => {
    if (rush.done) {
      setPriceOpen(false);
      setCloseOpen(false);
    }
  }, [rush.done]);

  // ── The end: outro, then endRush (R55) ──
  const ended = useRef(false);
  const finish = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    dispatch({ type: 'endRush' });
  }, [dispatch]);
  useEffect(() => {
    if (!rush.done) return;
    setOutro(o => o ?? { early: player?.status === 'closedEarly' });
    const t = window.setTimeout(finish, OUTRO_MS);
    return () => window.clearTimeout(t);
  }, [rush.done]);

  // ── What the panel gets, kept stable between ticks ──
  const craft = useStable(practice.on ? practice.craft : projected.craft);
  const stock = useStable(projected.stock);
  // The staff's progress in whole seconds (its ring eases between them): the panel re-renders once a second for it.
  const staff = useStable(rush.player.staff === null ? null : { progress: Math.floor(rush.player.staff.progress / 10) * 10 });
  const time = practice.on ? practiceTime : simTime;
  const hint: PracticeHint = practice.on && practice.result === null ? practiceNext(practice.craft, PRACTICE_ORDER) : null;
  const onClosePanel = useCallback(() => setPanelOpen(false), []);
  const onPrice = useCallback(() => setPriceOpen(true), []);
  const onCloseShop = useCallback(() => setCloseOpen(true), []);

  // The closed bar: who waits, and whether someone is about to walk out.
  const waiting = live.length + cv.rest;
  const now = rush.tick;
  const urgent = live.some(l => patienceUsed(now, l.joinedTick) >= 0.7);
  // Whole seconds: the top bar re-renders once a second, not every tick.
  // After "Đóng cửa sớm" the street is played out at once (R15): the clock stays where the shop closed.
  const ticksLeft = Math.ceil(((closedAt ?? CONFIG.rush.ticks - rush.tick)) / 10) * 10;

  const stats = useMemo(() => ({ cups: rush.player.tally.cups, revenue: rush.player.tally.revenue }),
    [rush.player.tally.cups, rush.player.tally.revenue]);

  // The street shrinks to the strip the panel leaves (a class on the game root; no :has(), which would re-match on
  // every DOM change of the screen).
  const root = useRef<HTMLDivElement>(null);
  const small = streetSmall && showPanel;
  useLayoutEffect(() => {
    const game = root.current?.closest('.game');
    if (game === null || game === undefined) return;
    game.classList.toggle('game--street-small', small);
    return () => game.classList.remove('game--street-small');
  }, [small]);

  return (
    <div ref={root} className={cx('rush', showPanel ? 'rush--open' : 'rush--closed', streetSmall && showPanel && 'rush--street-small',
      outro !== null && 'rush--outro', practice.on && 'rush--practice')} data-panel={showPanel ? 'open' : 'closed'}>
      <RushHud ticksLeft={ticksLeft} cash={rushCash(run, rush)} rep={run.rep} cups={rush.player.tally.cups} stock={stock}
        price={price} priceChanged={rush.player.priceChanged} closed={closed} waiting={practice.on} cashRef={cashRef}
        onPrice={onPrice} onClose={onCloseShop} />

      {soldOut && !closed && !practice.on && (
        <div className="rush__soldout" role="alert">
          <b>Hết trà!</b> <span>Quán đã treo biển hết hàng.</span>
          <button type="button" onClick={onCloseShop}>Đóng cửa sớm</button>
        </div>
      )}

      <div className="rush__panel" aria-hidden={!showPanel} inert={!showPanel}>
        <CraftPanel craft={craft} stock={practice.on ? null : stock} closed={closed} machine={machine} tea={rush.player.tea}
          price={price} time={time} reduced={reduced} counter={counterItems} rest={practice.on ? 0 : row.rest} lookOf={lookOf}
          staff={practice.on ? null : staff} staffServedAt={staffServedAt} practice={hint} notice={notice} open={showPanel}
          onInput={onInput} onTrash={onTrash} onDeliver={onDeliver} onClose={onClosePanel} />
      </div>

      {!showPanel && outro === null && (
        <button type="button" className={cx('rbar', urgent && 'is-urgent')} onClick={() => setPanelOpen(true)}
          aria-label={`Mở bảng pha chế. ${waiting} khách đang chờ`}>
          <span className="rbar__count"><b>{waiting}</b><small>khách chờ</small></span>
          <span className="rbar__faces" aria-hidden="true">
            {live.slice(0, 4).map(l => <OrderBubble key={l.customer} order={l.order} compact />)}
          </span>
          {urgent && <span className="rbar__warn">Sắp có người bỏ về!</span>}
          <span className="rbar__open">Mở bảng <span aria-hidden="true">▴</span></span>
        </button>
      )}

      {practice.on && (
        <aside className="rcoach" aria-label="Ly thử" aria-live="polite">
          <span className="rcoach__tag">Ly thử · không tính tiền · đồng hồ chưa chạy</span>
          {practice.result === null ? (
            <>
              <p className="rcoach__line">{practiceLine(hint ?? 'wait', PRACTICE_ORDER)}</p>
              <button type="button" className="rcoach__skip" onClick={startRush}>Bỏ qua, bán luôn</button>
            </>
          ) : (
            <>
              <p className="rcoach__line">
                {practice.result.correct
                  ? <>Đúng món! Bán thật, khách này trả <b>{fmtMoney(practice.result.paid)}</b>.</>
                  : <>Sai món: khách chỉ trả <b>{fmtMoney(practice.result.paid)}</b> ({practice.result.cutLabel}) và quán bị −2 uy tín tối nay.</>}
                {' '}Lúc bán thật, 4 khách đầu hàng hiện ở quầy: giao cho ai trước cũng được, nhưng đừng để ai chờ quá lâu.
              </p>
              <div className="rcoach__acts">
                {!practice.result.correct && <Button variant="ghost" onClick={retryPractice}>Thử lại</Button>}
                <Button variant="primary" size="lg" onClick={startRush} autoFocus>Bắt đầu 90 giây!</Button>
              </div>
            </>
          )}
        </aside>
      )}

      <div ref={fx} className="rush__fx" aria-hidden="true" />

      <PriceDialog open={priceOpen && !rush.done} morning={rush.player.morningPrice} current={price}
        used={rush.player.priceChanged} ceiling={rush.rules.ceiling} onCancel={cancelPrice} onConfirm={confirmPrice} />

      <CloseDialog open={closeOpen && !rush.done} onCancel={cancelClose} onConfirm={confirmClose} />

      {outro !== null && (
        <div className={cx('routro', outro.early && 'routro--early')} role="status">
          {outro.early && <div className="routro__shutter" aria-hidden="true" />}
          <div className="routro__card">
            <span className="routro__stamp">{outro.early ? 'Đóng cửa' : 'Hết giờ!'}</span>
            <p className="routro__line">
              Bán <b>{stats.cups}</b> ly · thu <b>{fmtMoney(stats.revenue)}</b>
              {rush.player.tally.wrong > 0 && <> · <span className="fx--bad">{rush.player.tally.wrong} ly sai</span></>}
            </p>
            <Button variant="dark" onClick={finish}>Sang buổi chiều →</Button>
          </div>
        </div>
      )}

      {paused && !rush.done && (
        <div className="rpause" role="dialog" aria-modal="true" aria-label="Tạm dừng">
          <div className="rpause__card">
            <b>Tạm dừng</b>
            <p>Đồng hồ đứng yên khi bạn rời trang.</p>
            <Button variant="primary" size="lg" onClick={() => setPaused(false)} autoFocus>Bán tiếp</Button>
          </div>
        </div>
      )}
    </div>
  );
}
