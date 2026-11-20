import { describe, expect, it } from 'vitest';
import { daySummary } from '../shared/protocol.fixtures';
import type { DaySummary } from '../shared/sim/types';
import { type AwardEntry, computeAwards, totals } from './awards';

/** A player whose days carry the given values; `days` lists per-day overrides. */
function entry(playerId: string, days: Partial<DaySummary>[], order = Number(playerId.slice(1))): AwardEntry {
  return { playerId, name: playerId.toUpperCase(), order, days: days.map((d, i) => daySummary({ day: (i + 1) as DaySummary['day'], ...d })) };
}
const winner = (awards: ReturnType<typeof computeAwards>, id: string) => awards.find(a => a.id === id)?.playerId ?? null;

describe('totals', () => {
  it('sums the day counts and takes score, rep, price and profit (cash − start, R51) from the last day', () => {
    const t = totals([
      daySummary({ day: 1, profit: 100, cash: 400, wasteValue: 2, cups: 10, wrong: 1, walkouts: 3, score: 500, rep: 50, closePrice: 30 }),
      daySummary({ day: 2, profit: -20, cash: 450, wasteValue: 3, cups: 12, wrong: 2, walkouts: 0, score: 600, rep: 60, closePrice: 32 }),
    ]);
    // Σ daily profit is 80, but the upgrade and card money also moved the cash: profit is 450 − 300 = 150.
    expect(t).toMatchObject({ days: 2, profit: 150, waste: 5, cups: 22, wrong: 3, walkouts: 3, score: 600, rep: 60,
      lastPrice: 32, lost: false, finished: false });
  });
  it('is finished after day 5 or a lost day', () => {
    expect(totals([daySummary({ day: 1, lost: true })])).toMatchObject({ finished: true, lost: true });
    const five = [1, 2, 3, 4, 5].map(d => daySummary({ day: d as DaySummary['day'] }));
    expect(totals(five)).toMatchObject({ finished: true, lost: false });
  });
  it('has no score for a player with no days', () => {
    expect(totals([])).toMatchObject({ days: 0, score: null, rep: null, lastPrice: null, profit: null });
  });
});

describe('computeAwards', () => {
  it('gives nothing when nobody has sent a day', () => {
    expect(computeAwards([entry('p1', [])])).toEqual([]);
  });

  it('gives the four awards to the right players with their values', () => {
    const awards = computeAwards([
      entry('p1', [{ score: 900, rep: 40, wasteValue: 1, cups: 40, wrong: 4 }]),
      entry('p2', [{ score: 700, rep: 90, wasteValue: 2, cups: 40, wrong: 2 }]),
      entry('p3', [{ score: 500, rep: 30, wasteValue: 25, cups: 40, wrong: 8 }]),
    ]);
    expect(awards.map(a => a.id)).toEqual(['tycoon', 'beloved', 'hoarder', 'goldenHand']);
    expect(awards.map(a => [a.id, a.playerId, a.value])).toEqual([
      ['tycoon', 'p1', 900], ['beloved', 'p2', 90], ['hoarder', 'p3', 25], ['goldenHand', 'p2', 0.05],
    ]);
    expect(awards[0]).toMatchObject({ emoji: '🏆', title: 'Đại Gia Trân Châu', name: 'P1' });
  });

  it('uses the last day sent for score and rep, and sums waste over days', () => {
    const awards = computeAwards([
      entry('p1', [{ score: 2000, rep: 99, wasteValue: 10 }, { score: 100, rep: 10, wasteValue: 10 }]),
      entry('p2', [{ score: 500, rep: 50, wasteValue: 15 }]),
    ]);
    expect(winner(awards, 'tycoon')).toBe('p2');
    expect(winner(awards, 'beloved')).toBe('p2');
    expect(winner(awards, 'hoarder')).toBe('p1');
  });

  it('breaks a tycoon tie by higher total profit, cash − start (R53), not the sum of daily profit', () => {
    const awards = computeAwards([
      entry('p1', [{ score: 800, profit: 200, cash: 420 }]),
      entry('p2', [{ score: 800, profit: 50, cash: 300 }, { score: 800, profit: 90, cash: 430 }]),
    ]);
    expect(winner(awards, 'tycoon')).toBe('p2');
  });

  it('breaks a beloved tie by higher score', () => {
    const awards = computeAwards([
      entry('p1', [{ rep: 80, score: 600 }]),
      entry('p2', [{ rep: 80, score: 650 }]),
    ]);
    expect(winner(awards, 'beloved')).toBe('p2');
  });

  it('breaks a hoarder tie by higher score', () => {
    const awards = computeAwards([
      entry('p1', [{ wasteValue: 12, score: 600 }]),
      entry('p2', [{ wasteValue: 12, score: 650 }]),
    ]);
    expect(winner(awards, 'hoarder')).toBe('p2');
  });

  it('gives no hoarder award when nobody threw anything away', () => {
    const awards = computeAwards([entry('p1', [{ wasteValue: 0 }]), entry('p2', [{ wasteValue: 0 }])]);
    expect(winner(awards, 'hoarder')).toBeNull();
  });

  it('needs at least 30 cups for the golden hand', () => {
    const awards = computeAwards([
      entry('p1', [{ cups: 29, wrong: 0 }]),
      entry('p2', [{ cups: 30, wrong: 3 }]),
    ]);
    expect(winner(awards, 'goldenHand')).toBe('p2');
    expect(winner(computeAwards([entry('p1', [{ cups: 29, wrong: 0 }])]), 'goldenHand')).toBeNull();
  });

  it('counts cups over every day for the golden hand threshold', () => {
    const awards = computeAwards([entry('p1', [{ cups: 15, wrong: 0 }, { cups: 15, wrong: 0 }])]);
    expect(winner(awards, 'goldenHand')).toBe('p1');
  });

  it('breaks a golden-hand tie by more cups sold', () => {
    const awards = computeAwards([
      entry('p1', [{ cups: 40, wrong: 2 }]),
      entry('p2', [{ cups: 60, wrong: 3 }]),
    ]);
    expect(winner(awards, 'goldenHand')).toBe('p2');
  });

  it('falls back to join order when every rule ties', () => {
    const awards = computeAwards([entry('p2', [{}], 2), entry('p1', [{}], 1)]);
    for (const a of awards) expect(a.playerId).toBe('p1');
  });

  it('ignores players with no days', () => {
    const awards = computeAwards([entry('p1', []), entry('p2', [{ score: -50, rep: 1 }])]);
    expect(winner(awards, 'tycoon')).toBe('p2');
  });
});
