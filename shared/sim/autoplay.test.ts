// The bots (Task 11, ruling R37): the rush policy one tick at a time, whole rushes with and without frames, whole runs
// for every play style of spec §14, and the 48 story-card combinations.
import { describe, expect, it } from 'vitest';
import {
  STRATEGIES, botStep, playRun, playRush, storyCombos, type BotState, type RushPolicy, type Strategy,
} from './autoplay';
import { CONFIG } from './config';
import { customerCount } from './customers';
import { dayRules, morningBrief, openDay, quickFill, validatePlan } from './day';
import { hashSeed } from './rng';
import { advance, canServe, cloneRush, step } from './rush';
import { cust, deepFreeze, order, playerShop, runTo, stock, street } from './rush.fixtures';
import { chooseCard, endRush, newRun, nextDay } from './run';
import type {
  Action, CardId, Customer, DayReport, MorningPlan, RunState, RushState, ShopDayResult, SimEvent,
} from './types';

const POLICY: RushPolicy = {
  delayTicks: 3, mistakeRate: 0, serve: 'urgent', cup: 'asOrdered', reprice: null, closeWhenEmpty: false,
};
const FRESH: BotState = { cooldown: 0, rng: 1 };

/** The rush of day 1 for this seed, the shop stocked to today's capacity, at 30k. */
function day1(seed: number, over: Partial<MorningPlan> = {}): RushState {
  const run = newRun(seed, `test-${seed}`);
  const draft: MorningPlan = { ...run.plan, price: 30, ...over };
  return openDay(run, { ...draft, ...quickFill(run, 'high', draft) }).rush;
}

/**
 * Steps the rush with the public `step`, the bot choosing each tick: every action with its tick, and the events
 * grouped by their own tick (the closing events of the last step carry t = 900).
 */
function drive(rush: RushState, policy: RushPolicy, seed: number) {
  let s = rush;
  let bot: BotState = { cooldown: 0, rng: seed };
  const actions: { t: number; a: Action }[] = [];
  const frames: { t: number; events: SimEvent[] }[] = [];
  while (!s.done) {
    const r = botStep(deepFreeze(s), bot, policy);
    bot = r.bot;
    for (const a of r.actions) actions.push({ t: s.tick, a });
    const next = step(s, r.actions);
    for (const e of next.events) {
      const last = frames[frames.length - 1];
      if (last !== undefined && last.t === e.t) last.events.push(e);
      else frames.push({ t: e.t, events: [e] });
    }
    s = next.state;
  }
  return { state: s, actions, frames };
}

