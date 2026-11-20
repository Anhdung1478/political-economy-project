// Pure helpers of the lunch-rush screen (spec §6 "Pha một ly", "Quầy", "Đổi giá giữa trưa", §9 "Bảng pha chế"): which
// craft buttons are lit and why the others are not, the cup as it will be once the buffered inputs run, how far the
// running step is, the next step of the day-1 practice cup, what a hand-over pays, what a price change would do, the
// patience face, stock warnings, and the counter row with the customers who just left still in it. No React here.
import { CONFIG, type SimConfig } from '../../../../shared/sim/config';
import { checkInput, orderPrice, payment } from '../../../../shared/sim/rush';
import type {
  CraftInput, CraftState, Cup, InputReject, K, Order, RunState, RushState, Size, Stock, Tick, ToppingId,
} from '../../../../shared/sim/types';
import { fmtMoney, fmtNumber } from '../../game/format';
import { CROSS_AT, FUME_AT, TAP_AT } from '../../scene/draw/characters';
import { TOPPING_NAMES } from './copy';

// ── Craft buttons ───────────────────────────────────────────────────────────────────────────────────────────────────

export type CraftButtonId = Size | 'ice' | 'tea' | ToppingId;

export const SIZES: readonly Size[] = ['S', 'M', 'L'];
export const TOPPINGS: readonly ToppingId[] = CONFIG.customers.toppingOrder;

export function inputOf(id: CraftButtonId): CraftInput {
  switch (id) {
    case 'S': case 'M': case 'L': return { k: 'size', size: id };
    case 'ice': return { k: 'ice' };
    case 'tea': return { k: 'tea' };
    default: return { k: 'topping', id };
  }
}

export const CRAFT_BUTTONS: readonly CraftButtonId[] = ['S', 'M', 'L', 'ice', 'tea', 'pearl', 'jelly', 'pudding'];

export const STEP_NAMES: Record<CraftInput['k'] | 'deliver', string> = {
  size: 'Ly', ice: 'Đá', tea: 'Trà', topping: 'Topping', deliver: 'Giao',
};

/** A short name for an input: "Ly M", "Đá", "Trà", "Trân châu". */
export function inputLabel(input: CraftInput): string {
  switch (input.k) {
    case 'size': return `Ly ${input.size}`;
    case 'topping': return TOPPING_NAMES[input.id];
    default: return STEP_NAMES[input.k];
  }
}

/** The cup as it will be once the running step and every buffered input are done; null when the counter stays empty. */
export interface ProjectedCup { size: Size; iced: boolean; tea: boolean; toppings: ToppingId[] }

export function projectCup(craft: CraftState): ProjectedCup | null {
  const c = craft.cup;
  let p: ProjectedCup | null = c === null ? null
    : { size: c.size, iced: c.iced, tea: c.teaMl > 0, toppings: [...c.toppings] };
  for (const b of craft.buffer) {
    if (b.k === 'size') p = { size: b.size, iced: false, tea: false, toppings: [] };
    else if (p === null) continue;
    else if (b.k === 'ice') p.iced = true;
    else if (b.k === 'tea') p.tea = true;
    else p.toppings.push(b.id);
  }
  return p;
}

/** Why a button is dark, in a few words a player reads at a glance (Vietnamese). */
export function rejectText(why: InputReject, input: CraftInput | null, cup: ProjectedCup | null,
  cfg: SimConfig = CONFIG): string {
  switch (why) {
    case 'noCup': return 'Chưa có ly: chọn size trước';
    case 'bufferFull': return `Đã bấm trước ${cfg.craft.bufferMax} bước, chờ chút`;
    case 'duplicate': return input?.k === 'topping' ? `Ly đã có ${TOPPING_NAMES[input.id].toLowerCase()}` : 'Đã có rồi';
    case 'noTea': return cup === null ? 'Không đủ trà' : `Không đủ trà cho ly ${cup.size}`;
    case 'noTopping': return input?.k === 'topping' ? `Hết ${TOPPING_NAMES[input.id].toLowerCase()}` : 'Hết topping';
    case 'busy': return 'Đang pha, chờ xong bước này';
    case 'closed': return 'Quán đã đóng cửa';
    case 'notInFirstFour': return 'Khách này chưa tới quầy';
    case 'priceUsed': return 'Trưa nay đã đổi giá rồi';
    case 'priceRange': return `Giá phải từ ${cfg.pricing.min}k đến ${cfg.pricing.max}k`;
    case 'ceiling': return 'Vượt giá trần';
    case 'order': {
      if (input === null) return 'Ly chưa có trà';
      if (input.k === 'size') return 'Đang có ly: giao hoặc bỏ ly này trước';
      if (input.k === 'ice') return cup?.iced ? 'Ly đã có đá' : 'Chọn size trước';
      if (input.k === 'tea') return cup?.tea ? 'Ly đã có trà' : 'Đổ đá trước đã';
      return 'Rót trà trước rồi mới thêm topping';
    }
  }
}

