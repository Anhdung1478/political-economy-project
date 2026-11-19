import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { applyChoice, cardsForDay, shuffleSideDeck } from './cards';
import { closeDay, openDay, quickFill, validatePlan } from './day';
import { seasoned } from './day.fixtures';
import { finishRush, summarizeRush } from './rush';
import { deepFreeze } from './rush.fixtures';
import { chooseCard, endRush, ending, newRun, nextDay, score } from './run';
import type { ChoiceLabel, Choice, Day, MorningPlan, RepItem, RunState } from './types';

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

/** `r` played to the afternoon with plan `p` and no input. */
const afternoonOf = (r: RunState, p: MorningPlan = r.plan) => {
  const { opened, rush } = played({ ...r, plan: p });
  return endRush(opened, rush);
};
/** `r` played to the evening report, answering every card with `choice`. */
const reportOf = (r: RunState, p: MorningPlan = r.plan, choice: Choice = 'B') => {
  let a = afternoonOf(r, p);
  while (a.phase === 'cards') a = chooseCard(a, choice);
  return a;
};

describe('chooseCard', () => {
  const a = afternoonOf(newRun(42, 'run-1'));

  it('needs the afternoon with a card left', () => {
    expect(a.cards).toHaveLength(2);
    expect(() => chooseCard({ ...a, phase: 'report' }, 'A')).toThrow();
    expect(() => chooseCard({ ...a, phase: 'morning' }, 'A')).toThrow();
    expect(() => chooseCard({ ...a, cardIndex: 2 }, 'A')).toThrow();
  });

  it('applies the choice to the card in hand and moves to the next, the day still open', () => {
    const next = chooseCard(deepFreeze(a), 'B');
    expect(next).toStrictEqual({ ...applyChoice(a, a.cards[0], 'B'), cardIndex: 1 });
    expect(next.phase).toBe('cards');
  });

  it('plays the cards dealt this afternoon, not a fresh deal (the side deck moved on)', () => {
    const first = chooseCard(a, 'A');
    expect(cardsForDay(first)).not.toEqual(a.cards);
    const done = chooseCard(first, 'A');
    expect(done.reports[0].summary.cards).toEqual([{ id: a.cards[0], choice: 'A' }, { id: 'cartel', choice: 'A' }]);
    expect(done.flags.cartel).toBe('agreed');
  });

  it('closes the day after the last card and moves to the report', () => {
    const done = chooseCard(chooseCard(a, 'A'), 'B');
    const chosen = applyChoice(applyChoice(a, a.cards[0], 'A'), 'cartel', 'B');
    expect(done).toStrictEqual(closeDay({ ...chosen, cardIndex: 2 }));
    expect(done.phase).toBe('report');
    expect(done.reports).toHaveLength(1);
    expect(() => chooseCard(done, 'A')).toThrow();
  });
});

describe('nextDay', () => {
  it('needs the evening report', () => {
    const a = afternoonOf(newRun(42, 'run-1'));
    expect(() => nextDay(a)).toThrow();
    expect(() => nextDay(newRun(42, 'run-1'))).toThrow();
  });

  it("moves to the next morning with yesterday's amounts, no upgrade, and a fresh day", () => {
    const r = newRun(42, 'run-1');
    const rep = reportOf(r, { ...r.plan, price: 33, tea: 'premium', upgrade: 'staff' });
    const next = nextDay(deepFreeze(rep));
    expect(next).toStrictEqual({
      ...rep, day: 2, phase: 'morning', plan: { ...rep.plan, upgrade: null },
      today: null, rushResult: null, cards: [], cardIndex: 0, choices: [], cardRep: [], morningNews: [],
    });
    expect(next.plan).toMatchObject({ price: 33, tea: 'premium', teaMl: r.plan.teaMl, upgrade: null });
    expect(next.upgrades).toEqual(['staff']);
  });

  it("brings the price under day 3's ceiling, and keeps it when the range is restored on day 4", () => {
    const d2 = seasoned(2);
    const day3 = nextDay(reportOf(d2, { ...d2.plan, price: 30 }));
    expect(day3.plan.price).toBe(20);
    expect(validatePlan(day3, day3.plan)).toEqual([]);
    expect(nextDay(reportOf(d2, { ...d2.plan, price: 15 })).plan.price).toBe(15);
    const d3 = seasoned(3, 20);
    const day4 = nextDay(reportOf(d3, { ...d3.plan, price: 20 }));
    expect(day4.plan.price).toBe(20);
    expect(validatePlan(day4, { ...day4.plan, price: 50 })).toEqual([]);
    const d4 = seasoned(4);
    expect(nextDay(reportOf(d4, { ...d4.plan, price: 50 })).plan.price).toBe(50);
  });

  it("lands the cartel break's gossip on the morning of day 3 (§7)", () => {
    const d2 = seasoned(2, 36, { flags: { ...newRun(1, 'x').flags, cartel: 'agreed' } });
    const day3 = nextDay(reportOf(d2, { ...d2.plan, price: 30 }));
    expect(day3.pending).toEqual([{ day: 3, source: 'cartelBreak', rep: -8 }]);
    const opened = openDay(day3, { ...day3.plan, teaMl: 0, toppings: { pearl: 0, jelly: 0, pudding: 0 } }).run;
    expect(opened.morningNews).toEqual([{ reason: 'cartel', delta: -8, when: 'morning' }]);
    expect(opened.rep).toBe(day3.rep - 8);
  });

  it('ends the run after the evening of day 5', () => {
    const rep = reportOf(seasoned(5));
    expect(rep.outcome).toBeNull();
    const end = nextDay(rep);
    expect(end).toStrictEqual({ ...rep, phase: 'end', outcome: 'finished' });
    expect(() => nextDay(end)).toThrow();
  });

  it('ends the run after an evening that lost all trust, whatever the day', () => {
    const r = seasoned(3, 20, { rep: 2 });
    const rep = reportOf(r, { ...r.plan, price: 20, tea: 'skimp' });
    expect(rep.outcome).toBe('lostTrust');
    const end = nextDay(rep);
    expect(end).toStrictEqual({ ...rep, phase: 'end' });
    expect(end.day).toBe(3);
  });

  it('gives a run that survives a JSON round trip', () => {
    const next = nextDay(reportOf(seasoned(2)));
    expect(JSON.parse(JSON.stringify(next))).toStrictEqual(next);
  });
});

