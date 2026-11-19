import { describe, expect, it } from 'vitest';
import { CONFIG, type SimConfig } from './config';
import { customerCount, generateAdCustomers, generateCustomers } from './customers';
import { capacityEstimate, dayRules, morningBrief, openDay, planCost, quickFill, validatePlan } from './day';
import { AI_SOLD, PLAYER_SOLD, USED, seasoned } from './day.fixtures';
import { createRush, finishRush, type RushInput } from './rush';
import { deepFreeze } from './rush.fixtures';
import { newRun } from './run';
import { STREET, morningPrices } from './shops';
import type { Day, MorningPlan, PendingEffect, RunFlags, RunState, RushState, UpgradeId } from './types';

const run = (over: Partial<RunState> = {}): RunState => ({ ...newRun(7, 'day-test'), ...over });
const plan = (r: RunState, upgrade: UpgradeId | null = null): MorningPlan => ({ ...r.plan, upgrade });
const temp = (day: RunState['day']): PendingEffect => ({ day, source: 'student', tempStaff: true });
const flags = (over: Partial<RunFlags>): RunFlags => ({ ...run().flags, ...over });
/** No stock, priced at 20k so it also passes the day-3 ceiling. */
const zero = (r: RunState): MorningPlan => ({ ...r.plan, price: 20, teaMl: 0, toppings: { pearl: 0, jelly: 0, pudding: 0 } });
const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const playerOf = (rush: RushState) => rush.shops.find(s => s.id === 'player')!;

describe('capacityEstimate', () => {
  it('gives ~18 cups with no upgrade, ~21 with the machine and ~10 more with staff (§4 Nâng cấp)', () => {
    const r = run();
    expect(capacityEstimate(r, plan(r))).toBe(18);
    expect(capacityEstimate(run({ upgrades: ['machine'] }), plan(r))).toBe(21);
    expect(capacityEstimate(r, plan(r, 'machine'))).toBe(21);
    expect(capacityEstimate(run({ upgrades: ['staff'] }), plan(r))).toBe(28);
    expect(capacityEstimate(r, plan(r, 'staff'))).toBe(28);
    expect(capacityEstimate(run({ upgrades: ['machine'] }), plan(r, 'staff'))).toBe(31);
  });

  it('ignores the banner', () => {
    const r = run();
    expect(capacityEstimate(run({ upgrades: ['banner'] }), plan(r, 'banner'))).toBe(18);
  });

  it("counts the student's helper on the morning it arrives, not on other days", () => {
    const r = run({ day: 2, pending: [temp(2)] });
    expect(capacityEstimate(r, plan(r))).toBe(28);
    const later = run({ day: 2, pending: [temp(3)] });
    expect(capacityEstimate(later, plan(later))).toBe(18);
  });

  it('derives from the config, not from fixed numbers', () => {
    const cfg: SimConfig = {
      ...CONFIG,
      craft: { ...CONFIG.craft, cupTicksEstimate: 45, staffTicks: 100 },
    };
    const r = run();
    expect(capacityEstimate(r, plan(r), cfg)).toBe(20);              // 900 / 45
    expect(capacityEstimate(r, plan(r, 'machine'), cfg)).toBe(24);   // 900 / (45 − 8) = 24.3
    expect(capacityEstimate(r, plan(r, 'staff'), cfg)).toBe(29);     // 20 + 900 / 100
  });
});