export interface ButtonState {
  id: CraftButtonId;
  input: CraftInput;
  /** null: lit, pressing it starts or queues the step. */
  why: InputReject | null;
  reason: string | null;
}

/**
 * Every craft button as the engine would judge it now (`checkInput`, the projected cup and the live stock; `stock`
 * null is the practice cup). After closing early everything is dark.
 */
export function buttonStates(craft: CraftState, stock: Stock | null, closed: boolean,
  cfg: SimConfig = CONFIG): ButtonState[] {
  const cup = projectCup(craft);
  return CRAFT_BUTTONS.map(id => {
    const input = inputOf(id);
    const why: InputReject | null = closed ? 'closed' : checkInput(craft, input, stock, cfg);
    return { id, input, why, reason: why === null ? null : rejectText(why, input, cup, cfg) };
  });
}

/** The inputs pressed ahead, as names ("Đá", "Trà", "Trân châu"). */
export const bufferLabels = (craft: CraftState): string[] => craft.buffer.map(inputLabel);

// ── Step timing ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** How long a step runs, in ticks (§6 table; the machine halves the pour). */
export function stepTicks(step: CraftInput['k'] | 'deliver', size: Size | null, machine: boolean,
  cfg: SimConfig = CONFIG): Tick {
  const c = cfg.craft;
  switch (step) {
    case 'size': return c.sizeTicks;
    case 'ice': return c.iceTicks;
    case 'tea': return (machine ? c.machineTeaTicks : c.teaTicks)[size ?? 'M'];
    case 'topping': return c.toppingTicks;
    case 'deliver': return c.deliverTicks;
  }
}

/**
 * How far the running step is at sim time `now` (fractional ticks), 0..1. A step started at tick t shows over
 * t..endsAt (R14), so it is done exactly when the tick that completes it is pushed.
 */
export function stepProgress(anim: CraftState['anim'], now: number, size: Size | null, machine: boolean,
  cfg: SimConfig = CONFIG): number {
  if (anim === null) return 1;
  const d = stepTicks(anim.step, size, machine, cfg);
  const p = (now - (anim.endsAt - d)) / d;
  return p <= 0 ? 0 : p >= 1 ? 1 : p;
}

// ── The day-1 practice cup ──────────────────────────────────────────────────────────────────────────────────────────

/** The practice customer's order: an M with pearls, every step once. */
export const PRACTICE_ORDER: Order = { size: 'M', toppings: ['pearl'] };

/**
 * What the practice cup needs next for `order`: a button, `deliver` once it is ready to hand over, `wait` while a step
 * is still running with nothing left to press, or `trash` when the cup went wrong.
 */
export function practiceNext(craft: CraftState, order: Order): CraftButtonId | 'deliver' | 'wait' | 'trash' {
  const p = projectCup(craft);
  if (p === null) return order.size;
  if (p.size !== order.size || p.toppings.some(t => !order.toppings.includes(t))) return 'trash';
  if (!p.iced) return 'ice';
  if (!p.tea) return 'tea';
  const missing = order.toppings.find(t => !p.toppings.includes(t));
  if (missing !== undefined) return missing;
  return craft.anim === null && craft.buffer.length === 0 ? 'deliver' : 'wait';
}

/** The practice coach's line for that next step. */
export function practiceLine(next: ReturnType<typeof practiceNext>, order: Order): string {
  switch (next) {
    case 'S': case 'M': case 'L': return `Khách gọi ly ${order.size}: chạm “${next}” để đặt ly xuống quầy.`;
    case 'ice': return 'Chạm “Đá” để đổ đá.';
    case 'tea': return 'Chạm “Trà”: trà tự rót tới vạch của size.';
    case 'pearl': case 'jelly': case 'pudding': return `Thêm ${TOPPING_NAMES[next].toLowerCase()}, đúng như đơn.`;
    case 'deliver': return 'Xong! Kéo ly thả vào khách (hoặc chạm ly rồi chạm khách).';
    case 'wait': return 'Đang pha… Bạn có thể bấm trước tối đa 3 bước.';
    case 'trash': return 'Ly này sai đơn rồi: bỏ vào thùng rác và pha lại.';
  }
}

// ── Orders, hand-over and payment ───────────────────────────────────────────────────────────────────────────────────

/** "M · trân châu, thạch" / "L · không topping". */
export function orderLabel(order: Order): string {
  const tops = order.toppings.length === 0 ? 'không topping'
    : order.toppings.map(t => TOPPING_NAMES[t].toLowerCase()).join(', ');
  return `${order.size} · ${tops}`;
}

