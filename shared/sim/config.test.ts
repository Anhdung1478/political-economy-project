import { describe, expect, it } from 'vitest';
import { CONFIG, type SimConfig } from './config';
import { customerCount } from './customers';
import { teaMlFor } from './rush';
import { restsToday } from './shops';
import type { AiShopId, Day, DayRules, Size } from './types';

const SIZES: Size[] = ['S', 'M', 'L'];
const AI_IDS = Object.keys(CONFIG.aiShops) as AiShopId[];

/** Player cups in one rush without upgrades, per spec section 4 ("khoảng 18 ly"). */
const playerCups = (cfg: SimConfig) => Math.floor(cfg.rush.ticks / cfg.craft.cupTicksEstimate);

/** Whether an AI shop sits the day out under that day's schedule (no cartel). */
const rests = (id: AiShopId, day: Day, cfg: SimConfig) => {
  const d = cfg.days[day];
  const rules: DayRules = { day, ceiling: d.ceiling, taxPerCup: d.taxPerCup, rumor: d.rumor, cartel: false,
    customerFactor: d.customerFactor };
  return restsToday(id, rules, cfg);
};

const streetCapacity = (day: Day, cfg: SimConfig) =>
  playerCups(cfg) +
  AI_IDS.filter(id => cfg.aiShops[id].firstDay <= day && !rests(id, day, cfg))
    .reduce((sum, id) => sum + cfg.aiShops[id].capacity, 0);

/** Expected animation ticks of an average ordered cup (size, ice unless "không đá", tea, toppings, deliver). */
const averageCupAnimation = (cfg: SimConfig, teaTicks: Record<Size, number>) => {
  const c = cfg.customers;
  const sizeShare: Record<Size, number> = {
    S: 1 - c.size.mediumShare - c.size.largeBase,
    M: c.size.mediumShare,
    L: c.size.largeBase,
  };
  const tea = SIZES.reduce((sum, s) => sum + sizeShare[s] * teaTicks[s], 0);
  const toppings = c.toppingCountPercent.reduce((sum, p, i) => sum + (p / 100) * i, 0);
  const ice = (1 - c.noIcePercent / 100) * cfg.craft.iceTicks;
  return cfg.craft.sizeTicks + ice + tea + toppings * cfg.craft.toppingTicks + cfg.craft.deliverTicks;
};

const tickEntries = (node: unknown, path: string[] = []): [string, unknown][] => {
  if (Array.isArray(node)) return node.flatMap((v, i) => tickEntries(v, [...path, String(i)]));
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => tickEntries(v, [...path, k]));
  }
  return path.some(p => /tick/i.test(p)) ? [[path.join('.'), node]] : [];
};

describe('CONFIG street capacity (spec section 4)', () => {
  it('player makes about 18 cups, about 21 with the machine, staff adds about 10', () => {
    expect(playerCups(CONFIG)).toBe(18);
    const saved = averageCupAnimation(CONFIG, CONFIG.craft.teaTicks) -
      averageCupAnimation(CONFIG, CONFIG.craft.machineTeaTicks);
    expect(Math.floor(CONFIG.rush.ticks / (CONFIG.craft.cupTicksEstimate - saved))).toBe(21);
    expect(Math.floor(CONFIG.rush.ticks / CONFIG.craft.staffTicks)).toBe(10);
  });

  it('is 78 cups on day 1 (player + 5 AI shops)', () => {
    expect(AI_IDS.filter(id => CONFIG.aiShops[id].firstDay <= 1)).toHaveLength(5);
    expect(streetCapacity(1, CONFIG)).toBe(78);
  });

  it('is 96 cups on day 2 once Chuỗi Tập Đoàn opens', () => {
    expect(CONFIG.aiShops.tapdoan.firstDay).toBe(2);
    expect(streetCapacity(2, CONFIG)).toBe(96);
  });

  it('is 60 cups on day 3: 20k ceiling, Ông Cố Chấp, Lướt Sóng and Sinh Viên rest', () => {
    expect(CONFIG.days[3].ceiling).toBe(20);
    expect(AI_IDS.filter(id => rests(id, 3, CONFIG))).toEqual(['cochap', 'luotsong', 'sinhvien']);
    expect(streetCapacity(3, CONFIG)).toBe(60);
  });

  it('AI service fits inside the rush', () => {
    for (const id of AI_IDS) {
      const s = CONFIG.aiShops[id];
      expect(s.capacity * s.ticksPerCup).toBeLessThanOrEqual(CONFIG.rush.ticks);
    }
  });
});

describe('CONFIG craft timings (spec section 6)', () => {
  it('an average cup animates for about 37.6 ticks (a quarter take no topping, a fifth no ice)', () => {
    const avg = averageCupAnimation(CONFIG, CONFIG.craft.teaTicks);
    expect(avg).toBeGreaterThan(37);
    expect(avg).toBeLessThan(38.5);
  });

  it('the machine pours tea in exactly half the ticks, as whole ticks', () => {
    for (const s of SIZES) {
      expect(Number.isInteger(CONFIG.craft.machineTeaTicks[s])).toBe(true);
      expect(CONFIG.craft.machineTeaTicks[s] * 2).toBe(CONFIG.craft.teaTicks[s]);
    }
  });

  it('every duration and tick mark is a positive whole number of ticks', () => {
    const entries = tickEntries(CONFIG);
    expect(entries.length).toBeGreaterThan(15);
    for (const [path, value] of entries) {
      expect(Number.isInteger(value), path).toBe(true);
      expect(value as number, path).toBeGreaterThan(0);
    }
  });

  it('mid-rush checkpoints, entry lead and the inspection fall inside the rush', () => {
    const inside = (t: number) => t > 0 && t < CONFIG.rush.ticks;
    expect(CONFIG.midRush.checkpoints.map(c => c.tick).every(inside)).toBe(true);
    expect(inside(CONFIG.rumor.inspectionTick)).toBe(true);
    expect(CONFIG.rush.arrivalWindowTicks).toBeLessThan(CONFIG.rush.ticks);
    expect(CONFIG.rush.enterLeadTicks).toBeLessThan(CONFIG.rush.arrivalWindowTicks);
  });
});

