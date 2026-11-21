import { describe, expect, it } from 'vitest';
import { CONFIG, type SimConfig } from './config';
import { customerCount, generateAdCustomers, generateCustomers } from './customers';
import type { Customer, Day, Size, ToppingId } from './types';

const SEEDS = [1, 2, 3, 42, 1234, 99999, 7, 2026];
const DAYS: Day[] = [1, 2, 3, 4, 5];

const many = (day: Day, seeds = SEEDS): Customer[] => seeds.flatMap(s => generateCustomers(s, day));
const share = (list: Customer[], pred: (c: Customer) => boolean) => list.filter(pred).length / list.length;

describe('customerCount', () => {
  it('is 130 on days 1–4 and 163 on day 5 (bus stop ×1.25)', () => {
    expect([1, 2, 3, 4, 5].map(d => customerCount(d as Day))).toEqual([130, 130, 130, 130, 163]);
  });

  it('follows the config base', () => {
    const tuned: SimConfig = { ...CONFIG, customers: { ...CONFIG.customers, base: 100 } };
    expect(customerCount(1, tuned)).toBe(100);
    expect(customerCount(5, tuned)).toBe(125);
  });

  it('generateCustomers makes that many customers with id = index', () => {
    for (const d of DAYS) {
      const list = generateCustomers(5, d);
      expect(list).toHaveLength(customerCount(d));
      list.forEach((c, i) => expect(c.id).toBe(i));
    }
  });
});

describe('generateCustomers is deterministic', () => {
  it('gives the same customers for the same seed and day', () => {
    expect(generateCustomers(77, 3)).toEqual(generateCustomers(77, 3));
  });

  it('gives different customers for another seed or another day', () => {
    expect(generateCustomers(77, 3)).not.toEqual(generateCustomers(78, 3));
    expect(generateCustomers(77, 3)).not.toEqual(generateCustomers(77, 4));
  });

  it('is plain data that survives JSON', () => {
    const list = generateCustomers(9, 5);
    expect(JSON.parse(JSON.stringify(list))).toEqual(list);
  });
});

describe('budget and trust are spread evenly (strata)', () => {
  it('budgets are multiples of 0.5 in [15, 60] and every 5k band holds about the same number', () => {
    for (const seed of SEEDS) {
      const list = generateCustomers(seed, 1);
      const bands = Array<number>(9).fill(0);
      for (const c of list) {
        expect(Number.isInteger(c.budget * 2)).toBe(true);
        expect(c.budget).toBeGreaterThanOrEqual(15);
        expect(c.budget).toBeLessThanOrEqual(60);
        bands[Math.min(8, Math.floor((c.budget - 15) / 5))]++;
      }
      // 130 / 9 ≈ 14.4 per band; a plain uniform draw would often miss this by 4+.
      for (const n of bands) {
        expect(n).toBeGreaterThanOrEqual(13);
        expect(n).toBeLessThanOrEqual(16);
      }
    }
  });

  it('trust is a whole number in [0, 50] and every 5-point band holds about the same number', () => {
    for (const seed of SEEDS) {
      const list = generateCustomers(seed, 5);
      const bands = Array<number>(10).fill(0);
      for (const c of list) {
        expect(Number.isInteger(c.trust)).toBe(true);
        expect(c.trust).toBeGreaterThanOrEqual(0);
        expect(c.trust).toBeLessThanOrEqual(50);
        bands[Math.min(9, Math.floor(c.trust / 5))]++;
      }
      // 163 / 10 ≈ 16.3 per band.
      for (const n of bands) {
        expect(n).toBeGreaterThanOrEqual(14);
        expect(n).toBeLessThanOrEqual(19);
      }
    }
  });

  it('budget and trust are not tied to each other or to the id', () => {
    const list = generateCustomers(3, 1);
    expect(list.map(c => c.budget)).not.toEqual([...list.map(c => c.budget)].sort((a, b) => a - b));
    const rich = list.filter(c => c.budget >= 37.5);
    const avgTrust = rich.reduce((s, c) => s + c.trust, 0) / rich.length;
    expect(avgTrust).toBeGreaterThan(18);
    expect(avgTrust).toBeLessThan(32);
  });
});