describe('quickFill', () => {
  // Average order: 362.5 ml of tea; per cup 0.6917 pearl and 0.4792 each of jelly and pudding (1–3 distinct
  // toppings 50/35/15 %, drawn without repetition at weights 2/1/1).
  it('fills ~10 cups for "low"', () => {
    expect(quickFill(run(), 'low')).toEqual({ teaMl: 3750, toppings: { pearl: 7, jelly: 5, pudding: 5 } });
  });

  it('fills ~15 cups for "mid"', () => {
    expect(quickFill(run(), 'mid')).toEqual({ teaMl: 5500, toppings: { pearl: 11, jelly: 8, pudding: 8 } });
  });

  it("fills today's capacity for \"high\"", () => {
    expect(quickFill(run(), 'high')).toEqual({ teaMl: 6750, toppings: { pearl: 13, jelly: 9, pudding: 9 } });
    const withMachine = run();
    const machine = { ...withMachine, plan: plan(withMachine, 'machine') };
    expect(quickFill(machine, 'high')).toEqual({ teaMl: 7750, toppings: { pearl: 15, jelly: 11, pudding: 11 } });
  });

  it('"high" follows the upgrade of the draft plan passed in (R24)', () => {
    const r = run();
    expect(quickFill(r, 'high', plan(r, 'machine'))).toEqual({ teaMl: 7750, toppings: { pearl: 15, jelly: 11, pudding: 11 } });
    expect(quickFill(r, 'high', plan(r, 'staff'))).toEqual(quickFill({ ...r, plan: plan(r, 'staff') }, 'high'));
    expect(quickFill(r, 'high', plan(r, 'staff')).teaMl).toBe(10250);   // 28 cups × 362.5 ml, up to the step
    expect(quickFill(r, 'high')).toEqual(quickFill(r, 'high', r.plan));
  });

  it('rounds tea up to the 250 ml step', () => {
    for (const level of ['low', 'mid', 'high'] as const) {
      expect(quickFill(run(), level).teaMl % CONFIG.supplies.teaStepMl).toBe(0);
    }
  });

  it('follows the order mix customers are actually generated with', () => {
    const cups = 10000;
    const cfg: SimConfig = { ...CONFIG, morning: { ...CONFIG.morning, quickFillCups: { low: 10, mid: cups } } };
    const r = run();
    const fill = quickFill(r, 'mid', r.plan, cfg);
    let ml = 0;
    const portions = { pearl: 0, jelly: 0, pudding: 0 };
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const c of generateCustomers(seed, 1)) {
        n++;
        ml += CONFIG.supplies.sizeMl[c.order.size];
        for (const t of c.order.toppings) portions[t]++;
      }
    }
    expect(Math.abs(fill.teaMl / cups / (ml / n) - 1)).toBeLessThan(0.02);
    for (const t of ['pearl', 'jelly', 'pudding'] as const) {
      expect(Math.abs(fill.toppings[t] / cups - portions[t] / n)).toBeLessThan(0.02);
    }
  });
});

describe('dayRules', () => {
  it("reads today's ceiling, tax, rumor and customer factor from the schedule (§3)", () => {
    expect(dayRules(run())).toEqual({ day: 1, ceiling: null, taxPerCup: 0, rumor: false, cartel: false, customerFactor: 1 });
    expect(dayRules(run({ day: 2 }))).toEqual({ day: 2, ceiling: null, taxPerCup: 0, rumor: false, cartel: false, customerFactor: 1 });
    expect(dayRules(run({ day: 3 }))).toEqual({ day: 3, ceiling: 20, taxPerCup: 0, rumor: false, cartel: false, customerFactor: 1 });
    expect(dayRules(run({ day: 4 }))).toEqual({ day: 4, ceiling: null, taxPerCup: 5, rumor: false, cartel: false, customerFactor: 1 });
    expect(dayRules(run({ day: 5 }))).toEqual({ day: 5, ceiling: null, taxPerCup: 0, rumor: true, cartel: false, customerFactor: 1.25 });
  });

  it('turns the cartel on only on the cartel day, and only if the player agreed (§7)', () => {
    expect(dayRules(run({ day: 2, flags: flags({ cartel: 'agreed' }) })).cartel).toBe(true);
    expect(dayRules(run({ day: 2, flags: flags({ cartel: 'refused' }) })).cartel).toBe(false);
    expect(dayRules(run({ day: 2 })).cartel).toBe(false);
    for (const day of [1, 3, 4, 5] as Day[]) {
      expect(dayRules(run({ day, flags: flags({ cartel: 'agreed' }) })).cartel).toBe(false);
    }
  });
});

