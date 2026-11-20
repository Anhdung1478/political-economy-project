// The balance checks of spec §14 "Giả lập báo lỗi khi" (Task 12), as pure functions of what the simulator kept from
// each run. Aggregation (§16 row 16): thresholds on the mean over seeds; "lost to trust" on any seed; "always" on
// every seed; the street's average price includes the player. Strategies on a seed share the bot's randomness (R39),
// so comparisons are on paired means. Money is in k (thousands of đồng), as in the sim.
import type { SimConfig } from '../shared/sim/config';
import type { Day, RunState } from '../shared/sim/types';

/** What a day of a run leaves for the checks. */
export interface DayRecord {
  day: number;
  /** The player's day profit (after fines) and the fines in it. */
  profit: number; fines: number;
  /** The mean close of every shop that sold that day, the player included; null if none sold. */
  streetAvg: number | null;
  /** Customers who could pay, and those of them who went home empty-handed. */
  eligible: number; emptyHanded: number;
  /** AI shops selling that day (not resting, closed or not open yet). */
  aiOpen: number;
}

/** What a run leaves for the checks. */
export interface RunRecord {
  seed: number; total: number; lostTrust: boolean;
  /** One per day played, in order (fewer than 5 when the run was lost). */
  days: DayRecord[];
  /** AI shops that closed for good on the evening of day 4 or earlier. */
  aiClosedBefore5: number;
}

/** The runs of each strategy key; `runs[key][i]` was played on `seeds[i]`. */
export interface Results { seeds: number[]; runs: Record<string, RunRecord[]> }

export interface CheckResult {
  id: string; pass: boolean; measured: number; threshold: string;
  /** The seed that contributes most to failing (or, passing, comes closest), null when none applies. */
  worstSeed: number | null;
  /** Which style, branch or card the measure is about, when it is one of several. */
  detail?: string;
}

/** Reasonable's story choices (autoplay R37): shock B, black market B, tax A, inspection B. */
const BASE = { shock: 'B', black: 'B', tax: 'A', inspect: 'B' } as const;
type Story = { shock: string; black: string; tax: string; inspect: string };

/** The id `storyCombos(STRATEGIES.reasonable)` gives a combination. */
export const comboKey = (cartel: 'refuse' | 'keep' | 'break', s: Story = BASE) =>
  `reasonable+cartel-${cartel}+shock-${s.shock}+black-${s.black}+tax-${s.tax}+inspect-${s.inspect}`;

/** The three cartel branches, every other story choice as `reasonable`'s. */
export const CARTEL_KEYS = { refuse: comboKey('refuse'), keep: comboKey('keep'), break: comboKey('break') } as const;

const flip = (card: keyof Story, choice: 'A' | 'B') => comboKey('refuse', { ...BASE, [card]: choice });

/** Each two-branch story card: [branch A, branch B], cartel refused and every other choice as `reasonable`'s. */
export const CARD_PAIRS: Record<'shockTopping' | 'blackMarket' | 'tax' | 'inspection', readonly [string, string]> = {
  shockTopping: [flip('shock', 'A'), flip('shock', 'B')],
  blackMarket: [flip('black', 'A'), flip('black', 'B')],
  tax: [flip('tax', 'A'), flip('tax', 'B')],
  inspection: [flip('inspect', 'A'), flip('inspect', 'B')],
};

/** The play styles of spec §14 the checks read (all of `STRATEGIES`). */
export const STYLE_KEYS = ['reasonable', 'flat15', 'flat45', 'skimp', 'premium', 'double', 'half', 'plainS',
  'day5cheat', 'delay1', 'delay6'] as const;
const EXTREMES = ['flat15', 'flat45', 'skimp', 'plainS', 'day5cheat'] as const;

/** Every strategy key the checks need: the styles, the cartel branches and the card pairs. */
export const NEEDED_KEYS: string[] = [...new Set<string>([
  ...STYLE_KEYS, ...Object.values(CARTEL_KEYS), ...Object.values(CARD_PAIRS).flat(),
])];

/** B14's control run: `reasonable` played with `withoutEntrant(cfg)`, on the same seeds. */
export const NO_ENTRY_KEY = 'reasonable+no-entrant';

/** `cfg` with Chuỗi Tập Đoàn's first day past the last day, so it never opens (B14's control run). */
export function withoutEntrant(cfg: SimConfig): SimConfig {
  const tapdoan = { ...cfg.aiShops.tapdoan, firstDay: (cfg.run.dayCount + 1) as Day };
  return { ...cfg, aiShops: { ...cfg.aiShops, tapdoan } };
}

/** Keys that play exactly the run of another key, so the simulator plays it once (`reasonable` already refuses the
 *  cartel and makes every other story choice of the base combination). */
