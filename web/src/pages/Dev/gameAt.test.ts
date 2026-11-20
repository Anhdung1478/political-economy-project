import { describe, expect, it } from 'vitest';
import { gameAt } from './gameAt';

describe('gameAt', () => {
  it('reaches each phase of the chosen day', () => {
    expect(gameAt(7, 1, 'morning').run).toMatchObject({ day: 1, phase: 'morning' });
    const rush = gameAt(7, 3, 'rush');
    expect(rush.run).toMatchObject({ day: 3, phase: 'rush' });
    expect(rush.rush?.tick).toBe(0);
    expect(rush.beforeOpen?.phase).toBe('morning');
    expect(gameAt(7, 2, 'cards').run).toMatchObject({ day: 2, phase: 'cards', cardIndex: 0 });
    const report = gameAt(7, 2, 'report').run;
    expect(report).toMatchObject({ day: 2, phase: 'report' });
    expect(report.reports).toHaveLength(2);
    expect(gameAt(7, 1, 'end').run.phase).toBe('end');
  });

  it('hands the morning over with the run\'s own plan as the draft', () => {
    const s = gameAt(11, 4, 'morning');
    expect(s.planDraft).toEqual(s.run.plan);
    expect(s.run.reports).toHaveLength(3);
  });

  it('answers the first cards, plays story combos and ends on a lost run (Task 21 shots)', () => {
    const s = gameAt(7, 1, 'cards', 'reasonable', 1);
    expect(s.run.cardIndex).toBe(1);
    expect(s.run.cards[1]).toBe('cartel');
    const kept = gameAt(7, 2, 'report', 'reasonable+cartel-keep+shock-B+black-B+tax-A+inspect-B');
    expect(kept.run.reports[1].lesson.id).toBe('cartelKept');
    const lost = gameAt(7, 1, 'end', 'plainS');
    expect(lost.run).toMatchObject({ phase: 'end', outcome: 'lostTrust' });
  });

  it('rejects an unknown strategy', () => {
    expect(() => gameAt(7, 1, 'morning', 'nope')).toThrow(/no strategy/);
  });
});
