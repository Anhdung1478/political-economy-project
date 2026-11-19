// The player's mid-rush price change (spec §6 "Đổi giá giữa trưa", §16.6; rulings R11, R18) and the full
// day result (`summarizeRush`).
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import {
  CLOSE, about, at, cust, deliver, make, ofType, order, playerShop, rules, runTo, shop, stock, street, type PlayerIn,
} from './rush.fixtures';
import { summarizeRush, type RushInput } from './rush';
import type { Action, DayRules, K } from './types';

const setPrice = (price: K): Action => ({ type: 'setPrice', price });

/** The player's shop alone on an empty street; these actions at tick 10, run through tick 10. */
const once = (actions: Action[], player: Partial<PlayerIn> = {}, dayRules: DayRules = rules(1)) =>
  runTo(street([], [], player, { rules: dayRules }), 11, { 10: actions });

describe('setPrice: when it is accepted (§6, R18)', () => {
  it('changes the price once: shopPrice, the trail, and every later change is refused', () => {
    const s = street([], [cust(0), cust(1)], { price: 30 });
    const { events, state } = runTo(s, 30, { 10: [setPrice(33), setPrice(34)], 20: [setPrice(30)] });
    expect(at(events, 10)).toEqual([
      { t: 10, type: 'shopPrice', shop: 'player', from: 30, to: 33 },
      { t: 10, type: 'inputRejected', action: 'setPrice', why: 'priceUsed' },
    ]);
    expect(at(events, 20)).toEqual([{ t: 20, type: 'inputRejected', action: 'setPrice', why: 'priceUsed' }]);
    const ps = playerShop(state);
    expect(ps.price).toBe(33);
    expect(ps.openPrice).toBe(30);
    expect(ps.trail).toEqual([[0, 30], [10, 33]]);
    expect(ps.queue).toEqual([0, 1]); // 40k budgets still score above 0 at 33k
    expect(state.player).toMatchObject({ morningPrice: 30, priceChanged: true, gouged: false, dropPermille: 0 });
  });

  it('refuses a price outside 10–50k or off the 1k step; a refused price leaves the change unused', () => {
    const { events, state } = once([setPrice(9), setPrice(51), setPrice(30.5), setPrice(50)]);
    expect(at(events, 10)).toEqual([
      { t: 10, type: 'inputRejected', action: 'setPrice', why: 'priceRange' },
      { t: 10, type: 'inputRejected', action: 'setPrice', why: 'priceRange' },
      { t: 10, type: 'inputRejected', action: 'setPrice', why: 'priceRange' },
      { t: 10, type: 'shopPrice', shop: 'player', from: 30, to: 50 },
    ]);
    expect(playerShop(state).price).toBe(50);
  });

  it('accepts the ends of the range', () => {
    expect(playerShop(once([setPrice(10)]).state).price).toBe(10);
    expect(playerShop(once([setPrice(50)]).state).price).toBe(50);
  });

  it('never goes above the day\'s ceiling (day 3: 20k)', () => {
    const { events, state } = once([setPrice(21), setPrice(51), setPrice(20)], { price: 15 }, rules(3));
    expect(at(events, 10)).toEqual([
      { t: 10, type: 'inputRejected', action: 'setPrice', why: 'ceiling' },
      { t: 10, type: 'inputRejected', action: 'setPrice', why: 'priceRange' },
      { t: 10, type: 'shopPrice', shop: 'player', from: 15, to: 20 },
    ]);
    expect(playerShop(state).price).toBe(20);
  });

  it('is refused once the shop has closed early, before any other check', () => {
    const { events, state } = runTo(street([], []), 12, { 10: [CLOSE, setPrice(31)], 11: [setPrice(99)] });
    expect(ofType(events, 'inputRejected')).toEqual([
      { t: 10, type: 'inputRejected', action: 'setPrice', why: 'closed' },
      { t: 11, type: 'inputRejected', action: 'setPrice', why: 'closed' },
    ]);
    expect(playerShop(state).price).toBe(30);
    expect(state.player.priceChanged).toBe(false);
  });
});