describe('planCost', () => {
  it('prices tea per 100 ml by grade, each topping portion, and the upgrade (§4)', () => {
    const r = run();   // 5,500 ml standard, 11/8/8 portions, 300k cash
    expect(planCost(r, r.plan)).toEqual({ tea: 165, toppings: 54, upgrade: 0, total: 219, cashAfter: 81 });
    expect(planCost(r, { ...r.plan, tea: 'skimp' }).tea).toBe(110);
    expect(planCost(r, { ...r.plan, tea: 'premium' }).tea).toBe(220);
    expect(planCost(r, plan(r, 'machine'))).toEqual({ tea: 165, toppings: 54, upgrade: 80, total: 299, cashAfter: 1 });
    expect(planCost(r, plan(r, 'staff')).upgrade).toBe(150);
    expect(planCost(r, plan(r, 'banner')).upgrade).toBe(100);
  });

  it('keeps money in multiples of 0.5k', () => {
    const r = run();
    const one: MorningPlan = { ...r.plan, teaMl: 250, toppings: { pearl: 1, jelly: 0, pudding: 0 } };
    expect(planCost(r, one)).toEqual({ tea: 7.5, toppings: 2, upgrade: 0, total: 9.5, cashAfter: 290.5 });
  });

  it('charges 0.5k a topping portion on days 3–4 after buying the shock toppings (§7)', () => {
    const shock = flags({ shockTopping: true });
    for (const day of [3, 4] as Day[]) {
      const r = run({ day, flags: shock });
      expect(planCost(r, r.plan)).toMatchObject({ toppings: 13.5, total: 178.5 });
    }
    for (const day of [1, 2, 5] as Day[]) expect(planCost(run({ day, flags: shock }), run().plan).toppings).toBe(54);
    expect(planCost(run({ day: 3 }), run().plan).toppings).toBe(54);
  });

  it('counts down from the cash in hand, below zero too', () => {
    const r = run({ cash: -100 });
    expect(planCost(r, r.plan).cashAfter).toBe(-319);
    expect(planCost(r, zero(r))).toEqual({ tea: 0, toppings: 0, upgrade: 0, total: 0, cashAfter: -100 });
  });
});

