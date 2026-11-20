// The street behind the screens that are not the rush (spec §9 "Cảnh phố": the live background of the morning and
// the evening). The scene draws a `RushState`, so this builds a street-only one from the run: the day's shops with
// their status (a grand opening, a shutter on a resting day, a "sang nhượng" sign on a shop gone), no customers (the
// ambient walkers are the scene's own, Task 17), and the prices the player already knows. Pure.
import { CONFIG, type SimConfig } from '../../../../shared/sim/config';
import { openDay } from '../../../../shared/sim/day';
import type { MorningPlan, RunState, RushState } from '../../../../shared/sim/types';
import type { Entrant } from './morning';
import { clampPrice } from './morning';

export interface StreetView {
  snapshot: RushState;
  /** AI shops opening today with their opening price (morning only). */
  entrants: Entrant[];
}

/** A plan that is always allowed: the price on today's range, no stock, no upgrade. */
function emptyPlan(run: RunState, price: number, cfg: SimConfig): MorningPlan {
  return {
    price: clampPrice(price, cfg.days[run.day].ceiling, cfg), tea: run.plan.tea, teaMl: 0, upgrade: null,
    toppings: { pearl: 0, jelly: 0, pudding: 0 },
  };
}

/** The rush state with nobody on the street and every board showing `priceOf(shop)`. */
function streetOnly(rush: RushState, priceOf: (id: string, today: number) => number): RushState {
  return {
    ...rush,
    customers: [], rt: [], arrivalOrder: [], nextArrival: 0, nextEnter: 0,
    shops: rush.shops.map(s => {
      if (s.price === 0) return { ...s, queue: [] };
      const price = priceOf(s.id, s.price);
      return { ...s, queue: [], price, openPrice: price, trail: [[0, price]] };
    }),
  };
}

/**
 * The street as the morning finds it: today's shops and statuses, the player's board at `playerPrice`, the AI boards
 * at yesterday's close held under today's ceiling (today's prices are theirs to show at lunch), a shop opening today
 * at its opening price.
 */
export function morningStreet(run: RunState, playerPrice: number = run.plan.price, cfg: SimConfig = CONFIG):
  StreetView | null {
  if (run.phase !== 'morning') return null;
  try {
    const plan = emptyPlan(run, playerPrice, cfg);
    const { rush } = openDay(run, plan, cfg);
    const entrants: Entrant[] = rush.shops
      .filter(s => s.grandOpening && s.price > 0)
      .map(s => ({ id: s.id, price: s.price }));
    const last = run.reports.find(r => r.summary.day === run.day - 1);
    const ceiling = cfg.days[run.day].ceiling ?? Infinity;
    const snapshot = streetOnly(rush, (id, today) => {
      if (id === 'player') return plan.price;
      if (entrants.some(e => e.id === id)) return today;
      return Math.min(ceiling, last?.street.find(s => s.id === id)?.closePrice ?? today);
    });
    // The preview plan buys nothing, but the player's shop is about to stock up, not sold out.
    snapshot.shops = snapshot.shops.map(s => (s.id === 'player' && s.status === 'soldOut' ? { ...s, status: 'open' } : s));
    return { snapshot, entrants };
  } catch {
    return null;
  }
}

/**
 * The street after lunch (afternoon cards, evening report, end): the day's shops priced as they closed. Built by
 * pricing a morning copy of the run (the shops' statuses after the evening's exits included) and putting each shop's
 * close from the day's result on its board.
 */
export function afternoonStreet(run: RunState, cfg: SimConfig = CONFIG): RushState | null {
  if (run.phase === 'morning' || run.phase === 'rush') return null;
  try {
    const morning: RunState = { ...run, phase: 'morning', pending: [], upgrades: [] };
    const result = run.rushResult?.shops ?? run.reports.find(r => r.summary.day === run.day)?.street ?? [];
    const playerClose = result.find(s => s.id === 'player')?.closePrice ?? run.plan.price;
    const { rush } = openDay(morning, emptyPlan(run, playerClose, cfg), cfg);
    const snap = streetOnly(rush, (id, today) => result.find(s => s.id === id)?.closePrice ?? today);
    // The player's shop as the lunch left it (sold out, closed early, or still open).
    const status = result.find(s => s.id === 'player')?.status ?? 'open';
    snap.shops = snap.shops.map(s => (s.id === 'player' ? { ...s, status } : s));
    return snap;
  } catch {
    return null;
  }
}
