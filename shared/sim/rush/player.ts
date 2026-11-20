// The player's shop during the rush (spec §4 Nâng cấp and Thuế, §6 Quầy and Đổi giá giữa trưa, §16.3/4/5/6/7; plan
// staff ruling; rulings R14, R15, R18): the player's actions (the price change among them), the cup station and the
// staff at production, the re-check of the queue against the stock, and the books of every cup sold. Every function
// works on a draft the caller owns (see `cloneRush`).
import type { SimConfig } from '../config';
import type { Action, InputReject, K, RushShop, RushState, SimEvent, Tick } from '../types';
import { applyInput, canServe, dropCup, holds, orderPrice, payment, tickCraft } from './craft';
import { leaveStreet, noteMissed, rescoreQueue, shopOf, siftQueue } from './street';

const reject = (events: SimEvent[], t: Tick, action: Action['type'], why: InputReject): false => {
  events.push({ t, type: 'inputRejected', action, why });
  return false;
};

/**
 * The customer the cup in progress holds (§16.3): the first of the first four in line with the cup's size who ordered
 * every topping already in it; −1 if none. The stock re-check never sends them away and the staff leaves them alone.
 */
function heldCustomer(d: RushState, ps: RushShop, cfg: SimConfig): number {
  const cup = d.player.craft.cup;
  if (cup === null) return -1;
  const n = Math.min(ps.queue.length, cfg.rush.counterSlots);
  for (let i = 0; i < n; i++) if (holds(d.customers[ps.queue[i]].order, cup)) return ps.queue[i];
  return -1;
}

/**
 * A cup sold by the player's shop, already out of the queue: the takings, the tax of a tax day (every cup, right or
 * wrong, the staff's too), then `customerServed` and the customer's exit.
 */
function sell(d: RushState, ps: RushShop, id: number, by: 'player' | 'staff', correct: boolean, paid: K, full: K,
  t: Tick, events: SimEvent[]): void {
  const tally = d.player.tally;
  tally.revenue += paid;
  tally.cups++;
  if (!correct) tally.wrong++;
  if (by === 'staff') tally.staffCups++;
  tally.tax += d.rules.taxPerCup;
  d.street.taxFund += d.rules.taxPerCup;
  ps.sold++;
  events.push({ t, type: 'customerServed', customer: id, shop: 'player', by, correct, paid, full });
  leaveStreet(d, id, correct ? 'served' : 'servedWrong', 'player', t, events);
}

/**
 * Hands the cup to a customer among the first four (§6, §16.4): only a cup with tea and no animation running. The sale
 * is settled now; the counter is then busy for the hand-over, and inputs pressed meanwhile queue for the next cup.
 */
function deliver(d: RushState, ps: RushShop, id: number, t: Tick, cfg: SimConfig, events: SimEvent[]): boolean {
  const craft = d.player.craft;
  const cup = craft.cup;
  if (craft.anim !== null) return reject(events, t, 'deliver', 'busy');
  if (cup === null) return reject(events, t, 'deliver', 'noCup');
  if (cup.teaMl === 0) return reject(events, t, 'deliver', 'order');
  const at = ps.queue.indexOf(id);
  if (at < 0 || at >= cfg.rush.counterSlots) return reject(events, t, 'deliver', 'notInFirstFour');
  ps.queue.splice(at, 1);
  const order = d.customers[id].order;
  const { correct, paid } = payment(ps.price, order, cup, cfg);
  sell(d, ps, id, 'player', correct, paid, orderPrice(ps.price, order, cfg), t, events);
  d.player.handed.teaMl += cup.teaMl;
  for (const k of cup.toppings) d.player.handed.toppings[k]++;
  craft.cup = null;
  const endsAt = t + cfg.craft.deliverTicks;
  craft.anim = { step: 'deliver', endsAt };
  events.push({ t, type: 'craftStep', step: 'deliver', endsAt });
  return true;
}

/**
 * Closing early (§6, §16.7, R15): the sign says closed, the cup in progress is dropped with what it used, and the
 * queue re-shops without a rep hit. The rush itself runs on to 900.
 */
function closeEarly(d: RushState, ps: RushShop, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  ps.status = 'closedEarly';
  events.push({ t, type: 'shopStatus', shop: 'player', status: 'closedEarly' });
  dropCup(d.player.craft);
  siftQueue(d, ps, () => 'shopClosed', t, cfg, events);
}

/**
 * The player's one price change of the rush (§6, R18). Refused when already used, outside 10–50k or off the 1k step,
 * or above today's ceiling. Percents are against the morning price, in integers: a rise of more than 20% is gouging;
 * a cut of more than 20% records its depth in permille, and the skeptic test then runs on the queue and on every later
 * arrival. Any price under the cartel's on a cartel day breaks the cartel. The queue then re-scores (R11); leavers
 * re-shop without a rep hit.
 */