export interface HandOver {
  correct: boolean;
  paid: K;
  /** The order's full price. */
  full: K;
  /** What a wrong cup costs the shop against the full price (0 when right). */
  cut: K;
  /** "−30%": the cut as a share of the full price, rounded to a whole percent. */
  cutLabel: string | null;
}

/** What handing `cup` to someone who ordered `order` pays at `price` (the engine's `payment`). */
export function handOver(price: K, order: Order, cup: Cup, cfg: SimConfig = CONFIG): HandOver {
  const { correct, paid } = payment(price, order, cup, cfg);
  return outcomeOf(correct, paid, orderPrice(price, order, cfg));
}

/** The same from a sale event's numbers. */
export function outcomeOf(correct: boolean, paid: K, full: K): HandOver {
  const cut = correct ? 0 : Math.max(0, full - paid);
  const pct = full > 0 ? Math.round((cut / full) * 100) : 0;
  return { correct, paid, full, cut, cutLabel: correct ? null : `−${pct}%` };
}

// ── Price change ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PriceImpact {
  /** Change against the morning price, whole percent with sign. */
  pct: number;
  kind: 'same' | 'raise' | 'gouge' | 'cut' | 'steep';
  /** Steep cut: the share of customers the skeptic test sends away (0..1). */
  scareShare: number;
  /** The confirm button may be pressed. */
  ok: boolean;
  /** Why not, when it may not. */
  issue: string | null;
}

/**
 * What changing the M price to `next` would do (§6 Đổi giá giữa trưa, the engine's own thresholds): above +20% of
 * the morning price is gouging (−5 rep tonight); below −20% the skeptic test sends away
 * (drop − 20%) × 2.5 of the customers. Confirm stays dark when nothing changes (R20), after the one change, off the
 * 1k grid, out of range or above the ceiling.
 */
export function priceImpact(morning: K, current: K, next: K, used: boolean, ceiling: K | null,
  cfg: SimConfig = CONFIG): PriceImpact {
  const pc = cfg.priceChange;
  const diff = next - morning;
  const pct = morning > 0 ? Math.round((diff / morning) * 100) : 0;
  const gouge = diff * 100 > pc.gougePercent * morning;
  const dropPermille = -diff * 1000 > pc.discountPermille * morning ? Math.floor((-diff * 1000) / morning) : 0;
  const scareShare = dropPermille === 0 ? 0
    : Math.min(1, Math.max(0, ((dropPermille - pc.discountPermille) * pc.skepticSlopeTenths) / 10000));
  const kind: PriceImpact['kind'] = next === morning ? 'same' : gouge ? 'gouge' : dropPermille > 0 ? 'steep'
    : diff > 0 ? 'raise' : 'cut';
  let issue: string | null = null;
  if (used) issue = rejectText('priceUsed', null, null, cfg);
  else if (next === current) issue = 'Giá chưa đổi';
  else if (next < cfg.pricing.min || next > cfg.pricing.max || next % cfg.pricing.step !== 0) {
    issue = rejectText('priceRange', null, null, cfg);
  } else if (ceiling !== null && next > ceiling) issue = `Giá trần hôm nay là ${ceiling}k`;
  return { pct, kind, scareShare, ok: issue === null, issue };
}

/** The consequences of a price change, as the dialog's lines (tone + text). */
export function priceLines(impact: PriceImpact, cfg: SimConfig = CONFIG): { tone: 'ok' | 'warn' | 'bad'; text: string }[] {
  const out: { tone: 'ok' | 'warn' | 'bad'; text: string }[] = [];
  switch (impact.kind) {
    case 'same':
      out.push({ tone: 'ok', text: 'Bằng giá buổi sáng.' });
      break;
    case 'raise':
      out.push({ tone: 'warn', text: 'Khách đang xếp hàng sẽ tính lại; ai thấy không còn đáng sẽ sang quán khác.' });
      break;
    case 'gouge':
      out.push({ tone: 'bad', text: `Tăng quá ${cfg.priceChange.gougePercent}%: bị ghi “chặt chém”, ${fmtNumber(cfg.rep.gouge, 0)} uy tín tối nay.` });
      out.push({ tone: 'warn', text: 'Khách đang xếp hàng sẽ tính lại với giá mới.' });
      break;
    case 'cut':
      out.push({ tone: 'ok', text: 'Khách thấy rẻ hơn; hàng có thể dài thêm.' });
      break;
    case 'steep':
      out.push({ tone: 'bad', text: `Giảm quá ${cfg.priceChange.discountPermille / 10}%: khoảng ${Math.round(impact.scareShare * 100)}% khách đa nghi sẽ bỏ đi vì sợ trà kém (cả khách đến sau).` });
      break;
  }
  return out;
}

