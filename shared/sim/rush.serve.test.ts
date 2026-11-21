import { describe, expect, it } from 'vitest';
import {
  CLOSE, ICE, TEA, TRASH, about, at, cust, deliver, dryOrder, input, make, ofType, order, playerShop, rules, runTo,
  shop, size, stock, street, top, tuned,
} from './rush.fixtures';
import {
  canServe, checkInput, counterView, createRush, cupPrice, finishRush, orderPrice, orderTeaMl, payment, step,
  summarizeRush,
} from './rush';
import { holds as engineHolds } from './rush/craft';
import type { Action, AiShopState, Cup, Day, Order, RushState, SimEvent, Stock, StockItem } from './types';

const cupOf = (o: Order): Cup => ({ size: o.size, iced: !o.noIce, teaMl: orderTeaMl(o), toppings: [...o.toppings] });

describe('prices and payment (§4 Giá, §6 Quầy)', () => {
  it('an order costs the M price, −5k for S, +5k for L, +5k per topping', () => {
    expect(orderPrice(30, order('S', 'pearl'))).toBe(30);
    expect(orderPrice(30, order('M', 'pearl'))).toBe(35);
    expect(orderPrice(30, order('L', 'pearl', 'jelly'))).toBe(45);
    expect(orderPrice(31, order('L', 'pearl', 'jelly', 'pudding'))).toBe(51);
  });

  it('a cup is priced the same way, from what is in it', () => {
    expect(cupPrice(30, cupOf(order('M')))).toBe(30);
    expect(cupPrice(30, cupOf(order('S')))).toBe(25);
    expect(cupPrice(30, cupOf(order('L', 'pudding', 'pearl', 'jelly')))).toBe(50);
  });

  it('the right cup (same size, same toppings in any order) pays the order in full', () => {
    expect(payment(30, order('L', 'pearl', 'jelly'), cupOf(order('L', 'jelly', 'pearl')))).toEqual({ correct: true, paid: 45 });
  });

  it('a wrong cup pays 70% of the cheaper of order and cup, rounded down: 41k ordered, 31k given → 21k', () => {
    expect(payment(31, order('L', 'pearl'), cupOf(order('M')))).toEqual({ correct: false, paid: 21 });
  });

  it('a dearer wrong cup pays 70% of the order, nothing for the extras', () => {
    expect(payment(30, order('S', 'jelly'), cupOf(order('L', 'pearl', 'jelly', 'pudding')))).toEqual({ correct: false, paid: 21 });
    // 34k ordered, 39k given: 23.8 → 23.
    expect(payment(29, order('M', 'pearl'), cupOf(order('M', 'pearl', 'jelly')))).toEqual({ correct: false, paid: 23 });
  });

  it('wrong size, a missing topping or an extra topping all make a wrong cup', () => {
    const o = order('M', 'pearl', 'jelly');
    expect(payment(30, o, cupOf(order('S', 'pearl', 'jelly'))).correct).toBe(false);
    expect(payment(30, o, cupOf(order('M', 'pearl'))).correct).toBe(false);
    expect(payment(30, o, cupOf(order('M', 'pearl', 'jelly', 'pudding'))).correct).toBe(false);
    expect(payment(30, o, cupOf(order('M', 'pearl', 'pudding'))).correct).toBe(false);
  });

  it('"không đá" costs the same: the right cup with no ice pays the order in full', () => {
    expect(orderPrice(30, dryOrder('L', 'pearl'))).toBe(orderPrice(30, order('L', 'pearl')));
    expect(cupPrice(30, cupOf(dryOrder('M')))).toBe(30);
    expect(payment(30, dryOrder('L', 'pearl'), cupOf(dryOrder('L', 'pearl')))).toEqual({ correct: true, paid: 40 });
  });

  it('the ice the other way is a wrong cup, both ways: 70% of the order', () => {
    // No ice ordered, ice given: 40k → 28k.
    expect(payment(30, dryOrder('L', 'pearl'), cupOf(order('L', 'pearl')))).toEqual({ correct: false, paid: 28 });
    // Ice ordered, none given: 35k → 24.5 → 24k.
    expect(payment(30, order('M', 'jelly'), cupOf(dryOrder('M', 'jelly')))).toEqual({ correct: false, paid: 24 });
  });

  it('a cup still holds an order only if its ice can still match (§16.3)', () => {
    const sized: Cup = { size: 'M', iced: false, teaMl: 0, toppings: [] };
    const iced: Cup = { size: 'M', iced: true, teaMl: 0, toppings: [] };
    const dry: Cup = { size: 'M', iced: false, teaMl: 300, toppings: [] };
    const icedTea: Cup = { size: 'M', iced: true, teaMl: 350, toppings: ['pearl'] };
    expect([sized, iced, dry, icedTea].map(c => engineHolds(order('M', 'pearl'), c))).toEqual([true, true, false, true]);
    expect([sized, iced, dry, icedTea].map(c => engineHolds(dryOrder('M', 'pearl'), c))).toEqual([true, false, true, false]);
    expect(engineHolds(dryOrder('S', 'pearl'), sized)).toBe(false);
  });
});

