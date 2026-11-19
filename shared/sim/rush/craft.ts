// The player's counter rules (spec §4 Giá, §6 Pha một ly and Quầy, §16.3/4, ruling R14): what an order and a cup
// cost and pay, the stock an order needs, and the cup station: step order, the 3-input buffer, step durations, stock
// taken when a step starts. Pure functions for the scene and the day-1 practice cup, with the mutating internals the
// rush engine runs on its draft.
import { CONFIG, type SimConfig } from '../config';
import type {
  CraftInput, CraftState, Cup, InputReject, K, Order, SimEvent, Size, Stock, StockItem, Tick,
} from '../types';

/** The stock covers this order: tea for its size and a portion of each topping (§6 "Còn hàng cho một đơn"). */
export function canServe(stock: Stock, order: Order, cfg: SimConfig = CONFIG): boolean {
  if (stock.teaMl < cfg.supplies.sizeMl[order.size]) return false;
  for (const t of order.toppings) if (stock.toppings[t] < 1) return false;
  return true;
}

/** @internal The first item the stock lacks for this order, tea before toppings in canonical order; null if none. */
export function missingFor(stock: Stock, order: Order, cfg: SimConfig): StockItem | null {
  if (stock.teaMl < cfg.supplies.sizeMl[order.size]) return 'tea';
  for (const t of order.toppings) if (stock.toppings[t] < 1) return t;
  return null;
}

/** What the customer pays for this order made right: the M price, −5k for S, +5k for L, +5k per topping (§4). */
export function orderPrice(price: K, order: Order, cfg: SimConfig = CONFIG): K {
  return price + cfg.pricing.sizeSurcharge[order.size] + cfg.pricing.toppingSurcharge * order.toppings.length;
}

/** What this cup is worth by the same rule. */
export function cupPrice(price: K, cup: Cup, cfg: SimConfig = CONFIG): K {
  return price + cfg.pricing.sizeSurcharge[cup.size] + cfg.pricing.toppingSurcharge * cup.toppings.length;
}

/** The cup is this order: same size, same set of toppings. */
function isOrder(cup: Cup, order: Order): boolean {
  if (cup.size !== order.size || cup.toppings.length !== order.toppings.length) return false;
  for (const t of cup.toppings) if (!order.toppings.includes(t)) return false;
  return true;
}

/**
 * The right cup pays the order in full. A wrong one pays 70% of the cheaper of order and cup, rounded down to 1k:
 * extras are never paid for (§6 Quầy: 41k ordered, 31k given → 21k).
 */
export function payment(price: K, order: Order, cup: Cup, cfg: SimConfig = CONFIG): { correct: boolean; paid: K } {
  const full = orderPrice(price, order, cfg);
  if (isOrder(cup, order)) return { correct: true, paid: full };
  return { correct: false, paid: Math.floor(Math.min(full, cupPrice(price, cup, cfg)) * cfg.pricing.wrongPayTenths / 10) };
}

/** The cup can still become this order: same size, and every topping already in it was ordered (§16.3). */
export function holds(order: Order, cup: Cup): boolean {
  if (order.size !== cup.size) return false;
  for (const t of cup.toppings) if (!order.toppings.includes(t)) return false;
  return true;
}

// How far a cup has come, in step order.
const NO_CUP = 0;
const SIZED = 1;
const ICED = 2;
const POURED = 3;
/** The stage a cup must be at for each step, and the stage it reaches. */
const STAGE_NEEDED: Record<CraftInput['k'], number> = { size: NO_CUP, ice: SIZED, tea: ICED, topping: POURED };
const STAGE_AFTER: Record<CraftInput['k'], number> = { size: SIZED, ice: ICED, tea: POURED, topping: POURED };

const stageOf = (cup: Cup | null): number =>
  cup === null ? NO_CUP : cup.teaMl > 0 ? POURED : cup.iced ? ICED : SIZED;

/** The step order (§6): size, ice, tea, then 0–3 different toppings. */
function orderReject(input: CraftInput, stage: number, duplicate: boolean): InputReject | null {
  if (stage === NO_CUP && input.k !== 'size') return 'noCup';
  if (stage !== STAGE_NEEDED[input.k]) return 'order';
  return duplicate ? 'duplicate' : null;
}

/** The stock a step takes: the tea of the cup's size, or a portion of the topping. Size and ice take none. */
function stockReject(input: CraftInput, size: Size | null, stock: Stock, cfg: SimConfig): InputReject | null {
  if (input.k === 'tea') return size === null || stock.teaMl < cfg.supplies.sizeMl[size] ? 'noTea' : null;
  if (input.k === 'topping') return stock.toppings[input.id] < 1 ? 'noTopping' : null;
  return null;
}

/**
 * Why this input cannot be pressed now, or null. It is judged against the cup as it will be once the running step and
 * the buffer are done; a running step leaves room for 3 inputs. The stock must cover the step as it stands now; the
 * size step is not checked against the tea. `stock` null is the day-1 practice cup, which never runs out.
 */
export function checkInput(craft: CraftState, input: CraftInput, stock: Stock | null,
  cfg: SimConfig = CONFIG): InputReject | null {
  if (craft.anim !== null && craft.buffer.length >= cfg.craft.bufferMax) return 'bufferFull';
  const cup = craft.cup;
  let stage = stageOf(cup);
  let size = cup === null ? null : cup.size;
  let duplicate = input.k === 'topping' && cup !== null && cup.toppings.includes(input.id);
  for (const b of craft.buffer) {
    stage = STAGE_AFTER[b.k];
    if (b.k === 'size') size = b.size;
    else if (b.k === 'topping' && input.k === 'topping' && b.id === input.id) duplicate = true;
  }
  return orderReject(input, stage, duplicate) ?? (stock === null ? null : stockReject(input, size, stock, cfg));
}