describe('botStep: one tick of the bot (R37)', () => {
  it('waits while cooling down and counts the cooldown down', () => {
    const s = day1(1);
    const r = botStep(s, { cooldown: 2, rng: 5 }, POLICY);
    expect(r).toEqual({ actions: [], bot: { cooldown: 1, rng: 5 } });
  });

  for (const delayTicks of [1, 3, 6]) {
    it(`leaves at least ${delayTicks} tick(s) between inputs, and exactly that while busy`, () => {
      const { actions } = drive(day1(2), { ...POLICY, delayTicks }, 7);
      expect(actions.length).toBeGreaterThan(20);
      const ticks = actions.map(x => x.t);
      expect(new Set(ticks).size).toBe(ticks.length);   // at most one input a tick
      const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
      expect(Math.min(...gaps)).toBe(delayTicks);
    });
  }

  it('is pure: the state is left alone and the same inputs give the same output', () => {
    const s = deepFreeze(day1(3));
    let st = s;
    for (let i = 0; i < 40; i++) st = step(st, botStep(st, FRESH, POLICY).actions).state;
    deepFreeze(st);
    expect(botStep(st, FRESH, POLICY)).toEqual(botStep(st, FRESH, POLICY));
  });

  /** One customer at the counter with this order and the cup on an idle counter; the stock as given. */
  function counter(o: Customer['order'], cup: { size: 'S' | 'M' | 'L'; teaMl: number; toppings: ('pearl' | 'jelly' | 'pudding')[] },
    each: number): RushState {
    const s0 = street([], [cust(0, { order: o })], { stock: stock(5000, 3) });
    const s = structuredClone(runTo(s0, 1).state);
    expect(playerShop(s).queue).toEqual([0]);
    s.player.craft = { cup: { size: cup.size, iced: true, teaMl: cup.teaMl, toppings: cup.toppings }, anim: null, buffer: [] };
    s.player.stock.toppings = { pearl: each, jelly: each, pudding: each };
    return s;
  }

  it('builds the order of its customer: the next topping, then the delivery', () => {
    expect(botStep(counter(order('M', 'pearl', 'jelly'), { size: 'M', teaMl: 350, toppings: ['pearl'] }, 1), FRESH, POLICY)
      .actions).toEqual([{ type: 'craft', input: { k: 'topping', id: 'jelly' } }]);
    expect(botStep(counter(order('M', 'pearl'), { size: 'M', teaMl: 350, toppings: ['pearl'] }, 1), FRESH, POLICY)
      .actions).toEqual([{ type: 'deliver', customer: 0 }]);
  });

  it('trashes the cup when the stock can no longer complete it', () => {
    const s = counter(order('M', 'pearl'), { size: 'M', teaMl: 350, toppings: [] }, 0);
    const r = botStep(s, FRESH, POLICY);
    expect(r.actions).toEqual([{ type: 'trash' }]);
    expect(r.bot.cooldown).toBe(POLICY.delayTicks - 1);
    expect(r.bot.rng).not.toBe(FRESH.rng);   // the next cup draws afresh
  });

  it('trashes the cup when it matches no one at the counter any more', () => {
    const s = counter(order('L', 'pearl'), { size: 'M', teaMl: 350, toppings: [] }, 3);
    expect(botStep(s, FRESH, POLICY).actions).toEqual([{ type: 'trash' }]);
  });

  it('trashes a cup the stock cannot pour any more (tea gone)', () => {
    const s = counter(order('M', 'pearl'), { size: 'M', teaMl: 0, toppings: [] }, 3);
    s.player.stock.teaMl = 100;
    expect(botStep(s, FRESH, POLICY).actions).toEqual([{ type: 'trash' }]);
  });

  it('closes early once the stock cannot make any order, with closeWhenEmpty', () => {
    const s = counter(order('M', 'pearl'), { size: 'M', teaMl: 0, toppings: [] }, 3);
    s.player.craft = { cup: null, anim: null, buffer: [] };
    s.player.stock.teaMl = 200;
    expect(botStep(s, FRESH, { ...POLICY, closeWhenEmpty: true }).actions).toEqual([{ type: 'closeEarly' }]);
    expect(botStep(s, FRESH, POLICY).actions).toEqual([]);
  });

  it('serves the least patient servable customer first with urgent, the head with fifo', () => {
    const s0 = street([], [
      cust(0, { order: order('M', 'pearl'), arriveTick: 0 }),
      cust(1, { order: order('L', 'jelly'), arriveTick: 0 }),
    ], { stock: stock(5000, 3) });
    // Both join at tick 0; the head (0) has least patience too. Make 1 the more urgent by an earlier join.
    const s = structuredClone(runTo(s0, 1).state);
    s.rt[1].joinedTick = -50;
    expect(botStep(s, FRESH, POLICY).actions).toEqual([{ type: 'craft', input: { k: 'size', size: 'L' } }]);
    expect(botStep(s, FRESH, { ...POLICY, serve: 'fifo' }).actions)
      .toEqual([{ type: 'craft', input: { k: 'size', size: 'M' } }]);
    // A customer whose order the stock cannot make is passed over.
    s.player.stock.toppings.jelly = 0;
    expect(botStep(s, FRESH, POLICY).actions).toEqual([{ type: 'craft', input: { k: 'size', size: 'M' } }]);
  });

  it('reprices once at its tick, to the price `to` gives, clamped to the day', () => {
    const policy: RushPolicy = { ...POLICY, reprice: { atTick: 5, to: () => 99 } };
    const { actions, state } = drive(day1(4), policy, 3);
    const set = actions.filter(x => x.a.type === 'setPrice');
    expect(set.map(x => x.a)).toEqual([{ type: 'setPrice', price: 50 }]);
    expect(set[0].t).toBeGreaterThanOrEqual(5);   // its tick, or the bot's first free tick after it
    expect(set[0].t).toBeLessThan(5 + POLICY.delayTicks);
    expect(playerShop(state).price).toBe(50);
    const same = drive(day1(4), { ...POLICY, reprice: { atTick: 5, to: s => playerShop(s).price } }, 3);
    expect(same.actions.some(x => x.a.type === 'setPrice')).toBe(false);
  });
});

