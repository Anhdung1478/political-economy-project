import { describe, expect, it } from 'vitest';
import { customerBudgets, runMarket, type MarketInput } from './market';
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
    expect(out.shops[0]).toEqual({ playerId: 'a', price: 10, sold: 10, unsold: 0, profit: -50 });
  });

  it('collects tax per cup served', () => {
    const out = runMarket(base({ cost: 20, tax: 5, shops: [{ playerId: 'a', price: 30 }] }), mulberry32(1));
    expect(out.served).toBe(7);
    expect(out.taxCollected).toBe(35);
    expect(out.shops[0].profit).toBe(70);
  });

  it('handles zero customers and zero shops', () => {
    expect(runMarket(base({ customers: 0, shops: [{ playerId: 'a', price: 20 }] })).served).toBe(0);
    expect(runMarket(base({ shops: [] })).pricedOut).toBe(10);
  });
});
