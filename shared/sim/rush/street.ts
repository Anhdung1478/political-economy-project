// The street part of the rush engine (spec §4 Khách, 6 quán AI, Tin đồn, §6, §16.2/5/6/8/9; plan "Thứ tự trong một
// nhịp"; rulings R8–R13, R15, R16, R19): customers walking in and choosing, queues, AI service, patience and re-shopping,
// mid-rush AI prices, sold-out signs, the day-5 inspection and the end of the rush. Every function works on a draft
// the caller owns (see `cloneRush`).
import { evaluate, staysAfterReprice, type ShopOffer } from '../choice';
import type { SimConfig } from '../config';
import { midRushPrice } from '../shops';
import type { Customer, CustomerOutcome, K, LeaveCause, RushShop, RushState, ShopId, SimEvent, Tick } from '../types';
import { canServe, dropCup } from './craft';

/** Open, sold out or closed early: the shop put a price on the board today. */
export const sellsToday = (s: RushShop) => s.status === 'open' || s.status === 'soldOut' || s.status === 'closedEarly';

/** @internal */
export function shopOf(d: RushState, id: ShopId): RushShop {
  const s = d.shops.find(x => x.id === id);
  if (!s) throw new Error(`no shop ${id} on the street`);
  return s;
}

/** @internal */
export function isCheckpoint(t: Tick, cfg: SimConfig): boolean {
  for (const c of cfg.midRush.checkpoints) if (c.tick === t) return true;
  return false;
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

/** @internal `customerEnter` at max(0, arriveTick − enterLeadTicks) (R10): the scene walks them in before they choose. */
export function enterStreet(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  const order = d.arrivalOrder;
  while (d.nextEnter < order.length) {
    const c = d.customers[order[d.nextEnter]];
    if (c.arriveTick - cfg.rush.enterLeadTicks > t) return;
    d.nextEnter++;
    events.push({ t, type: 'customerEnter', customer: c.id, entry: c.entry });
  }
}

/** @internal Arrivals (arrival order is by tick, then id). Eligible: could afford the cheapest board price, not scared. */
export function arrive(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
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

/** @internal Counts a customer toward `missedNoStock`, once per customer (R16). */
export function noteMissed(d: RushState, id: number): void {
  const rt = d.rt[id];
  if (rt.missedNoStock) return;
  rt.missedNoStock = true;
  d.player.tally.missedNoStock++;
}

/**
 * Scores the street and joins the best queue, or leaves (R9): `noOffer` at the first look, `gaveUp` on a
 * re-shop, `scared` for a scared customer (they never pick a shop). A customer who finds the player's shop out of
 * stock counts as missed only if they would have chosen it with stock (R16).
 */
function chooseShop(d: RushState, id: number, reshop: boolean, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  const c = d.customers[id];
  const rt = d.rt[id];
  const offers = d.shops.map(s => offerFor(d, s, c, cfg));
  const { chosen, verdicts } = evaluate(c, offers, rt.visited, cfg);
  if (!rt.missedNoStock) {
    let outOfStock = false;
    for (const v of verdicts) if (v.shop === 'player' && v.reason === 'outOfStock') outOfStock = true;
    if (outOfStock) {
      // The offers are not used after this point: score the street again with the player's shop in stock.
      for (const o of offers) if (o.id === 'player') o.canServe = true;
      if (evaluate(c, offers, rt.visited, cfg).chosen === 'player') noteMissed(d, id);
    }
  }
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

/** @internal The customer's one exit from the street. `shop` is where they got a cup, null if they got none. */
export function leaveStreet(d: RushState, id: number, outcome: CustomerOutcome, shop: ShopId | null, t: Tick,
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
 * @internal AI service (plan): the cup in progress only advances while someone waits; after `ticksPerCup` ticks of
 * work the head of the queue gets a correct cup at today's current price, tax goes to the ward fund, the next cup starts.
 */
export function serveAi(d: RushState, t: Tick, events: SimEvent[]): void {
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

/** Whether a queued customer leaves, given how many stay ahead of them: the cause, or null to stay. */
export type QueueDecision = (id: number, ahead: number) => LeaveCause | null;

/**
 * @internal Goes through the queue of `s` front to back. Each customer is decided with `ahead` = the customers before
 * them who stay, so a leaver no longer counts for those behind (R11). Leavers are taken out of the queue,
 * then walk away front first (`leaveQueue`: abandon, then re-shop).
 */
export function siftQueue(d: RushState, s: RushShop, leaves: QueueDecision, t: Tick, cfg: SimConfig,
  events: SimEvent[]): void {
  const stay: number[] = [];
  const gone: [number, LeaveCause][] = [];
  for (const id of s.queue) {
    const cause = leaves(id, stay.length);
    if (cause === null) stay.push(id);
    else gone.push([id, cause]);
  }
  s.queue = stay;
  for (const [id, cause] of gone) leaveQueue(d, id, s, cause, t, cfg, events);
}

/**
 * @internal Patience (§4): 250 ticks in one queue. Queues are in join order, so only a queue whose front has run out
 * is sifted; the per-tick loop allocates nothing otherwise.
 */
export function runOutOfPatience(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  const since = t - cfg.rush.patienceTicks;
  for (const s of d.shops) {
    if (s.queue.length === 0 || d.rt[s.queue[0]].joinedTick > since) continue;
    siftQueue(d, s, id => d.rt[id].joinedTick <= since ? 'patience' : null, t, cfg, events);
  }
}

/**
 * @internal Sold-out signs, in slot order. An AI shop out of cups flips its sign and its whole queue leaves to
 * re-shop, no rep hit. The player's shop flips once its tea is under 250 ml (§6); its queue was already re-checked
 * against the stock in this tick (phase 6), so only the sign changes.
 */
export function flipSoldOut(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  for (const s of d.shops) {
    if (s.status !== 'open') continue;
    if (s.ai === null ? d.player.stock.teaMl >= cfg.supplies.soldOutBelowMl : s.ai.cupsLeft > 0) continue;
    s.status = 'soldOut';
    events.push({ t, type: 'shopStatus', shop: s.id, status: 'soldOut' });
    if (s.ai !== null) siftQueue(d, s, () => 'stockOut', t, cfg, events);
  }
}

/**
 * @internal Mid-rush checkpoint (§4, R13), in two phases. Phase 1: in slot order, every AI shop decides on the street
 * as it stood when the checkpoint began and posts its new price (`midRushPrice` reads only the shop's own queue
 * and sales, which phase 1 never changes). Phase 2: in slot order, the queues of the shops that moved re-score;
 * leavers re-shop against the new prices.
 */
export function repriceAi(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  const moved: RushShop[] = [];
  for (const s of d.shops) {
    const next = midRushPrice(s, t, d.rules, cfg);
    if (next === null) continue;
    events.push({ t, type: 'shopPrice', shop: s.id, from: s.price, to: next });
    s.price = next;
    s.trail = [...s.trail, [t, next]];
    moved.push(s);
  }
  for (const s of moved) rescoreQueue(d, s, t, cfg, events);
}

/**
 * @internal Re-scoring after a price change, the AI's or the player's (§6, §16.6, R11): front to back, each counting
 * only those ahead who stay; the skeptic test of a steep cut comes first.
 */
export function rescoreQueue(d: RushState, s: RushShop, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  siftQueue(d, s, (id, ahead) => {
    const c = d.customers[id];
    const r = staysAfterReprice(c, offerFor(d, s, c, cfg), ahead, cfg);
    return r.stay ? null : r.cause ?? 'priceUp';
  }, t, cfg, events);
}

/**
 * @internal Day 5, tick 450 (§4 Tin đồn, §16.9, R19): the state announces its inspection of every shop selling
 * today that is not yet certified, in slot order. Fewer than 2 skimp days: the penalty goes and the shop is certified.
 * Otherwise it is named and keeps the penalty to the end of the day. Then the rumor lifts. Nobody re-scores: a lifted
 * penalty only makes a queue more willing to stay.
 */
export function inspect(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  const certified: ShopId[] = [];
  const named: ShopId[] = [];
  for (const s of d.shops) {
    if (s.certified || !sellsToday(s)) continue;
    if (s.skimpDays >= cfg.rumor.failSkimpDays) {
      s.named = true;
      named.push(s.id);
    } else {
      s.rumorPenalty = 0;
      s.certified = true;
      certified.push(s.id);
    }
  }
  events.push({ t, type: 'policy', kind: 'inspection', certified, named });
  events.push({ t, type: 'policy', kind: 'rumorLifted' });
}

/**
 * @internal Tick 900 (§6): whoever still queues goes home without a rep hit (`rushEnd`), a cup still in the making is
 * dropped, and the rush is done. `early` tells that the player closed early (R15).
 */
export function closeStreet(d: RushState, t: Tick, events: SimEvent[]): void {
  let early = false;
  for (const s of d.shops) {
    for (const id of s.queue) leaveStreet(d, id, 'rushEnd', null, t, events);
    s.queue = [];
    if (s.ai === null && s.status === 'closedEarly') early = true;
  }
  dropCup(d.player.craft);
  d.done = true;
  events.push({ t, type: 'rushEnd', early });
}
