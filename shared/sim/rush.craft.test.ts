import { describe, expect, it } from 'vitest';
import {
  CLOSE, ICE, TEA, TRASH, about, at, cust, deepFreeze, deliver, make, ofType, order, playerShop, runTo, size, stock,
  street, top,
} from './rush.fixtures';
import { canDeliver, checkInput, craftInput, craftTick, type CraftResult } from './rush';
import type { CraftInput, CraftState, Cup, Size, Stock, ToppingId } from './types';

const SIZE = (s: Size): CraftInput => ({ k: 'size', size: s });
const ICE_IN: CraftInput = { k: 'ice' };
const TEA_IN: CraftInput = { k: 'tea' };
const TOP = (id: ToppingId): CraftInput => ({ k: 'topping', id });

const EMPTY: CraftState = { cup: null, anim: null, buffer: [] };
const cup = (sz: Size, iced: boolean, teaMl: number, ...toppings: ToppingId[]): Cup => ({ size: sz, iced, teaMl, toppings });
/** An idle counter holding this cup. */
const idle = (c: Cup | null): CraftState => ({ cup: c, anim: null, buffer: [] });

/** Presses inputs one after another at tick t, threading the result. */
const press = (r: CraftResult, inputs: CraftInput[], t: number, machine = false): CraftResult => {
  let out: CraftResult = { ...r, events: [...r.events] };
  for (const i of inputs) {
    const next = craftInput(out.craft, i, out.stock, t, machine);
    out = { ...next, events: [...out.events, ...next.events] };
  }
  return out;
};
/** Runs craftTick for every tick in [from, to], collecting events. */
const tickThrough = (r: CraftResult, from: number, to: number, machine = false): CraftResult => {
  let out: CraftResult = { ...r, events: [...r.events] };
  for (let t = from; t <= to; t++) {
    const next = craftTick(out.craft, out.stock, t, machine);
    out = { ...next, events: [...out.events, ...next.events] };
  }
  return out;
};
const start = (s: Stock | null): CraftResult => ({ craft: EMPTY, stock: s, events: [] });

