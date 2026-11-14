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
 * Customers queue by budget, richest first. Each buys one cup at the cheapest shop
 * that still has capacity and whose price fits the budget; ties go to the shop that
 * has sold the fewest cups so far. A customer who cannot buy is a shortage
 * (`unserved`) only when every shop is sold out and they could afford the cheapest
 * price; otherwise they were priced out.
 */
export function runMarket(input: MarketInput, random: () => number = Math.random): MarketOutput {
  const sold = new Map(input.shops.map(s => [s.playerId, 0]));
  // Shuffle first so the stable sort leaves equal-price shops in random order.
  const byPrice = shuffle(input.shops, random).sort((a, b) => a.price - b.price);
  const budgets = customerBudgets(input.customers, input.wtpMin, input.wtpMax).reverse();
  const minPrice = byPrice.length ? byPrice[0].price : Infinity;
  let served = 0, unserved = 0, pricedOut = 0;

  for (const budget of budgets) {
    const open = byPrice.filter(s => s.price <= budget && sold.get(s.playerId)! < input.capacity);
    if (open.length === 0) {
      const allSoldOut = byPrice.every(s => sold.get(s.playerId)! >= input.capacity);
      if (allSoldOut && budget >= minPrice) unserved++;
      else pricedOut++;
      continue;
    }
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
