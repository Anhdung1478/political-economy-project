// The balance checks of spec §14 (Task 12), on hand-built results: one passing and one failing case per check.
import { describe, expect, it } from 'vitest';
import { STRATEGIES, playRun, storyCombos } from '../shared/sim/autoplay';
import { CONFIG } from '../shared/sim/config';
import {
  ALIASES, CARTEL_KEYS, CARD_PAIRS, CHECKS, NO_ENTRY_KEY, recordRun, runChecks, withoutEntrant,
  type CheckResult, type DayRecord, type Results, type RunRecord,
} from './balance-checks';

const SEEDS = [1, 2, 3];

/** A day of a healthy `reasonable` run. */
function day(d: number, over: Partial<DayRecord> = {}): DayRecord {
  const streetAvg = [32, 28, 20, 30, 30][d - 1];
  return {
    day: d, profit: 300, fines: 0, streetAvg, eligible: 100, emptyHanded: d === 3 ? 40 : 5, aiOpen: 4, ...over,
  };
}

function run(seed: number, total: number, over: Partial<RunRecord> = {}): RunRecord {
  return { seed, total, lostTrust: false, days: [1, 2, 3, 4, 5].map(d => day(d)), aiClosedBefore5: 1, ...over };
}

const all = (total: number) => SEEDS.map(s => run(s, total));

/** Results on which every check passes. */
function good(): Results {
  const runs: Record<string, RunRecord[]> = {
    reasonable: all(2500), flat15: all(1200), flat45: all(200), skimp: all(2000), premium: all(2450),
    double: all(1200), half: all(1000), plainS: all(80), day5cheat: all(2400), delay1: all(2500), delay6: all(2450),
    [CARTEL_KEYS.refuse]: all(2500),
    [CARTEL_KEYS.keep]: SEEDS.map(s => {
      const r = run(s, 2400);
      r.days[1] = day(2, { profit: 250, fines: 100 });
      return r;
    }),
    [CARTEL_KEYS.break]: all(2380),
    // The control run without Chuỗi Tập Đoàn: day 2 closes 2k above the run with it (28k).
    [NO_ENTRY_KEY]: SEEDS.map(s => {
      const r = run(s, 2500);
      r.days[1] = day(2, { streetAvg: 30 });
      return r;
    }),
  };
  for (const [a, b] of Object.values(CARD_PAIRS)) {
    runs[a] ??= all(2480);
    runs[b] ??= all(2480);
  }
  return { seeds: [...SEEDS], runs };
}

function check(r: Results, id: string): CheckResult {
  const c = runChecks(r).find(x => x.id === id);
  if (c === undefined) throw new Error(`no check ${id}`);
  return c;
}

/** Replace the runs under `key` by `f` applied to each (copied). */
function edit(r: Results, key: string, f: (x: RunRecord, i: number) => void): Results {
  r.runs[key] = r.runs[key].map((x, i) => {
    const y: RunRecord = { ...x, days: x.days.map(d => ({ ...d })) };
    f(y, i);
    return y;
  });
  return r;
}

