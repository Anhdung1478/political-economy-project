// Hand-made run histories for the day tests (not a test file itself): the AI books and day reports that the
// evening (Task 10) writes, at fixed closing prices.
import { CONFIG } from './config';
import { newRun } from './run';
import { restsToday } from './shops';
import type {
  AiShopId, AiShopState, Day, DayReport, DayRules, DaySummary, K, RunState, ShopDayResult, ShopId, Stock,
} from './types';

/** Closing price of each AI shop on a free day; on a ceiling day it closes at the ceiling. */
export const AI_CLOSE: Record<AiShopId, K> = { batu: 27, giare: 22, cochap: 30, luotsong: 29, sinhvien: 34, tapdoan: 26.5 };
export const AI_SOLD = 10;
export const PLAYER_SOLD = 14;
export const USED: Stock = { teaMl: 5100, toppings: { pearl: 11, jelly: 6, pudding: 6 } };

const rulesOf = (day: Day): DayRules => {
  const d = CONFIG.days[day];
  return { day, ceiling: d.ceiling, taxPerCup: d.taxPerCup, rumor: d.rumor, cartel: false,
    customerFactor: d.customerFactor };
};

export const shopRow = (id: ShopId, closePrice: K | null, sold: number, capacity: number,
  over: Partial<ShopDayResult> = {}): ShopDayResult => ({
  id, status: closePrice === null ? 'resting' : 'open', openPrice: closePrice, closePrice,
  trail: closePrice === null ? [] : [[0, closePrice]], sold, capacity, soldOut: false, profit: null,
  revenue: (closePrice ?? 0) * sold, ...over,
});

export function report(day: Day, playerClose: K, street: ShopDayResult[], over: Partial<DaySummary> = {}): DayReport {
  const summary: DaySummary = {
    day, openPrice: playerClose, closePrice: playerClose, tea: 'standard',
    bought: { teaMl: 5500, toppings: { pearl: 11, jelly: 8, pudding: 8 } }, used: USED, wasteValue: 0,
    cups: PLAYER_SOLD, wrong: 0, walkouts: 0, revenue: 0, cost: 0, tax: 0, fines: 0, profit: 0, cash: 300, rep: 50,
    score: 0, upgrade: null, cards: [], labels: [], lost: false, ...over,
  };
  return { summary, repItems: [], repBefore: 50, street, emptyHanded: 0, eligible: 0, taxFund: 0,
    lesson: { id: `day${day}`, data: {} } };
}

/**
 * A run on the morning of `day` after days 1..day−1 played at fixed closes: each AI shop that was open sold
 * `AI_SOLD` at `AI_CLOSE` (capped by the ceiling) or rested; the player closed at `playerClose` (a number for every
 * day, or one per day) and sold `PLAYER_SOLD`.
 */
export function seasoned(day: Day, playerClose: K | Partial<Record<Day, K>> = 30, over: Partial<RunState> = {}):
  RunState {
  const base = newRun(7, 'day-test');
  const closeOf = (d: Day) => (typeof playerClose === 'number' ? playerClose : playerClose[d] ?? 30);
  const shops: AiShopState[] = base.shops.map(s => ({
    ...s, status: CONFIG.aiShops[s.id].firstDay < day ? 'active' : s.status, history: [],
  }));
  const reports: DayReport[] = [];
  for (let n = 1; n < day; n++) {
    const d = n as Day;
    const rules = rulesOf(d);
    const street: ShopDayResult[] = [];
    for (const s of shops) {
      if (CONFIG.aiShops[s.id].firstDay > d) continue;
      const rested = restsToday(s.id, rules);
      const close = rested ? null : Math.min(AI_CLOSE[s.id], rules.ceiling ?? Infinity);
      s.history.push({ day: d, closePrice: close, sold: rested ? 0 : AI_SOLD, profit: 0, rested });
      street.push(shopRow(s.id, close, rested ? 0 : AI_SOLD, rested ? 0 : CONFIG.aiShops[s.id].capacity));
    }
    street.push(shopRow('player', closeOf(d), PLAYER_SOLD, 0));
    reports.push(report(d, closeOf(d), street));
  }
  return { ...base, day, shops, reports, ...over };
}