describe('handing over a cup (§6 Quầy, §16.4)', () => {
  const orders: Order[] = [order('M', 'pearl'), order('S', 'jelly'), order('L', 'pearl', 'pudding'), order('M', 'pearl'),
    order('M', 'jelly')];
  const five = (price = 30) => street([], orders.map((o, i) => cust(i, { order: o, budget: 60 })), { price });

  it('only a cup with tea, with no animation running, to one of the first four', () => {
    const { events, states } = runTo(five(), 60, {
      5: [deliver(0)],
      10: [size('M'), ICE],
      12: [deliver(0)],
      23: [deliver(0), TEA, top('pearl')], // the cup has no tea yet; then the tea starts at once
      46: [deliver(4), deliver(99), deliver(3)], // 4 is fifth in line, 99 is not in it; 3 is fourth
    });
    expect(ofType(events, 'inputRejected').map(e => [e.t, e.action, e.why])).toEqual([
      [5, 'deliver', 'noCup'], [12, 'deliver', 'busy'], [23, 'deliver', 'order'],
      [46, 'deliver', 'notInFirstFour'], [46, 'deliver', 'notInFirstFour'],
    ]);
    expect(at(events, 46).slice(2)).toEqual([
      { t: 46, type: 'customerServed', customer: 3, shop: 'player', by: 'player', correct: true, paid: 35, full: 35 },
      { t: 46, type: 'customerLeave', customer: 3, outcome: 'served', emptyHanded: false },
      { t: 46, type: 'craftStep', step: 'deliver', endsAt: 50 },
    ]);
    const s = states[46];
    expect(s.player.tally).toMatchObject({ revenue: 35, cups: 1, wrong: 0, staffCups: 0, tax: 0 });
    expect(playerShop(s).sold).toBe(1);
    expect(s.rt[3]).toMatchObject({ status: 'done', outcome: 'served', shop: 'player' });
    // The fifth customer moves up to the counter.
    expect(counterView(s).first.map(f => f.customer)).toEqual([0, 1, 2, 4]);
  });

  it('a wrong cup earns 70% of the cheaper cup and counts as wrong (41k ordered, 31k given → 21k)', () => {
    const s = street([], [cust(0, { order: order('L', 'pearl'), budget: 60 })], { price: 31 });
    const { events, state } = runTo(s, 50, { 10: [size('M'), ICE, TEA], 39: [deliver(0)] });
    expect(at(events, 39).slice(0, 2)).toEqual([
      { t: 39, type: 'customerServed', customer: 0, shop: 'player', by: 'player', correct: false, paid: 21, full: 41 },
      { t: 39, type: 'customerLeave', customer: 0, outcome: 'servedWrong', emptyHanded: false },
    ]);
    expect(state.player.tally).toMatchObject({ revenue: 21, cups: 1, wrong: 1 });
    expect(state.rt[0]).toMatchObject({ outcome: 'servedWrong', shop: 'player' });
  });

  it('a dearer wrong cup earns 70% of the order', () => {
    const s = street([], [cust(0, { order: order('S', 'jelly'), budget: 60 })], { price: 30 });
    const { events, state } = runTo(s, 70, {
      10: [size('L'), ICE, TEA, top('pearl')],
      30: [top('jelly'), top('pudding')],
      61: [deliver(0)],
    });
    expect(ofType(events, 'customerServed')).toEqual([
      { t: 61, type: 'customerServed', customer: 0, shop: 'player', by: 'player', correct: false, paid: 21, full: 30 },
    ]);
    expect(state.player.stock).toEqual({ teaMl: 9500, toppings: { pearl: 49, jelly: 49, pudding: 49 } });
  });

  it('a customer arriving at 75 s can still be served before the end', () => {
    const s = street([], [cust(0, { arriveTick: 749, budget: 60 })], { price: 30 });
    const { events } = runTo(s, Infinity, { 760: make(order('M', 'pearl')), 795: [deliver(0)] });
    expect(about(events, 0).slice(-2)).toEqual([
      { t: 795, type: 'customerServed', customer: 0, shop: 'player', by: 'player', correct: true, paid: 35, full: 35 },
      { t: 795, type: 'customerLeave', customer: 0, outcome: 'served', emptyHanded: false },
    ]);
  });
});

