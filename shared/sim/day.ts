// The player's morning (spec §5): quick-fill buttons and the capacity line. Task 9 adds the rest of the morning.
import { CONFIG, type SimConfig } from './config';
import type { MorningPlan, RunState, Size, ToppingId } from './types';

/** Share of S, M, L orders over the whole budget range: the budget tilt of L averages out (plan "Sinh khách"). */
function sizeShares(cfg: SimConfig): Record<Size, number> {
  const s = cfg.customers.size;
  return { S: 1 - s.mediumShare - s.largeBase, M: s.mediumShare, L: s.largeBase };
}

/** Expected value of `table[size]` for an average order. */
function perOrder(table: Record<Size, number>, cfg: SimConfig): number {
  const share = sizeShares(cfg);
  return share.S * table.S + share.M * table.M + share.L * table.L;
}

/**
 * Expected portions of each topping in an average order: the topping count by `toppingCountPercent`, then
 * distinct toppings drawn by weight without repetition, as customers are generated.
 */
function toppingsPerOrder(cfg: SimConfig): Record<ToppingId, number> {
  const c = cfg.customers;
  const out: Record<ToppingId, number> = { pearl: 0, jelly: 0, pudding: 0 };
  // P(t is drawn at this step) summed over every step and path; each path draws t at most once.
  const draw = (left: readonly ToppingId[], picks: number, p: number) => {
    if (picks === 0) return;
    const total = left.reduce((s, t) => s + c.toppingWeights[t], 0);
    for (const t of left) {
      const q = (p * c.toppingWeights[t]) / total;
      out[t] += q;
      draw(left.filter(x => x !== t), picks - 1, q);
    }
  };
  c.toppingCountPercent.forEach((percent, i) => draw(c.toppingOrder, i + 1, percent / 100));
  return out;
}

/** Smallest whole number ≥ x, ignoring floating-point dust from the fractional shares. */
const ceilWhole = (x: number) => -Math.floor(-Math.round(x * 1e6) / 1e6);

/**
 * "Sức pha hôm nay: khoảng N ly" (§5, §4 Nâng cấp): rush ticks over the whole-cup estimate (≈ 18), the machine
 * taking the average pour saving off each cup (≈ 21), plus one staff cup per `staffTicks` (≈ 10) when the shop
 * owns or buys the staff upgrade or the student card's helper comes today.
 */
export function capacityEstimate(run: RunState, plan: MorningPlan, cfg: SimConfig = CONFIG): number {
  const has = (u: 'staff' | 'machine') => run.upgrades.includes(u) || plan.upgrade === u;
  const k = cfg.craft;
  const saving = has('machine') ? perOrder(k.teaTicks, cfg) - perOrder(k.machineTeaTicks, cfg) : 0;
  const player = Math.floor(cfg.rush.ticks / (k.cupTicksEstimate - saving));
  const helper = has('staff') || run.pending.some(p => p.day === run.day && p.tempStaff === true);
  return player + (helper ? Math.floor(cfg.rush.ticks / k.staffTicks) : 0);
}

/**
 * Stock for the quick-fill buttons (§5): "low" and "mid" a fixed number of cups, "high" today's capacity for
 * `run.plan`. Tea and each topping follow the average order; tea rounds up to the purchase step, portions up.
 */
export function quickFill(run: RunState, level: 'low' | 'mid' | 'high',
  cfg: SimConfig = CONFIG): Pick<MorningPlan, 'teaMl' | 'toppings'> {
  const cups = level === 'high' ? capacityEstimate(run, run.plan, cfg) : cfg.morning.quickFillCups[level];
  const step = cfg.supplies.teaStepMl;
  const teaMl = ceilWhole((cups * perOrder(cfg.supplies.sizeMl, cfg)) / step) * step;
  const each = toppingsPerOrder(cfg);
  const toppings = { pearl: 0, jelly: 0, pudding: 0 };
  for (const t of cfg.customers.toppingOrder) toppings[t] = ceilWhole(cups * each[t]);
  return { teaMl, toppings };
}
