// The four class awards and their tie rules (spec §11 "Giải"), and the per-player totals the board also shows.
import { AWARDS, type Award, type AwardId } from '../shared/protocol';
import type { DaySummary, K } from '../shared/sim/types';

/** Cups a player must have sold for 🎯 Bàn Tay Vàng. */
export const GOLDEN_HAND_MIN_CUPS = 30;

export interface AwardEntry {
  playerId: string; name: string;
  /** Join order: the last tie-break, so the result never depends on the input order. */
  order: number;
  days: DaySummary[];
}

export interface Totals {
  days: number;
  /** From the last day sent; null before any. */
  score: K | null; rep: number | null; lastPrice: K | null;
  /** Sums over the days sent. */
  profit: K; waste: K; cups: number; wrong: number; walkouts: number;
  lost: boolean;
  /** Sent day 5, or lost trust (spec §11: a player who lost early counts as finished). */
  finished: boolean;
}

export function totals(days: readonly DaySummary[]): Totals {
  const last = days.length > 0 ? days[days.length - 1] : null;
  const sum = (f: (d: DaySummary) => number) => days.reduce((s, d) => s + f(d), 0);
  const lost = days.some(d => d.lost);
  return {
    days: days.length, score: last?.score ?? null, rep: last?.rep ?? null, lastPrice: last?.closePrice ?? null,
    profit: sum(d => d.profit), waste: sum(d => d.wasteValue), cups: sum(d => d.cups), wrong: sum(d => d.wrong),
    walkouts: sum(d => d.walkouts), lost, finished: lost || last?.day === 5,
  };
}

interface Row { e: AwardEntry; t: Totals & { score: K; rep: number } }
/** Higher first on each key in turn, then lower join order. */
function best(rows: Row[], keys: ((r: Row) => number)[]): Row | null {
  let top: Row | null = null;
  for (const r of rows) {
    if (top === null) { top = r; continue; }
    let cmp = 0;
    for (const k of keys) { cmp = k(r) - k(top); if (cmp !== 0) break; }
    if (cmp > 0 || (cmp === 0 && r.e.order < top.e.order)) top = r;
  }
  return top;
}

/** The awards over the days sent so far; players with no day are left out, an award nobody qualifies for too. */
export function computeAwards(entries: readonly AwardEntry[]): Award[] {
  const rows: Row[] = [];
  for (const e of entries) {
    const t = totals(e.days);
    if (t.score !== null && t.rep !== null) rows.push({ e, t: { ...t, score: t.score, rep: t.rep } });
  }
  const wrongShare = (r: Row) => r.t.wrong / r.t.cups;
  const winners: Record<AwardId, [Row | null, (r: Row) => number]> = {
    tycoon: [best(rows, [r => r.t.score, r => r.t.profit]), r => r.t.score],
    beloved: [best(rows, [r => r.t.rep, r => r.t.score]), r => r.t.rep],
    hoarder: [best(rows.filter(r => r.t.waste > 0), [r => r.t.waste, r => r.t.score]), r => r.t.waste],
    goldenHand: [best(rows.filter(r => r.t.cups >= GOLDEN_HAND_MIN_CUPS), [r => -wrongShare(r), r => r.t.cups]),
      wrongShare],
  };
  const out: Award[] = [];
  for (const a of AWARDS) {
    const [row, value] = winners[a.id];
    if (row) out.push({ ...a, playerId: row.e.playerId, name: row.e.name, value: value(row) });
  }
  return out;
}
