// Test fixtures for the class-session protocol: a valid DaySummary and a full run of them.
import type { DaySummary } from './sim/types';

export function daySummary(over: Partial<DaySummary> = {}): DaySummary {
  return {
    day: 1, openPrice: 30, closePrice: 28, tea: 'standard',
    bought: { teaMl: 3000, toppings: { pearl: 10, jelly: 5, pudding: 0 } },
    used: { teaMl: 2500, toppings: { pearl: 8, jelly: 5, pudding: 0 } }, wasteValue: 4.5,
    cups: 20, wrong: 1, walkouts: 2,
    revenue: 560, cost: 300, tax: 0, fines: 0, profit: 260, cash: 760, rep: 55, score: 1310,
    upgrade: null, cards: [{ id: 'kol', choice: 'A' }], labels: ['skimp'], lost: false,
    ...over,
  };
}
