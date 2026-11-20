import { describe, expect, it } from 'vitest';
import { CONFIG, type SimConfig } from './config';
import { customerCount, generateAdCustomers, generateCustomers } from './customers';
import { applyChoice } from './cards';
import {
  capacityEstimate, closeDay, dayRules, morningBrief, openDay, planCost, quickFill, validatePlan,
} from './day';
import { AI_SOLD, PLAYER_SOLD, USED, seasoned } from './day.fixtures';
import { createRush, finishRush, type RushInput } from './rush';
import { deepFreeze } from './rush.fixtures';
import { endRush, newRun } from './run';
import { STREET, aiProfit, morningPrices } from './shops';
import type {
  CardId, Choice, Day, DayReport, MorningPlan, PendingEffect, RunFlags, RunState, RushResult, RushState, UpgradeId,
} from './types';

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
    expect(planCost(r, plan(r, 'banner')).upgrade).toBe(CONFIG.upgrades.banner.cost);
    // The banner is no free score: its brand value is under its price (plan Task 31).
    expect(CONFIG.upgrades.banner.rep * CONFIG.run.brandPerRep).toBeLessThan(CONFIG.upgrades.banner.cost);
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
    expect(validatePlan(r, { ...r.plan, teaMl: 250.5 })).toEqual(['teaStep']);
    expect(validatePlan(r, { ...r.plan, teaMl: 0 })).toEqual([]);
  });

  it('wants whole topping portions', () => {
    const r = run();
    expect(validatePlan(r, { ...r.plan, toppings: { pearl: 1.5, jelly: 0, pudding: 0 } })).toEqual(['toppingStep']);
    expect(validatePlan(r, { ...r.plan, toppings: { pearl: 2, jelly: 1, pudding: 0.5 } })).toEqual(['toppingStep']);
    expect(validatePlan(r, { ...r.plan, toppings: { pearl: 2, jelly: 1, pudding: NaN } })).toEqual(['toppingStep']);
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
    const bad: MorningPlan = { price: 25.5, tea: 'standard', teaMl: 100,
      toppings: { pearl: -1.5, jelly: 0, pudding: 0 }, upgrade: 'banner' };
    expect(validatePlan(r, bad))
      .toEqual(['price', 'ceiling', 'teaStep', 'toppingStep', 'negative', 'upgradeOwned', 'credit']);
  });

  it("judges credit on the cash at opening: this morning's pending cash included (R28)", () => {
    const tab: PendingEffect = { day: 1, source: 'tab', cash: 30, rep: 3 };
    const r = run({ cash: 39, pending: [tab] });
    expect(planCost(r, r.plan).cashAfter).toBe(-150);                   // 39 + 30 − 219
    expect(validatePlan(r, r.plan)).toEqual([]);
    expect(validatePlan({ ...r, pending: [] }, r.plan)).toEqual(['credit']);
    expect(validatePlan({ ...r, pending: [{ ...tab, day: 2 }] }, r.plan)).toEqual(['credit']);
    const opened = openDay(r, r.plan).run;
    expect(opened.cash).toBe(-150);
    expect(opened.cash).toBe(planCost(r, r.plan).cashAfter);
  });
});

