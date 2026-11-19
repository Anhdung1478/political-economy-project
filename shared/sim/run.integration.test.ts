// Whole runs played through the public run API only (openDay → finishRush → endRush → chooseCard… → nextDay), with a
// scripted plan and scripted card choices, checked at every phase.
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { morningBrief, openDay, quickFill, validatePlan } from './day';
import { finishRush } from './rush';
import { chooseCard, endRush, ending, newRun, nextDay, score } from './run';
import type { CardId, Choice, Day, LessonId, MorningPlan, Phase, RunState, TeaGrade } from './types';

interface Script {
  /** Price on days other than 2 and 3 (day 3 sells at the 20k ceiling). */
  price: number; day2Price: number; tea: TeaGrade;
  card: (id: CardId) => Choice;
}

const roundTrip = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const clamp = (rep: number) => Math.min(CONFIG.run.maxRep, Math.max(CONFIG.run.minRep, rep));
const sum = (xs: readonly { delta: number }[]) => xs.reduce((s, i) => s + i.delta, 0);

/** The morning plan of the script: "mid" stock, staff on day 1, no stock when the cash cannot pay for it. */
function planOf(run: RunState, s: Script): MorningPlan {
  const price = run.day === 3 ? 20 : run.day === 2 ? s.day2Price : s.price;
  const plan: MorningPlan = { ...run.plan, price, tea: s.tea, ...quickFill(run, 'mid'), upgrade: run.day === 1 ? 'staff' : null };
  return validatePlan(run, plan).length === 0 ? plan : { ...plan, teaMl: 0, toppings: { pearl: 0, jelly: 0, pudding: 0 } };
}

/** Plays the run to its end, checking the JSON round trip and the phase at every step. */
function play(seed: number, s: Script): RunState {
  let run = newRun(seed, `integration-${seed}`);
  const phases: Phase[] = [];
  const at = (r: RunState) => {
    expect(roundTrip(r)).toStrictEqual(r);
    phases.push(r.phase);
  };
  while (run.phase !== 'end') {
    at(run);
    const brief = morningBrief(run);
    const opened = openDay(run, planOf(run, s));
    at(opened.run);
    expect(opened.run.rep).toBe(brief.rep);   // no banner in the script
    run = endRush(opened.run, finishRush(opened.rush).state);
    while (run.phase === 'cards') {
      at(run);
      run = chooseCard(run, s.card(run.cards[run.cardIndex]));
    }
    at(run);
    run = nextDay(run);
  }
  at(run);
  // Each day: morning, rush, one cards phase per card, report; then the end.
  const expected = run.reports.flatMap(r =>
    ['morning', 'rush', ...r.summary.cards.map(() => 'cards'), 'report'] as Phase[]).concat('end');
  expect(phases).toEqual(expected);
  return run;
}

/** Checks every report against the run: money, rep, the AI books and the score. */
function checkReports(run: RunState) {
  let cash = CONFIG.run.startCash;
  let rep = CONFIG.run.startRep;
  run.reports.forEach((r, i) => {
    const s = r.summary;
    expect(s.day).toBe(i + 1);
    expect(s.profit).toBe(s.revenue - s.cost - s.tax - s.fines);
    expect(s.cash).toBe(cash + r.delayedCash - r.upgradeCost + s.profit + r.cardCash);
    expect(r.repBefore).toBe(rep);
    const morning = clamp(rep + sum(r.repItems.filter(x => x.when === 'morning')));
    expect(s.rep).toBe(clamp(morning + sum(r.repItems.filter(x => x.when === 'evening'))));
    expect(s.lost).toBe(s.rep === 0);
    expect(s.score).toBe(s.cash - CONFIG.run.startCash + s.rep * CONFIG.run.brandPerRep);
    for (const x of [s.revenue, s.cost, s.tax, s.fines, s.profit, s.cash, s.wasteValue, r.cardCash]) {
      expect(Number.isInteger(x * 2)).toBe(true);
    }
    cash = s.cash;
    rep = s.rep;
  });
  expect(run.cash).toBe(cash);
  expect(run.rep).toBe(rep);
  expect(score(run).total).toBe(run.reports[run.reports.length - 1].summary.score);

  // AI books: one entry for each day a shop sold or rested, none after it closed; two losing days before closing.
  for (const shop of run.shops) {
    const first = CONFIG.aiShops[shop.id].firstDay;
    const lastDay = shop.closedOn ?? run.reports.length;
    expect(shop.history.map(h => h.day)).toEqual(
      Array.from({ length: lastDay - first + 1 }, (_, k) => first + k));
    if (shop.status === 'closed') {
      expect(shop.history.slice(-CONFIG.aiPricing.exitLossDays).every(h => h.profit < 0)).toBe(true);
    }
    for (const h of shop.history) {
      const row = run.reports[h.day - 1].street.find(x => x.id === shop.id)!;
      expect(row.profit).toBe(h.profit);
    }
  }
  const end = ending(run);
  expect(end.profitByDay).toEqual(run.reports.map(r => r.summary.profit));
  expect(end.closedShops).toEqual(run.shops.filter(x => x.status === 'closed').map(x => x.id));
  expect(end.repLosses.every(x => x.delta < 0)).toBe(true);
}