describe('stock running out at the player\'s counter (§6, §16.3, §16.5, R15)', () => {
  const batu = (): AiShopState[] => [shop('batu', 29)];

  it('sends away those whose order can no longer be made, without a rep hit, but keeps the customer the cup is for', () => {
    // 700 ml, a single pearl. All five pick the player (20k) over Bà Tư (29k).
    const orders = [order('M', 'jelly'), order('L', 'pearl'), order('M', 'pearl'), order('S', 'pudding'), order('S', 'pearl')];
    const s = street(batu(), orders.map((o, i) => cust(i, { order: o })),
      { price: 20, stock: { teaMl: 700, toppings: { pearl: 1, jelly: 5, pudding: 5 } } });
    const { events, states } = runTo(s, 200, { 10: [size('M'), ICE, TEA, top('pearl')], 45: [deliver(2)] });
    expect(playerShop(states[0]).queue).toEqual([0, 1, 2, 3, 4]);
    const reshop = (id: number, batuScore: number, position: number, t: number, missing: StockItem): SimEvent[] => [
      { t, type: 'customerAbandon', customer: id, shop: 'player', cause: 'stockOut', repHit: false, missing },
      { t, type: 'customerConsider', customer: id, reshop: true, chosen: 'batu', verdicts: [
        { shop: 'batu', score10: batuScore, reason: 'chosen' }, { shop: 'player', score10: null, reason: 'visited' },
      ] },
      { t, type: 'customerJoin', customer: id, shop: 'batu', position },
    ];
    // The tea leaves 350 ml: the L order goes. The cup (an M, no topping yet) holds customer 0.
    expect(at(events, 22)).toEqual([{ t: 22, type: 'craftStep', step: 'tea', endsAt: 38 }, ...reshop(1, 110, 0, 22, 'tea')]);
    // The last pearl goes into the cup: it now holds customer 2 (M with pearl), who stays though no pearl is left;
    // customer 4 (S with pearl) goes; customer 0 (M with jelly) can still be made and stays.
    expect(at(events, 38)).toEqual([{ t: 38, type: 'craftStep', step: 'topping', endsAt: 44 }, ...reshop(4, 90, 1, 38, 'pearl')]);
    expect(playerShop(states[38]).queue).toEqual([0, 2, 3]);
    expect(about(events, 2).slice(-2)).toEqual([
      { t: 45, type: 'customerServed', customer: 2, shop: 'player', by: 'player', correct: true, paid: 25, full: 25 },
      { t: 45, type: 'customerLeave', customer: 2, outcome: 'served', emptyHanded: false },
    ]);
    const p = states[199].player;
    expect(p.tally).toMatchObject({ missedNoStock: 2, walkouts: 0, cups: 1 });
    expect(states[199].rt.map(r => r.missedNoStock)).toEqual([false, true, false, false, true]);
    expect([states[199].rt[1].outcome, states[199].rt[1].shop]).toEqual(['served', 'batu']);
  });

  it('throwing the cup away frees the customer it held', () => {
    const s = street(batu(), [cust(0)], { price: 20, stock: stock(350, 5) });
    const { events, states } = runTo(s, 40, { 10: [size('M'), ICE, TEA], 30: [TRASH] });
    expect(at(events, 22)).toEqual([
      { t: 22, type: 'craftStep', step: 'tea', endsAt: 38 },
      { t: 22, type: 'shopStatus', shop: 'player', status: 'soldOut' },
    ]);
    expect(at(events, 30)).toEqual([
      { t: 30, type: 'cupTrashed' },
      { t: 30, type: 'customerAbandon', customer: 0, shop: 'player', cause: 'stockOut', repHit: false, missing: 'tea' },
      { t: 30, type: 'customerConsider', customer: 0, reshop: true, chosen: 'batu', verdicts: [
        { shop: 'batu', score10: 110, reason: 'chosen' }, { shop: 'player', score10: null, reason: 'visited' },
      ] },
      { t: 30, type: 'customerJoin', customer: 0, shop: 'batu', position: 0 },
    ]);
    expect(states[30].player.tally).toMatchObject({ trashed: 1, missedNoStock: 1, walkouts: 0 });
  });

  it('handing the cup to someone else frees the customer it held', () => {
    // The last pearl goes into the cup, which holds customer 0; it is then handed (wrong) to customer 1.
    const s = street([], [cust(0), cust(1, { order: order('M', 'jelly') })],
      { price: 20, stock: { teaMl: 1000, toppings: { pearl: 1, jelly: 5, pudding: 5 } } });
    const { events } = runTo(s, 50, { 10: make(order('M', 'pearl')), 45: [deliver(1)] });
    expect(at(events, 38)).toEqual([{ t: 38, type: 'craftStep', step: 'topping', endsAt: 44 }]);
    expect(at(events, 45)).toEqual([
      { t: 45, type: 'customerServed', customer: 1, shop: 'player', by: 'player', correct: false, paid: 17, full: 25 },
      { t: 45, type: 'customerLeave', customer: 1, outcome: 'servedWrong', emptyHanded: false },
      { t: 45, type: 'craftStep', step: 'deliver', endsAt: 49 },
      { t: 45, type: 'customerAbandon', customer: 0, shop: 'player', cause: 'stockOut', repHit: false,
        missing: 'pearl' },
      { t: 45, type: 'customerConsider', customer: 0, reshop: true, chosen: null, verdicts: [
        { shop: 'player', score10: null, reason: 'visited' },
      ] },
      { t: 45, type: 'customerLeave', customer: 0, outcome: 'gaveUp', emptyHanded: true },
    ]);
  });

  it('only a customer among the first four can be held', () => {
    // An L cup; the only L order is fifth in line. The pour leaves 100 ml and nobody can be served.
    const orders = [order('M', 'jelly'), order('S', 'jelly'), order('M', 'pudding'), order('S', 'pudding'), order('L', 'pearl')];
    const s = street([], orders.map((o, i) => cust(i, { order: o })), { price: 20, stock: stock(600, 5) });
    const { events, states } = runTo(s, 30, { 10: [size('L'), ICE, TEA] });
    expect(playerShop(states[21]).queue).toEqual([0, 1, 2, 3, 4]);
    expect(ofType(at(events, 22), 'customerAbandon').map(e => [e.customer, e.cause])).toEqual(
      [0, 1, 2, 3, 4].map(id => [id, 'stockOut']));
    expect(playerShop(states[22]).queue).toEqual([]);
  });

  it('counts as missed only a customer who would have chosen the player\'s shop with stock, once (R16)', () => {
    // The player (20k, rep 40) is sold out from the start. Bà Tư (29k, rep 50) is too slow to serve anyone.
    const cfg = tuned({ batu: { ticksPerCup: 400 } });
    const s = street([shop('batu', 29), shop('giare', 15)], [
      cust(0, { arriveTick: 10, budget: 15 }), // can afford nobody
      cust(1, { arriveTick: 20, trust: 45 }), // trusts only Bà Tư: the player's rep 40 is too low
      cust(2, { arriveTick: 30 }), // prefers GiáRẻ: 22k against 18k at the player
      cust(3, { arriveTick: 40, trust: 40 }), // GiáRẻ too low; would take the player (18k) over Bà Tư (9k)
    ], { price: 20, rep: 40, stock: stock(0) }, {}, cfg);
    const { events, state } = runTo(s, Infinity, {}, cfg);
    const playerVerdicts = ofType(events, 'customerConsider').map(e => [e.customer, e.reshop, e.verdicts[2].reason]);
    expect(playerVerdicts).toEqual([
      [0, false, 'outOfStock'], [1, false, 'outOfStock'], [2, false, 'outOfStock'], [3, false, 'outOfStock'],
      [1, true, 'outOfStock'], [3, true, 'outOfStock'],
    ]);
    expect(state.rt.map(r => [r.outcome, r.missedNoStock])).toEqual([
      ['noOffer', false], ['gaveUp', false], ['served', false], ['gaveUp', true],
    ]);
    expect(state.player.tally.missedNoStock).toBe(1);
  });

  it('under 200 ml the sign flips; later arrivals find the shop out of stock, each counted once', () => {
    const cfg = tuned({ batu: { ticksPerCup: 400 } }); // nobody gets served at Bà Tư: they all walk out
    const s = street(batu(), [cust(0), cust(1, { order: order('S', 'pearl') }), cust(2, { arriveTick: 100 })],
      { price: 20, stock: stock(500, 5) }, {}, cfg);
    const { events, state } = runTo(s, Infinity, { 10: make(order('M', 'pearl')), 45: [deliver(0)] }, cfg);
    expect(at(events, 22)).toEqual([
      { t: 22, type: 'craftStep', step: 'tea', endsAt: 38 },
      { t: 22, type: 'customerAbandon', customer: 1, shop: 'player', cause: 'stockOut', repHit: false, missing: 'tea' },
      { t: 22, type: 'customerConsider', customer: 1, reshop: true, chosen: 'batu', verdicts: [
        { shop: 'batu', score10: 110, reason: 'chosen' }, { shop: 'player', score10: null, reason: 'visited' },
      ] },
      { t: 22, type: 'customerJoin', customer: 1, shop: 'batu', position: 0 },
      { t: 22, type: 'shopStatus', shop: 'player', status: 'soldOut' },
    ]);
    // Customer 2 sees the player's shop out of stock at arrival and again when re-shopping after Bà Tư.
    expect(ofType(about(events, 2), 'customerConsider').map(e => [e.t, e.chosen, e.verdicts[1]])).toEqual([
      [100, 'batu', { shop: 'player', score10: null, reason: 'outOfStock', missing: 'tea' }],
      [350, null, { shop: 'player', score10: null, reason: 'outOfStock', missing: 'tea' }],
    ]);
    expect(state.rt.map(r => [r.outcome, r.missedNoStock])).toEqual([['served', false], ['gaveUp', true], ['gaveUp', true]]);
    expect(state.player.tally).toMatchObject({ missedNoStock: 2, walkouts: 0, cups: 1 });
  });
});