describe('setPrice: percents against the morning price, in integers (§6)', () => {
  const after = (morning: K, to: K) => once([setPrice(to)], { price: morning }).state.player;

  it('25k → 30k is exactly 20%: not gouging; 25k → 31k is', () => {
    expect(after(25, 30).gouged).toBe(false);
    expect(after(25, 31).gouged).toBe(true);
    expect(after(30, 36).gouged).toBe(false);
    expect(after(30, 37).gouged).toBe(true);
  });

  it('a cut of 20% or less sets no drop; a deeper cut records it in permille, rounded down', () => {
    expect(after(25, 20).dropPermille).toBe(0);
    expect(after(25, 19).dropPermille).toBe(240);
    expect(after(30, 24).dropPermille).toBe(0);
    expect(after(30, 23).dropPermille).toBe(233);
    expect(after(30, 12).dropPermille).toBe(600);
    expect(after(30, 35).dropPermille).toBe(0);
  });

  it('a gouging change shows in the day result', () => {
    const { state } = once([setPrice(31)], { price: 25 });
    expect(summarizeRush(state, CONFIG).player).toMatchObject({ gouged: true, closePrice: 31 });
  });
});

describe('setPrice: the queue re-scores (§6, §16.6, R11)', () => {
  // Budgets 40, 43, 50 queue in that order at 30k. A rise to 36k (exactly 20%) is then re-scored.
  const queue = () => [cust(0, { budget: 40 }), cust(1, { budget: 43 }), cust(2, { budget: 50 })];

  it('at a high-rep shop (80) everyone stays', () => {
    const { events, state } = runTo(street([], queue(), { rep: 80 }), 11, { 10: [setPrice(36)] });
    expect(at(events, 10)).toEqual([{ t: 10, type: 'shopPrice', shop: 'player', from: 30, to: 36 }]);
    expect(playerShop(state).queue).toEqual([0, 1, 2]);
  });

  it('at a low-rep shop (20) the front leaves and those behind count only who stays ahead', () => {
    const { events, state } = runTo(street([], queue(), { rep: 20 }), 11, { 10: [setPrice(36)] });
    // 0: 400 − 360 − 60 = −20 → leaves. 1: 430 − 360 − 60 − 20·0 = 10 → stays (counting 0 it would be −10).
    expect(at(events, 10)).toEqual([
      { t: 10, type: 'shopPrice', shop: 'player', from: 30, to: 36 },
      { t: 10, type: 'customerAbandon', customer: 0, shop: 'player', cause: 'priceUp', repHit: false },
      { t: 10, type: 'customerConsider', customer: 0, reshop: true, chosen: null,
        verdicts: [{ shop: 'player', score10: null, reason: 'visited' }] },
      { t: 10, type: 'customerLeave', customer: 0, outcome: 'gaveUp', emptyHanded: true },
    ]);
    expect(playerShop(state).queue).toEqual([1, 2]);
    expect(state.player.tally.walkouts).toBe(0);
  });

  it('a leaver re-shops among the shops they have not visited', () => {
    // Ông Cố Chấp at 40k is no match at first (400 − 400 + 10 = 10 < 40), but once the player charges 45k it is.
    const s = street([shop('cochap', 40)], [cust(0, { budget: 40 })], { rep: 20 });
    const { events, state } = runTo(s, 11, { 10: [setPrice(45)] });
    expect(about(events, 0).slice(-3)).toEqual([
      { t: 10, type: 'customerAbandon', customer: 0, shop: 'player', cause: 'priceUp', repHit: false },
      { t: 10, type: 'customerConsider', customer: 0, reshop: true, chosen: 'cochap', verdicts: [
        { shop: 'cochap', score10: 10, reason: 'chosen' }, { shop: 'player', score10: null, reason: 'visited' },
      ] },
      { t: 10, type: 'customerJoin', customer: 0, shop: 'cochap', position: 0 },
    ]);
    expect(state.rt[0].visited).toEqual(['player', 'cochap']);
  });
});