describe('orders', () => {
  const all = many(1);

  it('sizes are about S 25%, M 50%, L 25%', () => {
    const p = (s: Size) => share(all, c => c.order.size === s);
    expect(p('S')).toBeGreaterThan(0.21);
    expect(p('S')).toBeLessThan(0.29);
    expect(p('M')).toBeGreaterThan(0.46);
    expect(p('M')).toBeLessThan(0.54);
    expect(p('L')).toBeGreaterThan(0.21);
    expect(p('L')).toBeLessThan(0.29);
  });

  it('richer customers lean to L, poorer to S', () => {
    const poor = all.filter(c => c.budget < 30);
    const rich = all.filter(c => c.budget >= 45);
    expect(share(rich, c => c.order.size === 'L')).toBeGreaterThan(share(poor, c => c.order.size === 'L') + 0.1);
    expect(share(poor, c => c.order.size === 'S')).toBeGreaterThan(share(rich, c => c.order.size === 'S') + 0.1);
  });

  it('topping counts are about 0: 25%, 1: 40%, 2: 25%, 3: 10%', () => {
    const p = (n: number) => share(all, c => c.order.toppings.length === n);
    expect(p(0)).toBeGreaterThan(0.21);
    expect(p(0)).toBeLessThan(0.29);
    expect(p(1)).toBeGreaterThan(0.36);
    expect(p(1)).toBeLessThan(0.44);
    expect(p(2)).toBeGreaterThan(0.21);
    expect(p(2)).toBeLessThan(0.29);
    expect(p(3)).toBeGreaterThan(0.07);
    expect(p(3)).toBeLessThan(0.13);
  });

  it('toppings are distinct and stored pearl → jelly → pudding', () => {
    const order = CONFIG.customers.toppingOrder;
    for (const c of all) {
      const idx = c.order.toppings.map(t => order.indexOf(t));
      expect(idx.every(i => i >= 0)).toBe(true);
      for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
    }
  });

  it('pearl is ordered most, jelly and pudding about equally', () => {
    const p = (t: ToppingId) => share(all, c => c.order.toppings.includes(t));
    // Expected: pearl ≈ 0.69, jelly ≈ pudding ≈ 0.48.
    expect(p('pearl')).toBeGreaterThan(p('jelly') + 0.12);
    expect(p('pearl')).toBeGreaterThan(p('pudding') + 0.12);
    expect(Math.abs(p('jelly') - p('pudding'))).toBeLessThan(0.06);
  });

  it('about 20% order "không đá", on every day, across sizes', () => {
    for (const d of DAYS) {
      const p = share(many(d), c => c.order.noIce);
      expect(p, `day ${d}`).toBeGreaterThan(0.17);
      expect(p, `day ${d}`).toBeLessThan(0.23);
    }
    for (const s of ['S', 'M', 'L'] as Size[]) expect(all.some(c => c.order.size === s && c.order.noIce)).toBe(true);
    expect(generateAdCustomers(4, 2, 130, 40).some(c => c.order.noIce)).toBe(true);
  });

  it('the ice draw has its own stream: with no "không đá" at all, every other trait is the same', () => {
    const none: SimConfig = { ...CONFIG, customers: { ...CONFIG.customers, noIcePercent: 0 } };
    const strip = (list: Customer[]) => list.map(c => ({ ...c, order: { ...c.order, noIce: false } }));
    for (const seed of SEEDS.slice(0, 3)) {
      const plain = generateCustomers(seed, 2, none);
      expect(plain.some(c => c.order.noIce)).toBe(false);
      expect(strip(generateCustomers(seed, 2))).toEqual(plain);
      expect(strip(generateAdCustomers(seed, 2, 130, 6))).toEqual(generateAdCustomers(seed, 2, 130, 6, none));
    }
  });
});

