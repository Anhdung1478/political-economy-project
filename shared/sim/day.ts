// The player's morning (spec §5) and the opening of the shop: today's rules, the cost and checks of a plan, the
// quick-fill buttons and the capacity line, the morning brief, and `openDay`, which pays and starts the rush.
import { CONFIG, type SimConfig } from './config';
import { customerCount } from './customers';
import { createRush, type RushInput } from './rush';
import { STREET, morningPrices } from './shops';
import type {
  AiShopId, BriefShopRow, DayReport, DayRules, K, MorningBrief, MorningPlan, PendingEffect, PlanIssue, RepItem,
  RunState, RushState, ShopId, SimEvent, Size, ToppingId,
} from './types';

/** Today's rules (§3): ceiling, tax, rumor and crowd from the schedule; the cartel holds only on its day, if agreed. */
export function dayRules(run: RunState, cfg: SimConfig = CONFIG): DayRules {
  const d = cfg.days[run.day];
  return {
    day: run.day, ceiling: d.ceiling, taxPerCup: d.taxPerCup, rumor: d.rumor,
    cartel: d.cartelPossible && run.flags.cartel === 'agreed', customerFactor: d.customerFactor,
  };
}

/** Days 3–4 after buying the shock toppings (§7): cheap portions, and a skimp day. */
const shockDay = (run: RunState, cfg: SimConfig) =>
  run.flags.shockTopping && cfg.cards.shockTopping.days.includes(run.day);

/** What the plan costs this morning (§4 Giá và chi phí, Nâng cấp) and the cash left after paying it. */
export function planCost(run: RunState, plan: MorningPlan, cfg: SimConfig = CONFIG):
  { tea: K; toppings: K; upgrade: K; total: K; cashAfter: K } {
  const s = cfg.supplies;
  const tea = (plan.teaMl * s.teaGrades[plan.tea].costPer100Ml) / 100;
  const each = shockDay(run, cfg) ? cfg.cards.shockTopping.toppingCost : s.toppingCost;
  const toppings = cfg.customers.toppingOrder.reduce((sum, t) => sum + plan.toppings[t] * each, 0);
  const upgrade = plan.upgrade === null ? 0 : cfg.upgrades[plan.upgrade].cost;
  const total = tea + toppings + upgrade;
  return { tea, toppings, upgrade, total, cashAfter: run.cash - total };
}

/**
 * Every problem with the plan, in a fixed order; empty when the shop may open with it. Credit runs down to the
 * floor (§4), but a plan with no stock and no upgrade is always allowed, so a run deep in debt can still open (§5).
 * One upgrade a morning follows from the plan's single upgrade and `openDay` running once a morning.
 */
export function validatePlan(run: RunState, plan: MorningPlan, cfg: SimConfig = CONFIG): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const p = cfg.pricing;
  if (!(plan.price >= p.min && plan.price <= p.max) || !Number.isInteger((plan.price - p.min) / p.step)) {
    issues.push('price');
  }
  const ceiling = dayRules(run, cfg).ceiling;
  if (ceiling !== null && plan.price > ceiling) issues.push('ceiling');
  if (plan.teaMl % cfg.supplies.teaStepMl !== 0) issues.push('teaStep');
  const amounts = [plan.teaMl, ...cfg.customers.toppingOrder.map(t => plan.toppings[t])];
  if (amounts.some(x => x < 0)) issues.push('negative');
  if (plan.upgrade !== null && run.upgrades.includes(plan.upgrade)) issues.push('upgradeOwned');
  const empty = plan.upgrade === null && amounts.every(x => x === 0);
  if (!empty && planCost(run, plan, cfg).cashAfter < cfg.run.creditFloor) issues.push('credit');
  return issues;
}

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
 * Stock for the quick-fill buttons (§5): "low" and "mid" a fixed number of cups, "high" today's capacity for the
 * morning's draft `plan` (R24). Tea and each topping follow the average order; tea rounds up to the purchase step,
 * portions up.
 */
export function quickFill(run: RunState, level: 'low' | 'mid' | 'high', plan: MorningPlan = run.plan,
  cfg: SimConfig = CONFIG): Pick<MorningPlan, 'teaMl' | 'toppings'> {
  const cups = level === 'high' ? capacityEstimate(run, plan, cfg) : cfg.morning.quickFillCups[level];
  const step = cfg.supplies.teaStepMl;
  const teaMl = ceilWhole((cups * perOrder(cfg.supplies.sizeMl, cfg)) / step) * step;
  const each = toppingsPerOrder(cfg);
  const toppings = { pearl: 0, jelly: 0, pudding: 0 };
  for (const t of cfg.customers.toppingOrder) toppings[t] = ceilWhole(cups * each[t]);
  return { teaMl, toppings };
}

/** Delayed card effects that land on the morning of `run.day`. */
const dueToday = (run: RunState): PendingEffect[] => run.pending.filter(p => p.day === run.day);