describe('runChecks', () => {
  it('lists B1–B14 in order, every one passing on healthy results', () => {
    const out = runChecks(good());
    expect(out.map(c => c.id)).toEqual(
      ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8a', 'B8b', 'B8c', 'B9', 'B10', 'B11', 'B12', 'B13', 'B14']);
    expect(CHECKS.map(c => c.id)).toEqual(out.map(c => c.id));
    for (const c of out) expect(c.pass, c.id).toBe(true);
  });

  it('B1: a loss on one seed is fine while the mean stays positive; a negative mean day profit fails', () => {
    const ok = edit(good(), 'reasonable', (x, i) => { if (i === 0) x.days[2].profit = -100; });
    expect(check(ok, 'B1').pass).toBe(true);
    const bad = edit(good(), 'reasonable', (x, i) => { x.days[3].profit = i === 1 ? -500 : -10; });
    const c = check(bad, 'B1');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(-520 / 3);
    expect(c.worstSeed).toBe(2);
  });

  it('B1: day 5 does not count', () => {
    const r = edit(good(), 'reasonable', x => { x.days[4].profit = -1000; });
    expect(check(r, 'B1').pass).toBe(true);
  });

  it('B2: any seed lost to trust fails', () => {
    expect(check(good(), 'B2').worstSeed).toBeNull();
    const bad = edit(good(), 'reasonable', (x, i) => { if (i === 2) { x.lostTrust = true; x.days = x.days.slice(0, 2); } });
    const c = check(bad, 'B2');
    expect(c.pass).toBe(false);
    expect(c.measured).toBe(1);
    expect(c.worstSeed).toBe(3);
  });

  it('B3: an extreme style with a higher mean score than reasonable fails; double and half do not count', () => {
    const ok = edit(edit(good(), 'double', x => { x.total = 9000; }), 'day5cheat', (x, i) => { if (i === 0) x.total = 2700; });
    expect(check(ok, 'B3').pass).toBe(true);   // day5cheat mean 2500 = reasonable: not higher
    const bad = edit(good(), 'day5cheat', (x, i) => { x.total = i === 1 ? 2900 : 2510; });
    const c = check(bad, 'B3');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(140);
    expect(c.worstSeed).toBe(2);
    expect(c.detail).toContain('day5cheat');
  });

  it('B4: the day-1 street average must sit in 28–36k', () => {
    const ok = edit(good(), 'reasonable', x => { x.days[0].streetAvg = 36; x.days[1].streetAvg = 30; });
    expect(check(ok, 'B4').pass).toBe(true);
    const bad = edit(good(), 'reasonable', (x, i) => { x.days[0].streetAvg = i === 0 ? 40 : 37; });
    const c = check(bad, 'B4');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(38);
    expect(c.worstSeed).toBe(1);
  });

  it('B5: day 2 must close at least 3k under day 1 on average', () => {
    const ok = edit(good(), 'reasonable', x => { x.days[1].streetAvg = 29; });
    expect(check(ok, 'B5').pass).toBe(true);   // exactly 3k
    const bad = edit(good(), 'reasonable', (x, i) => { x.days[1].streetAvg = i === 1 ? 32 : 30; });
    const c = check(bad, 'B5');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(32 - 92 / 3);
    expect(c.worstSeed).toBe(2);
  });

  it('B6: under 25% empty-handed on the ceiling day on any cartel branch fails', () => {
    const ok = edit(good(), CARTEL_KEYS.break, x => { x.days[2].emptyHanded = 25; });
    expect(check(ok, 'B6').pass).toBe(true);   // exactly 25%
    const bad = edit(good(), CARTEL_KEYS.keep, (x, i) => { x.days[2].emptyHanded = i === 0 ? 5 : 20; });
    const c = check(bad, 'B6');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(0.15);
    expect(c.worstSeed).toBe(1);
    expect(c.detail).toContain('keep');
  });

  it('B7: delay 0.1 s and 0.6 s more than 15% of reasonable apart fails', () => {
    const ok = edit(good(), 'delay6', x => { x.total = 2500 - 375; });
    expect(check(ok, 'B7').pass).toBe(true);   // exactly 15%
    const bad = edit(good(), 'delay6', (x, i) => { x.total = i === 2 ? 1500 : 2200; });
    const c = check(bad, 'B7');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo((2500 - 5900 / 3) / 2500);
    expect(c.worstSeed).toBe(3);
  });

  it('B8a: keeping the cartel must pay more on day 2 before the fine than refusing', () => {
    const bad = edit(good(), CARTEL_KEYS.keep, (x, i) => { x.days[1] = day(2, { profit: i === 0 ? 100 : 200, fines: 100 }); });
    const c = check(bad, 'B8a');
    expect(c.pass).toBe(false);   // before the fine: 200, 300, 300 against 300
    expect(c.measured).toBeCloseTo(-100 / 3);
    expect(c.worstSeed).toBe(1);
    const eq = edit(good(), CARTEL_KEYS.keep, x => { x.days[1] = day(2, { profit: 200, fines: 100 }); });
    expect(check(eq, 'B8a').pass).toBe(false);   // equal is not above
  });

  it('B8b: an agree branch scoring above refuse fails', () => {
    const ok = edit(good(), CARTEL_KEYS.break, x => { x.total = 2500; });
    expect(check(ok, 'B8b').pass).toBe(true);
    const bad = edit(good(), CARTEL_KEYS.break, (x, i) => { x.total = i === 1 ? 2700 : 2450; });
    const c = check(bad, 'B8b');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(100 / 3);
    expect(c.worstSeed).toBe(2);
  });

  it('B8c: refuse beating the second-best branch by more than 150k fails', () => {
    const ok = edit(good(), CARTEL_KEYS.keep, x => { x.total = 2350; });
    expect(check(ok, 'B8c').pass).toBe(true);   // the best of the others: break at 2380
    const bad = edit(edit(good(), CARTEL_KEYS.keep, x => { x.total = 2000; }), CARTEL_KEYS.break,
      (x, i) => { x.total = i === 0 ? 1800 : 2300; });
    const c = check(bad, 'B8c');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(2500 - 6400 / 3);
    expect(c.worstSeed).toBe(1);
  });

  it('B9: a story card whose branch beats the other by over 80k on every seed fails; one seed under spares it', () => {
    // shockTopping: A is the flipped combo, B the base (reasonable's choices, cartel refused) at 2500.
    const [a, b] = CARD_PAIRS.shockTopping;
    expect(b).toBe(CARTEL_KEYS.refuse);
    const ok = edit(good(), a, (x, i) => { x.total = i === 1 ? 2570 : 2600; });
    expect(check(ok, 'B9').pass).toBe(true);   // seed 2 only +70
    const bad = edit(good(), a, (x, i) => { x.total = [2620, 2600, 2650][i]; });
    const c = check(bad, 'B9');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(100);   // the smallest lead over the seeds
    expect(c.worstSeed).toBe(3);           // the largest lead
    expect(c.detail).toContain('shockTopping');
    const other = edit(good(), a, x => { x.total = 2400; });
    expect(check(other, 'B9').pass).toBe(false);   // either direction
  });

  it('B10: premium more than 100k from reasonable either way fails', () => {
    const ok = edit(good(), 'premium', x => { x.total = 2600; });
    expect(check(ok, 'B10').pass).toBe(true);   // exactly 100k
    const bad = edit(good(), 'premium', (x, i) => { x.total = i === 0 ? 2900 : 2600; });
    const c = check(bad, 'B10');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(200);
    expect(c.worstSeed).toBe(1);
    expect(check(edit(good(), 'premium', x => { x.total = 2300; }), 'B10').pass).toBe(false);
  });

  it('B11: fewer than 70% of seeds with an AI shop closed before day 5 fails', () => {
    const r = good();
    r.seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const k of Object.keys(r.runs)) r.runs[k] = r.seeds.map(s => run(s, r.runs[k][0].total));
    const ok = edit(r, 'reasonable', (x, i) => { if (i < 3) x.aiClosedBefore5 = 0; });
    expect(check(ok, 'B11').pass).toBe(true);   // exactly 70%
    const bad = edit(ok, 'reasonable', (x, i) => { if (i === 3) x.aiClosedBefore5 = 0; });
    const c = check(bad, 'B11');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(0.6);
    expect(c.worstSeed).toBe(1);
  });

  it('B12: under 3 AI shops open on day 5 on average fails', () => {
    const ok = edit(good(), 'reasonable', x => { x.days[4].aiOpen = 3; });
    expect(check(ok, 'B12').pass).toBe(true);
    const bad = edit(good(), 'reasonable', (x, i) => { x.days[4].aiOpen = i === 2 ? 1 : 3; });
    const c = check(bad, 'B12');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(7 / 3);
    expect(c.worstSeed).toBe(3);
  });

  it("B13: the ceiling day's empty-handed share must be at least twice the mean of days 1 and 2", () => {
    // Days 1 and 2: 5% each; day 3 at 10% is exactly twice.
    const ok = edit(good(), 'reasonable', x => { x.days[2].emptyHanded = 10; });
    const c0 = check(ok, 'B13');
    expect(c0.pass).toBe(true);
    expect(c0.measured).toBeCloseTo(2);
    const bad = edit(good(), 'reasonable', (x, i) => { x.days[2].emptyHanded = i === 0 ? 6 : 10; });
    const c = check(bad, 'B13');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo((26 / 300) / 0.05);
    expect(c.worstSeed).toBe(1);
    // Days 1 and 2 count as their mean: 2% and 8% average 5%.
    const mixed = edit(edit(good(), 'reasonable', x => { x.days[0].emptyHanded = 2; x.days[1].emptyHanded = 8; }),
      'reasonable', x => { x.days[2].emptyHanded = 10; });
    expect(check(mixed, 'B13').pass).toBe(true);
  });

  it('B14: Chuỗi Tập Đoàn opening must lower the day-2 street average by at least 2k against the control run', () => {
    const c0 = check(good(), 'B14');
    expect(c0.pass).toBe(true);   // exactly 2k
    expect(c0.measured).toBeCloseTo(2);
    const bad = edit(good(), NO_ENTRY_KEY, (x, i) => { x.days[1].streetAvg = [29, 30, 30.5][i]; });
    const c = check(bad, 'B14');
    expect(c.pass).toBe(false);
    expect(c.measured).toBeCloseTo(5.5 / 3);
    expect(c.worstSeed).toBe(1);
  });
});