describe('other traits', () => {
  it('skeptic is a whole number in 0..1000, tie in 0..6, look a whole number', () => {
    const all = many(2);
    for (const c of all) {
      expect(Number.isInteger(c.skeptic)).toBe(true);
      expect(c.skeptic).toBeGreaterThanOrEqual(0);
      expect(c.skeptic).toBeLessThanOrEqual(1000);
      expect(Number.isInteger(c.tie)).toBe(true);
      expect(c.tie).toBeGreaterThanOrEqual(0);
      expect(c.tie).toBeLessThanOrEqual(6);
      expect(Number.isInteger(c.look)).toBe(true);
      expect(c.onlyShop).toBeNull();
    }
    expect(new Set(all.map(c => c.tie)).size).toBe(7);
    const avgSkeptic = all.reduce((s, c) => s + c.skeptic, 0) / all.length;
    expect(avgSkeptic).toBeGreaterThan(450);
    expect(avgSkeptic).toBeLessThan(550);
    expect(share(all, c => c.skeptic < 250)).toBeGreaterThan(0.2);
    expect(share(all, c => c.skeptic < 250)).toBeLessThan(0.3);
  });

  it('every customer arrives on a whole tick before 750, spread across the window', () => {
    for (const d of DAYS) {
      const all = many(d);
      for (const c of all) {
        expect(Number.isInteger(c.arriveTick)).toBe(true);
        expect(c.arriveTick).toBeGreaterThanOrEqual(0);
        expect(c.arriveTick).toBeLessThan(750);
      }
      expect(share(all, c => c.arriveTick < 375)).toBeGreaterThan(0.45);
      expect(share(all, c => c.arriveTick < 375)).toBeLessThan(0.55);
    }
  });

  it('enter left or right about half each, no bus before day 5', () => {
    for (const d of [1, 2, 3, 4] as Day[]) {
      const all = many(d);
      expect(all.some(c => c.entry === 'bus')).toBe(false);
      expect(share(all, c => c.entry === 'left')).toBeGreaterThan(0.45);
      expect(share(all, c => c.entry === 'left')).toBeLessThan(0.55);
    }
  });

  it('about 20% come by bus on day 5, the rest split left and right', () => {
    const all = many(5);
    expect(share(all, c => c.entry === 'bus')).toBeGreaterThan(0.17);
    expect(share(all, c => c.entry === 'bus')).toBeLessThan(0.23);
    expect(share(all, c => c.entry === 'left')).toBeGreaterThan(0.36);
    expect(share(all, c => c.entry === 'left')).toBeLessThan(0.44);
  });
});

describe('scared customers (day 5 rumor, §16.8)', () => {
  it('about half of the arrivals before tick 450 are scared, none after', () => {
    const all = many(5);
    const early = all.filter(c => c.arriveTick < CONFIG.rumor.inspectionTick);
    expect(share(early, c => c.scared)).toBeGreaterThan(0.45);
    expect(share(early, c => c.scared)).toBeLessThan(0.55);
    expect(all.filter(c => c.arriveTick >= CONFIG.rumor.inspectionTick).some(c => c.scared)).toBe(false);
  });

  it('nobody is scared on days 1–4', () => {
    for (const d of [1, 2, 3, 4] as Day[]) expect(many(d).some(c => c.scared)).toBe(false);
  });
});

describe('generateAdCustomers (delivery-app card)', () => {
  const base = generateCustomers(11, 3);
  const ads = generateAdCustomers(11, 3, base.length, 6);

  it('makes count customers numbered from firstId, only for the player', () => {
    expect(ads).toHaveLength(6);
    ads.forEach((c, j) => {
      expect(c.id).toBe(base.length + j);
      expect(c.onlyShop).toBe('player');
      expect(c.trust).toBe(0);
      expect(c.scared).toBe(false);
    });
  });

  it('budgets are multiples of 0.5 in [40, 60], arrivals before 750', () => {
    const many = SEEDS.flatMap(s => generateAdCustomers(s, 2, 130, 6));
    for (const c of many) {
      expect(Number.isInteger(c.budget * 2)).toBe(true);
      expect(c.budget).toBeGreaterThanOrEqual(40);
      expect(c.budget).toBeLessThanOrEqual(60);
      expect(Number.isInteger(c.arriveTick)).toBe(true);
      expect(c.arriveTick).toBeGreaterThanOrEqual(0);
      expect(c.arriveTick).toBeLessThan(750);
      expect(c.order.toppings.length).toBeLessThanOrEqual(3);
    }
    expect(Math.min(...many.map(c => c.budget))).toBeLessThan(45);
    expect(Math.max(...many.map(c => c.budget))).toBeGreaterThan(55);
  });

  it('is deterministic and leaves the street customers unchanged', () => {
    expect(generateAdCustomers(11, 3, base.length, 6)).toEqual(ads);
    expect(generateCustomers(11, 3)).toEqual(base);
    expect(ads[0]).not.toEqual({ ...base[0], id: ads[0].id });
  });
});
