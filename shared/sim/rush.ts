// The 90-second lunch rush, street part: clock, customers walking in and choosing, queues, AI service,
// patience and re-shopping, mid-rush AI prices, sold-out signs and the event stream for the scene
// (spec §4 Khách, 6 quán AI, §6, §16.2/5/6; plan "Thứ tự trong một nhịp", "Hiệu năng", rulings R8–R10).
// The player's crafting and delivery (Task 6) and price change and day-5 policy (Task 7) build on `advance`.
import { evaluate, staysAfterReprice, type ShopOffer } from './choice';
import { CONFIG, type SimConfig } from './config';
import { generateAdCustomers, generateCustomers } from './customers';
import { STREET, midRushPrice } from './shops';
import type {
  Action, AiShopState, Customer, CustomerOutcome, CustomerRt, DayRules, K, LeaveCause, Order, RushPlayer, RushResult,
  RushShop, RushState, ShopDayResult, ShopId, SimEvent, Stock, TeaGrade, Tick, ToppingId,
} from './types';

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

/** The stock covers this order: tea for its size and a portion of each topping (§6 "Còn hàng cho một đơn"). */
export function canServe(stock: Stock, order: Order, cfg: SimConfig = CONFIG): boolean {
  if (stock.teaMl < cfg.supplies.sizeMl[order.size]) return false;
  for (const t of order.toppings) if (stock.toppings[t] < 1) return false;
  return true;
}

const copyStock = (s: Stock): Stock => ({ teaMl: s.teaMl, toppings: { ...s.toppings } });

/** Open, sold out or closed early: the shop put a price on the board today. */
const sellsToday = (s: RushShop) => s.status === 'open' || s.status === 'soldOut' || s.status === 'closedEarly';

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
    rep: spec.rep, rumorPenalty: 0, certified: false, named: false, queue: [], sold: 0, revenue: 0,
    ai: { cost: spec.cost, capacity, cupsLeft: capacity, ticksPerCup: spec.ticksPerCup, busy: 0, frozen: rules.cartel },
  };
}

function playerShop(p: RushInput['player'], cfg: SimConfig): RushShop {
  return {
    id: 'player', slot: STREET.indexOf('player'),
    status: p.stock.teaMl < cfg.supplies.soldOutBelowMl ? 'soldOut' : 'open', grandOpening: false,
    price: p.price, openPrice: p.price, trail: [[0, p.price]],
    rep: p.rep, rumorPenalty: 0, certified: false, named: false, queue: [], sold: 0, revenue: 0, ai: null,
  };
}