describe('mistakes (R37)', () => {
  /** Cups the player made and how many were wrong, over day 1 of these seeds. */
  function tally(mistakeRate: number, seeds: number[]) {
    let cups = 0;
    let wrong = 0;
    for (const seed of seeds) {
      const { rush } = playRush(day1(seed), { ...POLICY, mistakeRate }, hashSeed(seed, 'bot/test/1'));
      cups += rush.player.tally.cups - rush.player.tally.staffCups;
      wrong += rush.player.tally.wrong;
    }
    return { cups, wrong };
  }
  const seeds = Array.from({ length: 24 }, (_, i) => i + 1);

  it('makes no wrong cup at rate 0', () => {
    const t = tally(0, seeds);
    expect(t.cups).toBeGreaterThan(300);
    expect(t.wrong).toBe(0);
  });

  it('makes about the configured share of wrong cups', () => {
    const t = tally(0.25, seeds);
    expect(t.cups).toBeGreaterThan(300);
    expect(t.wrong / t.cups).toBeGreaterThan(0.17);
    expect(t.wrong / t.cups).toBeLessThan(0.33);
  });

  it('draws a mistake only among wrong cups the stock can make, so a cup always starts (R42a)', () => {
    // A pearl-only order with no jelly or pudding left: no extra topping is possible, every cup is drawn wrong.
    const s0 = street([], [cust(0, { order: order('M', 'pearl') })], { stock: stock(5000, 3) });
    const s = structuredClone(runTo(s0, 1).state);
    s.player.stock.toppings = { pearl: 3, jelly: 0, pudding: 0 };
    const sizes = new Set<string>();
    for (let rng = 1; rng <= 200; rng++) {
      const [a] = botStep(s, { cooldown: 0, rng }, { ...POLICY, mistakeRate: 1 }).actions;
      expect(a?.type).toBe('craft');
      if (a.type === 'craft' && a.input.k === 'size') sizes.add(a.input.size);
    }
    expect([...sizes].sort()).toEqual(['L', 'M', 'S']);   // the wrong sizes, and M for the missing pearl
    // 400 ml of tea: an L cannot be poured, so it is never drawn.
    s.player.stock.teaMl = 400;
    for (let rng = 1; rng <= 200; rng++) {
      expect(botStep(s, { cooldown: 0, rng }, { ...POLICY, mistakeRate: 1 }).actions)
        .not.toEqual([{ type: 'craft', input: { k: 'size', size: 'L' } }]);
    }
  });
});

describe('plainS (R37)', () => {
  it('hands every customer an S cup with no topping', () => {
    const { actions, state } = drive(day1(5), { ...POLICY, cup: 'plainS' }, 1);
    const inputs = actions.flatMap(x => (x.a.type === 'craft' ? [x.a.input] : []));
    expect(inputs.some(i => i.k === 'topping')).toBe(false);
    expect(inputs.filter(i => i.k === 'size').every(i => i.k === 'size' && i.size === 'S')).toBe(true);
    const t = state.player.tally;
    expect(t.cups).toBeGreaterThan(10);
    expect(t.wrong).toBe(t.cups - t.staffCups);   // every order has a topping
  });
});