// ── Patience and stock ──────────────────────────────────────────────────────────────────────────────────────────────

/** The share of their patience a customer who joined at `joinedTick` has used at `now` (0..1). */
export function patienceUsed(now: number, joinedTick: Tick, cfg: SimConfig = CONFIG): number {
  const u = (now - joinedTick) / cfg.rush.patienceTicks;
  return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

export interface PatienceLook {
  mood: 'happy' | 'neutral' | 'annoyed' | 'angry';
  clip: 'idle' | 'tap' | 'crossed';
  tone: 'ok' | 'warn' | 'bad';
}

/** The face at the counter as patience runs down, on the street's own thresholds (tap, arms crossed, fuming). */
export function patienceLook(used: number): PatienceLook {
  if (used >= FUME_AT) return { mood: 'angry', clip: 'crossed', tone: 'bad' };
  if (used >= CROSS_AT) return { mood: 'annoyed', clip: 'crossed', tone: 'bad' };
  if (used >= TAP_AT) return { mood: 'annoyed', clip: 'tap', tone: 'warn' };
  if (used < 0.15) return { mood: 'happy', clip: 'idle', tone: 'ok' };
  return { mood: 'neutral', clip: 'idle', tone: 'ok' };
}

export type StockLevel = 'ok' | 'low' | 'out';
export interface StockView {
  teaMl: number;
  /** M cups the tea still makes. */
  teaCups: number;
  tea: StockLevel;
  toppings: Record<ToppingId, { n: number; level: StockLevel }>;
}

/** Stock with its warnings: tea out under an S cup, low under 3 M cups; a topping out at 0, low at 2 or fewer. */
export function stockView(stock: Stock, cfg: SimConfig = CONFIG): StockView {
  const ml = cfg.supplies.sizeMl;
  const tea: StockLevel = stock.teaMl < ml.S ? 'out' : stock.teaMl < ml.M * 3 ? 'low' : 'ok';
  const toppings = {} as StockView['toppings'];
  for (const t of TOPPINGS) {
    const n = stock.toppings[t];
    toppings[t] = { n, level: n <= 0 ? 'out' : n <= 2 ? 'low' : 'ok' };
  }
  return { teaMl: stock.teaMl, teaCups: Math.floor(stock.teaMl / ml.M), tea, toppings };
}

/** "4.250 ml" or "1,2 L" for the HUD. */
export const fmtMl = (ml: number): string => (ml >= 1000 ? `${fmtNumber(ml / 1000, 1)} L` : `${fmtNumber(ml, 0)} ml`);

/** The cash the HUD shows during the rush: the morning's cash after buying, plus takings, less the day's tax. */
export const rushCash = (run: RunState, rush: RushState): K => run.cash + rush.player.tally.revenue - rush.player.tally.tax;

/** "+35k" for a sale. */
export const saleLabel = (paid: K): string => `+${fmtMoney(paid)}`;

// ── The counter row ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface LiveSlot { customer: number; order: Order; joinedTick: Tick }
export type LeaveKind = 'cheer' | 'wrong' | 'angry' | 'gone';
/** A customer who just left the counter, kept on screen for their reaction. */
export interface Departure {
  customer: number; order: Order; joinedTick: Tick;
  /** Their place in the row when they left. */
  index: number;
  kind: LeaveKind;
  /** When they left (ms, the page clock). */
  at: number;
}
export interface CounterItem extends LiveSlot { leaving: Departure | null }

/**
 * The counter row: the first `slots` customers, with those who just left still standing in their place for their
 * reaction (whoever moves up waits behind them a moment); `rest` is everyone else waiting.
 */
export function counterRow(live: readonly LiveSlot[], departing: readonly Departure[], queueRest: number,
  slots: number = CONFIG.rush.counterSlots): { items: CounterItem[]; rest: number } {
  const list: CounterItem[] = live.map(l => ({ ...l, leaving: null }));
  const leaving = departing.filter(d => !live.some(l => l.customer === d.customer))
    .sort((a, b) => a.index - b.index);
  for (const d of leaving) {
    list.splice(Math.min(d.index, list.length), 0,
      { customer: d.customer, order: d.order, joinedTick: d.joinedTick, leaving: d });
  }
  const items = list.slice(0, slots);
  const hiddenLive = list.slice(slots).filter(i => i.leaving === null).length;
  return { items, rest: queueRest + hiddenLive };
}

/** Which kind of exit a sale or an abandon at the player's counter is. */
export function leaveKind(e: { type: 'customerServed'; correct: boolean } | { type: 'customerAbandon'; cause: string }): LeaveKind {
  if (e.type === 'customerServed') return e.correct ? 'cheer' : 'wrong';
  return e.cause === 'patience' || e.cause === 'priceUp' ? 'angry' : 'gone';
}