describe('what ran out (R21)', () => {
  const playerVerdict = (events: SimEvent[], id: number) =>
    ofType(about(events, id), 'customerConsider')[0].verdicts.find(v => v.shop === 'player');

  it('the player\'s verdict names the first missing item: tea before toppings, toppings in canonical order', () => {
    const s = (st: Stock, o: Order) => runTo(street([], [cust(0, { order: o })], { stock: st }), 1).events;
    const noPearlNoPudding: Stock = { teaMl: 2000, toppings: { pearl: 0, jelly: 5, pudding: 0 } };
    expect(playerVerdict(s(stock(300, 5), order('M', 'pearl')), 0))
      .toEqual({ shop: 'player', score10: null, reason: 'outOfStock', missing: 'tea' });
    expect(playerVerdict(s(stock(300, 0), order('M', 'pearl')), 0)?.missing).toBe('tea');
    expect(playerVerdict(s(noPearlNoPudding, order('M', 'jelly', 'pudding')), 0)?.missing).toBe('pudding');
    expect(playerVerdict(s(noPearlNoPudding, order('M', 'pearl', 'pudding')), 0)?.missing).toBe('pearl');
  });

  it('a customer sent away from the player\'s queue is told what ran out: the tea, or a topping', () => {
    // 600 ml: the M pour leaves 250, too little for the L order.
    const tea = runTo(street([], [cust(0), cust(1, { order: order('L', 'jelly') })], { stock: stock(600, 5) }), 23,
      { 10: [size('M'), ICE, TEA] }).events;
    expect(ofType(tea, 'customerAbandon')).toEqual([
      { t: 22, type: 'customerAbandon', customer: 1, shop: 'player', cause: 'stockOut', repHit: false, missing: 'tea' },
    ]);
    // The only pearl goes into the M cup (held by customer 0): customer 1's S with pearl and jelly can no longer be made.
    const pearl = runTo(street([], [cust(0), cust(1, { order: order('S', 'pearl', 'jelly') })],
      { stock: { teaMl: 2000, toppings: { pearl: 1, jelly: 5, pudding: 5 } } }), 39, { 10: make(order('M', 'pearl')) }).events;
    expect(ofType(pearl, 'customerAbandon')).toEqual([
      { t: 38, type: 'customerAbandon', customer: 1, shop: 'player', cause: 'stockOut', repHit: false, missing: 'pearl' },
    ]);
  });

  it('an AI shop out of cups has nothing left: its queue and later arrivals are told the tea', () => {
    const cfg = tuned({ batu: { capacity: 1 } });
    const s = street([shop('batu', 27)], [cust(0), cust(1), cust(2, { arriveTick: 100 })], { stock: stock(0) }, {}, cfg);
    const { events } = runTo(s, 101, {}, cfg);
    expect(ofType(events, 'customerAbandon')).toEqual([
      { t: 69, type: 'customerAbandon', customer: 1, shop: 'batu', cause: 'stockOut', repHit: false, missing: 'tea' },
    ]);
    expect(ofType(about(events, 2), 'customerConsider')[0].verdicts).toEqual([
      { shop: 'batu', score10: null, reason: 'outOfStock', missing: 'tea' },
      { shop: 'player', score10: null, reason: 'outOfStock', missing: 'tea' },
    ]);
  });

  it('is set on outOfStock verdicts and stockOut abandons only', () => {
    for (const day of [1, 5] as Day[]) {
      const ai = [shop('batu', 28), shop('giare', 25), shop('cochap', 30), shop('tapdoan', 27)];
      const { events } = finishRush(createRush(input({ seed: 3, rules: rules(day), ai },
        { stock: { teaMl: 1500, toppings: { pearl: 0, jelly: 2, pudding: 1 } } })).state);
      const verdicts = ofType(events, 'customerConsider').flatMap(e => e.verdicts);
      expect(verdicts.some(v => v.missing !== undefined)).toBe(true);
      for (const v of verdicts) expect(v.missing !== undefined).toBe(v.reason === 'outOfStock');
      for (const e of ofType(events, 'customerAbandon')) expect(e.missing !== undefined).toBe(e.cause === 'stockOut');
    }
  });
});