function setPrice(d: RushState, ps: RushShop, price: K, t: Tick, cfg: SimConfig, events: SimEvent[]): false {
  const p = d.player;
  const { min, max, step } = cfg.pricing;
  if (p.priceChanged) return reject(events, t, 'setPrice', 'priceUsed');
  if (price < min || price > max || (price - min) % step !== 0) return reject(events, t, 'setPrice', 'priceRange');
  if (d.rules.ceiling !== null && price > d.rules.ceiling) return reject(events, t, 'setPrice', 'ceiling');
  const morning = p.morningPrice;
  const { gougePercent, discountPermille } = cfg.priceChange;
  p.priceChanged = true;
  p.gouged = (price - morning) * 100 > gougePercent * morning;
  p.dropPermille = (morning - price) * 1000 > discountPermille * morning
    ? Math.floor((morning - price) * 1000 / morning) : 0;
  if (d.rules.cartel && price < cfg.cards.cartel.price) p.brokeCartel = true;
  events.push({ t, type: 'shopPrice', shop: 'player', from: ps.price, to: price });
  ps.price = price;
  ps.trail = [...ps.trail, [t, price]];
  rescoreQueue(d, ps, t, cfg, events);
  return false;
}

/**
 * @internal One player action at tick t (plan tick order, step 1); a refused action emits `inputRejected` and changes
 * nothing. Returns true when the queue must be re-checked against the stock: stock was taken, or the cup that held a
 * customer left the counter.
 */
export function playerAction(d: RushState, a: Action, t: Tick, cfg: SimConfig, events: SimEvent[]): boolean {
  const ps = shopOf(d, 'player');
  if (ps.status === 'closedEarly') return reject(events, t, a.type, 'closed');
  const p = d.player;
  switch (a.type) {
    case 'setPrice':
      return setPrice(d, ps, a.price, t, cfg, events);
    case 'craft':
      return applyInput(p.craft, a.input, p.stock, t, p.machine, events, cfg);
    case 'deliver':
      return deliver(d, ps, a.customer, t, cfg, events);
    case 'trash':
      if (p.craft.cup === null) return reject(events, t, 'trash', 'noCup');
      dropCup(p.craft);
      p.tally.trashed++;
      events.push({ t, type: 'cupTrashed' });
      return true;
    case 'closeEarly':
      closeEarly(d, ps, t, cfg, events);
      return false;
  }
}

/**
 * The staff helper (§4, plan): a 90-tick clock that runs only while the queue holds someone the stock can serve who is
 * not held by the player's cup. When it completes, the first such customer in line gets a correct cup at full price
 * from the shop's stock, and the clock starts again from 0. Returns whether stock was taken.
 */
function runStaff(d: RushState, staff: { progress: Tick }, t: Tick, cfg: SimConfig, events: SimEvent[]): boolean {
  const ps = shopOf(d, 'player');
  if (ps.queue.length === 0) return false;
  const held = heldCustomer(d, ps, cfg);
  const stock = d.player.stock;
  let at = 0;
  while (at < ps.queue.length && (ps.queue[at] === held || !canServe(stock, d.customers[ps.queue[at]].order, cfg))) at++;
  if (at === ps.queue.length || ++staff.progress < cfg.craft.staffTicks) return false;
  staff.progress = 0;
  const id = ps.queue[at];
  ps.queue.splice(at, 1);
  const order = d.customers[id].order;
  stock.teaMl -= cfg.supplies.sizeMl[order.size];
  for (const k of order.toppings) stock.toppings[k]--;
  d.player.handed.teaMl += cfg.supplies.sizeMl[order.size];
  for (const k of order.toppings) d.player.handed.toppings[k]++;
  const full = orderPrice(ps.price, order, cfg);
  sell(d, ps, id, 'staff', true, full, full, t, events);
  return true;
}

/**
 * @internal Production at tick t, the player's part (plan tick order, step 5): the running step ends and the next
 * queued one starts (R14), then the staff. Returns whether stock was taken.
 */
export function producePlayer(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): boolean {
  const p = d.player;
  const took = tickCraft(p.craft, p.stock, t, p.machine, events, cfg);
  return (p.staff !== null && runStaff(d, p.staff, t, cfg, events)) || took;
}

/**
 * @internal Step 6, after the stock changed or the cup left the counter: customers whose order can no longer be made
 * leave to re-shop (`stockOut`, no rep hit, §6, §16.5), except the one the cup in progress holds (§16.3). Each counts
 * toward `missedNoStock` (R16).
 */
export function recheckStock(d: RushState, t: Tick, cfg: SimConfig, events: SimEvent[]): void {
  const ps = shopOf(d, 'player');
  const held = heldCustomer(d, ps, cfg);
  const stock = d.player.stock;
  const cannot = (id: number) => id !== held && !canServe(stock, d.customers[id].order, cfg);
  if (!ps.queue.some(cannot)) return;
  siftQueue(d, ps, id => {
    if (!cannot(id)) return null;
    noteMissed(d, id);
    return 'stockOut';
  }, t, cfg, events);
}