describe('setPrice: the skeptic test of a steep cut (§6, R6)', () => {
  // 30k → 20k: drop 333‰, limit 10000 − 133·25 = 6675, so skeptic 667 passes and 668 does not.
  it('runs on the queue first: a skeptic leaves even though the price fell', () => {
    const s = street([], [cust(0, { skeptic: 668 }), cust(1, { skeptic: 667 }), cust(2, { skeptic: 1000 }), cust(3)]);
    const { events, state } = runTo(s, 11, { 10: [setPrice(20)] });
    const gone = ofType(at(events, 10), 'customerAbandon');
    expect(gone).toEqual([
      { t: 10, type: 'customerAbandon', customer: 0, shop: 'player', cause: 'steepDiscount', repHit: false },
      { t: 10, type: 'customerAbandon', customer: 2, shop: 'player', cause: 'steepDiscount', repHit: false },
    ]);
    expect(playerShop(state).queue).toEqual([1, 3]);
  });

  it('runs on every later arrival before they score the shop', () => {
    const s = street([shop('batu', 27)], [
      cust(0, { arriveTick: 20, skeptic: 668 }), cust(1, { arriveTick: 20, skeptic: 667 }),
    ]);
    const { events, state } = runTo(s, 21, { 10: [setPrice(20)] });
    const considered = ofType(events, 'customerConsider');
    expect(considered[0]).toMatchObject({ customer: 0, chosen: 'batu' });
    expect(considered[0].verdicts[1]).toEqual({ shop: 'player', score10: null, reason: 'steepDiscount' });
    expect(considered[1]).toMatchObject({ customer: 1, chosen: 'player' });
    expect(state.rt.map(r => r.shop)).toEqual(['batu', 'player']);
  });

  it('a 60% cut empties the queue, and no later arrival passes either', () => {
    const s = street([], [cust(0), cust(1), cust(2), cust(3, { arriveTick: 20 })]);
    const { events, state } = runTo(s, 21, { 10: [setPrice(12)] });
    expect(ofType(at(events, 10), 'customerAbandon').map(e => [e.customer, e.cause])).toEqual([
      [0, 'steepDiscount'], [1, 'steepDiscount'], [2, 'steepDiscount'],
    ]);
    expect(ofType(about(events, 3), 'customerConsider')[0].verdicts)
      .toEqual([{ shop: 'player', score10: null, reason: 'steepDiscount' }]);
    expect(playerShop(state).queue).toEqual([]);
  });

  it('a 59% cut still keeps the least skeptical', () => {
    // 30k → 13k: drop 566‰, limit 10000 − 366·25 = 850.
    const s = street([], [cust(0, { skeptic: 85 }), cust(1, { skeptic: 86 })]);
    expect(playerShop(runTo(s, 11, { 10: [setPrice(13)] }).state).queue).toEqual([0]);
  });
});

describe('setPrice: breaking the cartel (§7, R18)', () => {
  const cartel = rules(2, { cartel: true });
  const broke = (morning: K, actions: Action[], dayRules: DayRules = cartel) =>
    once(actions, { price: morning }, dayRules).state.player.brokeCartel;

  it('a price under 36k at any time of a cartel day breaks it', () => {
    expect(broke(36, [setPrice(35)])).toBe(true);
    expect(broke(35, [])).toBe(true);
    expect(broke(35, [setPrice(40)])).toBe(true);
  });

  it('holding 36k or more keeps it; a refused price does not count', () => {
    expect(broke(36, [])).toBe(false);
    expect(broke(36, [setPrice(40)])).toBe(false);
    expect(broke(40, [setPrice(36)])).toBe(false);
    expect(broke(36, [setPrice(9)])).toBe(false);
  });

  it('there is nothing to break on a day without the cartel', () => {
    expect(broke(30, [setPrice(20)], rules(2))).toBe(false);
  });
});

describe('summarizeRush: the full day result', () => {
  it('fills every field of the player\'s row and of every shop', () => {
    // Day 2 under the cartel: Bà Tư holds 36k. The player sells one cup at 36k, cuts to 30k, sells another.
    const input: Partial<RushInput> = { rules: rules(2, { cartel: true }) };
    const s = street([shop('batu', 36)], [cust(0), cust(1, { budget: 45, order: order('S', 'jelly') })],
      { price: 36, rep: 70, stock: stock(2000, 5) }, input);
    const script = { 10: make(order('M', 'pearl')), 45: [deliver(0)], 50: [setPrice(30), ...make(order('S', 'jelly'))],
      81: [deliver(1)] };
    const { state, events } = runTo(s, Infinity, script);
    expect(ofType(events, 'customerServed').map(e => [e.customer, e.paid])).toEqual([[0, 41], [1, 30]]);
    expect(summarizeRush(state, CONFIG)).toEqual({
      player: {
        revenue: 71, tax: 0, cups: 2, wrong: 0, staffCups: 0, walkouts: 0, missedNoStock: 0, trashed: 0,
        closePrice: 30,
        used: { teaMl: 600, toppings: { pearl: 1, jelly: 1, pudding: 0 } },
        left: { teaMl: 1400, toppings: { pearl: 4, jelly: 4, pudding: 5 } },
        gouged: false, brokeCartel: true,
      },
      shops: [
        { id: 'batu', status: 'open', openPrice: 36, closePrice: 36, trail: [[0, 36]], sold: 0, capacity: 12,
          soldOut: false, profit: null, revenue: 0 },
        { id: 'player', status: 'open', openPrice: 36, closePrice: 30, trail: [[0, 36], [50, 30]], sold: 2, capacity: 0,
          soldOut: false, profit: null, revenue: 71 },
      ],
      customers: 2, eligible: 2, emptyHanded: 0, taxFund: 0,
    });
  });
});