describe('the staff helper (§4 Nâng cấp, plan)', () => {
  it('makes a "không đá" order with its smaller tea', () => {
    const s = street([], [cust(0, { arriveTick: 10, budget: 60, order: dryOrder('L', 'pearl') })],
      { price: 30, staff: true, stock: stock(400, 1) });
    const { events, state } = runTo(s);
    expect(ofType(events, 'customerServed')).toEqual([
      { t: 99, type: 'customerServed', customer: 0, shop: 'player', by: 'staff', correct: true, paid: 40, full: 40 },
    ]);
    expect(state.player.stock).toEqual({ teaMl: 0, toppings: { pearl: 0, jelly: 1, pudding: 1 } });
    expect(state.player.handed.teaMl).toBe(400);
  });

  it('serves the first customer it can every 90 ticks of waiting, correctly, from the shop\'s stock', () => {
    const s = street([], [
      cust(0, { arriveTick: 10, budget: 60 }), cust(1, { arriveTick: 10, budget: 60, order: order('S', 'jelly', 'pudding') }),
      cust(2, { arriveTick: 400, budget: 60, order: order('L', 'pearl') }),
    ], { price: 30, staff: true, stock: stock(2000, 5) });
    const { events, state, states } = runTo(s);
    expect(ofType(events, 'customerServed')).toEqual([
      { t: 99, type: 'customerServed', customer: 0, shop: 'player', by: 'staff', correct: true, paid: 35, full: 35 },
      { t: 189, type: 'customerServed', customer: 1, shop: 'player', by: 'staff', correct: true, paid: 35, full: 35 },
      { t: 489, type: 'customerServed', customer: 2, shop: 'player', by: 'staff', correct: true, paid: 40, full: 40 },
    ]);
    expect(about(events, 0).at(-1)).toEqual({ t: 99, type: 'customerLeave', customer: 0, outcome: 'served', emptyHanded: false });
    // The clock waits while nobody waits.
    expect([states[399].player.staff?.progress, states[400].player.staff?.progress]).toEqual([0, 1]);
    expect(state.player.stock).toEqual({ teaMl: 900, toppings: { pearl: 3, jelly: 4, pudding: 4 } });
    expect(state.player.tally).toMatchObject({ cups: 3, staffCups: 3, revenue: 110, wrong: 0 });
    expect(playerShop(state).sold).toBe(3);
  });

  it('works alongside the player and leaves alone the customer the player\'s cup is for', () => {
    const s = street([], [cust(0, { arriveTick: 10, budget: 60 }), cust(1, { arriveTick: 10, budget: 60, order: order('S', 'jelly') })],
      { price: 30, staff: true });
    const { events, state, states } = runTo(s, 200, { 80: make(order('M', 'pearl')), 115: [deliver(0)] });
    expect(ofType(events, 'customerServed').map(e => [e.t, e.customer, e.by, e.paid])).toEqual([
      [99, 1, 'staff', 30], [115, 0, 'player', 35],
    ]);
    // Only the held customer waits from 100 to 114: the staff's clock stands still.
    expect(states[114].player.staff?.progress).toBe(0);
    expect(state.player.tally).toMatchObject({ cups: 2, staffCups: 1, revenue: 65 });
  });

  it('its clock pauses, keeping its count, while nobody it can serve waits', () => {
    const s = street([], [cust(0, { arriveTick: 10, budget: 60 }), cust(1, { arriveTick: 300, budget: 60, order: order('S', 'jelly') })],
      { price: 30, staff: true });
    // 40 ticks on customer 0 (10..49), then the player's cup holds them until it is handed over at 85.
    const { events, states } = runTo(s, 400, { 50: make(order('M', 'pearl')), 85: [deliver(0)] });
    expect(states[200].player.staff?.progress).toBe(40);
    expect(ofType(events, 'customerServed').map(e => [e.t, e.customer, e.by])).toEqual([[85, 0, 'player'], [349, 1, 'staff']]);
  });

  it('in the same tick the player\'s cup takes the stock before the staff', () => {
    // The player's queued tea and the staff's 90th tick both come at 89, with tea for one M only.
    const s = street([], [cust(0, { budget: 60 }), cust(1, { budget: 60 })], { price: 30, staff: true, stock: stock(600, 5) });
    const { events, states } = runTo(s, 100, { 77: [size('M'), ICE, TEA] });
    expect(at(events, 89)).toEqual([
      { t: 89, type: 'craftStep', step: 'tea', endsAt: 105 },
      { t: 89, type: 'customerAbandon', customer: 1, shop: 'player', cause: 'stockOut', repHit: false,
        missing: 'tea' },
      { t: 89, type: 'customerConsider', customer: 1, reshop: true, chosen: null, verdicts: [
        { shop: 'player', score10: null, reason: 'visited' },
      ] },
      { t: 89, type: 'customerLeave', customer: 1, outcome: 'gaveUp', emptyHanded: true },
    ]);
    expect(states[89].player.staff?.progress).toBe(89);
  });

  it('shares the stock: a queued tea the staff has used up is dropped when it comes up', () => {
    const s = street([], [cust(0, { budget: 60 }), cust(1, { budget: 60 })], { price: 30, staff: true, stock: stock(600, 5) });
    const { events } = runTo(s, 120, { 80: [size('M'), ICE, TEA], 100: [TRASH] });
    // The cup holds customer 0 from 80, so the staff serves customer 1 at 89 and leaves 250 ml.
    expect(at(events, 89)).toEqual([
      { t: 89, type: 'customerServed', customer: 1, shop: 'player', by: 'staff', correct: true, paid: 35, full: 35 },
      { t: 89, type: 'customerLeave', customer: 1, outcome: 'served', emptyHanded: false },
    ]);
    expect(at(events, 92)).toEqual([{ t: 92, type: 'inputRejected', action: 'craft', why: 'noTea' }]);
    expect(at(events, 100)).toEqual([
      { t: 100, type: 'cupTrashed' },
      { t: 100, type: 'customerAbandon', customer: 0, shop: 'player', cause: 'stockOut', repHit: false,
        missing: 'tea' },
      { t: 100, type: 'customerConsider', customer: 0, reshop: true, chosen: null, verdicts: [
        { shop: 'player', score10: null, reason: 'visited' },
      ] },
      { t: 100, type: 'customerLeave', customer: 0, outcome: 'gaveUp', emptyHanded: true },
    ]);
  });
});