describe('morningBrief', () => {
  it("gives day 1's theme and rules, the capacity, cash and rep, and no yesterday", () => {
    const r = run();
    expect(morningBrief(r)).toStrictEqual({
      day: 1, theme: 'opening', rules: dayRules(r), busStop: false, news: [], street: [], yesterday: null,
      capacity: 18, bus: null, cash: 300, rep: 50, toppingCost: 2,
    });
  });

  it("shows the cash the shop will have at opening, this morning's pending cash included (R28)", () => {
    const r = seasoned(3, 20, { cash: 39, pending: [{ day: 3, source: 'tab', cash: 30, rep: 3 },
      { day: 4, source: 'tab', cash: 30, rep: 3 }] });
    expect(morningBrief(r).cash).toBe(69);
  });

  it("shows the rep after this morning's delayed rep, clamped; the banner is left to the plan", () => {
    const tab: PendingEffect = { day: 3, source: 'tab', cash: 30, rep: 3 };
    expect(morningBrief(seasoned(3, 20, { pending: [tab, { ...tab, day: 4 }] })).rep).toBe(53);
    expect(morningBrief(seasoned(3, 20, { rep: 99, pending: [tab] })).rep).toBe(100);
    expect(morningBrief(seasoned(3, 20, { rep: 5, pending: [{ day: 3, source: 'blackMarket', rep: -8 }] })).rep).toBe(0);
    expect(morningBrief(run({ plan: plan(run(), 'banner') })).rep).toBe(50);
  });

  it("gives today's price of a topping portion: 0.5k on days 3–4 after the shock toppings (§7)", () => {
    const shock = flags({ shockTopping: true });
    expect(morningBrief(seasoned(3, 20, { flags: shock })).toppingCost).toBe(0.5);
    expect(morningBrief(seasoned(4, 30, { flags: shock })).toppingCost).toBe(0.5);
    expect(morningBrief(seasoned(5, 30, { flags: shock })).toppingCost).toBe(2);
    expect(morningBrief(seasoned(3, 20)).toppingCost).toBe(2);
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
      id: 'giare', status: 'open', closePrice: 22, sold: 12, soldOut: true, unsold: 0, closedOn: null });
    expect(brief.street.find(s => s.id === 'batu')).toStrictEqual({
      id: 'batu', status: 'open', closePrice: 27, sold: AI_SOLD, soldOut: false, unsold: 2, closedOn: null });
    expect(brief.street.find(s => s.id === 'luotsong')).toMatchObject({ status: 'closed', closePrice: 29, closedOn: 2 });
    expect(brief.street.find(s => s.id === 'tapdoan')).toMatchObject({ closePrice: 26.5, sold: AI_SOLD, unsold: 8 });
    expect(brief.street.find(s => s.id === 'player')).toStrictEqual({
      id: 'player', status: 'open', closePrice: 30, sold: PLAYER_SOLD, soldOut: false, unsold: null, closedOn: null });
  });

  it('marks Chuỗi Tập Đoàn as opening on day 2, with no price yesterday', () => {
    expect(morningBrief(seasoned(2)).street.find(s => s.id === 'tapdoan')).toStrictEqual({
      id: 'tapdoan', status: 'new', closePrice: null, sold: 0, soldOut: false, unsold: 0, closedOn: null });
    expect(morningBrief(seasoned(3)).street.find(s => s.id === 'tapdoan')!.status).toBe('open');
  });

  it('marks a shop whose first day is still to come as not yet open (a later first day in the config)', () => {
    const later: SimConfig = { ...CONFIG, aiShops: { ...CONFIG.aiShops, tapdoan: { ...CONFIG.aiShops.tapdoan, firstDay: 3 } } };
    expect(morningBrief(seasoned(2), later).street.find(s => s.id === 'tapdoan')).toMatchObject({ status: 'notYet' });
    expect(morningBrief(seasoned(2), CONFIG).street.find(s => s.id === 'tapdoan')).toMatchObject({ status: 'new' });
  });

  it('shows a shop that rested yesterday without a price', () => {
    const brief = morningBrief(seasoned(4));
    expect(brief.street.find(s => s.id === 'cochap')).toMatchObject({ status: 'rested', closePrice: null, sold: 0,
      unsold: 0 });
    expect(brief.street.find(s => s.id === 'batu')).toMatchObject({ status: 'open', closePrice: 20 });
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
    expect(next.today).toStrictEqual({
      plan: r.plan, cost: { tea: 165, toppings: 54, upgrade: 0 }, tempStaff: false, applied: [], cardCash: 0,
    });
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
    expect(next.today!.applied).toStrictEqual(due);                     // R29: what landed this morning
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
    expect(next.today!.applied).toEqual([]);
  });

  it("names the cartel break's morning gossip after the cartel card", () => {
    const r = seasoned(3, 20, { pending: [{ day: 3, source: 'cartelBreak', rep: -8 }] });
    expect(openDay(r, zero(r)).run.morningNews).toEqual([{ reason: 'cartel', delta: -8, when: 'morning' }]);
  });

  it('banner: +10 rep the moment it is bought, clamped to 100 (§4)', () => {
    const r = run({ rep: 70 });
    const opened = openDay(r, plan(r, 'banner'));
    expect(opened.run.rep).toBe(80);
    expect(opened.run.cash).toBe(81 - CONFIG.upgrades.banner.cost);   // 300 − 219 of stock − the banner
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
    const skimps = (r: RunState, tea: MorningPlan['tea'], pearl = 0) =>
      openDay(r, { ...zero(r), tea, teaMl: 250, toppings: { pearl, jelly: 0, pudding: 0 } }).run.skimpDays;
    const shock = flags({ shockTopping: true });
    expect(skimps(run(), 'skimp')).toBe(1);
    expect(skimps(run(), 'standard')).toBe(0);
    expect(skimps(run({ skimpDays: 2 }), 'premium')).toBe(2);
    for (const day of [3, 4] as Day[]) {
      expect(skimps(seasoned(day, 20, { flags: shock }), 'standard', 1)).toBe(1);
      expect(skimps(seasoned(day, 20, { flags: shock }), 'skimp', 1)).toBe(1);
      expect(skimps(seasoned(day, 20), 'standard', 1)).toBe(0);
    }
    for (const day of [2, 5] as Day[]) expect(skimps(seasoned(day, 30, { flags: shock }), 'standard', 1)).toBe(0);
  });

  it('counts no skimp day for a grade or a topping the shop did not buy (R31)', () => {
    const shock = flags({ shockTopping: true });
    expect(openDay(run(), { ...zero(run()), tea: 'skimp' }).run.skimpDays).toBe(0);
    const day3 = seasoned(3, 20, { flags: shock });
    expect(openDay(day3, { ...zero(day3), teaMl: 250 }).run.skimpDays).toBe(0);
    expect(openDay(day3, { ...zero(day3), tea: 'skimp', teaMl: 0, toppings: { pearl: 0, jelly: 1, pudding: 0 } })
      .run.skimpDays).toBe(1);
  });

  it("passes today's skimp day to the day-5 rumor (§16 row 9)", () => {
    const r = seasoned(5, 30, { skimpDays: 1 });
    const p = playerOf(openDay(r, { ...zero(r), tea: 'skimp', teaMl: 250 }).rush);
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
    // Others' closes 27, 22, 30, 29, 34 and the player's 30: mean 28.67 → 28.5, less the undercut.
    const under = CONFIG.aiPricing.tapdoanUndercut;
    expect(next.shops.find(s => s.id === 'tapdoan'))
      .toMatchObject({ status: 'active', todayPrice: 28.5 - under, resting: false });
    expect(rush.shops.find(s => s.id === 'tapdoan'))
      .toMatchObject({ status: 'open', price: 28.5 - under, grandOpening: true });
    const dearer = seasoned(2, 42);   // mean 30.67 → 30.5
    expect(openDay(dearer, dearer.plan).run.shops.find(s => s.id === 'tapdoan')!.todayPrice).toBe(30.5 - under);
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
    expect(resting).toEqual(['cochap', 'luotsong', 'sinhvien']);
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

describe('openDay: plain numbers', () => {
  it('stores −0 amounts as 0, so the run survives a JSON round trip exactly', () => {
    const r = run();
    const p: MorningPlan = { ...zero(r), teaMl: -0, toppings: { pearl: -0, jelly: 0, pudding: -0 } };
    const next = openDay(r, p).run;
    expect(roundTrip(next)).toStrictEqual(next);
    expect(Object.is(next.plan.teaMl, 0)).toBe(true);
    expect(Object.is(next.today!.plan.toppings.pearl, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The evening (Task 10).

type Tally = Partial<RushResult['player']>;
const QUIET: Tally = { cups: 0, wrong: 0, walkouts: 0, gouged: false };
const shock = () => flags({ shockTopping: true });
const agreed = () => flags({ cartel: 'agreed' });

/** `r` opened with plan `p` and played out with no input; the player's day result then takes the fields of `tally`. */
function afternoon(r: RunState, p: MorningPlan = r.plan, tally: Tally = {}): RunState {
  const o = openDay(r, p);
  const a = endRush(o.run, finishRush(o.rush).state);
  return { ...a, rushResult: { ...a.rushResult!, player: { ...a.rushResult!.player, ...tally } } };
}
/** Makes the afternoon's choices, then closes the day. */
function evening(a: RunState, choices: [CardId, Choice][] = [], cfg: SimConfig = CONFIG): RunState {
  let r = a;
  for (const [id, c] of choices) r = applyChoice(r, id, c);
  return closeDay({ ...r, cards: r.choices.map(c => c.id), cardIndex: r.choices.length }, cfg);
}
/** A quiet day: no cups, no mistakes, no walkouts, no gouging, unless `tally` says otherwise. */
const quiet = (r: RunState, p: MorningPlan = r.plan, tally: Tally = {}, choices: [CardId, Choice][] = []) =>
  evening(afternoon(r, p, { ...QUIET, ...tally }), choices);
const last = (r: RunState): DayReport => r.reports[r.reports.length - 1];
const eveningItems = (r: RunState) => last(r).repItems.filter(i => i.when === 'evening');
const at20 = (r: RunState): MorningPlan => ({ ...r.plan, price: 20 });
const lastEntry = <T>(xs: readonly T[]): T => xs[xs.length - 1];

describe('closeDay: phase and report', () => {
  it('needs the afternoon with every card chosen, and the day result', () => {
    const a = afternoon(run());
    expect(a.cards).toHaveLength(2);
    expect(() => closeDay(a)).toThrow();
    expect(() => closeDay({ ...a, cardIndex: 1 })).toThrow();
    expect(() => closeDay({ ...a, cardIndex: 2, phase: 'report' })).toThrow();
    expect(() => closeDay({ ...a, cardIndex: 2, rushResult: null })).toThrow();
    expect(() => closeDay({ ...a, cardIndex: 2, today: null })).toThrow();
    expect(closeDay({ ...a, cardIndex: 2 }).phase).toBe('report');
  });

  it("appends the day's report with the street, the street counts and the day's choices", () => {
    const a = afternoon(seasoned(3, 20), at20(seasoned(3, 20)));
    const e = evening(a, [['kol', 'A'], ['blackMarket', 'B']]);
    expect(e.reports).toHaveLength(3);
    const rep = last(e);
    expect(rep.summary.day).toBe(3);
    expect(rep.summary.cards).toEqual([{ id: 'kol', choice: 'A' }, { id: 'blackMarket', choice: 'B' }]);
    expect(rep.street.map(s => s.id)).toEqual(a.rushResult!.shops.map(s => s.id));
    expect(rep.emptyHanded).toBe(a.rushResult!.emptyHanded);
    expect(rep.eligible).toBe(a.rushResult!.eligible);
    expect(rep.taxFund).toBe(a.rushResult!.taxFund);
    expect(rep.missedNoStock).toBe(a.rushResult!.player.missedNoStock);
    expect(last(quiet(run(), run().plan, { missedNoStock: 7 })).missedNoStock).toBe(7);
  });

  it("fills the street's profit: AI shops from their books, the player's day profit, null for shops not trading", () => {
    const r = seasoned(3, 20);
    const shops = r.shops.map(s => (s.id === 'luotsong' ? { ...s, status: 'closed' as const, closedOn: 2 as Day } : s));
    const e = quiet({ ...r, shops }, at20(r));
    for (const row of last(e).street) {
      if (row.id === 'player') expect(row.profit).toBe(last(e).summary.profit);
      else if (row.id === 'luotsong') expect(row.profit).toBeNull();
      else expect(row.profit).toBe(lastEntry(e.shops.find(s => s.id === row.id)!.history).profit);
    }
    expect(last(e).street.find(s => s.id === 'cochap')!.profit).toBe(-CONFIG.aiPricing.rent);
  });

  it('leaves the run it was given alone and gives a run that survives a JSON round trip', () => {
    const a = afternoon(seasoned(2, 36, { flags: agreed() }), { ...seasoned(2).plan, price: 30 });
    const frozen = deepFreeze({ ...a, cards: [], cardIndex: 0 });
    const e = closeDay(frozen);
    expect(roundTrip(e)).toStrictEqual(e);
  });
});

describe('closeDay: money (R27, §16 row 13)', () => {
  it('day profit = revenue − tea − toppings − tax − fines; cash only loses the fines', () => {
    const a = afternoon(seasoned(4, 30, { upgrades: ['staff'] }));
    const p = a.rushResult!.player;
    expect(p.cups).toBeGreaterThan(0);
    expect(p.tax).toBe(p.cups * 5);
    const e = evening(a, [['tax', 'A'], ['inspection', 'B']]);
    expect(last(e).summary).toMatchObject({
      revenue: p.revenue, cost: 219, tax: p.tax, fines: 0, profit: p.revenue - 219 - p.tax, cash: a.cash,
    });
    expect(e.cash).toBe(a.cash);
  });

  it('keeps the upgrade out of the cost and the day profit, on a line of its own', () => {
    const r = run();
    const a = afternoon(r, plan(r, 'staff'));
    const s = last(evening(a)).summary;
    expect(s).toMatchObject({ cost: 219, upgrade: 'staff', profit: a.rushResult!.player.revenue - 219 });
    expect(last(evening(a)).upgradeCost).toBe(150);
    expect(last(evening(a))).toMatchObject({ teaCost: 165, toppingCost: 54 });
    expect(last(quiet(r)).upgradeCost).toBe(0);
  });

  it("reports what was paid this morning and at each card, as stored on today's record (not recomputed)", () => {
    const a = afternoon(run());
    const paid = { ...a.today!, cost: { tea: 100, toppings: 10.5, upgrade: 80 }, cardCash: -12.5 };
    const rep = last(closeDay({ ...a, cardIndex: 2, today: paid }));
    expect(rep.summary.cost).toBe(110.5);
    expect(rep.summary.profit).toBe(a.rushResult!.player.revenue - 110.5 - a.rushResult!.player.tax);
    expect(rep).toMatchObject({ teaCost: 100, toppingCost: 10.5, upgradeCost: 80, cardCash: -12.5 });
  });

  it('pays the shock price for toppings on days 3–4, as reported', () => {
    const r = seasoned(3, 20, { flags: shock() });
    expect(last(quiet(r, at20(r)))).toMatchObject({ teaCost: 165, toppingCost: 13.5 });
  });

  it('does not refund the evaded tax again: it is already in cash, as card money', () => {
    const a = afternoon(seasoned(4, 30, { upgrades: ['staff'] }));
    const p = a.rushResult!.player;
    expect(p.tax).toBeGreaterThan(0);
    const e = evening(a, [['tax', 'B'], ['inspection', 'B']]);
    expect(e.cash).toBe(a.cash + p.tax);
    expect(last(e).summary).toMatchObject({ tax: p.tax, profit: p.revenue - 219 - p.tax });
    expect(last(e).cardCash).toBe(p.tax);
  });

  it("puts today's card cash and this morning's delayed cash on lines of their own; cash adds up", () => {
    const r = seasoned(3, 20, { pending: [{ day: 3, source: 'tab', cash: 30, rep: 3 }] });
    const e = quiet(r, { ...at20(r), upgrade: 'machine' }, {}, [['kol', 'A'], ['blackMarket', 'A']]);
    const rep = last(e);
    expect(rep.cardCash).toBe(-30 + 50);
    expect(rep.delayedCash).toBe(30);
    expect(rep.upgradeCost).toBe(80);
    const before = r.reports[1].summary.cash;
    expect(rep.summary.cash).toBe(before + rep.delayedCash - rep.upgradeCost + rep.summary.profit + rep.cardCash);
    expect(rep.summary.cash).toBe(e.cash);
  });

  it('takes the cartel fine even below the credit floor (§4, §7)', () => {
    const r = seasoned(2, 36, { cash: -140, flags: agreed() });
    const e = quiet(r, { ...zero(r), price: 36 });
    expect(e.cash).toBe(-290);
    expect(last(e).summary).toMatchObject({ fines: 150, profit: -150, cash: -290 });
  });

  it("values the leftover tea and toppings at today's unit costs", () => {
    const left = { teaMl: 1000, toppings: { pearl: 2, jelly: 1, pudding: 0 } };
    const r = run();
    expect(last(quiet(r, r.plan, { left })).summary.wasteValue).toBe(30 + 6);
    expect(last(quiet(r, { ...r.plan, tea: 'premium' }, { left })).summary.wasteValue).toBe(40 + 6);
    expect(last(quiet(r, { ...r.plan, tea: 'skimp' }, { left: { ...left, teaMl: 1050 } })).summary.wasteValue)
      .toBe(21 + 6);
    const d3 = seasoned(3, 20, { flags: shock() });
    expect(last(quiet(d3, at20(d3), { left })).summary.wasteValue).toBe(30 + 1.5);
  });
});

describe('closeDay: the evening reputation (§4 Uy tín, §16 rows 10–11)', () => {
  it('tea grade: skimp −12, premium +8, standard nothing', () => {
    const r = run();
    const { skimp, premium } = CONFIG.supplies.teaGrades;
    expect([skimp.rep, premium.rep]).toEqual([-12, 8]);   // spec §4, the tea table
    expect(eveningItems(quiet(r, { ...r.plan, tea: 'skimp' })))
      .toEqual([{ reason: 'tea', delta: skimp.rep, when: 'evening' }]);
    expect(eveningItems(quiet(r, { ...r.plan, tea: 'premium' })))
      .toEqual([{ reason: 'tea', delta: premium.rep, when: 'evening' }]);
    expect(eveningItems(quiet(r))).toEqual([]);
    expect(quiet(r, { ...r.plan, tea: 'skimp' }).rep).toBe(50 + skimp.rep);
  });

  it('counts no tea grade on a day with no tea bought (R31)', () => {
    const r = run();
    expect(eveningItems(quiet(r, { ...zero(r), tea: 'skimp' }))).toEqual([]);
    expect(eveningItems(quiet(r, { ...zero(r), tea: 'premium' }))).toEqual([]);
  });

  it('wrong cups −2 each, walkouts −1 each, gouging −5', () => {
    const r = run();
    expect(eveningItems(quiet(r, r.plan, { cups: 5, wrong: 2 })))
      .toEqual([{ reason: 'wrong', delta: -4, count: 2, when: 'evening' }]);
    expect(eveningItems(quiet(r, r.plan, { walkouts: 3 })))
      .toEqual([{ reason: 'walkout', delta: -3, count: 3, when: 'evening' }]);
    expect(eveningItems(quiet(r, r.plan, { gouged: true }))).toEqual([{ reason: 'gouge', delta: -5, when: 'evening' }]);
    expect(CONFIG.rep.gouge).toBe(-5);
  });

  it('clean service +3: at least one cup, no wrong cup, no walkout (§16 row 11)', () => {
    const r = run();
    expect(eveningItems(quiet(r, r.plan, { cups: 1 }))).toEqual([{ reason: 'clean', delta: 3, when: 'evening' }]);
    expect(eveningItems(quiet(r, r.plan, { cups: 0 }))).toEqual([]);
    expect(eveningItems(quiet(r, r.plan, { cups: 4, wrong: 1 })).map(i => i.reason)).toEqual(['wrong']);
    expect(eveningItems(quiet(r, r.plan, { cups: 4, walkouts: 1 })).map(i => i.reason)).toEqual(['walkout']);
    expect(eveningItems(quiet(r, r.plan, { cups: 4, gouged: true })).map(i => i.reason)).toEqual(['gouge', 'clean']);
  });

  it("adds the afternoon's card rep", () => {
    const r = run();
    expect(eveningItems(quiet(r, r.plan, {}, [['complaint', 'B'], ['cartel', 'B']]))).toEqual([
      { reason: 'complaint', delta: -3, when: 'evening' }, { reason: 'cartel', delta: 3, when: 'evening' },
    ]);
  });

  it('shock toppings −3 on each evening of days 3–4, not on other days (§7)', () => {
    for (const day of [3, 4] as Day[]) {
      const r = seasoned(day, 20, { flags: shock() });
      expect(eveningItems(quiet(r, at20(r)))).toEqual([{ reason: 'shockTopping', delta: -3, when: 'evening' }]);
      expect(eveningItems(quiet(seasoned(day, 20), at20(r)))).toEqual([]);
    }
    expect(eveningItems(quiet(seasoned(5, 30, { flags: shock() })))).toEqual([]);
  });

  it('shock toppings cost no rep on a day the shop bought no toppings (R32)', () => {
    for (const day of [3, 4] as Day[]) {
      const r = seasoned(day, 20, { flags: shock() });
      expect(eveningItems(quiet(r, { ...zero(r), teaMl: 250 }))).toEqual([]);
      expect(eveningItems(quiet(r, { ...zero(r), toppings: { pearl: 0, jelly: 0, pudding: 1 } })))
        .toEqual([{ reason: 'shockTopping', delta: -3, when: 'evening' }]);
    }
  });

  it('lists the items in a fixed order: tea, wrong, walkouts, gouging, clean, cards, cartel fine, shock toppings', () => {
    const r = seasoned(2, 36, { flags: { ...agreed(), shockTopping: true } });
    const e = quiet(r, { ...r.plan, price: 36, tea: 'premium' }, { cups: 3, wrong: 1, walkouts: 2, gouged: true },
      [['scholarship', 'A'], ['shockTopping', 'A']]);
    expect(eveningItems(e).map(i => i.reason)).toEqual(['tea', 'wrong', 'walkout', 'gouge', 'scholarship', 'cartel']);
    const d3 = seasoned(3, 20, { flags: shock() });
    expect(eveningItems(quiet(d3, { ...at20(d3), tea: 'skimp' }, { cups: 2 }, [['complaint', 'A']])).map(i => i.reason))
      .toEqual(['tea', 'clean', 'complaint', 'shockTopping']);
  });

  it("puts this morning's items first in the report, already applied (§4: two times a day)", () => {
    const r = seasoned(3, 20, { rep: 40, pending: [{ day: 3, source: 'kol', rep: 8 }] });
    const e = quiet(r, { ...at20(r), upgrade: 'banner' }, { cups: 1 });
    expect(last(e).repItems).toEqual([
      { reason: 'kol', delta: 8, when: 'morning' }, { reason: 'banner', delta: 10, when: 'morning' },
      { reason: 'clean', delta: 3, when: 'evening' },
    ]);
    expect(e.rep).toBe(61);
  });

  it("reports the rep before the day: yesterday's evening rep, or the starting rep on day 1", () => {
    const r = seasoned(3, 20, { rep: 64 });
    const reports = r.reports.map(x => (x.summary.day === 2 ? { ...x, summary: { ...x.summary, rep: 61 } } : x));
    expect(last(quiet({ ...r, reports }, at20(r))).repBefore).toBe(61);
    expect(last(quiet(run({ rep: 70 }))).repBefore).toBe(CONFIG.run.startRep);
  });

  it('sums the evening items, then clamps once to 0–100', () => {
    const r = run({ rep: 98 });
    expect(quiet(r, { ...r.plan, tea: 'premium' }, { cups: 2 }).rep).toBe(100);
    // Skimp tea takes the rep below 0 before the clean service's +3: the sum is clamped, not each item.
    const low = run({ rep: -CONFIG.supplies.teaGrades.skimp.rep - 2 });
    expect(quiet(low, { ...low.plan, tea: 'skimp' }, { cups: 2 }).rep).toBe(1);   // −2 + 3, not max(0, −2) + 3
    expect(last(quiet(low, { ...low.plan, tea: 'skimp' }, { cups: 2 })).summary.rep).toBe(1);
  });
});

describe('closeDay: losing all trust (§4 Uy tín)', () => {
  it('ends the run when the evening leaves rep at 0', () => {
    const r = run({ rep: 5 });
    const e = quiet(r, { ...r.plan, tea: 'skimp' });
    expect(e.rep).toBe(0);
    expect(e.outcome).toBe('lostTrust');
    expect(e.phase).toBe('report');
    expect(last(e).summary.lost).toBe(true);
    const above = run({ rep: 1 - CONFIG.supplies.teaGrades.skimp.rep });   // skimp tea leaves 1
    expect(quiet(above, { ...r.plan, tea: 'skimp' }).outcome).toBeNull();
    expect(last(quiet(above, { ...r.plan, tea: 'skimp' })).summary.lost).toBe(false);
  });

  it('ends the run on the evening of day 5 too', () => {
    const e = quiet(seasoned(5, 30, { rep: 3 }), seasoned(5).plan, { walkouts: 3 });
    expect(e.rep).toBe(0);
    expect(e.outcome).toBe('lostTrust');
    expect(last(e).summary.lost).toBe(true);
  });

  it('judges only the evening: a morning at 0 survives if the evening lifts it, and loses if not', () => {
    const r = seasoned(3, 20, { rep: 5, pending: [{ day: 3, source: 'blackMarket', rep: -8 }] });
    const lifted = quiet(r, at20(r), { cups: 2 });
    expect(lifted.rep).toBe(3);
    expect(lifted.outcome).toBeNull();
    const sunk = quiet(r, at20(r));
    expect(sunk.rep).toBe(0);
    expect(sunk.outcome).toBe('lostTrust');
  });

  it("never loses to the day-5 rumor penalty: it only scares customers, it is not the shop's rep (§4 Tin đồn)", () => {
    const r = seasoned(5, 30, { rep: 10, skimpDays: 3 });
    expect(playerOf(openDay(r, r.plan).rush).rumorPenalty).toBe(25);
    const e = quiet(r);
    expect(e.rep).toBe(10);
    expect(e.outcome).toBeNull();
  });
});

describe('closeDay: the cartel on the evening of day 2 (§7)', () => {
  it('refused: no fine, no penalty', () => {
    const r = seasoned(2, 30, { flags: flags({ cartel: 'refused' }) });
    const e = quiet(r);
    expect(last(e).summary).toMatchObject({ fines: 0, labels: [] });
    expect(eveningItems(e)).toEqual([]);
    expect(e.pending).toEqual([]);
    expect(e.flags.cartelBroken).toBe(false);
  });

  it('kept: fined 150k and −2 rep', () => {
    const r = seasoned(2, 36, { flags: agreed() });
    const a = afternoon(r, { ...r.plan, price: 36 }, QUIET);
    expect(a.rushResult!.player.brokeCartel).toBe(false);
    const e = evening(a);
    expect(last(e).summary).toMatchObject({ fines: 150, labels: ['cartelKept'] });
    expect(eveningItems(e)).toEqual([{ reason: 'cartel', delta: -2, when: 'evening' }]);
    expect(e.cash).toBe(a.cash - 150);
    expect(e.flags.cartelBroken).toBe(false);
    expect(e.pending).toEqual([]);
  });

  it('broken: fined 150k and −2 rep all the same, and the street gossips on the morning of day 3 (−8)', () => {
    const r = seasoned(2, 36, { flags: agreed() });
    const a = afternoon(r, { ...r.plan, price: 30 }, QUIET);
    expect(a.rushResult!.player.brokeCartel).toBe(true);
    const e = evening(a);
    expect(last(e).summary).toMatchObject({ fines: 150, labels: ['cartelBroke'] });
    expect(eveningItems(e)).toEqual([{ reason: 'cartel', delta: -2, when: 'evening' }]);
    expect(e.flags.cartelBroken).toBe(true);
    expect(e.pending).toEqual([{ day: 3, source: 'cartelBreak', rep: -8 }]);
  });

  it('fines nobody on another day, even with the cartel agreed', () => {
    const r = seasoned(3, 20, { flags: agreed() });
    expect(last(quiet(r, at20(r))).summary.fines).toBe(0);
  });
});

describe('closeDay: the AI books (§4 Rút lui)', () => {
  it.each([3, 4] as Day[])('books every AI shop that sold or rested on day %i at aiProfit; shops not trading are left alone', day => {
    const r = seasoned(day, 20);
    const shops = r.shops.map(s => (s.id === 'luotsong' ? { ...s, status: 'closed' as const, closedOn: 2 as Day } : s));
    const a = afternoon({ ...r, shops }, at20(r), QUIET);
    const e = evening(a);
    const rules = dayRules(a);
    expect(rules.taxPerCup).toBe(CONFIG.days[day].taxPerCup);
    for (const s of e.shops) {
      const before = a.shops.find(x => x.id === s.id)!;
      if (s.id === 'luotsong') {
        expect(s.history).toEqual(before.history);
        continue;
      }
      const row = a.rushResult!.shops.find(x => x.id === s.id)!;
      expect(s.history).toStrictEqual([...before.history,
        { day, closePrice: row.closePrice, sold: row.sold, profit: aiProfit(s.id, row, rules), rested: before.resting }]);
    }
    if (day === 3) {
      expect(lastEntry(e.shops.find(s => s.id === 'cochap')!.history))
        .toStrictEqual({ day: 3, closePrice: null, sold: 0, profit: -CONFIG.aiPricing.rent, rested: true });
    } else {
      // On the tax day every cup sold pays 5k: the books are below the tax-free figure by 5k a cup.
      const batu = a.rushResult!.shops.find(x => x.id === 'batu')!;
      expect(batu.sold).toBeGreaterThan(0);
      expect(lastEntry(e.shops.find(s => s.id === 'batu')!.history).profit)
        .toBe(aiProfit('batu', batu, { ...rules, taxPerCup: 0 }) - 5 * batu.sold);
    }
  });

  it('opens the books of Chuỗi Tập Đoàn on its first day', () => {
    const e = quiet(seasoned(2));
    expect(e.shops.find(s => s.id === 'tapdoan')!.history.map(h => h.day)).toEqual([2]);
  });

  it('closes a shop after two losing days in a row, that evening', () => {
    const r = seasoned(3, 20);
    const loser = r.shops.map(s => (s.id === 'batu'
      ? { ...s, history: s.history.map(h => (h.day === 2 ? { ...h, profit: -10 } : h)) } : s));
    // At the 80k rent Bà Tư breaks even when she sells out at the ceiling; a dearer rent makes today a loss for sure.
    const dear: SimConfig = { ...CONFIG, aiPricing: { ...CONFIG.aiPricing, rent: 1000 } };
    const e = evening(afternoon({ ...r, shops: loser }, at20(r), QUIET), [], dear);
    expect(e.shops.find(s => s.id === 'batu')).toMatchObject({ status: 'closed', closedOn: 3 });
    expect(e.shops.find(s => s.id === 'giare')).toMatchObject({ status: 'active', closedOn: null });
  });

  it('runs the exits after day 5 too, so the ending can tell who did not survive', () => {
    const r = seasoned(5);
    const loser = r.shops.map(s => (s.id === 'batu'
      ? { ...s, history: s.history.map(h => (h.day === 4 ? { ...h, profit: -1 } : h)) } : s));
    const dear: SimConfig = { ...CONFIG, aiPricing: { ...CONFIG.aiPricing, rent: 1000 } };
    const e = evening(afternoon({ ...r, shops: loser }, r.plan, QUIET), [], dear);
    expect(e.shops.find(s => s.id === 'batu')).toMatchObject({ status: 'closed', closedOn: 5 });
    expect(e.shops.filter(s => s.status === 'closed').map(s => s.id)).toEqual(['batu']);
  });
});

describe('closeDay: the day summary (§11)', () => {
  it('fills every field', () => {
    const r = seasoned(4, 30, { upgrades: ['staff'], rep: 60 });
    const a = afternoon(r, { ...r.plan, price: 31, tea: 'premium' });
    const e = evening(a, [['tax', 'B'], ['inspection', 'A']]);
    const p = a.rushResult!.player;
    const left = p.left.toppings.pearl + p.left.toppings.jelly + p.left.toppings.pudding;
    expect(last(e).summary).toStrictEqual({
      day: 4, openPrice: 31, closePrice: p.closePrice, tea: 'premium',
      bought: { teaMl: 5500, toppings: { pearl: 11, jelly: 8, pudding: 8 } }, used: p.used,
      wasteValue: (p.left.teaMl * 4) / 100 + 2 * left,
      cups: p.cups, wrong: p.wrong, walkouts: p.walkouts,
      revenue: p.revenue, cost: 220 + 54, tax: p.tax, fines: 0, profit: p.revenue - 274 - p.tax,
      cash: e.cash, rep: e.rep, score: e.cash - 300 + e.rep * CONFIG.run.brandPerRep,
      upgrade: null, cards: [{ id: 'tax', choice: 'B' }, { id: 'inspection', choice: 'A' }],
      labels: ['taxEvaded', 'inspectPass'], lost: false,
    });
    expect(e.cash).toBe(a.cash + p.tax - 40);
    const sum = eveningItems(e).reduce((s, i) => s + i.delta, 0);
    expect(e.rep).toBe(Math.max(0, Math.min(100, a.rep + sum)));
  });

  it("labels today's choices: skimping, the shock toppings, the black market, the inspection", () => {
    const r = run();
    expect(last(quiet(r, { ...r.plan, tea: 'skimp' }, {}, [['cartel', 'A']])).summary.labels).toEqual(['skimp']);
    expect(last(quiet(r, { ...zero(r), tea: 'skimp' })).summary.labels).toEqual([]);
    expect(last(quiet(seasoned(2), seasoned(2).plan, {}, [['shockTopping', 'A']])).summary.labels)
      .toEqual(['shockTopping']);
    const d3 = seasoned(3, 20, { flags: shock() });
    // R33: `skimp` means skimp tea; a shock-topping day is a skimp day for the rumor, but earns no `skimp` label.
    expect(last(quiet(d3, at20(d3), {}, [['blackMarket', 'A']])).summary.labels).toEqual(['blackMarket']);
    expect(last(quiet(d3, { ...at20(d3), tea: 'skimp' })).summary.labels).toEqual(['skimp']);
    expect(quiet(d3, at20(d3)).skimpDays).toBe(1);
    expect(last(quiet(d3, { ...zero(d3), teaMl: 250 }, {}, [['blackMarket', 'B']])).summary.labels).toEqual([]);
    const d4 = seasoned(4, 30, { skimpDays: 2 });
    expect(last(quiet(d4, d4.plan, {}, [['tax', 'A'], ['inspection', 'A']])).summary.labels).toEqual(['inspectFail']);
  });
});

describe('closeDay: the lesson card (§3, §8)', () => {
  const streetPrices = (e: RunState, key: 'openPrice' | 'closePrice') =>
    last(e).street.flatMap(s => (s[key] === null ? [] : [s[key] as number]));
  const avg = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) * 2) / xs.length) / 2;

  it("day 1, free market: the street's opening and closing price ranges, the player included", () => {
    const e = quiet(run());
    const open = streetPrices(e, 'openPrice');
    const close = streetPrices(e, 'closePrice');
    expect(open).toHaveLength(6);
    expect(last(e).lesson).toStrictEqual({ id: 'freeMarket', data: {
      openMin: Math.min(...open), openMax: Math.max(...open), closeMin: Math.min(...close), closeMax: Math.max(...close),
    } });
    const opens = [CONFIG.morning.defaultPrice, ...Object.values(CONFIG.aiShops).flatMap(s => (s.firstDay === 1 ? [s.openPrice!] : []))];
    expect(last(e).lesson.data).toMatchObject({ openMin: Math.min(...opens), openMax: Math.max(...opens) });
    expect([Math.min(...opens), Math.max(...opens)]).toEqual([28, 34]);   // GiáRẻ, Ông Cố Chấp 28k … Sinh Viên 34k
  });

  it('day 2: a variant for refusing, keeping and breaking the cartel, with the average closes and the fine', () => {
    const refused = quiet(seasoned(2, 30, { flags: flags({ cartel: 'refused' }) }));
    expect(last(refused).lesson).toStrictEqual({ id: 'entryRefused', data: {
      avgClose1: 28.5, avgClose2: avg(streetPrices(refused, 'closePrice')), fine: 0 } });
    const kept = quiet(seasoned(2, 36, { flags: agreed() }), { ...seasoned(2).plan, price: 36 });
    expect(last(kept).lesson).toStrictEqual({ id: 'cartelKept', data: {
      avgClose1: avg([27, 22, 30, 29, 34, 36]), avgClose2: avg(streetPrices(kept, 'closePrice')), fine: 150 } });
    const broke = quiet(seasoned(2, 36, { flags: agreed() }), { ...seasoned(2).plan, price: 30 });
    expect(last(broke).lesson.id).toBe('cartelBroke');
    expect(last(broke).lesson.data.fine).toBe(150);
  });

  it('day 3, price ceiling: customers who left empty-handed, of those who could pay, and the shops resting', () => {
    const r = seasoned(3, 20);
    const a = afternoon(r, at20(r));
    expect(last(evening(a)).lesson).toStrictEqual({ id: 'ceiling', data: {
      emptyHanded: a.rushResult!.emptyHanded, eligible: a.rushResult!.eligible, resting: 3 } });
    expect(a.rushResult!.emptyHanded).toBeGreaterThan(0);
  });

  it("day 4, tax: the ward's fund, the player's tax and whether it was evaded", () => {
    const a = afternoon(seasoned(4, 30, { upgrades: ['staff'] }));
    const data = (c: Choice) => last(evening(a, [['tax', c], ['inspection', 'B']])).lesson;
    const base = { taxFund: a.rushResult!.taxFund, tax: a.rushResult!.player.tax };
    expect(last(evening(a, [['tax', 'A'], ['inspection', 'B']])).taxFund).toBe(base.taxFund);
    expect(data('A')).toStrictEqual({ id: 'tax', data: { ...base, evaded: 0 } });
    expect(data('B')).toStrictEqual({ id: 'tax', data: { ...base, evaded: 1 } });
    expect(base.taxFund).toBeGreaterThan(base.tax);
  });

  it('day 5, rumor: customers without and with the bus stop, the scared, the certified and the named', () => {
    const r = seasoned(5, 30, { skimpDays: 2 });
    const o = openDay(r, r.plan);
    const rush = finishRush(o.rush).state;
    const e = evening(endRush(o.run, rush));
    const scared = rush.rt.filter(x => x.outcome === 'scared').length;
    expect(scared).toBeGreaterThan(0);
    expect(last(e).lesson).toStrictEqual({ id: 'rumor', data: {
      without: 130, with: 163, scared,
      certified: rush.shops.filter(s => s.certified).length, named: rush.shops.filter(s => s.named).length } });
    expect(last(e).lesson.data.named).toBe(2);   // Chuỗi GiáRẻ (4 days) and the player (2)
  });
});