function briefRow(id: ShopId, run: RunState, last: DayReport, cfg: SimConfig): BriefShopRow {
  const r = last.street.find(s => s.id === id);
  const closePrice = r?.closePrice ?? null;
  const sold = r?.sold ?? 0;
  const soldOut = r?.soldOut ?? false;
  if (id === 'player') return { id, closePrice, sold, soldOut, unsold: null, opensToday: false, closedOn: null };
  const shop = run.shops.find(s => s.id === id);
  if (shop === undefined) throw new Error(`no shop ${id} in the run`);
  return {
    id, closePrice, sold, soldOut,
    unsold: r === undefined || closePrice === null ? 0 : r.capacity - r.sold,
    opensToday: shop.status === 'notYet' && cfg.aiShops[id as AiShopId].firstDay <= run.day,
    closedOn: shop.closedOn,
  };
}

/**
 * The morning screen's data (§5): today's theme and rules, the delayed effects landing this morning, yesterday's
 * street and hint line from yesterday's report, the capacity line for `run.plan`, the day-5 bus line, cash and rep.
 */
export function morningBrief(run: RunState, cfg: SimConfig = CONFIG): MorningBrief {
  const sched = cfg.days[run.day];
  const last = run.reports.find(r => r.summary.day === run.day - 1);
  let bus: MorningBrief['bus'] = null;
  if (sched.busStop) {
    const noStop: SimConfig = { ...cfg, days: { ...cfg.days, [run.day]: { ...sched, customerFactor: 1 } } };
    bus = { without: customerCount(run.day, noStop), with: customerCount(run.day, cfg) };
  }
  return {
    day: run.day, theme: sched.theme, rules: dayRules(run, cfg), busStop: sched.busStop,
    news: dueToday(run),
    street: last === undefined ? [] : STREET.map(id => briefRow(id, run, last, cfg)),
    yesterday: last === undefined ? null : {
      cups: last.summary.cups,
      used: { teaMl: last.summary.used.teaMl, toppings: { ...last.summary.used.toppings } },
    },
    capacity: capacityEstimate(run, run.plan, cfg),
    bus, cash: run.cash, rep: run.rep,
  };
}

/**
 * "Mở cửa" (§5): checks the plan, then applies this morning's delayed effects (cash, rep, the student's helper, ad
 * customers) and removes them; pays for the stock and the upgrade (R27); the banner's +10 lands now; the morning's
 * rep items are summed and clamped once and never end the run (§16 row 10). Counts a skimp day (skimp tea, or the
 * shock toppings on days 3–4; §16 row 9), prices the AI shops from their books and the player's reports (Chuỗi Tập
 * Đoàn opens on its first day) and starts the rush. `events` is empty: the first step emits `rushStart`.
 */
export function openDay(run: RunState, plan: MorningPlan, cfg: SimConfig = CONFIG):
  { run: RunState; rush: RushState; events: SimEvent[] } {
  if (run.phase !== 'morning') throw new Error(`cannot open the shop in phase ${run.phase}`);
  const issues = validatePlan(run, plan, cfg);
  if (issues.length > 0) throw new Error(`invalid plan: ${issues.join(', ')}`);

  const due = dueToday(run);
  const morningNews: RepItem[] = [];
  for (const p of due) {
    if (p.rep === undefined) continue;
    // The cartel break's gossip is a consequence of the cartel card.
    morningNews.push({ reason: p.source === 'cartelBreak' ? 'cartel' : p.source, delta: p.rep, when: 'morning' });
  }
  if (plan.upgrade === 'banner') {
    morningNews.push({ reason: 'banner', delta: cfg.upgrades.banner.rep, when: 'morning' });
  }
  const rep = Math.min(cfg.run.maxRep,
    Math.max(cfg.run.minRep, run.rep + morningNews.reduce((sum, i) => sum + i.delta, 0)));
  const tempStaff = due.some(p => p.tempStaff === true);
  const adCustomers = due.reduce((sum, p) => sum + (p.adCustomers ?? 0), 0);
  const spent = planCost(run, plan, cfg).total;
  const cash = run.cash + due.reduce((sum, p) => sum + (p.cash ?? 0), 0) - spent;
  const upgrades = plan.upgrade === null ? run.upgrades : [...run.upgrades, plan.upgrade];
  const skimpDays = run.skimpDays + (plan.tea === 'skimp' || shockDay(run, cfg) ? 1 : 0);

  const rules = dayRules(run, cfg);
  const playerHistory = run.reports.map(r =>
    ({ day: r.summary.day, closePrice: r.summary.closePrice, sold: r.summary.cups }));
  const shops = morningPrices(run.shops, playerHistory, rules, run.flags, cfg);
  const own: MorningPlan = { ...plan, toppings: { ...plan.toppings } };
  const input: RushInput = {
    seed: run.seed, rules, ai: shops, adCustomers,
    player: {
      price: plan.price, tea: plan.tea, stock: { teaMl: plan.teaMl, toppings: { ...plan.toppings } }, rep,
      machine: upgrades.includes('machine'), staff: upgrades.includes('staff') || tempStaff,
      skimpDays, selfCertified: run.flags.inspection === 'pass',
    },
  };
  const { state, events } = createRush(input, cfg);
  return {
    run: {
      ...run, phase: 'rush', cash, rep, upgrades, skimpDays, shops,
      pending: run.pending.filter(p => p.day !== run.day),
      plan: own, morningNews, today: { plan: own, spent, tempStaff }, rushResult: null,
    },
    rush: state,
    events,
  };
}