describe('tax (§4 Thuế)', () => {
  it('on day 4 every cup the player\'s shop sells pays 5k into the ward fund: player or staff, right or wrong', () => {
    const s = street([], [
      cust(0, { arriveTick: 10, budget: 60 }), cust(1, { arriveTick: 10, budget: 60, order: order('S', 'jelly') }),
      cust(2, { arriveTick: 10, budget: 60, order: order('L', 'pearl') }),
    ], { price: 30, staff: true }, { rules: rules(4) });
    const { events, state } = runTo(s, Infinity, {
      80: make(order('M', 'pearl')), 115: [deliver(0)], 120: [size('M'), ICE, TEA], 149: [deliver(2)],
    });
    expect(ofType(events, 'customerServed').map(e => [e.t, e.customer, e.by, e.correct, e.paid])).toEqual([
      [99, 1, 'staff', true, 30], [115, 0, 'player', true, 35], [149, 2, 'player', false, 21],
    ]);
    expect(state.player.tally).toMatchObject({ cups: 3, staffCups: 1, wrong: 1, revenue: 86, tax: 15 });
    expect(state.street.taxFund).toBe(15);
  });

  it('pays no tax on other days', () => {
    const s = street([], [cust(0, { budget: 60 })], { price: 30 });
    const { state } = runTo(s, 60, { 10: make(order('M', 'pearl')), 45: [deliver(0)] });
    expect([state.player.tally.tax, state.street.taxFund, state.player.tally.cups]).toEqual([0, 0, 1]);
  });
});