describe('validatePlan', () => {
  it('accepts the pre-filled plan', () => {
    const r = run();
    expect(validatePlan(r, r.plan)).toEqual([]);
  });

  it('wants a price of 10–50k on the 1k step', () => {
    const r = run();
    for (const price of [10, 33, 50]) expect(validatePlan(r, { ...r.plan, price })).toEqual([]);
    for (const price of [9, 51, 30.5, 0, -5, NaN]) expect(validatePlan(r, { ...r.plan, price })).toEqual(['price']);
  });

  it("wants the price at or under today's ceiling (§4 Chính sách)", () => {
    const r = run({ day: 3 });
    expect(validatePlan(r, { ...r.plan, price: 20 })).toEqual([]);
    expect(validatePlan(r, { ...r.plan, price: 21 })).toEqual(['ceiling']);
    expect(validatePlan(run({ day: 4 }), { ...r.plan, price: 50 })).toEqual([]);
  });

  it('wants tea in 250 ml steps', () => {
    const r = run();
    expect(validatePlan(r, { ...r.plan, teaMl: 5600 })).toEqual(['teaStep']);
    expect(validatePlan(r, { ...r.plan, teaMl: 0 })).toEqual([]);
  });

  it('refuses negative amounts', () => {
    const r = run();
    expect(validatePlan(r, { ...r.plan, teaMl: -250 })).toEqual(['negative']);
    expect(validatePlan(r, { ...r.plan, toppings: { pearl: 1, jelly: -1, pudding: 0 } })).toEqual(['negative']);
  });

  it('sells each upgrade once (§4 Nâng cấp)', () => {
    const r = run({ upgrades: ['machine'] });
    expect(validatePlan(r, plan(r, 'machine'))).toEqual(['upgradeOwned']);
    expect(validatePlan(r, plan(r, 'banner'))).toEqual([]);
  });

  it('buys on credit down to −150k, no further (§4)', () => {
    const at = (cash: number) => run({ cash });
    expect(validatePlan(at(69), at(69).plan)).toEqual([]);           // 69 − 219 = −150
    expect(validatePlan(at(68.5), at(68.5).plan)).toEqual(['credit']);
    expect(validatePlan(at(219), plan(at(219), 'machine'))).toEqual([]);           // 219 − 299 = −80
    expect(validatePlan(at(100), plan(at(100), 'staff'))).toEqual(['credit']);     // 100 − 369 = −269
  });

  it('always lets the shop open with no stock and no upgrade, however deep in debt (§5)', () => {
    for (const cash of [-150, -151, -400]) {
      const r = run({ cash });
      expect(validatePlan(r, zero(r))).toEqual([]);
    }
    for (const cash of [-151, -400]) {
      const r = run({ cash });
      expect(validatePlan(r, { ...zero(r), upgrade: 'banner' })).toEqual(['credit']);
      expect(validatePlan(r, { ...zero(r), toppings: { pearl: 1, jelly: 0, pudding: 0 } })).toEqual(['credit']);
    }
  });

  it('lists every issue at once, in a fixed order', () => {
    const r = run({ day: 3, cash: -150, upgrades: ['banner'] });
    const bad: MorningPlan = { price: 25.5, tea: 'standard', teaMl: 100, toppings: { pearl: -1, jelly: 0, pudding: 0 },
      upgrade: 'banner' };
    expect(validatePlan(r, bad)).toEqual(['price', 'ceiling', 'teaStep', 'negative', 'upgradeOwned', 'credit']);
  });
});

