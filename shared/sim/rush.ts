// The 90-second lunch rush: the public entry point of the engine (spec §6; plan "Thứ tự trong một nhịp", "Hiệu năng";
// rulings R8–R19). Setting up the street, one tick (`advance`), stepping and fast-forwarding, the day's result and the
// player's counter view. The internals live in `rush/`: `street.ts` (customers, queues, AI shops), `craft.ts` (the cup
// station, prices and payment) and `player.ts` (the player's actions, staff and stock re-check).
import { CONFIG, type SimConfig } from './config';
import { generateAdCustomers, generateCustomers } from './customers';
import { copyCraft, copyStock } from './rush/craft';
import { producePlayer, playerAction, recheckStock } from './rush/player';
import {
  arrive, closeStreet, enterStreet, flipSoldOut, inspect, isCheckpoint, repriceAi, runOutOfPatience, sellsToday, serveAi,
  shopOf,
} from './rush/street';
import { STREET } from './shops';
import type {
  Action, AiShopState, Customer, CustomerRt, DayRules, K, Order, RushPlayer, RushResult, RushShop, RushState,
  ShopDayResult, SimEvent, Stock, TeaGrade, Tick,
} from './types';

export {
  canDeliver, canServe, checkInput, craftInput, craftTick, cupPrice, orderPrice, orderTeaMl, payment, teaMlFor,
  type CraftResult,
} from './rush/craft';

export interface RushInput {
  seed: number; rules: DayRules;
  /** Today's AI shops after `morningPrices`; a shop not listed is not on the street. */
  ai: readonly AiShopState[];
  player: {
    price: K; tea: TeaGrade; stock: Stock; rep: number; machine: boolean; staff: boolean;
    skimpDays: number; selfCertified: boolean;
  };
  /** Delivery-app customers for the player's shop, appended after the street customers. */
  adCustomers: number;
}
export interface StepResult { state: RushState; events: SimEvent[] }
export interface CounterView { first: { customer: number; order: Order; patienceLeft: Tick }[]; rest: number }

/**
 * Day 5 (§4 Tin đồn, R19): a self-certified shop starts certified; every other shop selling today carries the
 * temporary penalty of 10 + 5 per skimp day until the inspection at 450. No penalty and no badge on other days.
 */
function rumorStart(sells: boolean, selfCertified: boolean, skimpDays: number, rules: DayRules, cfg: SimConfig):
  Pick<RushShop, 'rumorPenalty' | 'certified'> {
  if (!rules.rumor || !sells) return { rumorPenalty: 0, certified: false };
  if (selfCertified) return { rumorPenalty: 0, certified: true };
  return { rumorPenalty: cfg.rumor.basePenalty + cfg.rumor.penaltyPerSkimpDay * skimpDays, certified: false };
}

function aiShop(s: AiShopState, rules: DayRules, cfg: SimConfig): RushShop {
  const spec = cfg.aiShops[s.id];
  const status = s.status === 'active' ? (s.resting ? 'resting' : 'open') : s.status;
  const sells = status === 'open';
  const price = sells ? s.todayPrice : 0;
  if (price === null) throw new Error(`${s.id} opens without a price`);
  // AI shops always stock their full capacity (§4); a shop that does not sell stocks nothing.
  const capacity = sells ? spec.capacity : 0;
  return {
    id: s.id, slot: STREET.indexOf(s.id), status,
    grandOpening: sells && spec.firstDay > 1 && spec.firstDay === rules.day,
    price, openPrice: price, trail: sells ? [[0, price]] : [],
    rep: spec.rep, ...rumorStart(sells, spec.selfCertified, spec.rumorSkimpDays, rules, cfg),
    skimpDays: spec.rumorSkimpDays, named: false, queue: [], sold: 0, revenue: 0,
    ai: { cost: spec.cost, capacity, cupsLeft: capacity, ticksPerCup: spec.ticksPerCup, busy: 0, frozen: rules.cartel },
  };
}

function playerShop(p: RushInput['player'], rules: DayRules, cfg: SimConfig): RushShop {
  return {
    id: 'player', slot: STREET.indexOf('player'),
    status: p.stock.teaMl < cfg.supplies.soldOutBelowMl ? 'soldOut' : 'open', grandOpening: false,
    price: p.price, openPrice: p.price, trail: [[0, p.price]],
    rep: p.rep, ...rumorStart(true, p.selfCertified, p.skimpDays, rules, cfg), skimpDays: p.skimpDays, named: false,
    queue: [], sold: 0, revenue: 0, ai: null,
  };
}