describe('closing early (§6, §16.7, R15)', () => {
  const closing = () => street([shop('batu', 29)],
    [cust(0), cust(1, { order: order('S', 'jelly') }), cust(2, { arriveTick: 100 })], { price: 20 });
  const script = { 10: make(order('M', 'pearl')), 30: [CLOSE] };

  it('drops the cup, sends the queue to re-shop without a rep hit, and the rush runs on to 900', () => {
    const { events, state, states } = runTo(closing(), Infinity, script);
    const reshop = (id: number, batuScore: number, position: number): SimEvent[] => [
      { t: 30, type: 'customerAbandon', customer: id, shop: 'player', cause: 'shopClosed', repHit: false },
      { t: 30, type: 'customerConsider', customer: id, reshop: true, chosen: 'batu', verdicts: [
        { shop: 'batu', score10: batuScore, reason: 'chosen' }, { shop: 'player', score10: null, reason: 'closed' },
      ] },
      { t: 30, type: 'customerJoin', customer: id, shop: 'batu', position },
    ];
    expect(at(events, 30)).toEqual([
      { t: 30, type: 'shopStatus', shop: 'player', status: 'closedEarly' }, ...reshop(0, 110, 0), ...reshop(1, 90, 1),
    ]);
    const p = states[30].player;
    expect(p.craft).toEqual({ cup: null, anim: null, buffer: [] });
    expect(p.stock.teaMl).toBe(9650); // the tea in the dropped cup is gone; the queued pearl never started
    expect(p.stock.toppings.pearl).toBe(50);
    expect(p.tally.trashed).toBe(0);
    expect(ofType(about(events, 2), 'customerConsider')[0].verdicts[1]).toEqual({ shop: 'player', score10: null, reason: 'closed' });
    expect(events.at(-1)).toEqual({ t: 900, type: 'rushEnd', early: true });
    expect(state.player.tally).toMatchObject({ walkouts: 0, missedNoStock: 0 });
    expect(summarizeRush(state).shops.find(r => r.id === 'player')).toMatchObject({ status: 'closedEarly', openPrice: 20, closePrice: 20 });
  });

  it('finishRush fast-forwards a closed shop to the same end as stepping', () => {
    const stepped = runTo(closing(), Infinity, script);
    const closed = runTo(closing(), 31, script).state;
    const fast = finishRush(closed);
    expect(fast.state).toEqual(stepped.state);
    expect(fast.events).toEqual(stepped.events.filter(e => e.t > 30));
  });
});

