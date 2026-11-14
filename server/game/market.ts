import type { ShopResult } from '../../shared/types';
import { shuffle } from './random';

export interface MarketShop {
  playerId: string;
  price: number;
  /** Cost per cup paid by this shop; defaults to the round's cost. */
  cost?: number;
  /** Most cups customers buy here; defaults to the round's capacity. */
  capacity?: number;
  /** Customers who buy here first whatever the other prices (loyal fans). */
  loyal?: number;
}
export interface MarketInput {
  shops: MarketShop[];
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
 * Loyal fans buy first: each takes the poorest remaining customer who can afford the
 * shop's price (or the richest left if nobody can, since loyalty is guaranteed).
 * Then the rest queue by budget, richest first. Each buys one cup at the cheapest shop
 * that still has capacity and whose price fits the budget; ties go to the shop that
 * has sold the fewest cups so far. A customer who cannot buy is a shortage
 * (`unserved`) only when every shop is sold out and they could afford the cheapest
 * price; otherwise they were priced out.
 */
export function runMarket(input: MarketInput, random: () => number = Math.random): MarketOutput {
  const cap = new Map(input.shops.map(s => [s.playerId, Math.max(0, s.capacity ?? input.capacity)]));
  const sold = new Map(input.shops.map(s => [s.playerId, 0]));
  const loyalSold = new Map(input.shops.map(s => [s.playerId, 0]));
  const room = (id: string) => sold.get(id)! < cap.get(id)!;
  // Shuffle first so the stable sort leaves equal-price shops in random order.
  const byPrice = shuffle(input.shops, random).sort((a, b) => a.price - b.price);
  const budgets = customerBudgets(input.customers, input.wtpMin, input.wtpMax).reverse(); // richest first
  let served = 0, unserved = 0, pricedOut = 0;

  for (const s of byPrice) {
    for (let k = 0; k < (s.loyal ?? 0) && room(s.playerId) && budgets.length > 0; k++) {
      let at = -1;
      for (let i = budgets.length - 1; i >= 0; i--) if (budgets[i] >= s.price) { at = i; break; }
      budgets.splice(at >= 0 ? at : 0, 1);
      sold.set(s.playerId, sold.get(s.playerId)! + 1);
      loyalSold.set(s.playerId, loyalSold.get(s.playerId)! + 1);
      served++;
    }
  }

  const minPrice = byPrice.length ? byPrice[0].price : Infinity;
  for (const budget of budgets) {
    const open = byPrice.filter(s => s.price <= budget && room(s.playerId));
    if (open.length === 0) {
      const allSoldOut = byPrice.every(s => !room(s.playerId));
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
    const n = sold.get(s.playerId)!, c = cap.get(s.playerId)!, cost = s.cost ?? input.cost;
    return { playerId: s.playerId, price: s.price, sold: n, unsold: c - n, profit: (s.price - cost) * n, cost, capacity: c, loyal: loyalSold.get(s.playerId)! };
  });
  return { shops, served, unserved, pricedOut, taxCollected: served * input.tax };
}

/**
 * Market-clearing price: the price at which the customers who can afford it exactly fill
 * every shop's capacity. Shops at or below it sell out; above it they lose customers.
 * Never below cost + 1k (nobody should sell at a loss) and never above the round's cap.
 */
export function clearingPrice(o: { customersPerShop: number; wtpMin: number; wtpMax: number; capacity: number; cost: number; maxPrice: number }): number {
  const p = o.customersPerShop > 0 ? Math.floor(o.wtpMax - ((o.wtpMax - o.wtpMin) * o.capacity) / o.customersPerShop) : 0;
  return Math.min(o.maxPrice, Math.max(o.cost + 1, p));
}
