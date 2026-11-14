import type { ShopResult } from '../../shared/types';
import { shuffle } from './random';

export interface MarketInput {
  shops: { playerId: string; price: number }[];
  customers: number;
  wtpMin: number;
  wtpMax: number;
  capacity: number;
  cost: number;
  tax: number;
}
export interface MarketOutput {
  shops: ShopResult[];
  served: number;
  unserved: number;
  pricedOut: number;
  taxCollected: number;
}

export function customerBudgets(n: number, min: number, max: number): number[] {
  return Array.from({ length: n }, (_, i) => min + ((max - min) * (i + 0.5)) / n);
}

/**
 * Customers arrive in random order. Each buys one cup at the cheapest shop that
 * still has capacity and whose price fits the budget; ties go to the shop that
 * has sold the fewest cups so far.
 */
export function runMarket(input: MarketInput, random: () => number = Math.random): MarketOutput {
  const sold = new Map(input.shops.map(s => [s.playerId, 0]));
  // Shuffle first so the stable sort leaves equal-price shops in random order.
  const byPrice = shuffle(input.shops, random).sort((a, b) => a.price - b.price);
  const budgets = shuffle(customerBudgets(input.customers, input.wtpMin, input.wtpMax), random);
  let served = 0, unserved = 0, pricedOut = 0;

  for (const budget of budgets) {
    const affordable = byPrice.filter(s => s.price <= budget);
    if (affordable.length === 0) { pricedOut++; continue; }
    const open = affordable.filter(s => sold.get(s.playerId)! < input.capacity);
    if (open.length === 0) { unserved++; continue; }
    let pick = open[0];
    for (const s of open) {
      if (s.price !== open[0].price) break;
      if (sold.get(s.playerId)! < sold.get(pick.playerId)!) pick = s;
    }
    sold.set(pick.playerId, sold.get(pick.playerId)! + 1);
    served++;
  }

  const shops = input.shops.map(s => {
    const n = sold.get(s.playerId)!;
    return { playerId: s.playerId, price: s.price, sold: n, unsold: input.capacity - n, profit: (s.price - input.cost) * n };
  });
  return { shops, served, unserved, pricedOut, taxCollected: served * input.tax };
}