export const ALIASES: Record<string, string> = { [CARTEL_KEYS.refuse]: 'reasonable' };

/** What the checks need from a finished run. */
export function recordRun(seed: number, run: RunState, total: number): RunRecord {
  return {
    seed, total, lostTrust: run.outcome === 'lostTrust',
    days: run.reports.map(r => {
      let sum = 0;
      let n = 0;
      let aiOpen = 0;
      for (const s of r.street) {
        if (s.closePrice !== null) { sum += s.closePrice; n++; }
        if (s.id !== 'player' && (s.status === 'open' || s.status === 'soldOut')) aiOpen++;
      }
      return {
        day: r.summary.day, profit: r.summary.profit, fines: r.summary.fines, streetAvg: n > 0 ? sum / n : null,
        eligible: r.eligible, emptyHanded: r.emptyHanded, aiOpen,
      };
    }),
    aiClosedBefore5: run.shops.filter(s => s.closedOn !== null && s.closedOn <= 4).length,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

function runsOf(r: Results, key: string): RunRecord[] {
  const runs = r.runs[key];
  if (runs === undefined) throw new Error(`no results for ${key}`);
  return runs;
}

/** A value per seed (null when the run has no such value, e.g. a day it never reached). */
interface PerSeed { seed: number; v: number }
const perSeed = (runs: RunRecord[], f: (x: RunRecord) => number | null): PerSeed[] =>
  runs.flatMap(x => { const v = f(x); return v === null || Number.isNaN(v) ? [] : [{ seed: x.seed, v }]; });

const dayOf = (x: RunRecord, d: number) => x.days.find(y => y.day === d) ?? null;

/** The seed whose value is largest (`max`) or smallest. */
function argBy(xs: PerSeed[], max: boolean): number | null {
  let best: PerSeed | null = null;
  for (const x of xs) if (best === null || (max ? x.v > best.v : x.v < best.v)) best = x;
  return best === null ? null : best.seed;
}

/** Paired values a − b by seed (runs aligned on `r.seeds`). */
function paired(r: Results, a: string, b: string, f: (x: RunRecord) => number | null = x => x.total): PerSeed[] {
  const ra = runsOf(r, a);
  const rb = runsOf(r, b);
  return r.seeds.flatMap((seed, i) => {
    const va = f(ra[i]);
    const vb = f(rb[i]);
    return va === null || vb === null ? [] : [{ seed, v: va - vb }];
  });
}

const meanTotal = (r: Results, key: string) => mean(runsOf(r, key).map(x => x.total));
const vals = (xs: PerSeed[]) => xs.map(x => x.v);

// ── the checks ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Check = (r: Results) => CheckResult;

/** B1: `reasonable` loses money on a day of 1–4 (mean day profit < 0). */
const B1: Check = r => {
  let worst: { d: number; m: number; xs: PerSeed[] } | null = null;
  for (let d = 1; d <= 4; d++) {
    const xs = perSeed(runsOf(r, 'reasonable'), x => dayOf(x, d)?.profit ?? null);
    const m = mean(xs.map(x => x.v));
    if (worst === null || m < worst.m || Number.isNaN(m)) worst = { d, m, xs };
  }
  const w = worst!;
  return {
    id: 'B1', pass: w.m >= 0, measured: w.m, threshold: '>= 0', worstSeed: argBy(w.xs, false), detail: `day ${w.d}`,
  };
};

/** B2: `reasonable` lost to trust on any seed. */
const B2: Check = r => {
  const lost = runsOf(r, 'reasonable').filter(x => x.lostTrust);
  return { id: 'B2', pass: lost.length === 0, measured: lost.length, threshold: '= 0 seeds', worstSeed: lost[0]?.seed ?? null };
};

/** B3: an extreme style has a mean score above `reasonable`'s. */
const B3: Check = r => {
  let worst: { s: string; m: number; xs: PerSeed[] } | null = null;
  for (const s of EXTREMES) {
    const xs = paired(r, s, 'reasonable');
    const m = mean(vals(xs));
    if (worst === null || m > worst.m) worst = { s, m, xs };
  }
  const w = worst!;
  return {
    id: 'B3', pass: w.m <= 0, measured: w.m, threshold: '<= 0 (best extreme − reasonable)',
    worstSeed: argBy(w.xs, true), detail: w.s,
  };
};

const streetAvgs = (r: Results, d: number) => perSeed(runsOf(r, 'reasonable'), x => dayOf(x, d)?.streetAvg ?? null);

/** B4: day-1 mean street close outside 28–36k on `reasonable`. */
const B4: Check = r => {
  const xs = streetAvgs(r, 1);
  const m = mean(vals(xs));
  const off = xs.map(x => ({ seed: x.seed, v: Math.abs(x.v - 32) }));
  return { id: 'B4', pass: m >= 28 && m <= 36, measured: m, threshold: 'in [28, 36]', worstSeed: argBy(off, true) };
};

/** B5: day 2 (cartel refused) does not close at least 3k under day 1, on average. */
const B5: Check = r => {
  const drop = perSeed(runsOf(r, 'reasonable'), x => {
    const a = dayOf(x, 1)?.streetAvg ?? null;
    const b = dayOf(x, 2)?.streetAvg ?? null;
    return a === null || b === null ? null : a - b;
  });
  const m = mean(vals(streetAvgs(r, 1))) - mean(vals(streetAvgs(r, 2)));
  return { id: 'B5', pass: m >= 3, measured: m, threshold: '>= 3 (day 1 − day 2)', worstSeed: argBy(drop, false) };
};

/** B6: on the ceiling day (day 3), under 25% of those who could pay go home empty-handed, on any cartel branch. */
const B6: Check = r => {
  let worst: { b: string; m: number; xs: PerSeed[] } | null = null;
  for (const [b, key] of Object.entries(CARTEL_KEYS)) {
    const xs = perSeed(runsOf(r, key), x => {
      const d = dayOf(x, 3);
      return d === null || d.eligible === 0 ? null : d.emptyHanded / d.eligible;
    });
    const m = mean(vals(xs));
    if (worst === null || m < worst.m || Number.isNaN(m)) worst = { b, m, xs };
  }
  const w = worst!;
  return {
    id: 'B6', pass: w.m >= 0.25, measured: w.m, threshold: '>= 0.25 on every branch', worstSeed: argBy(w.xs, false),
    detail: w.b,
  };
};

/** B7: `delay1` and `delay6` mean scores more than 15% (of `reasonable`'s mean) apart. */
const B7: Check = r => {
  const xs = paired(r, 'delay1', 'delay6');
  const m = Math.abs(mean(vals(xs))) / meanTotal(r, 'reasonable');
  return {
    id: 'B7', pass: m <= 0.15, measured: m, threshold: '<= 0.15 |delay1 − delay6| / reasonable',
    worstSeed: argBy(xs.map(x => ({ seed: x.seed, v: Math.abs(x.v) })), true),
  };
};

/** B8a: keeping the cartel does not pay more on day 2 before the fine than refusing it. */
const B8a: Check = r => {
  const keep = runsOf(r, CARTEL_KEYS.keep);
  const refuse = runsOf(r, CARTEL_KEYS.refuse);
  const diffs = r.seeds.flatMap((seed, i) => {
    const k = dayOf(keep[i], 2);
    const f = dayOf(refuse[i], 2);
    return k === null || f === null ? [] : [{ seed, v: k.profit + k.fines - f.profit }];
  });
  const m = mean(vals(diffs));
  return {
    id: 'B8a', pass: m > 0, measured: m, threshold: '> 0 (keep day-2 profit before fine − refuse)',
    worstSeed: argBy(diffs, false),
  };
};

/** B8b: an agree branch (keep or break) scores above refuse on average. */
const B8b: Check = r => {
  const keep = paired(r, CARTEL_KEYS.keep, CARTEL_KEYS.refuse);
  const brk = paired(r, CARTEL_KEYS.break, CARTEL_KEYS.refuse);
  const [b, xs] = mean(vals(keep)) >= mean(vals(brk)) ? ['keep', keep] : ['break', brk];
  const m = mean(vals(xs));
  return {
    id: 'B8b', pass: m <= 0, measured: m, threshold: '<= 0 (best agree branch − refuse)', worstSeed: argBy(xs, true),
    detail: b,
  };
};

/** B8c: refuse beats the second-best cartel branch by more than 150k on average. */
const B8c: Check = r => {
  const keep = paired(r, CARTEL_KEYS.refuse, CARTEL_KEYS.keep);
  const brk = paired(r, CARTEL_KEYS.refuse, CARTEL_KEYS.break);
  // Refuse against the better agree branch (the second best while refuse leads; negative, and B8b's business, if not).
  const [b, xs] = mean(vals(keep)) <= mean(vals(brk)) ? ['keep', keep] : ['break', brk];
  const m = mean(vals(xs));
  return {
    id: 'B8c', pass: m <= 150, measured: m, threshold: '<= 150 (refuse − second best)', worstSeed: argBy(xs, true),
    detail: b,
  };
};

/** B9: a two-branch story card where one branch beats the other by more than 80k on every seed. */
const B9: Check = r => {
  let worst: { card: string; lead: number; xs: PerSeed[] } | null = null;
  for (const [card, [a, b]] of Object.entries(CARD_PAIRS)) {
    const d = paired(r, a, b);
    // The lead of the branch that is ahead on average, seed by seed; it "always" wins by its smallest lead.
    const sign = mean(vals(d)) >= 0 ? 1 : -1;
    const xs = d.map(x => ({ seed: x.seed, v: sign * x.v }));
    const lead = Math.min(...vals(xs));
    if (worst === null || lead > worst.lead) worst = { card, lead, xs };
  }
  const w = worst!;
  return {
    id: 'B9', pass: w.lead <= 80, measured: w.lead, threshold: '<= 80 (smallest per-seed lead)',
    worstSeed: argBy(w.xs, true), detail: w.card,
  };
};

/** B10: `premium`'s mean score more than 100k from `reasonable`'s, either way. */
const B10: Check = r => {
  const xs = paired(r, 'premium', 'reasonable');
  const m = Math.abs(mean(vals(xs)));
  return {
    id: 'B10', pass: m <= 100, measured: m, threshold: '<= 100 |premium − reasonable|',
    worstSeed: argBy(xs.map(x => ({ seed: x.seed, v: Math.abs(x.v) })), true),
  };
};

/** B11: under 70% of seeds on `reasonable` see an AI shop close before day 5. */
const B11: Check = r => {
  const runs = runsOf(r, 'reasonable');
  const share = runs.filter(x => x.aiClosedBefore5 > 0).length / runs.length;
  return {
    id: 'B11', pass: share >= 0.7, measured: share, threshold: '>= 0.70 of seeds',
    worstSeed: runs.find(x => x.aiClosedBefore5 === 0)?.seed ?? null,
  };
};

/** B12: on `reasonable`, under 3 AI shops open on day 5 on average. */
const B12: Check = r => {
  const xs = perSeed(runsOf(r, 'reasonable'), x => dayOf(x, 5)?.aiOpen ?? null);
  const m = mean(vals(xs));
  return { id: 'B12', pass: m >= 3, measured: m, threshold: '>= 3', worstSeed: argBy(xs, false) };
};

const share = (d: DayRecord | null) => (d === null || d.eligible === 0 ? null : d.emptyHanded / d.eligible);

/** B13: on `reasonable`, the ceiling day's (day 3) mean empty-handed share is under twice the mean of days 1 and 2. */
const B13: Check = r => {
  const runs = runsOf(r, 'reasonable');
  const s3 = perSeed(runs, x => share(dayOf(x, 3)));
  const m3 = mean(vals(s3));
  const m12 = (mean(vals(perSeed(runs, x => share(dayOf(x, 1))))) + mean(vals(perSeed(runs, x => share(dayOf(x, 2)))))) / 2;
  // Per seed: how far day 3 sits above twice the mean of its own days 1 and 2.
  const margin = perSeed(runs, x => {
    const [a, b, c] = [1, 2, 3].map(d => share(dayOf(x, d)));
    return a === null || b === null || c === null ? null : c - (a + b);
  });
  return {
    id: 'B13', pass: m3 >= 2 * m12, measured: m3 / m12, threshold: '>= 2 (day-3 share / mean of days 1–2)',
    worstSeed: argBy(margin, false),
  };
};

/** B14: Chuỗi Tập Đoàn opening lowers the day-2 street average by under 2k against the run without it (paired). */
const B14: Check = r => {
  const xs = paired(r, NO_ENTRY_KEY, 'reasonable', x => dayOf(x, 2)?.streetAvg ?? null);
  const m = mean(vals(xs));
  return {
    id: 'B14', pass: m >= 2, measured: m, threshold: '>= 2 (day 2 without entrant − with)', worstSeed: argBy(xs, false),
  };
};

export const CHECKS: { id: string; run: Check }[] = [
  { id: 'B1', run: B1 }, { id: 'B2', run: B2 }, { id: 'B3', run: B3 }, { id: 'B4', run: B4 }, { id: 'B5', run: B5 },
  { id: 'B6', run: B6 }, { id: 'B7', run: B7 }, { id: 'B8a', run: B8a }, { id: 'B8b', run: B8b },
  { id: 'B8c', run: B8c }, { id: 'B9', run: B9 }, { id: 'B10', run: B10 }, { id: 'B11', run: B11 },
  { id: 'B12', run: B12 }, { id: 'B13', run: B13 }, { id: 'B14', run: B14 },
];

/** Every check on the results, in order. A NaN measure (no data) fails. */
export function runChecks(r: Results): CheckResult[] {
  return CHECKS.map(c => {
    const out = c.run(r);
    return Number.isNaN(out.measured) ? { ...out, pass: false } : out;
  });
}