/** Declines every offer and declares the tax; the cartel as given. */
const honest = (cartel: Choice): Script['card'] => id => (id === 'cartel' ? cartel : id === 'tax' ? 'A' : 'B');
const branches: { name: string; day2Price: number; cartel: Choice; id: LessonId }[] = [
  { name: 'refused', day2Price: 30, cartel: 'B', id: 'entryRefused' },
  { name: 'kept', day2Price: 36, cartel: 'A', id: 'cartelKept' },
  { name: 'broke', day2Price: 30, cartel: 'A', id: 'cartelBroke' },
];

describe('a whole run, five days', () => {
  for (const seed of [11, 12]) {
    for (const b of branches) {
      it(`plays seed ${seed} to the end with the cartel ${b.name}`, () => {
        const run = play(seed, { price: 30, day2Price: b.day2Price, tea: 'standard', card: honest(b.cartel) });
        expect(run.phase).toBe('end');
        expect(run.outcome).toBe('finished');
        expect(run.day).toBe(5);
        expect(run.reports.map(r => r.lesson.id)).toEqual(['freeMarket', b.id, 'ceiling', 'tax', 'rumor']);
        checkReports(run);

        const day2 = run.reports[1];
        const day3 = run.reports[2];
        expect(day2.summary.fines).toBe(b.cartel === 'A' ? CONFIG.cards.cartel.fine : 0);
        expect(day2.summary.labels).toEqual(b.cartel === 'A' ? [b.id] : []);
        expect(run.flags.cartelBroken).toBe(b.name === 'broke');
        const gossip = day3.repItems.filter(x => x.reason === 'cartel' && x.when === 'morning');
        expect(gossip).toEqual(b.name === 'broke' ? [{ reason: 'cartel', delta: -8, when: 'morning' }] : []);
        expect(ending(run)).toMatchObject({ outcome: 'finished', labels: b.cartel === 'A' ? [b.id] : [] });
        expect(run.reports.flatMap(r => r.summary.cards.map(c => c.id)).filter(id => id === 'cartel')).toHaveLength(1);
      });
    }

    it(`plays seed ${seed} the same way twice`, () => {
      const s: Script = { price: 30, day2Price: 30, tea: 'standard', card: () => 'A' };
      expect(play(seed, s)).toStrictEqual(play(seed, s));
    });
  }

  it('plays every story choice A: labels for each, one run of each card', () => {
    const run = play(11, { price: 30, day2Price: 30, tea: 'standard', card: () => 'A' });
    checkReports(run);
    const labels = ending(run).labels;
    for (const l of ['cartelBroke', 'shockTopping', 'skimp', 'blackMarket'] as const) expect(labels).toContain(l);
    expect(labels.some(l => l === 'inspectPass' || l === 'inspectFail')).toBe(true);
    expect(run.flags.reporter).toBe('A');
    const story = new Set<CardId>(([1, 2, 3, 4, 5] as Day[]).flatMap(d => CONFIG.days[d].storyCards));
    expect(run.reports.flatMap(r => r.summary.cards.map(c => c.id)).filter(id => story.has(id)))
      .toEqual(['cartel', 'shockTopping', 'blackMarket', 'tax', 'inspection', 'reporter']);
  });
});

describe('a run that loses all trust', () => {
  for (const seed of [11, 12]) {
    it(`ends seed ${seed} early, on the evening rep reaches 0`, () => {
      const run = play(seed, { price: 15, day2Price: 15, tea: 'skimp', card: () => 'A' });
      expect(run.phase).toBe('end');
      expect(run.outcome).toBe('lostTrust');
      expect(run.reports.length).toBeLessThan(5);
      expect(run.day).toBe(run.reports.length as Day);
      const lastReport = run.reports[run.reports.length - 1];
      expect(lastReport.summary).toMatchObject({ rep: 0, lost: true });
      expect(run.reports.slice(0, -1).every(r => !r.summary.lost)).toBe(true);
      checkReports(run);
      const end = ending(run);
      expect(end.outcome).toBe('lostTrust');
      expect(end.repLosses.map(x => x.reason)).toContain('tea');
      expect(() => nextDay(run)).toThrow();
    });
  }
});
