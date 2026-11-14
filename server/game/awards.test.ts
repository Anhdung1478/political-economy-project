import { describe, expect, it } from 'vitest';
import { computeAwards, type PlayerHistory } from './awards';

const p = (playerId: string, total: number, rounds: [number, number, number][]): PlayerHistory =>
  ({ playerId, total, rounds: rounds.map(([price, sold, unsold]) => ({ price, sold, unsold })) });

describe('computeAwards', () => {
  const players = [
    p('rich', 300, [[30, 10, 0], [20, 10, 0]]),
    p('cheap', 10, [[12, 10, 0], [11, 10, 0]]),
    p('shark', 40, [[50, 1, 9], [45, 0, 10]]),
  ];
  const byId = Object.fromEntries(computeAwards(players).map(a => [a.id, a]));
  it('tycoon = highest total', () => expect(byId.tycoon.playerId).toBe('rich'));
  it('saint = lowest average price', () => expect(byId.saint.playerId).toBe('cheap'));
  it('shark = highest price that still sold', () => {
    expect(byId.shark.playerId).toBe('shark');
    expect(byId.shark.detail).toContain('50k');
  });
  it('hoarder = most unsold', () => expect(byId.hoarder.playerId).toBe('shark'));
  it('skips awards with no eligible player', () => {
    expect(computeAwards([])).toEqual([]);
    const ids = computeAwards([p('x', 0, [[50, 0, 0]])]).map(a => a.id);
    expect(ids).not.toContain('shark');
    expect(ids).not.toContain('hoarder');
  });
});