describe('playRush', () => {
  for (const seed of [1, 2]) {
    it(`records frames that replay the events of a stepped rush (seed ${seed})`, () => {
      const rush = day1(seed);
      const botSeed = hashSeed(seed, 'bot/1');
      const policy = STRATEGIES.reasonable.rush;
      const recorded = playRush(deepFreeze(rush), policy, botSeed, CONFIG, true);
      const plain = playRush(rush, policy, botSeed);
      const stepped = drive(rush, policy, botSeed);
      expect(plain.frames).toEqual([]);
      expect(recorded.rush).toStrictEqual(plain.rush);
      expect(recorded.rush).toStrictEqual(stepped.state);
      expect(recorded.frames).toStrictEqual(stepped.frames);
      expect(recorded.frames.every(f => f.events.length > 0 && f.events.every(e => e.t === f.t))).toBe(true);
      expect(recorded.rush.done).toBe(true);
    });
  }
});

/** playRun's loop written out, keeping each day's customers. */
function customersByDay(seed: number, s: Strategy): Customer[][] {
  let run: RunState = newRun(seed, `bot-${seed}`);
  const out: Customer[][] = [];
  while (run.phase !== 'end') {
    const opened = openDay(run, s.plan(run, morningBrief(run), CONFIG));
    out.push(opened.rush.customers.slice(0, customerCount(run.day)));
    const { rush } = playRush(opened.rush, s.rush, hashSeed(seed, `bot/${run.day}`));
    run = endRush(opened.run, rush);
    while (run.phase === 'cards') run = chooseCard(run, s.card(run.cards[run.cardIndex], run));
    run = nextDay(run);
  }
  expect(run).toStrictEqual(playRun(seed, s).run);
  return out;
}

/**
 * playRun's loop with the rush stepped by hand: the longest run of ticks in which the bot, free to act at an empty and
 * idle counter, took no input although one of the first four could be served from the stock.
 */
function longestStall(seed: number, s: Strategy): { stall: number; run: RunState } {
  let run: RunState = newRun(seed, `bot-${seed}`);
  let longest = 0;
  while (run.phase !== 'end') {
    const opened = openDay(run, s.plan(run, morningBrief(run), CONFIG));
    const d = cloneRush(opened.rush);
    let bot: BotState = { cooldown: 0, rng: hashSeed(seed, `bot/${run.day}`) };
    let stall = 0;
    while (!d.done) {
      const r = botStep(d, bot, s.rush);
      const ps = playerShop(d);
      const c = d.player.craft;
      const servable = ps.queue.slice(0, CONFIG.rush.counterSlots)
        .some(id => canServe(d.player.stock, d.customers[id].order));
      const idle = ps.status !== 'closedEarly' && servable && c.cup === null && c.anim === null
        && bot.cooldown === 0 && r.actions.length === 0;
      stall = idle ? stall + 1 : 0;
      longest = Math.max(longest, stall);
      bot = r.bot;
      advance(d, r.actions, CONFIG, []);
    }
    run = endRush(opened.run, d);
    while (run.phase === 'cards') run = chooseCard(run, s.card(run.cards[run.cardIndex], run));
    run = nextDay(run);
  }
  return { stall: longest, run };
}

const SEEDS = [11, 12, 13];
const NAMES = ['reasonable', 'flat15', 'flat45', 'skimp', 'premium', 'double', 'half', 'plainS', 'day5cheat',
  'delay1', 'delay6'];