describe('checkInput: the steps go size → ice → tea → toppings (§6 Pha một ly)', () => {
  const S = stock(10000, 5);

  it('an empty counter takes only a size', () => {
    expect(checkInput(EMPTY, SIZE('M'), S)).toBeNull();
    expect(checkInput(EMPTY, ICE_IN, S)).toBe('noCup');
    expect(checkInput(EMPTY, TEA_IN, S)).toBe('noCup');
    expect(checkInput(EMPTY, TOP('pearl'), S)).toBe('noCup');
  });

  it('after the size the ice, after the ice the tea, after the tea up to three different toppings', () => {
    const sized = idle(cup('M', false, 0));
    expect([SIZE('S'), ICE_IN, TEA_IN, TOP('pearl')].map(i => checkInput(sized, i, S))).toEqual(['order', null, 'order', 'order']);
    const iced = idle(cup('M', true, 0));
    expect([SIZE('S'), ICE_IN, TEA_IN, TOP('pearl')].map(i => checkInput(iced, i, S))).toEqual(['order', 'order', null, 'order']);
    const poured = idle(cup('M', true, 350));
    expect([SIZE('S'), ICE_IN, TEA_IN].map(i => checkInput(poured, i, S))).toEqual(['order', 'order', 'order']);
    expect(['pearl', 'jelly', 'pudding'].map(id => checkInput(poured, TOP(id as ToppingId), S))).toEqual([null, null, null]);
    const pearl = idle(cup('M', true, 350, 'pearl'));
    expect(checkInput(pearl, TOP('pearl'), S)).toBe('duplicate');
    expect(checkInput(pearl, TOP('jelly'), S)).toBeNull();
    const full = idle(cup('M', true, 350, 'jelly', 'pearl', 'pudding'));
    expect(['pearl', 'jelly', 'pudding'].map(id => checkInput(full, TOP(id as ToppingId), S))).toEqual(['duplicate', 'duplicate', 'duplicate']);
  });

  it('judges an input against the cup as it will be once the running step and the buffer are done', () => {
    const running = (c: Cup | null, step: CraftState['anim'], buffer: CraftInput[]): CraftState => ({ cup: c, anim: step, buffer });
    const sizing = running(cup('M', false, 0), { step: 'size', endsAt: 4 }, [ICE_IN]);
    expect([ICE_IN, TEA_IN, TOP('pearl')].map(i => checkInput(sizing, i, S))).toEqual(['order', null, 'order']);
    const two = running(cup('M', false, 0), { step: 'size', endsAt: 4 }, [ICE_IN, TEA_IN]);
    expect(checkInput(two, TOP('pearl'), S)).toBeNull();
    // A topping already pouring or queued counts as in the cup.
    const pearling = running(cup('L', true, 500, 'pearl'), { step: 'topping', endsAt: 40 }, [TOP('jelly')]);
    expect(['pearl', 'jelly', 'pudding'].map(id => checkInput(pearling, TOP(id as ToppingId), S))).toEqual(['duplicate', 'duplicate', null]);
    // During the hand-over the counter is empty: the buffer starts the next cup.
    const handing = running(null, { step: 'deliver', endsAt: 60 }, []);
    expect([SIZE('L'), ICE_IN].map(i => checkInput(handing, i, S))).toEqual([null, 'noCup']);
    const next = running(null, { step: 'deliver', endsAt: 60 }, [SIZE('L'), ICE_IN]);
    expect([SIZE('S'), ICE_IN, TEA_IN].map(i => checkInput(next, i, S))).toEqual(['order', 'order', null]);
  });

  it('holds at most 3 inputs behind a running step: the 4th is rejected, whatever it is', () => {
    const full: CraftState = { cup: cup('M', false, 0), anim: { step: 'size', endsAt: 4 }, buffer: [ICE_IN, TEA_IN, TOP('pearl')] };
    expect([TOP('jelly'), SIZE('S'), ICE_IN].map(i => checkInput(full, i, S))).toEqual(['bufferFull', 'bufferFull', 'bufferFull']);
    const three: CraftState = { ...full, buffer: [ICE_IN, TEA_IN] };
    expect(checkInput(three, TOP('jelly'), S)).toBeNull();
  });

  it('needs the tea of the cup\'s size and a portion of the topping in stock: 300 ml pours an S but not an M', () => {
    expect(checkInput(idle(cup('S', true, 0)), TEA_IN, stock(300))).toBeNull();
    expect(checkInput(idle(cup('M', true, 0)), TEA_IN, stock(300))).toBe('noTea');
    expect(checkInput(idle(cup('M', true, 0)), TEA_IN, stock(350))).toBeNull();
    expect(checkInput(idle(cup('L', true, 0)), TEA_IN, stock(499))).toBe('noTea');
    const s: Stock = { teaMl: 0, toppings: { pearl: 0, jelly: 1, pudding: 0 } };
    expect(checkInput(idle(cup('M', true, 350)), TOP('pearl'), s)).toBe('noTopping');
    expect(checkInput(idle(cup('M', true, 350)), TOP('jelly'), s)).toBeNull();
    // The size of a queued cup counts; the size step itself takes no stock.
    const next: CraftState = { cup: null, anim: { step: 'deliver', endsAt: 60 }, buffer: [SIZE('L'), ICE_IN] };
    expect(checkInput(next, TEA_IN, stock(400))).toBe('noTea');
    expect(checkInput(EMPTY, SIZE('L'), stock(0))).toBeNull();
  });

  it('checks the step order before the stock', () => {
    expect(checkInput(EMPTY, TEA_IN, stock(0))).toBe('noCup');
    expect(checkInput(idle(cup('M', false, 0)), TEA_IN, stock(0))).toBe('order');
    expect(checkInput(idle(cup('M', true, 350, 'pearl')), TOP('pearl'), stock(0))).toBe('duplicate');
  });

  it('never fails for stock on the practice cup (stock null)', () => {
    expect(checkInput(idle(cup('L', true, 0)), TEA_IN, null)).toBeNull();
    expect(checkInput(idle(cup('L', true, 500)), TOP('pudding'), null)).toBeNull();
    expect(checkInput(EMPTY, TEA_IN, null)).toBe('noCup');
  });
});