describe('CONFIG tea per cup (§4, §6)', () => {
  it('a cup with no ice takes 200, 300, 400 ml: about 80% of the size, in 50 ml so its tea is worth whole 0.5k', () => {
    expect(SIZES.map(s => teaMlFor(s, false))).toEqual([200, 300, 400]);
    expect(SIZES.map(s => teaMlFor(s, true))).toEqual(SIZES.map(s => CONFIG.supplies.sizeMl[s]));
    for (const s of SIZES) {
      const dry = CONFIG.supplies.noIceMl[s];
      expect(dry % 50).toBe(0);
      expect(dry / CONFIG.supplies.sizeMl[s]).toBeGreaterThanOrEqual(0.75);
      expect(dry / CONFIG.supplies.sizeMl[s]).toBeLessThanOrEqual(0.9);
      for (const g of Object.values(CONFIG.supplies.teaGrades)) expect(Number.isInteger(dry * g.costPer100Ml / 50)).toBe(true);
    }
  });

  it('the sold-out sign hangs below the smallest cup, an S with no ice', () => {
    expect(CONFIG.supplies.soldOutBelowMl).toBe(Math.min(...SIZES.flatMap(s => [teaMlFor(s, true), teaMlFor(s, false)])));
  });
});

describe('CONFIG money', () => {
  it('prices, costs and card cash are multiples of 0.5k', () => {
    const money = [
      CONFIG.run.startCash, CONFIG.run.creditFloor, CONFIG.run.brandPerRep,
      CONFIG.pricing.toppingSurcharge, ...Object.values(CONFIG.pricing.sizeSurcharge),
      CONFIG.supplies.toppingCost, ...Object.values(CONFIG.supplies.teaGrades).map(g => g.costPer100Ml),
      ...Object.values(CONFIG.upgrades).map(u => u.cost),
      ...AI_IDS.flatMap(id => [CONFIG.aiShops[id].cost, CONFIG.aiShops[id].openPrice ?? 0]),
      CONFIG.aiPricing.rent, CONFIG.cards.cartel.price, CONFIG.cards.cartel.fine,
      CONFIG.cards.shockTopping.toppingCost, CONFIG.cards.blackMarket.cash, CONFIG.cards.inspection.cost,
      CONFIG.cards.kol.acceptCash, CONFIG.cards.tab.acceptCash, CONFIG.cards.tab.repayCash,
      CONFIG.cards.student.acceptCash, CONFIG.cards.complaint.acceptCash,
      CONFIG.cards.deliveryAd.acceptCash, CONFIG.cards.scholarship.acceptCash,
      ...([1, 2, 3, 4, 5] as Day[]).flatMap(d => [CONFIG.days[d].taxPerCup, CONFIG.days[d].ceiling ?? 0]),
    ];
    for (const k of money) expect(Number.isInteger(k * 2), String(k)).toBe(true);
  });
});

describe('CONFIG day schedule (spec section 3)', () => {
  it('has the five days with their rules', () => {
    const d = CONFIG.days;
    expect([d[1].ceiling, d[2].ceiling, d[3].ceiling, d[4].ceiling, d[5].ceiling]).toEqual([null, null, 20, null, null]);
    expect([d[1].taxPerCup, d[2].taxPerCup, d[3].taxPerCup, d[4].taxPerCup, d[5].taxPerCup]).toEqual([0, 0, 0, 5, 0]);
    expect([d[1].rumor, d[2].rumor, d[3].rumor, d[4].rumor, d[5].rumor]).toEqual([false, false, false, false, true]);
    expect([d[1].cartelPossible, d[2].cartelPossible, d[3].cartelPossible, d[4].cartelPossible, d[5].cartelPossible])
      .toEqual([false, true, false, false, false]);
    expect(([1, 2, 3, 4, 5] as Day[]).map(day => customerCount(day))).toEqual([130, 130, 130, 130, 163]);
  });

  it('deals the story cards of each day in order, side cards on days 1–3', () => {
    const d = CONFIG.days;
    expect([d[1].storyCards, d[2].storyCards, d[3].storyCards, d[4].storyCards, d[5].storyCards])
      .toEqual([['cartel'], ['shockTopping'], ['blackMarket'], ['tax', 'inspection'], ['reporter']]);
    expect([d[1].sideCard, d[2].sideCard, d[3].sideCard, d[4].sideCard, d[5].sideCard])
      .toEqual([true, true, true, false, false]);
  });
});

describe('CONFIG is tunable', () => {
  it('accepts a modified copy as a SimConfig', () => {
    const tuned: SimConfig = { ...CONFIG, rush: { ...CONFIG.rush, patienceTicks: 200 } };
    expect(tuned.rush.patienceTicks).toBe(200);
    expect(CONFIG.rush.patienceTicks).toBe(250);
  });
});
