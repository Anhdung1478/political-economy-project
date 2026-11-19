import { describe, expect, it } from 'vitest';
import { CONFIG, type SimConfig } from './config';
import { generateAdCustomers, generateCustomers } from './customers';
import {
  canServe, counterView, createRush, createRushWith, finishRush, step, summarizeRush, type RushInput,
} from './rush';
import type { AiShopId, AiShopState, Customer, Day, DayRules, K, RushState, SimEvent, Stock } from './types';

const rules = (day: Day, over: Partial<DayRules> = {}): DayRules => {
  const d = CONFIG.days[day];
  return { day, ceiling: d.ceiling, taxPerCup: d.taxPerCup, rumor: d.rumor, cartel: false,
    customerFactor: d.customerFactor, ...over };
};

const stock = (teaMl: number, each = 0): Stock => ({ teaMl, toppings: { pearl: each, jelly: each, pudding: each } });
/** The player's shop starts sold out: nobody can pick it. */
const NONE = stock(0);
const PLENTY = stock(10000, 50);

const shop = (id: AiShopId, todayPrice: K | null, over: Partial<AiShopState> = {}): AiShopState => ({
  id, status: 'active', closedOn: null, todayPrice, resting: false, probeDir: -1, history: [], ...over,
});

const day1Ai = () => [shop('batu', 27), shop('giare', 22), shop('cochap', 30), shop('luotsong', 29),
  shop('sinhvien', 34), shop('tapdoan', null, { status: 'notYet' })];
const day2Ai = () => [shop('batu', 28), shop('giare', 25), shop('cochap', 30), shop('luotsong', 31),
  shop('sinhvien', 31), shop('tapdoan', 27)];
const dayAi: Record<Day, () => AiShopState[]> = {
  1: day1Ai,
  2: day2Ai,
  3: () => [shop('batu', 20), shop('giare', 20), shop('cochap', null, { resting: true }), shop('luotsong', 20),
    shop('sinhvien', null, { resting: true }), shop('tapdoan', 20)],
  4: () => [shop('batu', 30), shop('giare', 29), shop('cochap', 33), shop('luotsong', 33), shop('sinhvien', 31),
    shop('tapdoan', 30)],
  5: day2Ai,
};

type PlayerIn = RushInput['player'];
const input = (over: Partial<RushInput> = {}, player: Partial<PlayerIn> = {}): RushInput => ({
  seed: 1, rules: rules(1), ai: day1Ai(), adCustomers: 0,
  player: { price: 30, tea: 'standard', stock: PLENTY, rep: 50, machine: false, staff: false, skimpDays: 0,
    selfCertified: false, ...player },
  ...over,
});

const cust = (id: number, over: Partial<Customer> = {}): Customer => ({
  id, budget: 40, trust: 0, skeptic: 0, order: { size: 'M', toppings: ['pearl'] }, arriveTick: 0, entry: 'left',
  tie: 0, look: 0, scared: false, onlyShop: null, ...over,
});

/** A hand-built street: these AI shops, these customers, the player's shop as given. */
const street = (ai: AiShopState[], customers: Customer[], player: Partial<PlayerIn> = {}, over: Partial<RushInput> = {},
  cfg: SimConfig = CONFIG) => createRushWith(input({ ai, ...over }, player), customers, cfg).state;

const deepFreeze = <T>(x: T): T => {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
};

/**
 * Steps one tick at a time until the clock reaches `until` or the rush ends, collecting every event.
 * Every state is deep-frozen before it is stepped, so each scenario also checks that `step` leaves its input alone.
 */