describe('craftInput and craftTick (R14)', () => {
  it('an idle counter starts the step at once; a busy one queues it', () => {
    const a = craftInput(EMPTY, SIZE('M'), stock(1000, 2), 10, false);
    expect(a.craft).toEqual({ cup: cup('M', false, 0), anim: { step: 'size', endsAt: 14 }, buffer: [] });
    expect(a.events).toEqual([{ t: 10, type: 'craftStep', step: 'size', endsAt: 14 }]);
    expect(a.stock).toEqual(stock(1000, 2));
    const b = craftInput(a.craft, ICE_IN, a.stock, 11, false);
    expect(b.craft).toEqual({ cup: cup('M', false, 0), anim: { step: 'size', endsAt: 14 }, buffer: [ICE_IN] });
    expect(b.events).toEqual([]);
  });

  it('queues a copy of the input, never the caller\'s object', () => {
    const a = craftInput(EMPTY, SIZE('M'), stock(1000), 0, false);
    const ice: CraftInput = { k: 'ice' };
    const b = craftInput(a.craft, ice, a.stock, 1, false);
    expect(b.craft.buffer).toEqual([ice]);
    expect(b.craft.buffer[0]).not.toBe(ice);
    const action = top('pearl');
    const s = street([], [cust(0)], { price: 30 });
    const { states } = runTo(s, 3, { 1: [size('M'), ICE, TEA], 2: [action] });
    const queued = states[2].player.craft.buffer;
    expect(queued.at(-1)).toEqual({ k: 'topping', id: 'pearl' });
    expect(queued.some(i => i === (action.type === 'craft' ? action.input : null))).toBe(false);
  });

  it('a rejected input changes nothing and says why', () => {
    const r = craftInput(EMPTY, TEA_IN, stock(1000), 7, false);
    expect(r.craft).toEqual(EMPTY);
    expect(r.events).toEqual([{ t: 7, type: 'inputRejected', action: 'craft', why: 'noCup' }]);
  });

  it.each([
    ['S', false, 12], ['M', false, 16], ['L', false, 20], ['S', true, 6], ['M', true, 8], ['L', true, 10],
  ] as [Size, boolean, number][])('a %s cup (machine %s) pours in %i ticks; size 4, ice 8, each topping 6', (sz, machine, pour) => {
    let r = press(start(stock(1000, 2)), [SIZE(sz), ICE_IN, TEA_IN, TOP('pearl')], 0, machine);
    expect(r.events.map(e => e.type)).toEqual(['craftStep']);
    r = press(tickThrough(r, 1, 5, machine), [TOP('jelly')], 5, machine);
    r = tickThrough(r, 6, 80, machine);
    expect(ofType(r.events, 'craftStep').map(e => [e.t, e.step, e.endsAt])).toEqual([
      [0, 'size', 4], [4, 'ice', 12], [12, 'tea', 12 + pour], [12 + pour, 'topping', 18 + pour],
      [18 + pour, 'topping', 24 + pour],
    ]);
    expect(r.craft).toEqual({ cup: cup(sz, true, { S: 250, M: 350, L: 500 }[sz], 'pearl', 'jelly'), anim: null, buffer: [] });
  });

  it('takes the stock when a step starts: the ml of the size, one portion per topping', () => {
    for (const [sz, ml] of [['S', 250], ['M', 350], ['L', 500]] as [Size, number][]) {
      let r = press(start(stock(1000, 2)), [SIZE(sz), ICE_IN, TEA_IN, TOP('pudding')], 0);
      r = tickThrough(r, 1, 11);
      expect(r.stock).toEqual(stock(1000, 2));
      r = tickThrough(r, 12, 12);
      expect(r.stock?.teaMl).toBe(1000 - ml);
      const pours = { S: 12, M: 16, L: 20 }[sz];
      r = tickThrough(r, 13, 11 + pours);
      expect(r.stock?.toppings.pudding).toBe(2);
      r = tickThrough(r, 12 + pours, 12 + pours);
      expect(r.stock).toEqual({ teaMl: 1000 - ml, toppings: { pearl: 2, jelly: 2, pudding: 1 } });
    }
  });

  it('drops a queued step the stock can no longer cover when it comes up, with the rest of the buffer', () => {
    let r = press(start(stock(700, 1)), [SIZE('M'), ICE_IN, TEA_IN, TOP('pearl')], 0);
    // Someone else (the staff) used the tea meanwhile.
    r = { ...r, stock: stock(300, 1) };
    r = tickThrough(r, 1, 20);
    expect(r.events.slice(1)).toEqual([
      { t: 4, type: 'craftStep', step: 'ice', endsAt: 12 },
      { t: 12, type: 'inputRejected', action: 'craft', why: 'noTea' },
    ]);
    expect(r.craft).toEqual({ cup: cup('M', true, 0), anim: null, buffer: [] });
    expect(r.stock).toEqual(stock(300, 1));

    let q = press(start(stock(700, 1)), [SIZE('S'), ICE_IN, TEA_IN], 0);
    q = press(tickThrough(q, 1, 5), [TOP('pearl'), TOP('jelly')], 5);
    q = { ...q, stock: { ...stock(450), toppings: { pearl: 0, jelly: 1, pudding: 1 } } };
    q = tickThrough(q, 6, 40);
    expect(q.events.slice(-2)).toEqual([
      { t: 12, type: 'craftStep', step: 'tea', endsAt: 24 },
      { t: 24, type: 'inputRejected', action: 'craft', why: 'noTopping' },
    ]);
    expect(q.craft).toEqual({ cup: cup('S', true, 250), anim: null, buffer: [] });
  });

  it('makes the day-1 practice cup without stock', () => {
    let r = press(start(null), [SIZE('L'), ICE_IN, TEA_IN, TOP('pearl')], 0);
    r = tickThrough(r, 1, 50);
    expect(r.stock).toBeNull();
    expect(r.craft).toEqual({ cup: cup('L', true, 500, 'pearl'), anim: null, buffer: [] });
    expect(canDeliver(r.craft)).toBe(true);
  });

  it('craftTick does nothing until the running step ends', () => {
    const a = craftInput(EMPTY, SIZE('M'), stock(1000), 0, false);
    const b = craftTick(a.craft, a.stock, 3, false);
    expect(b).toEqual({ craft: a.craft, stock: a.stock, events: [] });
    const c = craftTick(a.craft, a.stock, 4, false);
    expect(c.craft.anim).toBeNull();
    expect(c.events).toEqual([]);
  });

  it('leaves its inputs alone', () => {
    const craft = deepFreeze<CraftState>({ cup: cup('M', false, 0), anim: { step: 'size', endsAt: 4 }, buffer: [ICE_IN, TEA_IN] });
    const s = deepFreeze(stock(1000, 1));
    expect(() => craftInput(craft, TOP('pearl'), s, 1, false)).not.toThrow();
    let r: CraftResult = { craft, stock: s, events: [] };
    for (let t = 4; t <= 30; t++) r = craftTick(deepFreeze(r.craft), deepFreeze(r.stock), t, false);
    expect(r.stock?.teaMl).toBe(650);
    const idleCup = deepFreeze(idle(cup('M', true, 350)));
    expect(() => craftInput(idleCup, TOP('pearl'), s, 1, false)).not.toThrow();
  });
});