/** The cup can be handed over: it has tea and no animation is running (§6). */
export function canDeliver(craft: CraftState): boolean {
  return craft.anim === null && craft.cup !== null && craft.cup.teaMl > 0;
}

function stepTicks(input: CraftInput, size: Size, machine: boolean, cfg: SimConfig): Tick {
  const c = cfg.craft;
  switch (input.k) {
    case 'size': return c.sizeTicks;
    case 'ice': return c.iceTicks;
    case 'tea': return (machine ? c.machineTeaTicks : c.teaTicks)[size];
    case 'topping': return c.toppingTicks;
  }
}

/**
 * Starts a checked step at tick t (R14): its stock is taken now and it goes into the cup now; its animation runs
 * until t + its ticks. Returns whether stock was taken.
 */
function startStep(craft: CraftState, input: CraftInput, stock: Stock | null, t: Tick, machine: boolean,
  events: SimEvent[], cfg: SimConfig): boolean {
  if (input.k === 'size') craft.cup = { size: input.size, iced: false, teaMl: 0, toppings: [] };
  const cup = craft.cup;
  if (cup === null) throw new Error(`${input.k} without a cup`);
  let took = false;
  if (input.k === 'ice') {
    cup.iced = true;
  } else if (input.k === 'tea') {
    cup.teaMl = cfg.supplies.sizeMl[cup.size];
    if (stock !== null) stock.teaMl -= cup.teaMl;
    took = stock !== null;
  } else if (input.k === 'topping') {
    cup.toppings.push(input.id);
    if (stock !== null) stock.toppings[input.id]--;
    took = stock !== null;
  }
  const endsAt = t + stepTicks(input, cup.size, machine, cfg);
  craft.anim = { step: input.k, endsAt };
  events.push({ t, type: 'craftStep', step: input.k, endsAt });
  return took;
}

/**
 * @internal An input pressed at tick t, on a station the caller owns (mutates `craft` and `stock`): refused with
 * `inputRejected`, started at once on an idle counter, or queued behind the running step. Returns whether stock was taken.
 */
export function applyInput(craft: CraftState, input: CraftInput, stock: Stock | null, t: Tick, machine: boolean,
  events: SimEvent[], cfg: SimConfig): boolean {
  const why = checkInput(craft, input, stock, cfg);
  if (why !== null) {
    events.push({ t, type: 'inputRejected', action: 'craft', why });
    return false;
  }
  if (craft.anim !== null) {
    craft.buffer.push({ ...input }); // the state never shares an object with the caller's action
    return false;
  }
  return startStep(craft, input, stock, t, machine, events, cfg);
}

/**
 * @internal Production at tick t on a station the caller owns (R14): the running step completes in the tick it ends
 * and the next queued input starts in that same tick, checked again against the stock as it is now. If the stock no
 * longer covers it, it and the rest of the buffer are dropped with `inputRejected`. Returns whether stock was taken.
 */
export function tickCraft(craft: CraftState, stock: Stock | null, t: Tick, machine: boolean, events: SimEvent[],
  cfg: SimConfig): boolean {
  if (craft.anim === null || craft.anim.endsAt > t) return false;
  craft.anim = null;
  const next = craft.buffer.shift();
  if (next === undefined) return false;
  const why = stock === null ? null : stockReject(next, craft.cup === null ? null : craft.cup.size, stock, cfg);
  if (why !== null) {
    craft.buffer.length = 0;
    events.push({ t, type: 'inputRejected', action: 'craft', why });
    return false;
  }
  return startStep(craft, next, stock, t, machine, events, cfg);
}

/** @internal Empties the counter: the cup, its running step and the buffer. What the cup used stays used. */
export function dropCup(craft: CraftState): void {
  craft.cup = null;
  craft.anim = null;
  craft.buffer.length = 0;
}

export const copyStock = (s: Stock): Stock => ({ teaMl: s.teaMl, toppings: { ...s.toppings } });

/** @internal A copy of the station that the mutating internals may write to. */
export const copyCraft = (c: CraftState): CraftState => ({
  cup: c.cup && { ...c.cup, toppings: [...c.cup.toppings] }, anim: c.anim && { ...c.anim }, buffer: [...c.buffer],
});

export interface CraftResult { craft: CraftState; stock: Stock | null; events: SimEvent[] }

/**
 * Presses one input at tick t (R14). Pure: returns a new station and stock. `stock` null is the day-1 practice cup,
 * which uses no stock; `machine` halves the pour.
 */
export function craftInput(craft: CraftState, input: CraftInput, stock: Stock | null, t: Tick, machine: boolean,
  cfg: SimConfig = CONFIG): CraftResult {
  const r: CraftResult = { craft: copyCraft(craft), stock: stock && copyStock(stock), events: [] };
  applyInput(r.craft, input, r.stock, t, machine, r.events, cfg);
  return r;
}

/** Runs the station's production for tick t (call it once per tick, in order). Pure, like `craftInput`. */
export function craftTick(craft: CraftState, stock: Stock | null, t: Tick, machine: boolean,
  cfg: SimConfig = CONFIG): CraftResult {
  const r: CraftResult = { craft: copyCraft(craft), stock: stock && copyStock(stock), events: [] };
  tickCraft(r.craft, r.stock, t, machine, r.events, cfg);
  return r;
}