describe('playRun with every play style (spec §14)', () => {
  it('has the styles of spec §14, each under its own id', () => {
    expect(Object.keys(STRATEGIES).sort()).toEqual([...NAMES].sort());
    for (const [id, s] of Object.entries(STRATEGIES)) expect(s.id).toBe(id);
  });

  for (const name of NAMES) {
    it(`plays ${name} to the end on 3 seeds, the same way twice`, () => {
      for (const seed of SEEDS) {
        const a = playRun(seed, STRATEGIES[name]);
        expect(a.run.phase).toBe('end');
        expect(a.reports).toBe(a.run.reports);
        expect(a.total).toBe(a.run.cash - CONFIG.run.startCash + a.run.rep * CONFIG.run.brandPerRep);
        expect(playRun(seed, STRATEGIES[name])).toStrictEqual(a);
      }
    });
  }

  it('meets the same street customers whatever the style', () => {
    for (const seed of SEEDS) {
      const base = customersByDay(seed, STRATEGIES.reasonable);
      for (const name of ['flat45', 'plainS', 'day5cheat']) {
        const other = customersByDay(seed, STRATEGIES[name]);
        other.forEach((day, i) => expect(day).toStrictEqual(base[i]));
      }
    }
  });

  it('reasonable: sells all five days, refuses the cartel, and day 3 leaves customers empty-handed', () => {
    for (const seed of SEEDS) {
      const { run } = playRun(seed, STRATEGIES.reasonable);
      expect(run.outcome).toBe('finished');
      expect(run.flags.cartel).toBe('refused');
      expect(run.upgrades[0]).toBe('machine');
      for (const r of run.reports) expect(r.summary.cups).toBeGreaterThan(0);
      expect(run.reports[2].summary.openPrice).toBe(20);
      expect(run.reports[2].emptyHanded).toBeGreaterThan(0);
    }
  });

  it('reasonable (R38): prices day 4 from the street of day 2, not from the 20k ceiling day', () => {
    for (const seed of SEEDS) {
      const { run } = playRun(seed, STRATEGIES.reasonable);
      const closes = run.reports[1].street.flatMap(r => (r.closePrice === null ? [] : [r.closePrice]));
      const want = Math.round(closes.reduce((a, b) => a + b, 0) / closes.length);
      expect(run.reports[3].summary.openPrice).toBe(want);
      expect(want).toBeGreaterThan(20);
    }
  });

  it("shares the bot stream across strategies (R39): reasonable's choices as a story combo play the same run", () => {
    const same = storyCombos(STRATEGIES.reasonable)
      .find(c => c.id.endsWith('+cartel-refuse+shock-B+black-B+tax-A+inspect-B'));
    expect(same).toBeDefined();
    for (const seed of [11, 12]) expect(playRun(seed, same!)).toStrictEqual(playRun(seed, STRATEGIES.reasonable));
  });

  it('never sits idle with a servable customer at the counter (R42a)', () => {
    for (const name of NAMES) {
      for (const seed of [11, 61, 90, 91]) {
        const { stall, run } = longestStall(seed, STRATEGIES[name]);
        expect(stall, `${name} seed ${seed}`).toBe(0);
        expect(run).toStrictEqual(playRun(seed, STRATEGIES[name]).run);
      }
    }
    const { run } = playRun(61, STRATEGIES.reasonable);
    expect(run.reports.map(r => r.summary.walkouts)).toEqual([0, 0, 0, 0, 0]);
  });

  it('owns the machine by the end of day 2 in every style (R42b)', () => {
    for (const name of NAMES) {
      for (const seed of [11, 12, 13, 61, 90]) {
        const { run } = playRun(seed, STRATEGIES[name]);
        expect(run.reports.slice(0, 2).some(r => r.summary.upgrade === 'machine'), `${name} seed ${seed}`).toBe(true);
      }
    }
  });

  it("pins reasonable's rush constants (R37)", () => {
    expect(STRATEGIES.reasonable.rush).toEqual({ delayTicks: 3, mistakeRate: 0.03, serve: 'urgent', cup: 'asOrdered',
      reprice: null, closeWhenEmpty: true });
  });

  it('prices, teas and cards of each style as named', () => {
    const seed = 11;
    const days = (name: string) => playRun(seed, STRATEGIES[name]).run.reports.map(r => r.summary);
    expect(days('flat15').map(d => d.openPrice)).toEqual([15, 15, 15, 15, 15]);
    expect(days('flat45').map(d => d.openPrice)).toEqual([45, 45, 20, 45, 45]);
    expect(days('skimp').every(d => d.tea === 'skimp')).toBe(true);
    expect(days('premium').every(d => d.tea === 'premium')).toBe(true);
    expect(STRATEGIES.delay1.rush.delayTicks).toBe(1);
    expect(STRATEGIES.delay6.rush.delayTicks).toBe(6);
    expect(STRATEGIES.plainS.rush.cup).toBe('plainS');
    const run = newRun(seed, 'x');
    const cards: CardId[] = ['cartel', 'shockTopping', 'blackMarket', 'tax', 'inspection', 'reporter',
      'kol', 'tab', 'student', 'complaint', 'deliveryAd', 'scholarship'];
    expect(cards.map(c => STRATEGIES.reasonable.card(c, run)).join('')).toBe('BBBABA' + 'AAAAAA');
    expect(cards.map(c => STRATEGIES.day5cheat.card(c, run)).join('')).toBe('BBBAAA' + 'AAAAAA');
  });

  it('day5cheat: honest days 1–4 with the self-inspection, then skimp tea and a gouging rise on day 5', () => {
    for (const seed of SEEDS) {
      const { run } = playRun(seed, STRATEGIES.day5cheat);
      const d = run.reports.map(r => r.summary);
      expect(d.slice(0, 4).every(x => x.tea === 'standard')).toBe(true);
      expect(d[3].labels).toContain('inspectPass');
      expect(d[4].tea).toBe('skimp');
      const open = d[4].openPrice;
      expect((d[4].closePrice - open) * 100).toBeGreaterThan(CONFIG.priceChange.gougePercent * open);
      expect(d[4].closePrice).toBe(open + Math.floor((CONFIG.priceChange.gougePercent * open) / 100) + 1);
      expect(run.reports[4].repItems.map(i => i.reason)).toContain('gouge');
      expect(d.slice(0, 4).every(x => x.closePrice === x.openPrice)).toBe(true);
    }
  });
});