describe('whole rushes played through actions', () => {
  const holds = (o: Order, c: Cup) => o.size === c.size && (o.noIce ? !c.iced : c.iced || c.teaMl === 0)
    && c.toppings.every(t => o.toppings.includes(t));

  /** A plain bot: when the counter is idle it makes the cup of the first customer at the counter and hands it over;
   *  every fifth customer gets a cup without toppings. It throws the cup away when it cannot be finished. */
  const bot = (s: RushState): Action[] => {
    const { craft: c, stock: st } = s.player;
    if (c.anim !== null || playerShop(s).status === 'closedEarly') return [];
    const first = counterView(s).first;
    const cup = c.cup;
    if (cup === null) return first.length > 0 ? make(first[0].order) : [];
    const target = first.find(f => holds(f.order, cup));
    if (!target) return [TRASH];
    const sloppy = target.customer % 5 === 0;
    const steps: Action[] = [];
    if (!cup.iced && !target.order.noIce && cup.teaMl === 0) steps.push(ICE);
    if (cup.teaMl === 0) steps.push(TEA);
    if (!sloppy) for (const t of target.order.toppings) if (!cup.toppings.includes(t)) steps.push(top(t));
    if (steps.length === 0) return [deliver(target.customer)];
    const head = steps[0];
    if (head.type === 'craft' && checkInput(c, head.input, st) !== null) return [TRASH];
    return steps;
  };

  const play = (day: Day, seed: number) => {
    const ai: AiShopState[] = day === 1
      ? [shop('batu', 27), shop('giare', 22), shop('cochap', 30), shop('luotsong', 29), shop('sinhvien', 34)]
      : [shop('batu', 28), shop('giare', 25), shop('cochap', 30), shop('luotsong', 31), shop('sinhvien', 31), shop('tapdoan', 27)];
    let s = createRush(input({ seed, rules: rules(day), ai, adCustomers: 3 }, {
      price: day === 3 ? 20 : 30, stock: { teaMl: 4000, toppings: { pearl: 7, jelly: 5, pudding: 4 } },
      staff: seed === 2, machine: seed === 3,
    })).state;
    const events: SimEvent[] = [];
    const states: RushState[] = [];
    while (!s.done) {
      const r = step(s, bot(s));
      s = r.state;
      states.push(s);
      events.push(...r.events);
    }
    return { state: s, events, states };
  };

  it.each([1, 2, 3, 4, 5] as Day[])('day %i: the books of the player\'s shop add up', day => {
    for (const seed of [1, 2, 3]) {
      const { state, events, states } = play(day, seed);
      const p = state.player;
      const mine = ofType(events, 'customerServed').filter(e => e.shop === 'player');
      expect(mine.length).toBeGreaterThan(0);
      expect(p.tally.cups).toBe(mine.length);
      expect(playerShop(state).sold).toBe(mine.length);
      expect(p.tally.staffCups).toBe(mine.filter(e => e.by === 'staff').length);
      expect(p.tally.wrong).toBe(mine.filter(e => !e.correct).length);
      expect(p.tally.revenue).toBe(mine.reduce((k, e) => k + e.paid, 0));
      expect(p.tally.tax).toBe(mine.length * rules(day).taxPerCup);
      expect(state.street.taxFund).toBe(ofType(events, 'customerServed').length * rules(day).taxPerCup);
      expect(p.tally.trashed).toBe(ofType(events, 'cupTrashed').length);
      for (const e of mine) {
        expect(state.rt[e.customer]).toMatchObject({ shop: 'player', outcome: e.correct ? 'served' : 'servedWrong' });
        if (e.correct) expect(e.paid).toBe(e.full);
        else expect(e.paid).toBeLessThan(e.full);
      }
      expect(ofType(events, 'customerLeave')).toHaveLength(state.customers.length);
      expect(p.tally.missedNoStock).toBe(state.rt.filter(r => r.missedNoStock).length);
      expect(ofType(events, 'customerAbandon').filter(e => e.repHit).every(e => e.cause === 'patience')).toBe(true);
      expect(p.craft).toEqual({ cup: null, anim: null, buffer: [] });
      // Stock never goes negative, and every customer at the player's counter can be served from it,
      // except at most one held by the cup in progress.
      for (const x of states) {
        const st = x.player.stock;
        expect(st.teaMl >= 0 && Object.values(st.toppings).every(n => n >= 0)).toBe(true);
        const stuck = playerShop(x).queue.filter(id => !canServe(st, x.customers[id].order));
        expect(stuck.length).toBeLessThanOrEqual(1);
        if (stuck.length === 1) {
          const c = x.player.craft.cup;
          expect(c !== null && holds(x.customers[stuck[0]].order, c)).toBe(true);
          expect(counterView(x).first.map(f => f.customer)).toContain(stuck[0]);
        }
      }
    }
  });

  it('is deterministic: the same seed and the same actions give the same events', () => {
    const a = play(4, 2);
    const b = play(4, 2);
    expect(b.events).toEqual(a.events);
    expect(b.state).toEqual(a.state);
  });
});
