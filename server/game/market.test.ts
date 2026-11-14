import { describe, expect, it } from 'vitest';
import { clearingPrice, customerBudgets, runMarket, type MarketInput } from './market';
import { mulberry32 } from './random';

const base = (over: Partial<MarketInput>): MarketInput => ({
  shops: [], customers: 10, wtpMin: 15, wtpMax: 60, capacity: 10, cost: 15, tax: 0, ...over,
});
// budgets for N=10: 17.25, 21.75, 26.25, 30.75, 35.25, 39.75, 44.25, 48.75, 53.25, 57.75

describe('customerBudgets', () => {
  it('spreads budgets evenly at bucket midpoints', () => {
    expect(customerBudgets(3, 15, 60)).toEqual([22.5, 37.5, 52.5]);
  });
});

describe('runMarket', () => {
  it('cheapest shop sells first; unaffordable customers are priced out', () => {
    const out = runMarket(base({ shops: [{ playerId: 'a', price: 20 }, { playerId: 'b', price: 40 }] }), mulberry32(1));
    const a = out.shops.find(s => s.playerId === 'a')!, b = out.shops.find(s => s.playerId === 'b')!;
    expect(a.sold).toBe(9);
    expect(b.sold).toBe(0);
    expect(out.pricedOut).toBe(1);
    expect(out.unserved).toBe(0);
    expect(out.served).toBe(9);
  });

  it('overflow spills to pricier shops and counts are conserved', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const out = runMarket(base({ capacity: 3, shops: [{ playerId: 'a', price: 20 }, { playerId: 'b', price: 40 }] }), mulberry32(seed));
      const [a, b] = out.shops;
      expect(a.sold).toBe(3);
      expect(b.sold).toBeLessThanOrEqual(3);
      expect(out.served + out.unserved + out.pricedOut).toBe(10);
    }
  });

  it('price ceiling style: all full → shortage counted as unserved', () => {
    const out = runMarket(base({ capacity: 2, shops: [{ playerId: 'a', price: 20 }, { playerId: 'b', price: 20 }] }), mulberry32(3));
    expect(out.served).toBe(4);
    expect(out.unserved).toBe(5);
    expect(out.pricedOut).toBe(1);
  });

  it('equal prices split customers evenly', () => {
    const out = runMarket(base({ shops: [{ playerId: 'a', price: 20 }, { playerId: 'b', price: 20 }] }), mulberry32(7));
    const [a, b] = out.shops;
    expect(a.sold + b.sold).toBe(9);
    expect(Math.abs(a.sold - b.sold)).toBeLessThanOrEqual(1);
  });

  it('profit = (price - cost) × sold, may be negative; unsold = capacity - sold', () => {
    const out = runMarket(base({ shops: [{ playerId: 'a', price: 10 }] }), mulberry32(1));
    expect(out.shops[0]).toEqual({ playerId: 'a', price: 10, sold: 10, unsold: 0, profit: -50, cost: 15, capacity: 10, loyal: 0 });
  });

  it('collects tax per cup served', () => {
    const out = runMarket(base({ cost: 20, tax: 5, shops: [{ playerId: 'a', price: 30 }] }), mulberry32(1));
    expect(out.served).toBe(7);
    expect(out.taxCollected).toBe(35);
    expect(out.shops[0].profit).toBe(70);
  });

  it('free market: richer customers fill the cheap shop first, an overpriced shop sells nothing, no fake shortage', () => {
    const out = runMarket(base({ customers: 15, shops: [{ playerId: 'fair', price: 30 }, { playerId: 'greedy', price: 45 }] }), mulberry32(2));
    const [fair, greedy] = out.shops;
    expect(fair.sold).toBe(10);
    expect(greedy.sold).toBe(0);
    expect(out.unserved).toBe(0);
    expect(out.pricedOut).toBe(5);
  });

  it('a cheap sold-out shop does not count pricier-shop refusals as shortage', () => {
    const out = runMarket(base({ capacity: 2, shops: [{ playerId: 'a', price: 10 }, { playerId: 'b', price: 50 }] }), mulberry32(4));
    expect(out.unserved).toBe(0);
    expect(out.served + out.pricedOut).toBe(10);
  });

  it('handles zero customers and zero shops', () => {
    expect(runMarket(base({ customers: 0, shops: [{ playerId: 'a', price: 20 }] })).served).toBe(0);
    expect(runMarket(base({ shops: [] })).pricedOut).toBe(10);
  });
});

describe('runMarket: skimping and loyalty', () => {
  it('charges each shop its own cost', () => {
    const out = runMarket(base({ shops: [{ playerId: 'a', price: 20, cost: 8 }], customers: 10 }), mulberry32(1));
    expect(out.shops[0].profit).toBe((20 - 8) * out.shops[0].sold);
  });

  it('caps a shop that lost reputation, sending customers elsewhere', () => {
    const out = runMarket(base({
      shops: [{ playerId: 'cheat', price: 16, capacity: 3 }, { playerId: 'b', price: 30 }], customers: 30,
    }), mulberry32(1));
    const [cheat, b] = out.shops;
    expect(cheat).toMatchObject({ sold: 3, capacity: 3, unsold: 0 });
    expect(b.sold).toBe(10);
  });

  it('guarantees loyal buyers even when a cheaper shop has room', () => {
    const out = runMarket(base({
      shops: [{ playerId: 'fan', price: 40, loyal: 2 }, { playerId: 'cheap', price: 15 }], customers: 5,
    }), mulberry32(1));
    expect(out.shops[0]).toMatchObject({ sold: 2, loyal: 2 });
    expect(out.shops[1].sold).toBe(3);
  });

  it('keeps loyalty even when no customer can afford the price', () => {
    const out = runMarket(base({ shops: [{ playerId: 'fan', price: 50, loyal: 2 }], customers: 2, wtpMax: 20 }), mulberry32(1));
    expect(out.shops[0].sold).toBe(2);
  });
});

describe('clearingPrice', () => {
  const o = { customersPerShop: 15, wtpMin: 15, wtpMax: 60, capacity: 10, cost: 15, maxPrice: 50 };
  it('is where demand fills capacity', () => expect(clearingPrice(o)).toBe(30));
  it('is capped by a price ceiling', () => expect(clearingPrice({ ...o, maxPrice: 20 })).toBe(20));
  it('never drops below cost + 1k', () => expect(clearingPrice({ ...o, customersPerShop: 7.5 })).toBe(16));
  it('is the best price for one shop when the others charge it', () => {
    const mine = (p: number) => runMarket(base({
      shops: [{ playerId: 'me', price: p }, ...Array.from({ length: 9 }, (_, i) => ({ playerId: `s${i}`, price: 30 }))], customers: 150,
    }), mulberry32(1)).shops[0].profit;
    expect(mine(30)).toBeGreaterThan(mine(28));
    expect(mine(30)).toBeGreaterThan(mine(32));
  });
});