describe('the morning plans', () => {
  const run = newRun(11, 'x');
  const rich: RunState = { ...run, cash: 5000 };
  const brief = morningBrief(run);
  const plan = (name: string, r: RunState = run, b = morningBrief(r)) => STRATEGIES[name].plan(r, b, CONFIG);
  const high = (r: RunState, upgrade: MorningPlan['upgrade']) =>
    quickFill(r, 'high', { ...r.plan, upgrade });

  it("reasonable: 30k on day 1, standard tea, the machine and today's capacity with it", () => {
    expect(plan('reasonable')).toEqual({ ...run.plan, price: 30, tea: 'standard', upgrade: 'machine',
      ...high(run, 'machine') });
  });

  /** A run on the morning of `day` whose past days closed at these prices (`[id, close]`, null for not selling). */
  function after(day: 2 | 3 | 4 | 5, closes: Record<number, [ShopDayResult['id'], number | null][]>,
    cartel: 'refused' | 'agreed' = 'refused'): RunState {
    const reports = Object.entries(closes).map(([d, rows]) => ({
      summary: { day: Number(d) },
      street: rows.map(([id, closePrice]) => ({ id, closePrice })),
    }) as unknown as DayReport);
    return { ...rich, day, reports, flags: { ...rich.flags, cartel } };
  }
  const price = (r: RunState) => STRATEGIES.reasonable.plan(r, { ...brief, rules: dayRules(r) }, CONFIG).price;

  it("reasonable (R38): the average of the latest free day's closes, rounded, clamped to the day", () => {
    expect(price(after(2, { 1: [['batu', 28], ['giare', 31], ['cochap', null], ['player', 33]] }))).toBe(31);
    // Day 3 has a 20k ceiling.
    expect(price(after(3, { 2: [['batu', 28], ['player', 33]] }))).toBe(20);
  });

  it('reasonable (R38): skips the ceiling day and the cartel day, and takes the AI tax pass-through off day 4', () => {
    const d1: [ShopDayResult['id'], number | null][] = [['batu', 24], ['player', 26]];
    const d2: [ShopDayResult['id'], number | null][] = [['batu', 30], ['player', 32]];
    const d3: [ShopDayResult['id'], number | null][] = [['batu', 20], ['player', 20]];
    expect(price(after(4, { 1: d1, 2: d2, 3: d3 }))).toBe(31);
    expect(price(after(4, { 1: d1, 2: d2, 3: d3 }, 'agreed'))).toBe(25);
    // Day 4 closes: AI 36 → 33 once the 3k pass-through is taken back; the player's 31 as is.
    expect(price(after(5, { 1: d1, 2: d2, 3: d3, 4: [['batu', 36], ['tapdoan', 35], ['player', 31]] }))).toBe(32);
  });

  it('reasonable: staff when it can pay from day 3, nothing on day 2', () => {
    const owned: RunState = { ...rich, upgrades: ['machine'] };
    expect(plan('reasonable', { ...owned, day: 2 }).upgrade).toBeNull();
    expect(plan('reasonable', { ...owned, day: 3 }).upgrade).toBe('staff');
    expect(plan('reasonable', { ...owned, day: 4, upgrades: ['machine', 'staff'] }).upgrade).toBeNull();
  });

  type Stocking = ReturnType<typeof quickFill>;
  /** `target` stepped down to k tea steps of 250 ml, toppings in proportion, rounded down. */
  const atStep = (target: Stocking, k: number): Stocking => {
    const n = target.teaMl / 250;
    return { teaMl: k * 250, toppings: { pearl: Math.floor((target.toppings.pearl * k) / n),
      jelly: Math.floor((target.toppings.jelly * k) / n), pudding: Math.floor((target.toppings.pudding * k) / n) } };
  };
  /** The plan is `target` at a step the credit allows, and one more step it does not. */
  const largestAffordable = (r: RunState, p: MorningPlan, target: Stocking) => {
    const k = p.teaMl / 250;
    expect(k).toBeLessThan(target.teaMl / 250);
    expect(p).toMatchObject(atStep(target, k));
    expect(validatePlan(r, p)).toEqual([]);
    expect(validatePlan(r, { ...p, ...atStep(target, k + 1) })).toContain('credit');
  };

  it('keeps the wanted upgrade and steps the stock down to what the credit allows (R42b)', () => {
    for (const cash of [50, -40]) {
      const r: RunState = { ...run, cash };
      const p = plan('reasonable', r);
      expect(p.upgrade).toBe('machine');
      largestAffordable(r, p, high(r, 'machine'));
    }
    // The machine alone is beyond the credit: no upgrade, as much stock as allowed.
    const deep: RunState = { ...run, cash: -100 };
    const q = plan('reasonable', deep);
    expect(q.upgrade).toBeNull();
    largestAffordable(deep, q, high(deep, null));
    expect(plan('reasonable', { ...run, cash: -150 }))
      .toMatchObject({ upgrade: null, teaMl: 0, toppings: { pearl: 0, jelly: 0, pudding: 0 } });
  });

  it('wants the machine any morning until it owns it (R42b)', () => {
    expect(plan('reasonable', { ...rich, day: 2 }).upgrade).toBe('machine');
    expect(plan('premium', { ...rich, day: 4 }).upgrade).toBe('machine');
  });

  it("double buys twice today's capacity, half half of it", () => {
    const two = high(rich, 'machine');
    expect(plan('double', rich)).toMatchObject({ upgrade: 'machine', teaMl: 2 * two.teaMl,
      toppings: { pearl: 2 * two.toppings.pearl, jelly: 2 * two.toppings.jelly, pudding: 2 * two.toppings.pudding } });
    const one = high(run, 'machine');
    expect(plan('half')).toMatchObject({ upgrade: 'machine', teaMl: Math.ceil(one.teaMl / 500) * 250,
      toppings: { pearl: Math.ceil(one.toppings.pearl / 2), jelly: Math.ceil(one.toppings.jelly / 2),
        pudding: Math.ceil(one.toppings.pudding / 2) } });
  });

  it('day5cheat opens day 5 low enough for its rise to gouge under the 50k top', () => {
    // Street at 48k (AI 51 - 3 pass-through, the player's 48): reasonable 48, day5cheat 41 (41 -> 50 is +22%).
    const r = after(5, { 4: [['batu', 51], ['player', 48]] });
    expect(price(r)).toBe(48);
    expect(STRATEGIES.day5cheat.plan(r, { ...brief, rules: dayRules(r) }, CONFIG).price).toBe(41);
  });

  it('day5cheat buys skimp tea on day 5 only', () => {
    expect(plan('day5cheat').tea).toBe('standard');
    expect(plan('day5cheat', { ...rich, day: 5 }).tea).toBe('skimp');
  });
});