describe('canDeliver: a cup with tea and no animation running (§6)', () => {
  it('is false with no cup, without tea, while a step runs or during the hand-over', () => {
    expect(canDeliver(EMPTY)).toBe(false);
    expect(canDeliver(idle(cup('M', true, 0)))).toBe(false);
    expect(canDeliver({ cup: cup('M', true, 350), anim: { step: 'topping', endsAt: 30 }, buffer: [] })).toBe(false);
    expect(canDeliver({ cup: null, anim: { step: 'deliver', endsAt: 30 }, buffer: [] })).toBe(false);
  });

  it('is true for an idle cup with tea, toppings or not', () => {
    expect(canDeliver(idle(cup('S', true, 250)))).toBe(true);
    expect(canDeliver(idle(cup('L', true, 500, 'jelly')))).toBe(true);
  });
});

describe('crafting during the rush', () => {
  const oneCustomer = (o = order('M', 'pearl', 'jelly'), player = {}) =>
    street([], [cust(0, { order: o, budget: 60 })], { price: 30, ...player });

  it('one M cup with two toppings, pressed ahead: steps chain on, stock goes at each start, then the hand-over', () => {
    const { events, states } = runTo(oneCustomer(), 70, {
      10: make(order('M', 'pearl', 'jelly')), // size runs; ice, tea, pearl queue; jelly finds the buffer full
      11: [top('jelly')], // still full
      15: [top('jelly')], // the ice has started: room again
      50: [deliver(0)], // the jelly step ends in this tick's production: still busy
      51: [deliver(0)],
      52: [size('S')], // queued behind the hand-over
    });
    expect(ofType(events, 'craftStep').map(e => [e.t, e.step, e.endsAt])).toEqual([
      [10, 'size', 14], [14, 'ice', 22], [22, 'tea', 38], [38, 'topping', 44], [44, 'topping', 50],
      [51, 'deliver', 55], [55, 'size', 59],
    ]);
    expect(ofType(events, 'inputRejected').map(e => [e.t, e.action, e.why])).toEqual([
      [10, 'craft', 'bufferFull'], [11, 'craft', 'bufferFull'], [50, 'deliver', 'busy'],
    ]);
    expect([states[21].player.stock.teaMl, states[22].player.stock.teaMl]).toEqual([10000, 9650]);
    expect([states[37].player.stock.toppings.pearl, states[38].player.stock.toppings.pearl]).toEqual([50, 49]);
    expect([states[43].player.stock.toppings.jelly, states[44].player.stock.toppings.jelly]).toEqual([50, 49]);
    expect(canDeliver(states[49].player.craft)).toBe(false);
    expect(canDeliver(states[50].player.craft)).toBe(true);
    expect(states[50].player.craft.cup).toEqual(cup('M', true, 350, 'pearl', 'jelly'));
    expect(at(events, 51)).toEqual([
      { t: 51, type: 'customerServed', customer: 0, shop: 'player', by: 'player', correct: true, paid: 40, full: 40 },
      { t: 51, type: 'customerLeave', customer: 0, outcome: 'served', emptyHanded: false },
      { t: 51, type: 'craftStep', step: 'deliver', endsAt: 55 },
    ]);
    expect(states[51].player.craft).toEqual({ cup: null, anim: { step: 'deliver', endsAt: 55 }, buffer: [] });
    expect(states[52].player.craft.buffer).toEqual([{ k: 'size', size: 'S' }]);
  });

  it('the tea machine halves the pour', () => {
    const { events } = runTo(oneCustomer(order('L', 'pearl'), { machine: true }), 60, { 10: make(order('L', 'pearl')) });
    expect(ofType(events, 'craftStep').map(e => [e.t, e.step, e.endsAt])).toEqual([
      [10, 'size', 14], [14, 'ice', 22], [22, 'tea', 32], [32, 'topping', 38],
    ]);
  });

  it('300 ml left: an M cannot be poured, an S can', () => {
    const { events, states } = runTo(oneCustomer(order('S', 'pearl'), { stock: stock(300, 5) }), 60, {
      10: [size('M'), ICE, TEA], // the tea is checked against the stock when pressed
      30: [TRASH, size('S'), ICE, TEA],
    });
    expect(ofType(events, 'inputRejected').map(e => [e.t, e.why])).toEqual([[10, 'noTea']]);
    expect(ofType(events, 'craftStep').filter(e => e.step === 'tea').map(e => [e.t, e.endsAt])).toEqual([[42, 54]]);
    expect(states[42].player.stock.teaMl).toBe(50);
  });

  it('trash throws the cup away with whatever it already used; with no cup there is nothing to throw', () => {
    const { events, states } = runTo(oneCustomer(), 40, {
      5: [TRASH],
      10: make(order('M', 'pearl')),
      30: [TRASH], // while the tea pours; the queued pearl goes too
      31: [TRASH],
    });
    expect(at(events, 30)).toEqual([{ t: 30, type: 'cupTrashed' }]);
    expect(ofType(events, 'inputRejected').map(e => [e.t, e.action, e.why])).toEqual([[5, 'trash', 'noCup'], [31, 'trash', 'noCup']]);
    const p = states[30].player;
    expect(p.craft).toEqual({ cup: null, anim: null, buffer: [] });
    expect(p.stock.teaMl).toBe(9650);
    expect(p.stock.toppings.pearl).toBe(50);
    expect(p.tally.trashed).toBe(1);
    expect(ofType(events, 'craftStep').filter(e => e.t > 30)).toEqual([]);
  });

  it('a cup still in the making at 900 is dropped; what it used stays used', () => {
    const s = street([], [cust(0, { arriveTick: 700, budget: 60 })], { price: 30, stock: stock(1000, 5) });
    const { state, events } = runTo(s, Infinity, {
      880: make(order('M', 'pearl')), // the tea starts at 892 and would end at 908
    });
    expect(state.player.craft).toEqual({ cup: null, anim: null, buffer: [] });
    expect(state.player.stock.teaMl).toBe(650);
    expect(state.player.tally.trashed).toBe(0);
    expect(events.at(-1)).toEqual({ t: 900, type: 'rushEnd', early: false });
    expect(about(events, 0).at(-1)).toEqual({ t: 900, type: 'customerLeave', customer: 0, outcome: 'rushEnd', emptyHanded: true });
  });

  it('after closing early every action is refused', () => {
    const { events } = runTo(oneCustomer(), 12, { 10: [CLOSE], 11: [size('M'), deliver(0), TRASH, CLOSE] });
    expect(ofType(events, 'inputRejected').map(e => [e.t, e.action, e.why])).toEqual([
      [11, 'craft', 'closed'], [11, 'deliver', 'closed'], [11, 'trash', 'closed'], [11, 'closeEarly', 'closed'],
    ]);
  });

  it('hangs the sold-out sign once the tea drops under 250 ml', () => {
    const s = street([], [cust(0, { order: order('M', 'pearl'), budget: 60 })], { price: 30, stock: stock(599, 5) });
    const { events, states } = runTo(s, 40, { 10: make(order('M', 'pearl')) });
    expect(playerShop(states[21]).status).toBe('open');
    expect(ofType(events, 'shopStatus')).toEqual([{ t: 22, type: 'shopStatus', shop: 'player', status: 'soldOut' }]);
    expect(playerShop(states[22]).status).toBe('soldOut');
    // The customer the cup is for keeps their place.
    expect(playerShop(states[39]).queue).toEqual([0]);
  });
});
