import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { applyChoice, cardsForDay, shuffleSideDeck } from './cards';
import { openDay, quickFill } from './day';
import { seasoned } from './day.fixtures';
import { finishRush, summarizeRush } from './rush';
import { deepFreeze } from './rush.fixtures';
import { endRush, newRun } from './run';
import type { RunState } from './types';

describe('newRun', () => {
  const run = newRun(42, 'run-1');

  it('starts on the morning of day 1 with the starting cash and reputation', () => {
    expect(run.v).toBe(1);
    expect(run.seed).toBe(42);
    expect(run.runId).toBe('run-1');
    expect(run.day).toBe(1);
    expect(run.phase).toBe('morning');
    expect(run.cash).toBe(300);
    expect(run.rep).toBe(50);
    expect(run.upgrades).toEqual([]);
    expect(run.skimpDays).toBe(0);
  });

  it('starts with no flags, effects, cards or reports', () => {
    expect(run.flags).toEqual({
      cartel: 'none', cartelBroken: false, shockTopping: false, blackMarket: false,
      taxEvaded: false, inspection: 'none', reporter: null,
    });
    expect(run.pending).toEqual([]);
    expect(run.sideDrawn).toEqual([]);
    expect(run.morningNews).toEqual([]);
    expect(run.today).toBeNull();
    expect(run.rushResult).toBeNull();
    expect(run.cards).toEqual([]);
    expect(run.cardIndex).toBe(0);
    expect(run.choices).toEqual([]);
    expect(run.cardRep).toEqual([]);
    expect(run.reports).toEqual([]);
    expect(run.outcome).toBeNull();
  });

  it('shuffles the side deck from the seed', () => {
    expect(run.sideDeck).toEqual(shuffleSideDeck(42));
    expect(newRun(43, 'run-1').sideDeck).toEqual(shuffleSideDeck(43));
  });

  it('opens the five day-1 AI shops; Chuỗi Tập Đoàn is not open yet', () => {
    expect(run.shops.map(s => [s.id, s.status])).toEqual([
      ['batu', 'active'], ['giare', 'active'], ['cochap', 'active'], ['luotsong', 'active'],
      ['sinhvien', 'active'], ['tapdoan', 'notYet'],
    ]);
    for (const s of run.shops) {
      expect(s.todayPrice).toBeNull();
      expect(s.resting).toBe(false);
      expect(s.history).toEqual([]);
      expect(s.closedOn).toBeNull();
    }
    expect(run.shops.find(s => s.id === 'sinhvien')!.probeDir).toBe(CONFIG.aiPricing.sinhvienFirstDir);
    expect(run.shops.find(s => s.id === 'sinhvien')!.probeDir).toBe(-1);
  });

  it('pre-fills day 1 at 30k, standard tea and the "mid" quick fill (§5)', () => {
    expect(run.plan).toEqual({ price: 30, tea: 'standard', upgrade: null, ...quickFill(run, 'mid') });
    expect(run.plan.teaMl).toBe(5500);
  });

  it('is plain data that survives a JSON round trip unchanged', () => {
    expect(JSON.parse(JSON.stringify(run))).toStrictEqual(run);
  });

  it('is deterministic', () => {
    expect(newRun(42, 'run-1')).toStrictEqual(run);
  });
});

/** Opens `run` with its own plan and plays the rush out with no player input. */
const played = (run: RunState) => {
  const opened = openDay(run, run.plan);
  return { opened: opened.run, rush: finishRush(opened.rush).state };
};

describe('endRush', () => {
  it('needs the rush phase and a finished rush', () => {
    const r = newRun(42, 'run-1');
    const opened = openDay(r, r.plan);
    expect(() => endRush(opened.run, opened.rush)).toThrow();
    const done = finishRush(opened.rush).state;
    expect(() => endRush(r, done)).toThrow();
    expect(() => endRush(endRush(opened.run, done), done)).toThrow();
  });

  it('credits the takings less the tax, keeps the day result and deals the afternoon cards (R27)', () => {
    const { opened, rush } = played(seasoned(4, 30, { upgrades: ['staff'] }));
    const result = summarizeRush(rush);
    expect(result.player.cups).toBeGreaterThan(0);
    expect(result.player.tax).toBe(result.player.cups * 5);
    const next = endRush(deepFreeze(opened), rush);
    expect(next.cash).toBe(opened.cash + result.player.revenue - result.player.tax);
    expect(next.rushResult).toStrictEqual(result);
    expect(next.phase).toBe('cards');
    expect(next.cards).toEqual(['tax', 'inspection']);
    expect(next.cardIndex).toBe(0);
  });

  it('pays the tax before the evade card refunds it (R27)', () => {
    const { opened, rush } = played(seasoned(4, 30, { upgrades: ['staff'] }));
    const afternoon = endRush(opened, rush);
    const evaded = applyChoice(afternoon, 'tax', 'B');
    expect(evaded.cash).toBe(opened.cash + afternoon.rushResult!.player.revenue);
  });

  it("deals day 1's side card, then the cartel", () => {
    const { opened, rush } = played(newRun(42, 'run-1'));
    const next = endRush(opened, rush);
    expect(next.cards).toEqual(cardsForDay(opened));
    expect(next.cards).toEqual([shuffleSideDeck(42)[0], 'cartel']);
    expect(next.cash).toBe(opened.cash + next.rushResult!.player.revenue);
  });

  it("starts the afternoon with no choices or card rep; earlier days' choices live in the reports", () => {
    const { opened, rush } = played(seasoned(3, 20, {
      plan: { ...newRun(7, 'x').plan, price: 20 },
      choices: [{ id: 'kol', choice: 'A' }, { id: 'shockTopping', choice: 'B' }],
      cardRep: [{ reason: 'complaint', delta: 3, when: 'evening' }],
      cardIndex: 2,
    }));
    const next = endRush(opened, rush);
    expect(next.choices).toEqual([]);
    expect(next.cardRep).toEqual([]);
    expect(next.cardIndex).toBe(0);
  });

  it('gives a run that survives a JSON round trip in the afternoon', () => {
    const { opened, rush } = played(seasoned(5, 30, { pending: [{ day: 5, source: 'tab', cash: 30, rep: 3 }] }));
    const next = endRush(opened, rush);
    expect(JSON.parse(JSON.stringify(next))).toStrictEqual(next);
  });
});