describe('storyCombos', () => {
  const combos = storyCombos(STRATEGIES.reasonable);

  it('gives 48 strategies with distinct ids', () => {
    expect(combos).toHaveLength(48);
    expect(new Set(combos.map(c => c.id)).size).toBe(48);
  });

  it('covers every choice of the other story cards under each cartel outcome', () => {
    const run = newRun(1, 'x');
    const picks = combos.map(c =>
      (['cartel', 'shockTopping', 'blackMarket', 'tax', 'inspection'] as const).map(id => c.card(id, run)).join(''));
    expect(new Set(picks).size).toBe(32);   // the two agree outcomes share their card choices
  });

  it('keeps or breaks the cartel on day 2 as its id says', () => {
    for (const seed of [11, 12]) {
      for (const c of combos.filter(x => x.id.includes('shock-B') && x.id.includes('black-B') && x.id.includes('tax-A')
        && x.id.includes('inspect-B'))) {
        const { run } = playRun(seed, c);
        const day2 = run.reports[1].summary;
        const label = day2.labels.find(l => l === 'cartelKept' || l === 'cartelBroke');
        if (c.id.includes('cartel-refuse')) {
          expect(run.flags.cartel).toBe('refused');
          expect(label).toBeUndefined();
        } else if (c.id.includes('cartel-keep')) {
          expect(label).toBe('cartelKept');
          expect(day2.openPrice).toBeGreaterThanOrEqual(CONFIG.cards.cartel.price);
          expect(day2.closePrice).toBeGreaterThanOrEqual(CONFIG.cards.cartel.price);
        } else {
          expect(label).toBe('cartelBroke');
          expect(day2.openPrice).toBeLessThan(CONFIG.cards.cartel.price);
        }
      }
    }
  });

  it('plays every combination to the end', () => {
    for (const c of combos) {
      const { run } = playRun(11, c);
      expect(run.phase).toBe('end');
      const choices = run.reports.flatMap(r => r.summary.cards);
      const story = (id: string) => choices.find(x => x.id === id)?.choice;
      const want = c.id.includes('shock-A') ? 'A' : 'B';
      expect(story('shockTopping')).toBe(want);
      if (run.reports.length === 5) expect(story('inspection')).toBe(c.id.includes('inspect-A') ? 'A' : 'B');
    }
  });

  it('keeps the base strategy for everything but the story cards', () => {
    const run = newRun(1, 'x');
    for (const c of combos) {
      expect(c.rush).toBe(STRATEGIES.reasonable.rush);
      expect(c.card('kol', run)).toBe(STRATEGIES.reasonable.card('kol', run));
      expect(c.card('reporter', run)).toBe(STRATEGIES.reasonable.card('reporter', run));
    }
  });
});
