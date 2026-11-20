// The balance simulator (spec §14, Task 12): plays every strategy the checks need over many seeds and reports each
// condition of "Giả lập báo lỗi khi".
//
//   npm run balance -- [--seeds N] [--from S] [--check ID] [--json]
//
// Seeds S, S+1, …, S+N−1 (default S = 1, N = DEFAULT_SEEDS). Exit 0 when every reported check passes, 1 when one
// fails, 2 on bad arguments or a sim error.
import { STRATEGIES, playRun, storyCombos, type Strategy } from '../shared/sim/autoplay';
import { CONFIG, type SimConfig } from '../shared/sim/config';
import {
  ALIASES, CARTEL_KEYS, CHECKS, NEEDED_KEYS, NO_ENTRY_KEY, STYLE_KEYS, recordRun, runChecks, withoutEntrant,
  type CheckResult, type Results, type RunRecord,
} from './balance-checks';

/** Seeds by default: a full run takes about 50 s on the dev machine (≈ 0.12 s a seed, 18 runs each: the 18 strategy
 *  keys less one alias, plus B14's control run). */
const DEFAULT_SEEDS = 400;

const USAGE = 'usage: npm run balance -- [--seeds N] [--from S] [--check ID] [--json]';

interface Args { seeds: number; from: number; check: string | null; json: boolean }

function parseArgs(argv: string[]): Args {
  const a: Args = { seeds: DEFAULT_SEEDS, from: 1, check: null, json: false };
  const int = (flag: string, v: string | undefined, min: number) => {
    if (v === undefined || !/^-?\d+$/.test(v) || Number(v) < min) throw new Error(`${flag} needs an integer >= ${min}`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === '--seeds') a.seeds = int(f, argv[++i], 1);
    else if (f === '--from') a.from = int(f, argv[++i], 0);
    else if (f === '--check') {
      const id = argv[++i];
      if (id === undefined || !CHECKS.some(c => c.id === id)) {
        throw new Error(`--check needs one of ${CHECKS.map(c => c.id).join(', ')}`);
      }
      a.check = id;
    } else if (f === '--json') a.json = true;
    else throw new Error(`unknown argument ${f}`);
  }
  return a;
}

function strategies(): Map<string, Strategy> {
  const all = new Map<string, Strategy>();
  for (const s of Object.values(STRATEGIES)) all.set(s.id, s);
  for (const s of storyCombos(STRATEGIES.reasonable)) all.set(s.id, s);
  const out = new Map<string, Strategy>();
  for (const k of NEEDED_KEYS) {
    const s = all.get(k);
    if (s === undefined) throw new Error(`no strategy ${k}`);
    out.set(k, s);
  }
  return out;
}

function simulate(seeds: number[]): Results {
  const play = (strat: Strategy, cfg: SimConfig) => seeds.map(seed => {
    const { run, total } = playRun(seed, strat, cfg);
    return recordRun(seed, run, total);
  });
  const runs: Record<string, RunRecord[]> = {};
  for (const [key, strat] of strategies()) if (!(key in ALIASES)) runs[key] = play(strat, CONFIG);
  for (const [key, same] of Object.entries(ALIASES)) runs[key] = runs[same];
  runs[NO_ENTRY_KEY] = play(STRATEGIES.reasonable, withoutEntrant(CONFIG));
  return { seeds, runs };
}

const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

function summary(r: Results) {
  const total = (k: string) => round(mean(r.runs[k].map(x => x.total)), 1);
  const day = (k: string, d: number, f: (x: RunRecord['days'][number]) => number | null) =>
    mean(r.runs[k].flatMap(x => { const y = x.days.find(z => z.day === d); const v = y ? f(y) : null; return v === null ? [] : [v]; }));
  const share = (k: string) => round(day(k, 3, y => (y.eligible === 0 ? null : y.emptyHanded / y.eligible)), 3);
  return {
    reasonableMean: total('reasonable'),
    styles: Object.fromEntries(STYLE_KEYS.map(k => [k, total(k)])),
    cartel: Object.fromEntries(Object.entries(CARTEL_KEYS).map(([b, k]) => [b, total(k)])),
    streetAvg: {
      day1: round(day('reasonable', 1, y => y.streetAvg)), day2: round(day('reasonable', 2, y => y.streetAvg)),
      day2NoEntrant: round(day(NO_ENTRY_KEY, 2, y => y.streetAvg)),
    },
    emptyHanded: Object.fromEntries([1, 2, 3, 4, 5].map(d =>
      [`day${d}`, round(day('reasonable', d, y => (y.eligible === 0 ? null : y.emptyHanded / y.eligible)), 3)])),
    day3EmptyHanded: Object.fromEntries(Object.entries(CARTEL_KEYS).map(([b, k]) => [b, share(k)])),
  };
}

const fmt = (c: CheckResult) =>
  `${c.id.padEnd(4)} ${c.pass ? 'PASS' : 'FAIL'} ${String(round(c.measured, 3)).padStart(9)}  ${c.threshold}`
  + `  worstSeed=${c.worstSeed ?? '-'}${c.detail === undefined ? '' : `  (${c.detail})`}`;

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const seeds = Array.from({ length: args.seeds }, (_, i) => args.from + i);
  const t0 = performance.now();
  let results: Results;
  try {
    results = simulate(seeds);
  } catch (e) {
    console.error('sim error:', e);
    return 2;
  }
  const secs = (performance.now() - t0) / 1000;
  const checks = runChecks(results).filter(c => args.check === null || c.id === args.check);
  const sum = summary(results);
  if (args.json) {
    console.log(JSON.stringify({ seeds: { from: args.from, count: args.seeds }, seconds: round(secs, 1), checks, summary: sum }, null, 2));
  } else {
    console.log(`${args.seeds} seeds from ${args.from}, ${NEEDED_KEYS.length} strategies + B14 control, ${secs.toFixed(1)} s`);
    for (const c of checks) console.log(fmt(c));
    console.log('');
    console.log(`reasonable mean score: ${sum.reasonableMean}`);
    console.log(`styles: ${Object.entries(sum.styles).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(`cartel branches: ${Object.entries(sum.cartel).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(`street average close: day 1 ${sum.streetAvg.day1}, day 2 ${sum.streetAvg.day2}`
      + ` (day 2 without Chuỗi Tập Đoàn ${sum.streetAvg.day2NoEntrant})`);
    console.log(`reasonable empty-handed share: ${Object.entries(sum.emptyHanded).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    console.log(`day-3 empty-handed share: ${Object.entries(sum.day3EmptyHanded).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const failed = checks.filter(c => !c.pass).map(c => c.id);
    console.log(failed.length === 0 ? 'all checks pass' : `FAILED: ${failed.join(' ')}`);
  }
  return checks.every(c => c.pass) ? 0 : 1;
}

process.exitCode = main();