const newRt = (): CustomerRt =>
  ({ status: 'pending', shop: null, joinedTick: -1, visited: [], outcome: null, eligible: false, missedNoStock: false });

/**
 * @internal `createRush` with a given customer list (id = index) in place of the seeded one; tests build
 * small streets with it. Emits nothing: the first `step` emits `rushStart` (R10).
 */
export function createRushWith(input: RushInput, customers: Customer[], cfg: SimConfig = CONFIG): StepResult {
  customers.forEach((c, i) => {
    if (c.id !== i) throw new Error(`customer id ${c.id} at index ${i}`);
  });
  const arrivalOrder = customers.map(c => c.id)
    .sort((a, b) => customers[a].arriveTick - customers[b].arriveTick || a - b);
  const shops = [...input.ai.map(s => aiShop(s, input.rules, cfg)), playerShop(input.player, input.rules, cfg)]
    .sort((a, b) => a.slot - b.slot);
  const p = input.player;
  const state: RushState = {
    day: input.rules.day, tick: 0, done: false, rules: input.rules,
    customers, rt: customers.map(newRt),
    arrivalOrder, nextArrival: 0, nextEnter: 0,
    shops,
    player: {
      morningPrice: p.price, priceChanged: false, gouged: false, dropPermille: 0,
      brokeCartel: input.rules.cartel && p.price < cfg.cards.cartel.price,
      tea: p.tea, machine: p.machine, stock: copyStock(p.stock), bought: copyStock(p.stock),
      handed: { teaMl: 0, toppings: { pearl: 0, jelly: 0, pudding: 0 } },
      craft: { cup: null, anim: null, buffer: [] }, staff: p.staff ? { progress: 0 } : null,
      tally: { revenue: 0, tax: 0, cups: 0, wrong: 0, staffCups: 0, walkouts: 0, missedNoStock: 0, trashed: 0 },
    },
    street: { eligible: 0, emptyHanded: 0, taxFund: 0 },
  };
  return { state, events: [] };
}

/** Opens the rush: the day's customers (ad customers after them, ids N..) and the street as priced this morning. */
export function createRush(input: RushInput, cfg: SimConfig = CONFIG): StepResult {
  const { seed, rules: { day } } = input;
  const street = generateCustomers(seed, day, cfg);
  const ads = generateAdCustomers(seed, day, street.length, input.adCustomers, cfg);
  return createRushWith(input, street.concat(ads), cfg);
}

function clonePlayer(p: RushPlayer): RushPlayer {
  return { ...p, stock: copyStock(p.stock), handed: copyStock(p.handed), craft: copyCraft(p.craft), staff: p.staff && { ...p.staff }, tally: { ...p.tally } };
}

/**
 * @internal A draft of `s` that `advance` may mutate. Copies everything `advance` writes in place (customer
 * runtime entries, shops and their queues and AI books, the player and its cup station, street counters) and shares
 * the rest: customers, arrival order, rules, bought stock, and the readonly arrays that are only ever replaced
 * (`visited`, `trail`).
 */
export function cloneRush(s: RushState): RushState {
  return {
    ...s,
    rt: s.rt.map(r => ({ ...r })),
    shops: s.shops.map(sh => ({ ...sh, queue: [...sh.queue], ai: sh.ai && { ...sh.ai } })),
    player: clonePlayer(s.player),
    street: { ...s.street },
  };
}

/** Exactly one tick. `state` is left untouched. */
export function step(state: RushState, actions: readonly Action[], cfg: SimConfig = CONFIG): StepResult {
  const d = cloneRush(state);
  const events: SimEvent[] = [];
  advance(d, actions, cfg, events);
  return { state: d, events };
}

/**
 * The rest of the rush with no player input: one copy, then `advance` until done. `state` is left untouched.
 * After the player closes early (R15) this simulates the rest of the street at once.
 */
export function finishRush(state: RushState, cfg: SimConfig = CONFIG): StepResult {
  const d = cloneRush(state);
  const events: SimEvent[] = [];
  while (!d.done) advance(d, [], cfg, events);
  return { state: d, events };
}