describe('morningBrief', () => {
  it("gives day 1's theme and rules, the capacity, cash and rep, and no yesterday", () => {
    const r = run();
    expect(morningBrief(r)).toStrictEqual({
      day: 1, theme: 'opening', rules: dayRules(r), busStop: false, news: [], street: [], yesterday: null,
      capacity: 18, bus: null, cash: 300, rep: 50,
    });
  });

  it('lists the delayed effects that land this morning, not later ones', () => {
    const kol: PendingEffect = { day: 2, source: 'kol', rep: 8 };
    const tab: PendingEffect = { day: 3, source: 'tab', cash: 30, rep: 3 };
    const r = seasoned(2, 30, { pending: [kol, tab, temp(2)] });
    expect(morningBrief(r).news).toStrictEqual([kol, temp(2)]);
  });

  it("shows yesterday's street: closing prices, sold out, unsold, who opens today and who closed", () => {
    const r = seasoned(3);
    const yesterday = r.reports[1];
    const street = yesterday.street.map(s => (s.id === 'giare' ? { ...s, soldOut: true, sold: 12 } : s));
    const shops = r.shops.map(s => (s.id === 'luotsong' ? { ...s, status: 'closed' as const, closedOn: 2 as Day } : s));
    const brief = morningBrief({ ...r, shops, reports: [r.reports[0], { ...yesterday, street }] });
    expect(brief.street.map(s => s.id)).toEqual(STREET);
    expect(brief.street.find(s => s.id === 'giare')).toStrictEqual({
      id: 'giare', closePrice: 22, sold: 12, soldOut: true, unsold: 0, opensToday: false, closedOn: null });
    expect(brief.street.find(s => s.id === 'batu')).toStrictEqual({
      id: 'batu', closePrice: 27, sold: AI_SOLD, soldOut: false, unsold: 2, opensToday: false, closedOn: null });
    expect(brief.street.find(s => s.id === 'luotsong')).toMatchObject({ closePrice: 29, closedOn: 2 });
    expect(brief.street.find(s => s.id === 'tapdoan')).toMatchObject({ closePrice: 26.5, sold: AI_SOLD, unsold: 8 });
    expect(brief.street.find(s => s.id === 'player')).toStrictEqual({
      id: 'player', closePrice: 30, sold: PLAYER_SOLD, soldOut: false, unsold: null, opensToday: false, closedOn: null });
  });

  it('marks Chuỗi Tập Đoàn as opening on day 2, with no price yesterday', () => {
    expect(morningBrief(seasoned(2)).street.find(s => s.id === 'tapdoan')).toStrictEqual({
      id: 'tapdoan', closePrice: null, sold: 0, soldOut: false, unsold: 0, opensToday: true, closedOn: null });
    expect(morningBrief(seasoned(3)).street.find(s => s.id === 'tapdoan')!.opensToday).toBe(false);
  });

  it('shows a shop that rested yesterday without a price', () => {
    const brief = morningBrief(seasoned(4));
    expect(brief.street.find(s => s.id === 'cochap')).toMatchObject({ closePrice: null, sold: 0, unsold: 0 });
    expect(brief.street.find(s => s.id === 'batu')).toMatchObject({ closePrice: 20 });
  });

  it("gives the hint line: yesterday's cups and stock used (§5)", () => {
    expect(morningBrief(seasoned(2)).yesterday).toStrictEqual({ cups: PLAYER_SOLD, used: USED });
  });

  it('estimates capacity for the current plan, counting a helper who comes today', () => {
    const r = seasoned(2, 30, { pending: [temp(2)] });
    expect(morningBrief(r).capacity).toBe(28);
    expect(morningBrief({ ...r, pending: [], plan: plan(r, 'machine') }).capacity).toBe(21);
  });

  it('gives the bus-stop line on day 5: customers without and with the stop (§4 Chính sách)', () => {
    const brief = morningBrief(seasoned(5));
    expect(brief.busStop).toBe(true);
    expect(brief.bus).toStrictEqual({ without: 130, with: 163 });
    expect(brief.bus!.with).toBe(customerCount(5));
    expect(morningBrief(seasoned(4)).bus).toBeNull();
  });

  it('reads the theme of each day and leaves the run alone', () => {
    const themes = ([1, 2, 3, 4, 5] as Day[]).map(d => morningBrief(deepFreeze(seasoned(d))).theme);
    expect(themes).toEqual(['opening', 'newShop', 'priceCeiling', 'tax', 'rumor']);
  });
});