describe('withoutEntrant', () => {
  it("moves Chuỗi Tập Đoàn's first day past the last day and changes nothing else", () => {
    const before = JSON.stringify(CONFIG);
    const cfg = withoutEntrant(CONFIG);
    expect(cfg.aiShops.tapdoan.firstDay).toBeGreaterThan(CONFIG.run.dayCount);
    expect({ ...cfg.aiShops, tapdoan: CONFIG.aiShops.tapdoan }).toEqual(CONFIG.aiShops);
    expect({ ...cfg, aiShops: CONFIG.aiShops }).toEqual(CONFIG);
    expect(JSON.stringify(CONFIG)).toBe(before);
  });

  it('plays a run in which Chuỗi Tập Đoàn never opens', () => {
    const { run: r } = playRun(5, STRATEGIES.reasonable, withoutEntrant(CONFIG));
    expect(r.reports.length).toBe(5);
    for (const rep of r.reports) {
      const td = rep.street.find(s => s.id === 'tapdoan');
      expect(td === undefined || td.closePrice === null).toBe(true);
    }
  });
});

describe('ALIASES', () => {
  it('maps the cartel-refused combo to reasonable, which plays the same run', () => {
    expect(ALIASES).toEqual({ [CARTEL_KEYS.refuse]: 'reasonable' });
    const combo = storyCombos(STRATEGIES.reasonable).find(s => s.id === CARTEL_KEYS.refuse)!;
    for (const seed of [3, 8]) {
      const a = playRun(seed, STRATEGIES.reasonable);
      const b = playRun(seed, combo);
      expect(b.total).toBe(a.total);
      expect(JSON.stringify(b.reports)).toBe(JSON.stringify(a.reports));
    }
  });
});