const runTo = (state: RushState, until = Infinity, cfg: SimConfig = CONFIG) => {
  const events: SimEvent[] = [];
  let s = state;
  while (!s.done && s.tick < until) {
    const r = step(deepFreeze(s), [], cfg);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
};

const about = (events: SimEvent[], id: number) => events.filter(e => 'customer' in e && e.customer === id);
const at = (events: SimEvent[], t: number) => events.filter(e => e.t === t);
const ofType = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

type AiSpec = SimConfig['aiShops'][AiShopId];
/** A config where some AI shops have another capacity or pace. */
const tuned = (over: Partial<Record<AiShopId, Partial<AiSpec>>>): SimConfig => {
  const aiShops = { ...CONFIG.aiShops };
  for (const [id, o] of Object.entries(over) as [AiShopId, Partial<AiSpec>][]) aiShops[id] = { ...aiShops[id], ...o };
  return { ...CONFIG, aiShops };
};

describe('createRush', () => {
  it('generates the day\'s customers, appends ad customers after them, and emits nothing', () => {
    const { state, events } = createRush(input({ seed: 9, rules: rules(2), ai: day2Ai(), adCustomers: 6 }));
    expect(events).toEqual([]);
    expect(state.customers.slice(0, 130)).toEqual(generateCustomers(9, 2));
    expect(state.customers.slice(130)).toEqual(generateAdCustomers(9, 2, 130, 6));
    expect(state.customers.map(c => c.id)).toEqual(state.customers.map((_, i) => i));
    expect(state.rt.every(r => r.status === 'pending' && r.outcome === null && r.visited.length === 0)).toBe(true);
    expect(state.tick).toBe(0);
    expect(state.done).toBe(false);
  });

  it('orders arrivals by tick, then id', () => {
    const { state } = createRush(input({ seed: 4 }));
    const keys = state.arrivalOrder.map(id => [state.customers[id].arriveTick, id]);
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(keys).toEqual(sorted);
    expect(new Set(state.arrivalOrder).size).toBe(state.customers.length);
  });

  it('puts every shop on the street in slot order with its status, price and stock', () => {
    const ai = [shop('tapdoan', 27), shop('batu', 28), shop('cochap', null, { resting: true }),
      shop('giare', null, { status: 'closed', closedOn: 1 })];
    const { state } = createRush(input({ rules: rules(2), ai }, { price: 31, rep: 62 }));
    expect(state.shops.map(s => [s.id, s.slot, s.status, s.price])).toEqual([
      ['batu', 0, 'open', 28], ['giare', 1, 'closed', 0], ['cochap', 2, 'resting', 0],
      ['player', 5, 'open', 31], ['tapdoan', 6, 'open', 27],
    ]);
    const batu = state.shops[0];
    expect(batu.ai).toEqual({ cost: 13, capacity: 12, cupsLeft: 12, ticksPerCup: 70, busy: 0, frozen: false });
    expect(batu.trail).toEqual([[0, 28]]);
    expect(batu.rep).toBe(50);
    expect(state.shops[2].ai?.capacity).toBe(0);
    expect(state.shops[2].trail).toEqual([]);
    const player = state.shops[3];
    expect(player.ai).toBeNull();
    expect(player.rep).toBe(62);
    expect(state.player.morningPrice).toBe(31);
    expect(state.player.stock).toEqual(PLENTY);
    expect(state.player.bought).toEqual(PLENTY);
    expect(state.shops[4].ai?.ticksPerCup).toBe(50);
  });

  it('gives Chuỗi Tập Đoàn its grand opening on day 2 only', () => {
    const d2 = createRush(input({ rules: rules(2), ai: day2Ai() })).state;
    expect(d2.shops.filter(s => s.grandOpening).map(s => s.id)).toEqual(['tapdoan']);
    const d4 = createRush(input({ rules: rules(4), ai: dayAi[4]() })).state;
    expect(d4.shops.some(s => s.grandOpening)).toBe(false);
    const d1 = createRush(input()).state;
    expect(d1.shops.some(s => s.grandOpening)).toBe(false);
  });

  it('freezes AI prices on a cartel day', () => {
    const { state } = createRush(input({ rules: rules(2, { cartel: true }), ai: day2Ai().map(s => ({ ...s, todayPrice: 36 })) }));
    expect(state.shops.filter(s => s.ai).every(s => s.ai?.frozen)).toBe(true);
    const free = createRush(input()).state;
    expect(free.shops.some(s => s.ai?.frozen)).toBe(false);
  });

  it('hangs the sold-out sign on the player\'s shop when it opens with under 250 ml of tea', () => {
    const at249 = createRush(input({}, { stock: stock(249, 5) })).state;
    expect(at249.shops.find(s => s.id === 'player')?.status).toBe('soldOut');
    const at250 = createRush(input({}, { stock: stock(250, 5) })).state;
    expect(at250.shops.find(s => s.id === 'player')?.status).toBe('open');
  });

  it('does not change its input', () => {
    const inp = deepFreeze(input({ adCustomers: 3 }));
    expect(() => createRush(inp)).not.toThrow();
  });
});

describe('clock', () => {
  it('the first step emits rushStart at t 0; one step is one tick; the 900th step ends the rush', () => {
    let s = createRush(input()).state;
    const first = step(s, []);
    expect(first.events[0]).toEqual({ t: 0, type: 'rushStart', day: 1, rules: rules(1) });
    expect(first.state.tick).toBe(1);
    s = first.state;
    let steps = 1;
    let last: SimEvent[] = [];
    let starts = 0;
    while (!s.done) {
      const r = step(s, []);
      expect(r.state.tick).toBe(s.tick + 1);
      starts += ofType(r.events, 'rushStart').length;
      s = r.state;
      last = r.events;
      steps++;
    }
    expect(steps).toBe(900);
    expect(starts).toBe(0);
    expect(s.tick).toBe(900);
    expect(last.at(-1)).toEqual({ t: 900, type: 'rushEnd', early: false });
  });

  it('a step after the end does nothing', () => {
    const done = finishRush(createRush(input()).state).state;
    const r = step(done, []);
    expect(r.events).toEqual([]);
    expect(r.state).toEqual(done);
  });
});

describe('customers walking in (tick order 3 and 4)', () => {
  it('customerEnter fires enterLeadTicks before arrival, at 0 for early arrivals (R10)', () => {
    const s = street([shop('batu', 27)], [
      cust(0, { arriveTick: 3 }), cust(1, { arriveTick: 15, entry: 'right' }), cust(2, { arriveTick: 16 }),
      cust(3, { arriveTick: 40 }),
    ], { stock: NONE });
    const { events } = runTo(s, 50);
    expect(ofType(events, 'customerEnter')).toEqual([
      { t: 0, type: 'customerEnter', customer: 0, entry: 'left' },
      { t: 0, type: 'customerEnter', customer: 1, entry: 'right' },
      { t: 1, type: 'customerEnter', customer: 2, entry: 'left' },
      { t: 25, type: 'customerEnter', customer: 3, entry: 'left' },
    ]);
  });

  it('within a tick, entries come before arrivals, and arrivals go in id order', () => {
    const s = street([shop('batu', 27)], [
      cust(0, { arriveTick: 20 }), cust(1, { arriveTick: 10 }), cust(2, { arriveTick: 20 }), cust(3, { arriveTick: 35 }),
    ], { stock: NONE });
    const { events } = runTo(s, 21);
    expect(at(events, 20)).toEqual([
      { t: 20, type: 'customerEnter', customer: 3, entry: 'left' },
      { t: 20, type: 'customerConsider', customer: 0, reshop: false, chosen: 'batu', verdicts: [
        { shop: 'batu', score10: 110, reason: 'chosen' },
        { shop: 'player', score10: null, reason: 'outOfStock', missing: 'tea' },
      ] },
      { t: 20, type: 'customerJoin', customer: 0, shop: 'batu', position: 1 },
      { t: 20, type: 'customerConsider', customer: 2, reshop: false, chosen: 'batu', verdicts: [
        { shop: 'batu', score10: 90, reason: 'chosen' },
        { shop: 'player', score10: null, reason: 'outOfStock', missing: 'tea' },
      ] },
      { t: 20, type: 'customerJoin', customer: 2, shop: 'batu', position: 2 },
    ]);
  });

  it('closed, resting and not-yet shops are listed as closed in the verdicts', () => {
    const s = street([shop('batu', 27), shop('giare', null, { status: 'closed', closedOn: 1 }),
      shop('cochap', null, { resting: true }), shop('tapdoan', null, { status: 'notYet' })], [cust(0)], { stock: NONE });
    const consider = ofType(runTo(s, 1).events, 'customerConsider')[0];
    expect(consider.verdicts.map(v => [v.shop, v.reason])).toEqual([
      ['batu', 'chosen'], ['giare', 'closed'], ['cochap', 'closed'], ['player', 'outOfStock'], ['tapdoan', 'closed'],
    ]);
  });

  it('nobody joins a queue of 5; the player\'s counter shows the first 4 with their patience', () => {
    const customers = [0, 1, 2, 3, 4, 5].map(i => cust(i, { budget: 60, arriveTick: 10 }));
    const s = street([], customers, { price: 20 });
    const { state, events } = runTo(s, 12);
    expect(state.shops[0].queue).toEqual([0, 1, 2, 3, 4]);
    const sixth = ofType(events, 'customerConsider').find(e => e.customer === 5);
    expect(sixth?.verdicts).toEqual([{ shop: 'player', score10: 300, reason: 'tooCrowded' }]);
    expect(state.rt[5].outcome).toBe('noOffer');
    const order = customers[0].order;
    expect(counterView(state)).toEqual({
      first: [0, 1, 2, 3].map(customer => ({ customer, order, patienceLeft: 248 })),
      rest: 1,
    });
  });

  it('a customer who finds no shop worth it leaves at once (noOffer)', () => {
    const s = street([shop('batu', 27)], [cust(0, { budget: 20, arriveTick: 5 })], { stock: NONE });
    const { state, events } = runTo(s, 6);
    expect(about(events, 0).slice(1)).toEqual([
      { t: 5, type: 'customerConsider', customer: 0, reshop: false, chosen: null, verdicts: [
        { shop: 'batu', score10: -70, reason: 'tooExpensive' },
        { shop: 'player', score10: null, reason: 'outOfStock', missing: 'tea' },
      ] },
      { t: 5, type: 'customerLeave', customer: 0, outcome: 'noOffer', emptyHanded: false },
    ]);
    expect(state.rt[0]).toMatchObject({ status: 'done', outcome: 'noOffer', shop: null });
  });

  it('scared customers walk through without buying (outcome scared)', () => {
    const s = street([shop('batu', 27)], [cust(0, { scared: true, budget: 60 })], { stock: NONE });
    const { state, events } = runTo(s, 1);
    expect(about(events, 0).slice(1)).toEqual([
      { t: 0, type: 'customerConsider', customer: 0, reshop: false, chosen: null, verdicts: [
        { shop: 'batu', score10: null, reason: 'rumor' },
        { shop: 'player', score10: null, reason: 'rumor' },
      ] },
      { t: 0, type: 'customerLeave', customer: 0, outcome: 'scared', emptyHanded: false },
    ]);
    expect(state.street.eligible).toBe(0);
  });
});

describe('AI service pace', () => {
  it('Ông Cố Chấp serves one cup per 70 ticks; the clock only runs while someone waits', () => {
    // Ông Cố Chấp never reprices, so every cup is 30k.
    const s = street([shop('cochap', 30)], [
      cust(0, { arriveTick: 10 }), cust(1, { arriveTick: 10 }), cust(2, { arriveTick: 400 }),
    ], { stock: NONE });
    const { state, events } = runTo(s);
    expect(ofType(events, 'customerServed')).toEqual([
      { t: 79, type: 'customerServed', customer: 0, shop: 'cochap', by: 'ai', correct: true, paid: 30, full: 30 },
      { t: 149, type: 'customerServed', customer: 1, shop: 'cochap', by: 'ai', correct: true, paid: 30, full: 30 },
      { t: 469, type: 'customerServed', customer: 2, shop: 'cochap', by: 'ai', correct: true, paid: 30, full: 30 },
    ]);
    expect(about(events, 0).at(-1)).toEqual({ t: 79, type: 'customerLeave', customer: 0, outcome: 'served', emptyHanded: false });
    const cochap = state.shops[0];
    expect(cochap.sold).toBe(3);
    expect(cochap.ai?.cupsLeft).toBe(9);
    expect(cochap.revenue).toBe(90);
    expect(state.rt[0]).toMatchObject({ status: 'done', outcome: 'served', shop: 'cochap' });
  });

  it('Chuỗi Tập Đoàn serves one cup per 50 ticks', () => {
    const s = street([shop('tapdoan', 27)], [cust(0, { arriveTick: 10 }), cust(1, { arriveTick: 10 })],
      { stock: NONE }, { rules: rules(2) });
    const served = ofType(runTo(s).events, 'customerServed');
    expect(served.map(e => [e.t, e.customer])).toEqual([[59, 0], [109, 1]]);
  });

  it('a cup in progress waits while the queue is empty and resumes with the next customer', () => {
    // 300 ticks a cup: customer 0 gives up at 250 after 251 ticks of work; customer 1 gets that cup 49 ticks later.
    const cfg = tuned({ batu: { ticksPerCup: 300 } });
    const s = street([shop('batu', 27)], [cust(0), cust(1, { arriveTick: 300 })], { stock: NONE }, {}, cfg);
    const { events } = runTo(s, Infinity, cfg);
    expect(ofType(events, 'customerAbandon').map(e => [e.t, e.customer, e.cause])).toEqual([[250, 0, 'patience']]);
    expect(ofType(events, 'customerServed').map(e => [e.t, e.customer])).toEqual([[348, 1]]);
  });

  it('a cup finished on the tick patience runs out wins (production before patience)', () => {
    const cfg = tuned({ batu: { ticksPerCup: 251 } });
    const s = street([shop('batu', 27)], [cust(0)], { stock: NONE }, {}, cfg);
    const { events } = runTo(s, Infinity, cfg);
    expect(ofType(events, 'customerServed').map(e => e.t)).toEqual([250]);
    expect(ofType(events, 'customerAbandon')).toEqual([]);
  });

  it('pays the tax of every AI cup into the ward fund on a tax day', () => {
    const s = street([shop('batu', 27)], [cust(0), cust(1)], { stock: NONE }, { rules: rules(4) });
    const { state } = runTo(s);
    expect(state.street.taxFund).toBe(10);
    expect(state.shops[0].revenue).toBe(54);
  });
});

describe('sold out', () => {
  it('flips the sign after the last cup and the queue re-shops without a rep hit', () => {
    const cfg = tuned({ batu: { capacity: 2 } });
    const customers = [0, 1, 2, 3].map(i => cust(i, { budget: 50 }));
    customers.push(cust(4, { budget: 50, arriveTick: 300 }));
    const s = street([shop('batu', 20), shop('giare', 30)], customers, { stock: NONE }, {}, cfg);
    const { state, events } = runTo(s, Infinity, cfg);
    const shops3 = (giare: number) => [
      { shop: 'batu', score10: null, reason: 'visited' },
      { shop: 'giare', score10: giare, reason: 'chosen' },
      { shop: 'player', score10: null, reason: 'outOfStock', missing: 'tea' },
    ];
    expect(at(events, 139)).toEqual([
      { t: 139, type: 'customerServed', customer: 1, shop: 'batu', by: 'ai', correct: true, paid: 20, full: 20 },
      { t: 139, type: 'customerLeave', customer: 1, outcome: 'served', emptyHanded: false },
      { t: 139, type: 'shopStatus', shop: 'batu', status: 'soldOut' },
      { t: 139, type: 'customerAbandon', customer: 2, shop: 'batu', cause: 'stockOut', repHit: false,
        missing: 'tea' },
      { t: 139, type: 'customerConsider', customer: 2, reshop: true, chosen: 'giare', verdicts: shops3(170) },
      { t: 139, type: 'customerJoin', customer: 2, shop: 'giare', position: 0 },
      { t: 139, type: 'customerAbandon', customer: 3, shop: 'batu', cause: 'stockOut', repHit: false,
        missing: 'tea' },
      { t: 139, type: 'customerConsider', customer: 3, reshop: true, chosen: 'giare', verdicts: shops3(150) },
      { t: 139, type: 'customerJoin', customer: 3, shop: 'giare', position: 1 },
    ]);
    // Fresh patience at the second shop; Chuỗi GiáRẻ starts on them the next tick. Customer 4 comes later.
    expect(ofType(events, 'customerServed').filter(e => e.shop === 'giare').map(e => [e.t, e.customer]))
      .toEqual([[209, 2], [279, 3], [369, 4]]);
    const later = ofType(events, 'customerConsider').find(e => e.customer === 4);
    expect(later?.verdicts[0]).toEqual({ shop: 'batu', score10: null, reason: 'outOfStock', missing: 'tea' });
    const [batu, giare] = state.shops;
    expect([batu.status, batu.sold, batu.ai?.cupsLeft, batu.revenue]).toEqual(['soldOut', 2, 0, 40]);
    expect([giare.sold, giare.revenue]).toEqual([3, 90]);
    expect(state.player.tally.walkouts).toBe(0);
  });
});

describe('patience and re-shopping (§4, §16.5)', () => {
  it('walks out of the player\'s queue after 250 ticks (walkout, rep hit), re-shops once, then leaves the street', () => {
    const cfg = tuned({ batu: { ticksPerCup: 400 } });
    const s = street([shop('batu', 25), shop('giare', 30)], [cust(0)], { price: 20 }, {}, cfg);
    const { state, events } = runTo(s, Infinity, cfg);
    expect(about(events, 0)).toEqual([
      { t: 0, type: 'customerEnter', customer: 0, entry: 'left' },
      { t: 0, type: 'customerConsider', customer: 0, reshop: false, chosen: 'player', verdicts: [
        { shop: 'batu', score10: 150, reason: 'otherBetter' },
        { shop: 'giare', score10: 70, reason: 'otherBetter' },
        { shop: 'player', score10: 200, reason: 'chosen' },
      ] },
      { t: 0, type: 'customerJoin', customer: 0, shop: 'player', position: 0 },
      { t: 250, type: 'customerAbandon', customer: 0, shop: 'player', cause: 'patience', repHit: true },
      { t: 250, type: 'customerConsider', customer: 0, reshop: true, chosen: 'batu', verdicts: [
        { shop: 'batu', score10: 150, reason: 'chosen' },
        { shop: 'giare', score10: 70, reason: 'otherBetter' },
        { shop: 'player', score10: null, reason: 'visited' },
      ] },
      { t: 250, type: 'customerJoin', customer: 0, shop: 'batu', position: 0 },
      // Second walk-out: no third shop, though Chuỗi GiáRẻ would still score 70.
      { t: 500, type: 'customerAbandon', customer: 0, shop: 'batu', cause: 'patience', repHit: false },
      { t: 500, type: 'customerLeave', customer: 0, outcome: 'gaveUp', emptyHanded: true },
    ]);
    expect(state.player.tally.walkouts).toBe(1);
    expect(state.rt[0]).toMatchObject({ status: 'done', outcome: 'gaveUp', visited: ['player', 'batu'], shop: null });
    expect(state.street).toMatchObject({ eligible: 1, emptyHanded: 1 });
  });

  it('leaves the street (gaveUp) when no unvisited shop scores above 0', () => {
    const s = street([shop('batu', 25), shop('giare', 30)], [cust(0, { budget: 22 })], { price: 20 });
    const { state, events } = runTo(s);
    expect(about(events, 0).slice(3)).toEqual([
      { t: 250, type: 'customerAbandon', customer: 0, shop: 'player', cause: 'patience', repHit: true },
      { t: 250, type: 'customerConsider', customer: 0, reshop: true, chosen: null, verdicts: [
        { shop: 'batu', score10: -30, reason: 'tooExpensive' },
        { shop: 'giare', score10: -110, reason: 'tooExpensive' },
        { shop: 'player', score10: null, reason: 'visited' },
      ] },
      { t: 250, type: 'customerLeave', customer: 0, outcome: 'gaveUp', emptyHanded: true },
    ]);
    expect(state.player.tally.walkouts).toBe(1);
  });

  it('an ad customer only re-shops among its own shop, so it leaves after walking out', () => {
    const s = street([shop('batu', 20)], [cust(0, { onlyShop: 'player', budget: 50 })], { price: 40 });
    const { state, events } = runTo(s);
    expect(ofType(events, 'customerConsider').map(e => [e.t, e.chosen, e.verdicts.length])).toEqual([
      [0, 'player', 1], [250, null, 1],
    ]);
    expect(state.rt[0].outcome).toBe('gaveUp');
  });
});

describe('end of the rush', () => {
  it('a customer arriving at 749 is still queued at 900 and goes home without a rep hit', () => {
    const s = street([], [cust(0, { arriveTick: 749 })], { price: 20 });
    const { state, events } = runTo(s);
    expect(about(events, 0)).toEqual([
      { t: 734, type: 'customerEnter', customer: 0, entry: 'left' },
      { t: 749, type: 'customerConsider', customer: 0, reshop: false, chosen: 'player', verdicts: [
        { shop: 'player', score10: 200, reason: 'chosen' },
      ] },
      { t: 749, type: 'customerJoin', customer: 0, shop: 'player', position: 0 },
      { t: 900, type: 'customerLeave', customer: 0, outcome: 'rushEnd', emptyHanded: true },
    ]);
    expect(events.at(-1)).toEqual({ t: 900, type: 'rushEnd', early: false });
    expect(state.player.tally.walkouts).toBe(0);
    expect(state.shops[0].queue).toEqual([]);
    expect(state.rt[0]).toMatchObject({ status: 'done', outcome: 'rushEnd' });
  });

  it('empties AI queues too, shop by shop in slot order', () => {
    // Both shops too slow to serve anyone before 900; neither reprices.
    const cfg = tuned({ giare: { ticksPerCup: 400 }, cochap: { ticksPerCup: 400 } });
    const s = street([shop('giare', 22), shop('cochap', 30)], [
      cust(0, { arriveTick: 700, budget: 30 }), // GiáRẻ 30 − 22 − 3 = 5k vs Cố Chấp 1k
      cust(1, { arriveTick: 701, trust: 40 }), // GiáRẻ's rep 35 is below its trust → Cố Chấp
      cust(2, { arriveTick: 702, budget: 30 }), // one ahead at each: GiáRẻ 3k vs Cố Chấp −1k
    ], { stock: NONE }, {}, cfg);
    const { state, events } = runTo(s, Infinity, cfg);
    expect(state.rt.map(r => r.visited)).toEqual([['giare'], ['cochap'], ['giare']]);
    const leaves = ofType(events, 'customerLeave').filter(e => e.t === 900);
    expect(leaves.map(e => [e.customer, e.outcome])).toEqual([[0, 'rushEnd'], [2, 'rushEnd'], [1, 'rushEnd']]);
    expect(ofType(events, 'customerAbandon')).toEqual([]);
  });
});

describe('mid-rush AI prices (§4, §16.6)', () => {
  // Bà Tư 27 gets four customers at 250; Lướt Sóng 45 has nobody; GiáRẻ and Ông Cố Chấp never move.
  // At 250, Bà Tư 27 gets 0 (40k), 1 (31k), 2 (33k) and 3 (40k). 2 and 3 do not trust GiáRẻ (rep 35);
  // 1 trusts it but prefers Bà Tư (31 − 27 − 2 = 2k vs 31 − 27 − 3 = 1k).
  const midRush = () => street(
    [shop('batu', 27), shop('giare', 27), shop('cochap', 45), shop('luotsong', 45)],
    [cust(0, { arriveTick: 250 }), cust(1, { arriveTick: 250, budget: 31 }),
      cust(2, { arriveTick: 250, budget: 33, trust: 40 }), cust(3, { arriveTick: 250, trust: 40 })],
    { stock: NONE });

  it('at 300 every shop posts its price first, then moved queues re-score front to back (R11, R13)', () => {
    const { state, events } = runTo(midRush());
    expect(state.rt.slice(0, 4).every(r => r.visited[0] === 'batu')).toBe(true);
    // New price 29, front to back, counting only those ahead who stay:
    // 0 → 40 − 29 = 11k stays; 1 → 31 − 29 − 2 = 0 leaves;
    // 2 → 33 − 29 − 2 (only 0 ahead now) = 2k stays (it would be 0 if 1 still counted);
    // 3 → 40 − 29 − 4 = 7k stays.
    // 1 re-shops against the new prices: Lướt Sóng already shows 43.
    expect(at(events, 300)).toEqual([
      { t: 300, type: 'shopPrice', shop: 'batu', from: 27, to: 29 },
      { t: 300, type: 'shopPrice', shop: 'luotsong', from: 45, to: 43 },
      { t: 300, type: 'customerAbandon', customer: 1, shop: 'batu', cause: 'priceUp', repHit: false },
      { t: 300, type: 'customerConsider', customer: 1, reshop: true, chosen: 'giare', verdicts: [
        { shop: 'batu', score10: null, reason: 'visited' },
        { shop: 'giare', score10: 10, reason: 'chosen' },
        { shop: 'cochap', score10: -130, reason: 'tooExpensive' },
        { shop: 'luotsong', score10: -120, reason: 'tooExpensive' },
        { shop: 'player', score10: null, reason: 'outOfStock', missing: 'tea' },
      ] },
      { t: 300, type: 'customerJoin', customer: 1, shop: 'giare', position: 0 },
    ]);
    expect(state.rt.map(r => r.outcome)).toEqual(['served', 'served', 'served', 'served']);
  });

  it('a customer pushed out of one queue at a checkpoint is not bounced again by the next shop in the same tick', () => {
    // At 250, ties (2k per person ahead offsets Lướt Sóng's 2k higher price) rotate by `tie`:
    // Bà Tư 27 gets 0, 2, 4, 5; Lướt Sóng 29 gets 1 and 3.
    const s = street([shop('batu', 27), shop('luotsong', 29)], [
      cust(0, { arriveTick: 250 }), cust(1, { arriveTick: 250, tie: 1 }), cust(2, { arriveTick: 250 }),
      cust(3, { arriveTick: 250, tie: 1 }), cust(4, { arriveTick: 250 }), cust(5, { arriveTick: 250, budget: 34 }),
    ], { stock: NONE });
    const { state, events } = runTo(s);
    expect(state.rt.map(r => r.visited[0])).toEqual(['batu', 'luotsong', 'batu', 'luotsong', 'batu', 'batu']);
    // Both decide on the street as it stood at 300: Bà Tư (4 waiting) +2k; Lướt Sóng (2 waiting, none sold) stays.
    // 5 leaves Bà Tư (34 − 29 − 6 < 0) and joins Lướt Sóng third (34 − 29 − 4 = 1k), which must not now
    // see 3 waiting and raise its price on them.
    expect(at(events, 300)).toEqual([
      { t: 300, type: 'shopPrice', shop: 'batu', from: 27, to: 29 },
      { t: 300, type: 'customerAbandon', customer: 5, shop: 'batu', cause: 'priceUp', repHit: false },
      { t: 300, type: 'customerConsider', customer: 5, reshop: true, chosen: 'luotsong', verdicts: [
        { shop: 'batu', score10: null, reason: 'visited' },
        { shop: 'luotsong', score10: 10, reason: 'chosen' },
        { shop: 'player', score10: null, reason: 'outOfStock', missing: 'tea' },
      ] },
      { t: 300, type: 'customerJoin', customer: 5, shop: 'luotsong', position: 2 },
    ]);
    expect(state.shops[1].trail).toEqual([[0, 29], [600, 27]]);
    expect(state.rt[5]).toMatchObject({ outcome: 'served', shop: 'luotsong', visited: ['batu', 'luotsong'] });
  });

  it('keeps a trail of prices, cuts again at 600, and books each cup at its price at sale', () => {
    const { state, events } = runTo(midRush());
    expect(ofType(events, 'shopPrice').map(e => [e.t, e.shop, e.to])).toEqual([
      [300, 'batu', 29], [300, 'luotsong', 43], [600, 'batu', 27], [600, 'luotsong', 41],
    ]);
    const [batu, giare, cochap, luotsong] = state.shops;
    expect(batu.trail).toEqual([[0, 27], [300, 29], [600, 27]]);
    expect(luotsong.trail).toEqual([[0, 45], [300, 43], [600, 41]]);
    expect(cochap.trail).toEqual([[0, 45]]);
    expect(giare.trail).toEqual([[0, 27]]);
    // Bà Tư serves 0, 2 and 3 at 29; GiáRẻ serves 1 at 27.
    expect(ofType(events, 'customerServed').map(e => [e.t, e.customer, e.paid]))
      .toEqual([[319, 0, 29], [369, 1, 27], [389, 2, 29], [459, 3, 29]]);
    expect(batu.revenue).toBe(87);
    expect(batu.openPrice).toBe(27);
  });

  it('frozen cartel shops never reprice', () => {
    const ai = day2Ai().map(s => ({ ...s, todayPrice: 36 }));
    const { events } = finishRush(createRush(input({ rules: rules(2, { cartel: true }), ai }, { price: 36 })).state);
    expect(ofType(events, 'shopPrice')).toEqual([]);
    const free = finishRush(createRush(input({ rules: rules(2), ai: day2Ai() })).state);
    expect(ofType(free.events, 'shopPrice').length).toBeGreaterThan(0);
  });
});

describe('eligible and empty-handed customers', () => {
  it('counts customers who could afford the cheapest shop at arrival, and those of them who left without a cup', () => {
    const s = street([shop('batu', 27)], [
      cust(0, { budget: 20, arriveTick: 10 }), // below every price: not eligible
      cust(1, { budget: 27, arriveTick: 10 }), // can afford 27 but scores 0: empty-handed
      cust(2, { budget: 60, arriveTick: 10, scared: true }), // scared: never counted
      cust(3, { budget: 40, arriveTick: 10 }), // buys
    ], { stock: NONE });
    const { state, events } = runTo(s);
    expect(state.rt.map(r => r.eligible)).toEqual([false, true, false, true]);
    expect(state.street).toMatchObject({ eligible: 2, emptyHanded: 1 });
    expect(ofType(events, 'customerLeave').map(e => [e.customer, e.outcome, e.emptyHanded])).toEqual([
      [0, 'noOffer', false], [1, 'noOffer', true], [2, 'scared', false], [3, 'served', false],
    ]);
  });

  it('a sold-out shop still sets the lowest price; resting shops do not', () => {
    const cfg = tuned({ batu: { capacity: 1 } });
    const s = street([shop('batu', 20), shop('cochap', null, { resting: true })], [
      cust(0), cust(1, { budget: 21, arriveTick: 100 }), cust(2, { budget: 19, arriveTick: 100 }),
    ], { stock: NONE, price: 35 }, {}, cfg);
    const { state } = runTo(s, Infinity, cfg);
    expect(state.shops[0].status).toBe('soldOut');
    expect(state.rt.map(r => [r.eligible, r.outcome])).toEqual([[true, 'served'], [true, 'noOffer'], [false, 'noOffer']]);
    expect(state.street).toMatchObject({ eligible: 2, emptyHanded: 1 });
  });
});

describe('summarizeRush (street part)', () => {
  it('reports every shop, AI revenue at price of sale, the player\'s takings and the street counts', () => {
    const ai = [shop('batu', 27), shop('cochap', null, { resting: true }), shop('tapdoan', null, { status: 'notYet' })];
    const s = street(ai, [cust(0), cust(1, { budget: 20 })], { price: 31, stock: stock(1000, 4) }, { rules: rules(4) });
    const { state } = runTo(s);
    const r = summarizeRush(state);
    expect(r.customers).toBe(2);
    expect(r.taxFund).toBe(5);
    expect([r.eligible, r.emptyHanded]).toEqual([1, 0]);
    expect(r.shops.map(x => x.id)).toEqual(['batu', 'cochap', 'player', 'tapdoan']);
    // One cup at 27 before Bà Tư cuts at 300 and 600 (empty queue, few sales).
    expect(r.shops[0]).toEqual({ id: 'batu', status: 'open', openPrice: 27, closePrice: 23,
      trail: [[0, 27], [300, 25], [600, 23]], sold: 1, capacity: 12, soldOut: false, profit: null, revenue: 27 });
    expect(r.shops[1]).toMatchObject({ status: 'resting', openPrice: null, closePrice: null, sold: 0, capacity: 0, revenue: 0 });
    expect(r.shops[3]).toMatchObject({ status: 'notYet', openPrice: null, closePrice: null });
    expect(r.shops[2]).toMatchObject({ status: 'open', openPrice: 31, closePrice: 31, revenue: 0, capacity: 0 });
    expect(r.player).toMatchObject({ closePrice: 31, walkouts: 0, revenue: 0, used: stock(0), left: stock(1000, 4),
      gouged: false, brokeCartel: false });
  });
});

describe('canServe (§6 "còn hàng cho một đơn")', () => {
  it('needs the tea of the order\'s size', () => {
    expect(canServe(stock(300, 1), { size: 'S', toppings: ['pearl'] })).toBe(true);
    expect(canServe(stock(300, 1), { size: 'M', toppings: ['pearl'] })).toBe(false);
    expect(canServe(stock(350, 1), { size: 'M', toppings: ['pearl'] })).toBe(true);
    expect(canServe(stock(499, 1), { size: 'L', toppings: ['pearl'] })).toBe(false);
  });

  it('needs one portion of every ordered topping', () => {
    const s: Stock = { teaMl: 1000, toppings: { pearl: 0, jelly: 1, pudding: 2 } };
    expect(canServe(s, { size: 'M', toppings: ['jelly', 'pudding'] })).toBe(true);
    expect(canServe(s, { size: 'M', toppings: ['pearl', 'jelly'] })).toBe(false);
  });
});

describe('whole rushes from a seed', () => {
  const DAYS: Day[] = [1, 2, 3, 4, 5];

  it.each(DAYS)('day %i: every customer ends with exactly one outcome and the books add up', day => {
    for (const seed of [1, 2, 3]) {
      const { state, events } = finishRush(createRush(input({ seed, rules: rules(day), ai: dayAi[day](), adCustomers: 6 })).state);
      expect(state.done).toBe(true);
      expect(state.tick).toBe(900);
      const leaves = ofType(events, 'customerLeave');
      expect(leaves.map(e => e.customer).sort((a, b) => a - b)).toEqual(state.customers.map(c => c.id));
      for (const e of leaves) expect(state.rt[e.customer].outcome).toBe(e.outcome);
      expect(state.rt.every(r => r.status === 'done' && r.outcome !== null)).toBe(true);
      expect(ofType(events, 'customerEnter')).toHaveLength(state.customers.length);
      for (const [i, r] of state.rt.entries()) {
        expect(r.visited.length).toBeLessThanOrEqual(2);
        expect(new Set(r.visited).size).toBe(r.visited.length);
        expect(ofType(about(events, i), 'customerJoin').map(e => e.shop)).toEqual(r.visited);
        expect(r.outcome === 'scared').toBe(state.customers[i].scared);
      }
      const served = ofType(events, 'customerServed');
      expect(served.length).toBe(state.shops.reduce((n, s) => n + s.sold, 0));
      expect(state.rt.filter(r => r.outcome === 'served').length).toBe(served.length);
      for (const s of state.shops) {
        expect(s.queue).toEqual([]);
        if (s.ai) expect(s.sold + s.ai.cupsLeft).toBe(s.ai.capacity);
        if (s.ai) expect(s.revenue).toBe(served.filter(e => e.shop === s.id).reduce((k, e) => k + e.paid, 0));
      }
      expect(state.street.emptyHanded).toBe(leaves.filter(e => e.emptyHanded).length);
      expect(state.street.emptyHanded).toBeLessThanOrEqual(state.street.eligible);
      expect(state.street.taxFund).toBe(served.length * rules(day).taxPerCup);
      const walkouts = ofType(events, 'customerAbandon').filter(e => e.repHit);
      expect(walkouts.every(e => e.shop === 'player' && e.cause === 'patience')).toBe(true);
      expect(state.player.tally.walkouts).toBe(walkouts.length);
    }
  });

  it('day 5 has scared customers, all of them routed straight through', () => {
    const { state } = finishRush(createRush(input({ seed: 2, rules: rules(5), ai: dayAi[5]() })).state);
    const scared = state.customers.filter(c => c.scared);
    expect(scared.length).toBeGreaterThan(0);
    for (const c of scared) expect(state.rt[c.id]).toMatchObject({ outcome: 'scared', visited: [], eligible: false });
  });

  it('the street keeps the same customers whether 4, 5 or 6 AI shops are open', () => {
    const six = day2Ai();
    const five = six.map(s => s.id === 'sinhvien' ? { ...s, status: 'closed' as const, todayPrice: null } : s);
    const four = five.map(s => s.id === 'batu' ? { ...s, status: 'closed' as const, todayPrice: null } : s);
    const runs = [six, five, four].map(ai => finishRush(createRush(input({ seed: 5, rules: rules(2), ai })).state).state);
    expect(runs.map(r => r.shops.filter(s => s.status !== 'closed' && s.ai).length)).toEqual([6, 5, 4]);
    for (const r of runs) {
      expect(r.customers).toEqual(generateCustomers(5, 2));
      expect(r.rt.filter(x => x.outcome !== null)).toHaveLength(130);
    }
  });

  it('is deterministic: the same seed gives the same state and the same events, stepped or finished at once', () => {
    const start = () => createRush(input({ seed: 7, rules: rules(2), ai: day2Ai(), adCustomers: 6 })).state;
    const a = finishRush(start());
    const b = finishRush(start());
    expect(b).toEqual(a);
    const stepped = runTo(start());
    expect(stepped.events).toEqual(a.events);
    expect(stepped.state).toEqual(a.state);
  });

  it('step and finishRush never change their input (deep-frozen)', () => {
    for (const day of [1, 4] as Day[]) {
      let s = deepFreeze(createRush(input({ seed: 3, rules: rules(day), ai: dayAi[day]() })).state);
      const finished = finishRush(s);
      expect(finished.state.done).toBe(true);
      while (!s.done) s = deepFreeze(step(s, []).state);
      expect(s).toEqual(finished.state);
    }
  });
});