describe('openDay', () => {
  it('refuses an invalid plan or a run that is not in the morning', () => {
    const r = run();
    expect(() => openDay(r, { ...r.plan, price: 60 })).toThrow();
    expect(() => openDay({ ...r, phase: 'rush' }, r.plan)).toThrow();
    const opened = openDay(r, r.plan).run;
    expect(() => openDay(opened, r.plan)).toThrow();
  });

  it('pays for the stock, moves to the rush and keeps the plan (R27)', () => {
    const r = deepFreeze(run());
    const { run: next, rush, events } = openDay(r, r.plan);
    expect(next.cash).toBe(81);
    expect(next.phase).toBe('rush');
    expect(next.plan).toStrictEqual(r.plan);
    expect(next.today).toStrictEqual({ plan: r.plan, spent: 219, tempStaff: false });
    expect(next.rep).toBe(50);
    expect(next.morningNews).toEqual([]);
    expect(events).toEqual([]);
    expect(rush).toMatchObject({ day: 1, tick: 0, done: false });
  });

  it('opens with no stock when cash already sits at the credit floor (§5)', () => {
    for (const cash of [-150, -220]) {
      const r = run({ cash });
      const { run: next, rush } = openDay(r, zero(r));
      expect(next.cash).toBe(cash);
      expect(next.phase).toBe('rush');
      expect(rush.player.stock).toEqual({ teaMl: 0, toppings: { pearl: 0, jelly: 0, pudding: 0 } });
      expect(playerOf(rush).status).toBe('soldOut');
    }
  });

  it('buys one upgrade, keeps it for the run and never sells it again (§4 Nâng cấp)', () => {
    const r = run();
    const { run: next, rush } = openDay(r, plan(r, 'machine'));
    expect(next.upgrades).toEqual(['machine']);
    expect(next.cash).toBe(1);
    expect(rush.player.machine).toBe(true);
    const tomorrow: RunState = { ...seasoned(2), upgrades: next.upgrades };
    expect(validatePlan(tomorrow, plan(tomorrow, 'machine'))).toEqual(['upgradeOwned']);
    expect(() => openDay(tomorrow, plan(tomorrow, 'machine'))).toThrow();
    const both = openDay(tomorrow, plan(tomorrow, 'staff'));
    expect(both.run.upgrades).toEqual(['machine', 'staff']);
    expect(both.rush.player.machine).toBe(true);
    expect(both.rush.player.staff).toEqual({ progress: 0 });
  });

  it("applies this morning's delayed effects and removes them; later ones wait (§4 Uy tín, §7)", () => {
    const due: PendingEffect[] = [
      { day: 3, source: 'kol', rep: 8 },
      { day: 3, source: 'blackMarket', rep: -8 },
      { day: 3, source: 'tab', cash: 30, rep: 3 },
      { day: 3, source: 'deliveryAd', adCustomers: 6 },
      temp(3),
    ];
    const later: PendingEffect = { day: 4, source: 'blackMarket', rep: -8 };
    const r = seasoned(3, 20, { cash: 100, pending: [due[0], later, ...due.slice(1)] });
    const { run: next, rush } = openDay(r, zero(r));
    expect(next.cash).toBe(130);
    expect(next.rep).toBe(53);
    expect(next.pending).toEqual([later]);
    expect(next.morningNews).toEqual([
      { reason: 'kol', delta: 8, when: 'morning' },
      { reason: 'blackMarket', delta: -8, when: 'morning' },
      { reason: 'tab', delta: 3, when: 'morning' },
    ]);
    expect(next.today!.tempStaff).toBe(true);
    expect(rush.player.staff).toEqual({ progress: 0 });
    expect(rush.customers).toHaveLength(customerCount(3) + 6);
    expect(rush.customers.slice(-6)).toEqual(generateAdCustomers(r.seed, 3, customerCount(3), 6));
  });

  it('brings no helper and no ad customers on a morning without them', () => {
    const r = seasoned(3, 20, { pending: [temp(4), { day: 4, source: 'deliveryAd', adCustomers: 6 }] });
    const { run: next, rush } = openDay(r, { ...r.plan, price: 20 });
    expect(next.today!.tempStaff).toBe(false);
    expect(rush.player.staff).toBeNull();
    expect(rush.customers).toHaveLength(customerCount(3));
    expect(next.pending).toEqual(r.pending);
  });

  it("names the cartel break's morning gossip after the cartel card", () => {
    const r = seasoned(3, 20, { pending: [{ day: 3, source: 'cartelBreak', rep: -8 }] });
    expect(openDay(r, zero(r)).run.morningNews).toEqual([{ reason: 'cartel', delta: -8, when: 'morning' }]);
  });

  it('banner: +10 rep the moment it is bought, clamped to 100 (§4)', () => {
    const r = run({ rep: 70 });
    const opened = openDay(r, plan(r, 'banner'));
    expect(opened.run.rep).toBe(80);
    expect(opened.run.cash).toBe(-19);
    expect(opened.run.morningNews).toEqual([{ reason: 'banner', delta: 10, when: 'morning' }]);
    expect(playerOf(opened.rush).rep).toBe(80);
    expect(openDay(run({ rep: 95 }), plan(r, 'banner')).run.rep).toBe(100);
  });

  it('sums the morning items, clamps once to 0–100, and never ends the run (§16 row 10)', () => {
    const gossip: PendingEffect = { day: 3, source: 'blackMarket', rep: -8 };
    const low = seasoned(3, 20, { rep: 5, pending: [gossip] });
    const sunk = openDay(low, zero(low)).run;
    expect(sunk.rep).toBe(0);
    expect(sunk.phase).toBe('rush');
    expect(sunk.outcome).toBeNull();
    expect(openDay({ ...low, cash: 300 }, { ...zero(low), upgrade: 'banner' }).run.rep).toBe(7);   // 5 − 8 + 10
  });

  it('counts a skimp day for skimp tea, or on days 3–4 with the shock toppings, once a day (§16 row 9)', () => {
    const skimps = (r: RunState, tea: MorningPlan['tea']) => openDay(r, { ...zero(r), tea }).run.skimpDays;
    const shock = flags({ shockTopping: true });
    expect(skimps(run(), 'skimp')).toBe(1);
    expect(skimps(run(), 'standard')).toBe(0);
    expect(skimps(run({ skimpDays: 2 }), 'premium')).toBe(2);
    for (const day of [3, 4] as Day[]) {
      expect(skimps(seasoned(day, 20, { flags: shock }), 'standard')).toBe(1);
      expect(skimps(seasoned(day, 20, { flags: shock }), 'skimp')).toBe(1);
      expect(skimps(seasoned(day, 20), 'standard')).toBe(0);
    }
    for (const day of [2, 5] as Day[]) expect(skimps(seasoned(day, 30, { flags: shock }), 'standard')).toBe(0);
  });

  it("passes today's skimp day to the day-5 rumor (§16 row 9)", () => {
    const r = seasoned(5, 30, { skimpDays: 1 });
    const p = playerOf(openDay(r, { ...zero(r), tea: 'skimp' }).rush);
    expect(p.skimpDays).toBe(2);
    expect(p.rumorPenalty).toBe(CONFIG.rumor.basePenalty + 2 * CONFIG.rumor.penaltyPerSkimpDay);
  });

  it('lets a shop that passed the self-paid inspection start day 5 certified', () => {
    const pass = seasoned(5, 30, { skimpDays: 1, flags: flags({ inspection: 'pass' }) });
    expect(playerOf(openDay(pass, pass.plan).rush)).toMatchObject({ certified: true, rumorPenalty: 0 });
    for (const inspection of ['wait', 'fail', 'none'] as const) {
      const r = seasoned(5, 30, { flags: flags({ inspection }) });
      expect(playerOf(openDay(r, r.plan).rush).certified).toBe(false);
    }
  });

  it('opens Chuỗi Tập Đoàn on day 2 with a price from day 1, the player included (§3, §4)', () => {
    const r = seasoned(2);
    const { run: next, rush } = openDay(r, r.plan);
    // Others' closes 27, 22, 30, 29, 34 and the player's 30: mean 28.67 → 28.5, less the 2k undercut.
    expect(next.shops.find(s => s.id === 'tapdoan')).toMatchObject({ status: 'active', todayPrice: 26.5, resting: false });
    expect(rush.shops.find(s => s.id === 'tapdoan')).toMatchObject({ status: 'open', price: 26.5, grandOpening: true });
    const dearer = seasoned(2, 42);   // mean 30.67 → 30.5
    expect(openDay(dearer, dearer.plan).run.shops.find(s => s.id === 'tapdoan')!.todayPrice).toBe(28.5);
  });

  it("prices the AI shops with morningPrices from the AI books and the player's reports (R27)", () => {
    const r = seasoned(4, { 1: 31, 2: 33, 3: 20 });
    const { run: next } = openDay(r, r.plan);
    const history = [{ day: 1 as Day, closePrice: 31, sold: PLAYER_SOLD }, { day: 2 as Day, closePrice: 33, sold: PLAYER_SOLD },
      { day: 3 as Day, closePrice: 20, sold: PLAYER_SOLD }];
    expect(next.shops).toStrictEqual(morningPrices(r.shops, history, dayRules(r), r.flags));
    expect(next.shops).not.toStrictEqual(morningPrices(r.shops, [], dayRules(r), r.flags));
  });

  it('freezes every AI shop at the cartel price on day 2 after the player agreed', () => {
    const r = seasoned(2, 30, { flags: flags({ cartel: 'agreed' }) });
    const { rush } = openDay(r, { ...r.plan, price: 36 });
    expect(rush.rules.cartel).toBe(true);
    for (const s of rush.shops.filter(x => x.id !== 'player')) {
      expect(s.price).toBe(CONFIG.cards.cartel.price);
      expect(s.ai!.frozen).toBe(true);
    }
  });

  it('rests the shops the 20k ceiling leaves no margin on day 3 (§4 Nghỉ bán)', () => {
    const r = seasoned(3, 20);
    const { run: next, rush } = openDay(r, { ...r.plan, price: 20 });
    const resting = rush.shops.filter(s => s.status === 'resting').map(s => s.id);
    expect(resting).toEqual(['cochap', 'sinhvien']);
    for (const id of resting) expect(next.shops.find(s => s.id === id)).toMatchObject({ resting: true, todayPrice: null });
    for (const s of rush.shops.filter(x => x.status === 'open')) expect(s.price).toBeLessThanOrEqual(20);
  });

  it('builds the rush from the run: seed, rules, AI shops, the player and the ad customers', () => {
    const r = seasoned(4, 30, {
      rep: 61, skimpDays: 1, upgrades: ['banner'],
      pending: [temp(4), { day: 4, source: 'deliveryAd', adCustomers: 6 }],
    });
    const p: MorningPlan = { price: 34, tea: 'premium', teaMl: 4000, toppings: { pearl: 9, jelly: 4, pudding: 5 },
      upgrade: 'machine' };
    const { run: next, rush } = openDay(r, p);
    const input: RushInput = {
      seed: r.seed, rules: dayRules(r), ai: next.shops, adCustomers: 6,
      player: { price: 34, tea: 'premium', stock: { teaMl: 4000, toppings: { pearl: 9, jelly: 4, pudding: 5 } },
        rep: 61, machine: true, staff: true, skimpDays: 1, selfCertified: false },
    };
    expect(rush).toStrictEqual(createRush(input).state);
    expect(rush.customers.slice(0, customerCount(4))).toEqual(generateCustomers(r.seed, 4));
  });

  it('gives the staff to a shop that owns the upgrade, with no helper card', () => {
    const r = seasoned(3, 20, { upgrades: ['staff'] });
    const { run: next, rush } = openDay(r, { ...r.plan, price: 20 });
    expect(rush.player.staff).toEqual({ progress: 0 });
    expect(next.today!.tempStaff).toBe(false);
  });

  it('leaves the run it was given alone', () => {
    const r = deepFreeze(seasoned(3, 20, { pending: [temp(3), { day: 3, source: 'kol', rep: 8 }] }));
    const p = deepFreeze({ ...r.plan, price: 20, upgrade: 'banner' as const });
    expect(() => openDay(r, p)).not.toThrow();
  });

  it('gives a run that survives a JSON round trip, in the morning and in the rush', () => {
    const r = seasoned(3, 20, { pending: [temp(3), { day: 3, source: 'tab', cash: 30, rep: 3 }] });
    expect(roundTrip(r)).toStrictEqual(r);
    const { run: next, rush } = openDay(r, { ...r.plan, price: 20, upgrade: 'banner' });
    expect(roundTrip(next)).toStrictEqual(next);
    expect(finishRush(rush).state.done).toBe(true);
  });
});