describe('recordRun', () => {
  it('keeps what the checks need from a real run', () => {
    const { run: r, total } = playRun(11, STRATEGIES.reasonable);
    const rec = recordRun(11, r, total);
    expect(rec.seed).toBe(11);
    expect(rec.total).toBe(total);
    expect(rec.lostTrust).toBe(r.outcome === 'lostTrust');
    expect(rec.days.map(d => d.day)).toEqual(r.reports.map(x => x.summary.day));
    const d1 = r.reports[0];
    const closes = d1.street.flatMap(s => (s.closePrice === null ? [] : [s.closePrice]));
    expect(rec.days[0].streetAvg).toBeCloseTo(closes.reduce((a, b) => a + b, 0) / closes.length);
    expect(rec.days[0].profit).toBe(d1.summary.profit);
    expect(rec.days[2].eligible).toBe(r.reports[2].eligible);
    expect(rec.days[2].emptyHanded).toBe(r.reports[2].emptyHanded);
    expect(rec.days[4].aiOpen).toBe(r.reports[4].street.filter(s => s.id !== 'player'
      && (s.status === 'open' || s.status === 'soldOut')).length);
    expect(rec.aiClosedBefore5).toBe(r.shops.filter(s => s.closedOn !== null && s.closedOn <= 4).length);
  });
});