/**
 * @internal One tick on a draft the caller owns (see `cloneRush`): mutates `d`, appends to `events`.
 * `step` and `finishRush` wrap it; Tasks 7 and 11 build on it. The tick order is fixed (plan).
 */
export function advance(d: RushState, actions: readonly Action[], cfg: SimConfig, events: SimEvent[]): void {
  if (d.done) return;
  const t = d.tick;
  // 1. Player actions in order. Taking stock, or the cup leaving the counter, calls for the stock re-check of step 6.
  let recheck = false;
  for (const a of actions) if (playerAction(d, a, t, cfg, events)) recheck = true;
  // 2. Timeline: the start, the AI checkpoints, the day-5 inspection.
  if (t === 0) events.push({ t, type: 'rushStart', day: d.day, rules: d.rules });
  if (isCheckpoint(t, cfg)) repriceAi(d, t, cfg, events);
  if (d.rules.rumor && t === cfg.rumor.inspectionTick) inspect(d, t, cfg, events);
  // 3–4. Customers walk into view, then those arriving now choose, in id order.
  enterStreet(d, t, cfg, events);
  arrive(d, t, cfg, events);
  // 5. Production: the player's cup station (R14) and staff, then AI shops in slot order.
  if (producePlayer(d, t, cfg, events)) recheck = true;
  serveAi(d, t, events);
  // 6. The player's queue against the stock, when it changed or the cup left the counter.
  if (recheck) recheckStock(d, t, cfg, events);
  // 7. Patience, after production: a cup finished this tick wins.
  runOutOfPatience(d, t, cfg, events);
  // 8. Sold-out signs, the player's included.
  flipSoldOut(d, t, cfg, events);
  // 9. Clock; at 900 the street goes home and a cup in the making is dropped.
  d.tick = t + 1;
  if (d.tick >= cfg.rush.ticks) closeStreet(d, d.tick, events);
}

function dayResult(s: RushShop, p: RushPlayer): ShopDayResult {
  const sells = sellsToday(s);
  return {
    id: s.id, status: s.status, openPrice: sells ? s.openPrice : null, closePrice: sells ? s.price : null,
    trail: s.trail, sold: s.sold, capacity: s.ai === null ? 0 : s.ai.capacity, soldOut: s.status === 'soldOut',
    profit: null,
    // R8: AI rows sum the price at each sale; the player's row is what customers paid.
    revenue: s.ai === null ? p.tally.revenue : s.revenue,
  };
}

/**
 * The day's result for the evening report and the AI books: the player's tally, closing price, stock used and left,
 * gouging and cartel flags; every shop's row (AI profit is left to the evening, `aiProfit`); the street counts and the
 * day-5 rumor's scared, certified and named.
 */
export function summarizeRush(state: RushState, cfg: SimConfig = CONFIG): RushResult {
  const p = state.player;
  const used = copyStock(p.bought);
  used.teaMl -= p.stock.teaMl;
  for (const k of cfg.customers.toppingOrder) used.toppings[k] -= p.stock.toppings[k];
  return {
    player: { ...p.tally, closePrice: shopOf(state, 'player').price, used, left: copyStock(p.stock), handed: copyStock(p.handed),
      gouged: p.gouged, brokeCartel: p.brokeCartel },
    shops: state.shops.map(s => dayResult(s, p)),
    customers: state.customers.length,
    eligible: state.street.eligible, emptyHanded: state.street.emptyHanded, taxFund: state.street.taxFund,
    scared: state.rt.filter(r => r.outcome === 'scared').length,
    certified: state.shops.filter(s => s.certified).map(s => s.id),
    named: state.shops.filter(s => s.named).map(s => s.id),
  };
}

/** The player's counter (§6 Quầy): the first 4 of its queue with the patience they have left, and how many more wait. */
export function counterView(state: RushState, cfg: SimConfig = CONFIG): CounterView {
  const queue = shopOf(state, 'player').queue;
  const n = Math.min(queue.length, cfg.rush.counterSlots);
  const first: CounterView['first'] = [];
  for (let i = 0; i < n; i++) {
    const id = queue[i];
    first.push({ customer: id, order: state.customers[id].order,
      patienceLeft: cfg.rush.patienceTicks - (state.tick - state.rt[id].joinedTick) });
  }
  return { first, rest: queue.length - n };
}