describe('score', () => {
  it('is the profit over the starting cash plus 8k a point of rep (§3)', () => {
    expect(score({ ...newRun(1, 'x'), cash: 450, rep: 60 })).toEqual({ profit: 150, brand: 480, total: 630 });
    expect(score({ ...newRun(1, 'x'), cash: -100.5, rep: 0 })).toEqual({ profit: -400.5, brand: 0, total: -400.5 });
    expect(score(newRun(1, 'x'))).toEqual({ profit: 0, brand: 400, total: 400 });
  });

  it("is the day summary's running score after each evening", () => {
    const rep = reportOf(seasoned(3, 20), { ...seasoned(3).plan, price: 20 });
    expect(rep.reports[2].summary.score).toBe(score(rep).total);
  });
});

describe('ending', () => {
  const r = seasoned(5);
  const days: { profit: number; labels: ChoiceLabel[]; repItems: RepItem[] }[] = [
    { profit: 10, labels: ['skimp'], repItems: [{ reason: 'tea', delta: -6, when: 'evening' }] },
    { profit: -20, labels: ['cartelBroke'],
      repItems: [{ reason: 'clean', delta: 3, when: 'evening' }, { reason: 'cartel', delta: -5, when: 'evening' }] },
    { profit: 30.5, labels: ['skimp', 'blackMarket'], repItems: [{ reason: 'cartel', delta: -8, when: 'morning' },
      { reason: 'walkout', delta: -3, count: 3, when: 'evening' }] },
    { profit: 0, labels: ['taxEvaded'], repItems: [{ reason: 'banner', delta: 10, when: 'morning' }] },
  ];
  const reports = r.reports.map((x, i) => ({
    ...x, repItems: days[i].repItems, summary: { ...x.summary, profit: days[i].profit, labels: days[i].labels },
  }));
  const shops = r.shops.map(s => (s.id === 'sinhvien' || s.id === 'batu'
    ? { ...s, status: 'closed' as const, closedOn: (s.id === 'batu' ? 4 : 3) as Day } : s));
  const end: RunState = { ...r, phase: 'end', outcome: 'finished', reports, shops };

  it('needs the end of the run', () => {
    expect(() => ending({ ...end, phase: 'report' })).toThrow();
  });

  it('tells the outcome, the shops that closed, what lost trust, the choice labels and the profit by day', () => {
    expect(ending(deepFreeze(end))).toStrictEqual({
      outcome: 'finished',
      closedShops: ['batu', 'sinhvien'],
      repLosses: [
        { day: 1, reason: 'tea', delta: -6, when: 'evening' },
        { day: 2, reason: 'cartel', delta: -5, when: 'evening' },
        { day: 3, reason: 'cartel', delta: -8, when: 'morning' },
        { day: 3, reason: 'walkout', delta: -3, count: 3, when: 'evening' },
      ],
      labels: ['skimp', 'cartelBroke', 'blackMarket', 'taxEvaded'],
      profitByDay: [10, -20, 30.5, 0],
    });
  });

  it('tells a run that lost all trust', () => {
    expect(ending({ ...end, outcome: 'lostTrust' }).outcome).toBe('lostTrust');
  });
});