const newRt = (): CustomerRt =>
  ({ status: 'pending', shop: null, joinedTick: -1, visited: [], outcome: null, eligible: false });

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
  const shops = [...input.ai.map(s => aiShop(s, input.rules, cfg)), playerShop(input.player, cfg)]
    .sort((a, b) => a.slot - b.slot);
  const p = input.player;
  const state: RushState = {
    day: input.rules.day, tick: 0, done: false, rules: input.rules,
    customers, rt: customers.map(newRt),
    arrivalOrder, nextArrival: 0, nextEnter: 0,
    shops,
    player: {
      morningPrice: p.price, priceChanged: false, gouged: false, dropPermille: 0, brokeCartel: false,
      tea: p.tea, machine: p.machine, stock: copyStock(p.stock), bought: copyStock(p.stock),
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
  const cup = p.craft.cup;
  return {
    ...p,
    stock: copyStock(p.stock),
    craft: { cup: cup && { ...cup, toppings: [...cup.toppings] }, anim: p.craft.anim && { ...p.craft.anim },
      buffer: [...p.craft.buffer] },
    staff: p.staff && { ...p.staff },
    tally: { ...p.tally },
  };
}

/**
 * @internal A draft of `s` that `advance` may mutate. Copies everything `advance` writes in place (customer
 * runtime entries, shops and their queues and AI books, the player, street counters) and shares the rest:
 * customers, arrival order, rules, bought stock, and the arrays that are only ever replaced (`visited`, `trail`).
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

/** The rest of the rush with no player input: one copy, then `advance` until done. `state` is left untouched. */
export function finishRush(state: RushState, cfg: SimConfig = CONFIG): StepResult {
  const d = cloneRush(state);
  const events: SimEvent[] = [];
  while (!d.done) advance(d, [], cfg, events);
  return { state: d, events };
}

/**
 * @internal One tick on a draft the caller owns (see `cloneRush`): mutates `d`, appends to `events`.
 * `step` and `finishRush` wrap it; Tasks 6, 7 and 11 build on it. The tick order is fixed (plan).
 */
export function advance(d: RushState, actions: readonly Action[], cfg: SimConfig, events: SimEvent[]): void {
  if (d.done) return;
  const t = d.tick;
  // 1. Player actions: craft, deliver, trash and closeEarly come with Task 6, setPrice with Task 7.
  if (actions.length > 0) throw new Error(`action '${actions[0].type}' is not supported yet`);
  // 2. Timeline (the day-5 inspection at 450 comes with Task 7).
  if (t === 0) events.push({ t, type: 'rushStart', day: d.day, rules: d.rules });
  if (isCheckpoint(t, cfg)) repriceAi(d, t, cfg, events);
  // 3–4. Customers walk into view, then those arriving now choose, in id order.
  enterStreet(d, t, cfg, events);
  arrive(d, t, cfg, events);
  // 5. Production: the player's cup and staff (Task 6), then AI shops in slot order.
  serveAi(d, t, events);
  // 6. Re-check of the player's queue when its stock changed (Task 6).
  // 7. Patience, after production: a cup finished this tick wins.
  runOutOfPatience(d, t, cfg, events);
  // 8. Sold-out signs (the player's, when its stock runs low, comes with Task 6).
  flipSoldOut(d, t, cfg, events);
  // 9. Clock.
  d.tick = t + 1;
  if (d.tick >= cfg.rush.ticks) closeStreet(d, d.tick, events);
}

function isCheckpoint(t: Tick, cfg: SimConfig): boolean {
  for (const c of cfg.midRush.checkpoints) if (c.tick === t) return true;
  return false;
}

function shopOf(d: RushState, id: ShopId): RushShop {
  const s = d.shops.find(x => x.id === id);
  if (!s) throw new Error(`no shop ${id} on the street`);
  return s;
}

/**
 * What customer `c` sees of shop `s`. Rep is effective rep (rep − rumor penalty). A sold-out shop is open
 * but cannot serve. AI price moves stay far below the 20% steep-discount line (§6), so only the player's cut counts.
 */
function offerFor(d: RushState, s: RushShop, c: Customer, cfg: SimConfig): ShopOffer {
  return {
    id: s.id, slot: s.slot,
    open: s.status === 'open' || s.status === 'soldOut',
    price: s.price, rep: s.rep - s.rumorPenalty, queue: s.queue.length,
    canServe: s.status === 'open' && (s.ai === null ? canServe(d.player.stock, c.order, cfg) : s.ai.cupsLeft > 0),
    dropPermille: s.ai === null ? d.player.dropPermille : 0,
  };
}

/** Lowest price on the board among the shops selling today, sold out or not; Infinity if none. */
function lowestPrice(d: RushState): K {
  let low = Infinity;
  for (const s of d.shops) if (sellsToday(s) && s.price < low) low = s.price;
  return low;
}

/** `customerEnter` at max(0, arriveTick − enterLeadTicks) (R10): the scene walks them in before they choose. */
function enterStreet(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  const order = d.arrivalOrder;
  while (d.nextEnter < order.length) {
    const c = d.customers[order[d.nextEnter]];
    if (c.arriveTick - cfg.rush.enterLeadTicks > t) return;
    d.nextEnter++;
    events.push({ t, type: 'customerEnter', customer: c.id, entry: c.entry });
  }
}

/** Arrivals (arrival order is by tick, then id). Eligible: could afford the cheapest board price, not scared. */
function arrive(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  const order = d.arrivalOrder;
  while (d.nextArrival < order.length) {
    const c = d.customers[order[d.nextArrival]];
    if (c.arriveTick > t) return;
    d.nextArrival++;
    if (!c.scared && c.budget >= lowestPrice(d)) {
      d.rt[c.id].eligible = true;
      d.street.eligible++;
    }
    chooseShop(d, c.id, false, t, cfg, events);
  }
}

/**
 * Scores the street and joins the best queue, or leaves (R9): `noOffer` at the first look, `gaveUp` on a
 * re-shop, `scared` for a scared customer (they never pick a shop).
 */
function chooseShop(d: RushState, id: number, reshop: boolean, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  const c = d.customers[id];
  const offers = d.shops.map(s => offerFor(d, s, c, cfg));
  const { chosen, verdicts } = evaluate(c, offers, d.rt[id].visited, cfg);
  events.push({ t, type: 'customerConsider', customer: id, reshop, verdicts, chosen });
  if (chosen !== null) joinQueue(d, id, shopOf(d, chosen), t, events);
  else leaveStreet(d, id, c.scared ? 'scared' : reshop ? 'gaveUp' : 'noOffer', null, t, events);
}

/** Joins at the back with fresh patience; `position` counts the people ahead. */
function joinQueue(d: RushState, id: number, s: RushShop, t: Tick, events: SimEvent[]): void {
  const rt = d.rt[id];
  events.push({ t, type: 'customerJoin', customer: id, shop: s.id, position: s.queue.length });
  s.queue.push(id);
  rt.status = 'queued';
  rt.shop = s.id;
  rt.joinedTick = t;
  rt.visited = [...rt.visited, s.id];
}

/**
 * A customer already taken out of `s`'s queue walks away. Only running out of patience at the player's shop is
 * a walkout with a rep hit. Every departure re-shops among unvisited shops while they have visited fewer
 * than 2 (§16.5); otherwise they leave the street.
 */
function leaveQueue(d: RushState, id: number, s: RushShop, cause: LeaveCause, t: Tick, cfg: SimConfig,
  events: SimEvent[]): void {
  const repHit = cause === 'patience' && s.ai === null;
  if (repHit) d.player.tally.walkouts++;
  events.push({ t, type: 'customerAbandon', customer: id, shop: s.id, cause, repHit });
  if (d.rt[id].visited.length < cfg.rush.maxVisits) chooseShop(d, id, true, t, cfg, events);
  else leaveStreet(d, id, 'gaveUp', null, t, events);
}

/** The customer's one exit from the street. `shop` is where they got a cup, null if they got none. */
function leaveStreet(d: RushState, id: number, outcome: CustomerOutcome, shop: ShopId | null, t: Tick,
  events: SimEvent[]): void {
  const rt = d.rt[id];
  const emptyHanded = rt.eligible && shop === null;
  if (emptyHanded) d.street.emptyHanded++;
  rt.status = 'done';
  rt.shop = shop;
  rt.outcome = outcome;
  events.push({ t, type: 'customerLeave', customer: id, outcome, emptyHanded });
}

/**
 * AI service (plan): the cup in progress only advances while someone waits; after `ticksPerCup` ticks of work
 * the head of the queue gets a correct cup at today's current price, tax goes to the ward fund, the next cup starts.
 */
function serveAi(d: RushState, t: Tick, events: SimEvent[]): void {
  for (const s of d.shops) {
    const ai = s.ai;
    if (ai === null || s.status !== 'open' || ai.cupsLeft === 0 || s.queue.length === 0) continue;
    if (++ai.busy < ai.ticksPerCup) continue;
    ai.busy = 0;
    const id = s.queue[0];
    s.queue.shift();
    ai.cupsLeft--;
    s.sold++;
    s.revenue += s.price;
    d.street.taxFund += d.rules.taxPerCup;
    events.push({ t, type: 'customerServed', customer: id, shop: s.id, by: 'ai', correct: true,
      paid: s.price, full: s.price });
    leaveStreet(d, id, 'served', s.id, t, events);
  }
}

/** Patience (§4): 250 ticks in one queue. A queue is in join order, so whoever runs out is at its front. */
function runOutOfPatience(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  for (const s of d.shops) {
    while (s.queue.length > 0 && t - d.rt[s.queue[0]].joinedTick >= cfg.rush.patienceTicks) {
      const id = s.queue[0];
      s.queue.shift();
      leaveQueue(d, id, s, 'patience', t, cfg, events);
    }
  }
}

/** The whole queue of `s` leaves, front first. */
function emptyQueue(d: RushState, s: RushShop, cause: LeaveCause, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  const leaving = s.queue;
  s.queue = [];
  for (const id of leaving) leaveQueue(d, id, s, cause, t, cfg, events);
}

/** An AI shop out of cups flips its sign and its queue leaves to re-shop, no rep hit. */
function flipSoldOut(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  for (const s of d.shops) {
    if (s.ai === null || s.status !== 'open' || s.ai.cupsLeft > 0) continue;
    s.status = 'soldOut';
    events.push({ t, type: 'shopStatus', shop: s.id, status: 'soldOut' });
    emptyQueue(d, s, 'stockOut', t, cfg, events);
  }
}

/** Mid-rush checkpoint (§4): AI shops in slot order may move 2k; a moved shop's queue re-scores at once. */
function repriceAi(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  for (const s of d.shops) {
    const next = midRushPrice(s, t, d.rules, cfg);
    if (next === null) continue;
    events.push({ t, type: 'shopPrice', shop: s.id, from: s.price, to: next });
    s.price = next;
    s.trail = [...s.trail, [t, next]];
    rescoreQueue(d, s, t, cfg, events);
  }
}

/**
 * Re-scoring after a price change (§6, §16.6). Everyone in the queue decides at once, each counting the people
 * ahead of them at the moment of the change; those who leave then re-shop one by one, front first.
 */
function rescoreQueue(d: RushState, s: RushShop, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  const stay: number[] = [];
  const leave: [number, LeaveCause][] = [];
  s.queue.forEach((id, ahead) => {
    const c = d.customers[id];
    const r = staysAfterReprice(c, offerFor(d, s, c, cfg), ahead, cfg);
    if (r.stay) stay.push(id);
    else leave.push([id, r.cause ?? 'priceUp']);
  });
  s.queue = stay;
  for (const [id, cause] of leave) leaveQueue(d, id, s, cause, t, cfg, events);
}

/** Tick 900 (§6): whoever still queues goes home without a rep hit (`rushEnd`), and the rush is done. */
function closeStreet(d: RushState, t: Tick, events: SimEvent[]): void {
  for (const s of d.shops) {
    for (const id of s.queue) leaveStreet(d, id, 'rushEnd', null, t, events);
    s.queue = [];
  }
  d.done = true;
  events.push({ t, type: 'rushEnd', early: false });
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

/** The day's result for the evening report and the AI books (street part; Task 7 completes the player's side). */
export function summarizeRush(state: RushState): RushResult {
  const p = state.player;
  const used = copyStock(p.bought);
  used.teaMl -= p.stock.teaMl;
  for (const k of Object.keys(used.toppings) as ToppingId[]) used.toppings[k] -= p.stock.toppings[k];
  return {
    player: { ...p.tally, closePrice: shopOf(state, 'player').price, used, left: copyStock(p.stock),
      gouged: p.gouged, brokeCartel: p.brokeCartel },
    shops: state.shops.map(s => dayResult(s, p)),
    customers: state.customers.length,
    eligible: state.street.eligible, emptyHanded: state.street.emptyHanded, taxFund: state.street.taxFund,
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
