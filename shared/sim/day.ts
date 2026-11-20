// The player's day around the rush (spec §5, §8): today's rules, the cost and checks of a plan, the quick-fill
// buttons and the capacity line, the morning brief, `openDay`, which pays and starts the rush, and `closeDay`, the
// evening that settles the day and writes its report.
import { CONFIG, type SimConfig } from './config';
import { customerCount } from './customers';
import { createRush, type RushInput } from './rush';
import { STREET, aiProfit, applyExits, morningPrices } from './shops';
import type {
  AiShopId, AiShopState, BriefShopRow, ChoiceLabel, Day, DayReport, DayRules, DaySummary, K, MorningBrief, MorningPlan,
  PendingEffect, PlanIssue, RepItem, RepReason, RunState, RushResult, RushState, ShopDayResult, ShopId, SimEvent, Size, Stock,
  ToppingId,
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

/** Price of a topping portion today. */
const toppingUnit = (run: RunState, cfg: SimConfig): K =>
  (shockDay(run, cfg) ? cfg.cards.shockTopping.toppingCost : cfg.supplies.toppingCost);

/** Skimp tea bought today: the `skimp` label (R33). A grade with no tea bought does not count (R31). */
const skimpTea = (plan: MorningPlan) => plan.tea === 'skimp' && plan.teaMl > 0;

/** Shock toppings bought on their days: the evening's −3 (R32). */
const shockToppings = (run: RunState, plan: MorningPlan, cfg: SimConfig) =>
  shockDay(run, cfg) && cfg.customers.toppingOrder.some(t => plan.toppings[t] > 0);

/** A skimp day for the rumor and the inspection (§4 Uy tín, §16 row 9, R31): skimp tea or shock toppings bought. */
const skimpToday = (run: RunState, plan: MorningPlan, cfg: SimConfig) =>
  skimpTea(plan) || shockToppings(run, plan, cfg);

const clampRep = (rep: number, cfg: SimConfig) => Math.min(cfg.run.maxRep, Math.max(cfg.run.minRep, rep));

/** A copy of the plan with −0 written as 0, so the stored plan survives a JSON round trip exactly. */
const plainPlan = (p: MorningPlan): MorningPlan => ({
  price: p.price + 0, tea: p.tea, teaMl: p.teaMl + 0, upgrade: p.upgrade,
  toppings: { pearl: p.toppings.pearl + 0, jelly: p.toppings.jelly + 0, pudding: p.toppings.pudding + 0 },
});

/** Delayed card effects that land on the morning of `run.day`. */
const dueToday = (run: RunState): PendingEffect[] => run.pending.filter(p => p.day === run.day);

/** Cash when the shop opens, before paying for the plan: this morning's delayed cash has landed (R28). */
const cashAtOpening = (run: RunState): K => run.cash + dueToday(run).reduce((sum, p) => sum + (p.cash ?? 0), 0);

/**
 * What the plan costs this morning (§4 Giá và chi phí, Nâng cấp) and the cash left after paying it, counted from
 * the cash at opening (R28).
 */
export function planCost(run: RunState, plan: MorningPlan, cfg: SimConfig = CONFIG):
  { tea: K; toppings: K; upgrade: K; total: K; cashAfter: K } {
  const s = cfg.supplies;
  const tea = (plan.teaMl * s.teaGrades[plan.tea].costPer100Ml) / 100;
  const each = toppingUnit(run, cfg);
  const toppings = cfg.customers.toppingOrder.reduce((sum, t) => sum + plan.toppings[t] * each, 0);
  const upgrade = plan.upgrade === null ? 0 : cfg.upgrades[plan.upgrade].cost;
  const total = tea + toppings + upgrade;
  return { tea, toppings, upgrade, total, cashAfter: cashAtOpening(run) - total };
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
  if (!cfg.customers.toppingOrder.every(t => Number.isInteger(plan.toppings[t]))) issues.push('toppingStep');
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
const ceilWhole = (x: number) => -Math.floor(-Math.round(x * 1e6) / 1e6) + 0;

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

function briefRow(id: ShopId, run: RunState, last: DayReport, cfg: SimConfig): BriefShopRow {
  const r = last.street.find(s => s.id === id);
  const closePrice = r?.closePrice ?? null;
  const sold = r?.sold ?? 0;
  const soldOut = r?.soldOut ?? false;
  if (id === 'player') return { id, status: 'open', closePrice, sold, soldOut, unsold: null, closedOn: null };
  const shop = run.shops.find(s => s.id === id);
  if (shop === undefined) throw new Error(`no shop ${id} in the run`);
  let status: BriefShopRow['status'] = r?.status === 'resting' ? 'rested' : 'open';
  if (shop.status === 'closed') status = 'closed';
  else if (shop.status === 'notYet') status = cfg.aiShops[id as AiShopId].firstDay <= run.day ? 'new' : 'notYet';
  return {
    id, status, closePrice, sold, soldOut,
    unsold: r === undefined || closePrice === null ? 0 : r.capacity - r.sold,
    closedOn: shop.closedOn,
  };
}

/** The street's customers without and with the day's bus stop (§4 Chính sách). */
function busLine(day: Day, cfg: SimConfig): { without: number; with: number } {
  const noStop: SimConfig = { ...cfg, days: { ...cfg.days, [day]: { ...cfg.days[day], customerFactor: 1 } } };
  return { without: customerCount(day, noStop), with: customerCount(day, cfg) };
}

/**
 * The morning screen's data (§5): today's theme and rules, the delayed effects landing this morning, yesterday's
 * street and hint line from yesterday's report, the capacity line for `run.plan`, the day-5 bus line, today's
 * topping price, the cash at opening (R28), and the rep after this morning's delayed rep, clamped (a banner bought
 * this morning adds its +10 at opening on top).
 */
export function morningBrief(run: RunState, cfg: SimConfig = CONFIG): MorningBrief {
  const sched = cfg.days[run.day];
  const last = run.reports.find(r => r.summary.day === run.day - 1);
  const due = dueToday(run);
  return {
    day: run.day, theme: sched.theme, rules: dayRules(run, cfg), busStop: sched.busStop,
    news: due,
    street: last === undefined ? [] : STREET.map(id => briefRow(id, run, last, cfg)),
    yesterday: last === undefined ? null : {
      cups: last.summary.cups,
      used: { teaMl: last.summary.used.teaMl, toppings: { ...last.summary.used.toppings } },
    },
    capacity: capacityEstimate(run, run.plan, cfg),
    bus: sched.busStop ? busLine(run.day, cfg) : null,
    cash: cashAtOpening(run),
    rep: clampRep(run.rep + due.reduce((sum, p) => sum + (p.rep ?? 0), 0), cfg),
    toppingCost: toppingUnit(run, cfg),
    beforeCeiling: beforeCeiling(run, cfg),
  };
}

/** The latest report of a day with no ceiling; null when there is none. */
export function lastFreeReport(run: RunState, cfg: SimConfig = CONFIG): DayReport | null {
  for (let i = run.reports.length - 1; i >= 0; i--) {
    if (cfg.days[run.reports[i].summary.day].ceiling === null) return run.reports[i];
  }
  return null;
}

/** The hint of the morning after a ceiling day (R76): see `MorningBrief.beforeCeiling`. */
function beforeCeiling(run: RunState, cfg: SimConfig): MorningBrief['beforeCeiling'] {
  const yesterday = run.day - 1;
  if (yesterday < 1 || cfg.days[yesterday as Day].ceiling === null) return null;
  const free = lastFreeReport(run, cfg);
  if (free === null) return null;
  const closes = prices(free.street, 'closePrice');
  if (closes.length === 0) return null;
  return { day: free.summary.day, average: Math.round((closes.reduce((s, x) => s + x, 0) / closes.length) * 2) / 2 };
}

/**
 * "Mở cửa" (§5): checks the plan, then applies this morning's delayed effects (cash, rep, the student's helper, ad
 * customers), records them in `today.applied` (R29) and removes them; pays for the stock and the upgrade (R27);
 * the banner's +10 lands now; the morning's rep items are summed and clamped once and never end the run (§16 row
 * 10). Counts a skimp day (skimp tea, or the shock toppings on days 3–4, when bought; §16 row 9, R31), prices the
 * AI shops from their books and the player's reports (Chuỗi Tập Đoàn opens on its first day) and starts the rush.
 * `events` is empty: the first step emits `rushStart`.
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
  const rep = clampRep(run.rep + morningNews.reduce((sum, i) => sum + i.delta, 0), cfg);
  const tempStaff = due.some(p => p.tempStaff === true);
  const adCustomers = due.reduce((sum, p) => sum + (p.adCustomers ?? 0), 0);
  const own = plainPlan(plan);
  const paid = planCost(run, own, cfg);
  const cash = cashAtOpening(run) - paid.total;
  const upgrades = plan.upgrade === null ? run.upgrades : [...run.upgrades, plan.upgrade];
  const skimpDays = run.skimpDays + (skimpToday(run, plan, cfg) ? 1 : 0);

  const rules = dayRules(run, cfg);
  const playerHistory = run.reports.map(r =>
    ({ day: r.summary.day, closePrice: r.summary.closePrice, sold: r.summary.cups }));
  const shops = morningPrices(run.shops, playerHistory, rules, run.flags, cfg);
  const input: RushInput = {
    seed: run.seed, rules, ai: shops, adCustomers,
    player: {
      price: own.price, tea: own.tea, stock: { teaMl: own.teaMl, toppings: { ...own.toppings } }, rep,
      machine: upgrades.includes('machine'), staff: upgrades.includes('staff') || tempStaff,
      skimpDays, selfCertified: run.flags.inspection === 'pass',
    },
  };
  const { state, events } = createRush(input, cfg);
  return {
    run: {
      ...run, phase: 'rush', cash, rep, upgrades, skimpDays, shops,
      pending: run.pending.filter(p => p.day !== run.day),
      plan: own, morningNews, today: {
        plan: own, cost: { tea: paid.tea, toppings: paid.toppings, upgrade: paid.upgrade }, tempStaff, applied: due,
        cardCash: 0,
      },
      rushResult: null,
    },
    rush: state,
    events,
  };
}

/** Score (§3): profit over the starting cash plus the brand value of the rep. Re-exported by `run.ts`. */
export function score(run: RunState, cfg: SimConfig = CONFIG): { profit: K; brand: K; total: K } {
  const profit = run.cash - cfg.run.startCash;
  const brand = run.rep * cfg.run.brandPerRep;
  return { profit, brand, total: profit + brand };
}

/**
 * The evening's rep items (§4 Uy tín, §7), in a fixed order: tea grade (only with tea bought, R31), wrong cups,
 * walkouts, gouging, clean service (§16 row 11), the afternoon's card rep, the cartel fine, the shock toppings (only
 * with toppings bought, R32).
 */
function eveningRep(run: RunState, plan: MorningPlan, p: RushResult['player'], rules: DayRules, cfg: SimConfig):
  RepItem[] {
  const r = cfg.rep;
  const items: RepItem[] = [];
  const add = (reason: RepReason, delta: number, count?: number) =>
    items.push(count === undefined ? { reason, delta, when: 'evening' } : { reason, delta, count, when: 'evening' });
  const tea = cfg.supplies.teaGrades[plan.tea].rep;
  if (plan.teaMl > 0 && tea !== 0) add('tea', tea);
  if (p.wrong > 0) add('wrong', r.wrongCup * p.wrong, p.wrong);
  if (p.walkouts > 0) add('walkout', r.walkout * p.walkouts, p.walkouts);
  if (p.gouged) add('gouge', r.gouge);
  if (p.cups >= r.cleanMinCups && p.wrong === 0 && p.walkouts === 0) add('clean', r.clean);
  items.push(...run.cardRep);
  if (rules.cartel) add('cartel', cfg.cards.cartel.fineRep);
  if (shockToppings(run, plan, cfg)) add('shockTopping', cfg.cards.shockTopping.repPerDay);
  return items;
}

/**
 * Labels of the day (§8 màn kết): skimp tea used (R33; a shock-topping day is a skimp day for the rumor but its
 * label is `shockTopping`, earned with the card), the cartel's outcome, then today's choices that earn one.
 */
function dayLabels(run: RunState, plan: MorningPlan, p: RushResult['player'], rules: DayRules): ChoiceLabel[] {
  const labels: ChoiceLabel[] = [];
  if (skimpTea(plan)) labels.push('skimp');
  if (rules.cartel) labels.push(p.brokeCartel ? 'cartelBroke' : 'cartelKept');
  for (const c of run.choices) {
    if (c.id === 'shockTopping' && c.choice === 'A') labels.push('shockTopping');
    if (c.id === 'blackMarket' && c.choice === 'A') labels.push('blackMarket');
    if (c.id === 'tax' && c.choice === 'B') labels.push('taxEvaded');
    if (c.id === 'inspection' && c.choice === 'A') labels.push(run.flags.inspection === 'pass' ? 'inspectPass' : 'inspectFail');
  }
  return labels;
}

/** Prices of the shops that sold, the player included (§16 row 16). */
const prices = (street: readonly ShopDayResult[], key: 'openPrice' | 'closePrice'): K[] =>
  street.flatMap(s => { const k = s[key]; return k === null ? [] : [k]; });
/** Mean rounded to the nearest 0.5k, halves up. */
const mean = (xs: readonly K[]): K => Math.round((xs.reduce((s, x) => s + x, 0) * 2) / xs.length) / 2;

/**
 * The lesson card's id and real numbers (§3, §8), by the day's theme; the UI writes the sentences.
 * - opening `freeMarket`: the street's opening and closing price ranges (openMin, openMax, closeMin, closeMax).
 * - newShop `entryRefused` / `cartelKept` / `cartelBroke`: the average close of yesterday and today (avgClose1,
 *   avgClose2, to 0.5k) and the fine.
 * - priceCeiling `ceiling`: customers who left empty-handed, those who could pay, AI shops resting.
 * - tax `tax`: the ward's fund, the player's tax, evaded 0/1.
 * - rumor `rumor`: customers without and with the bus stop, scared, certified and named shops.
 */
function lessonOf(run: RunState, result: RushResult, fines: K, rules: DayRules, cfg: SimConfig): DayReport['lesson'] {
  const street = result.shops;
  switch (cfg.days[run.day].theme) {
    case 'opening': {
      const open = prices(street, 'openPrice');
      const close = prices(street, 'closePrice');
      return { id: 'freeMarket', data: {
        openMin: Math.min(...open), openMax: Math.max(...open), closeMin: Math.min(...close), closeMax: Math.max(...close),
      } };
    }
    case 'newShop': {
      const yesterday = run.reports.find(r => r.summary.day === run.day - 1);
      if (yesterday === undefined) throw new Error(`no report of day ${run.day - 1}`);
      const id = !rules.cartel ? 'entryRefused' : result.player.brokeCartel ? 'cartelBroke' : 'cartelKept';
      return { id, data: {
        avgClose1: mean(prices(yesterday.street, 'closePrice')), avgClose2: mean(prices(street, 'closePrice')), fine: fines,
      } };
    }
    case 'priceCeiling':
      return { id: 'ceiling', data: {
        emptyHanded: result.emptyHanded, eligible: result.eligible,
        resting: street.filter(s => s.status === 'resting').length,
      } };
    case 'tax':
      return { id: 'tax', data: { taxFund: result.taxFund, tax: result.player.tax, evaded: run.flags.taxEvaded ? 1 : 0 } };
    case 'rumor':
      return { id: 'rumor', data: {
        ...busLine(run.day, cfg), scared: result.scared, certified: result.certified.length, named: result.named.length,
      } };
  }
}

/**
 * The evening (§4, §7, §8), after the last card. Money (R27, §16 row 13): stock, upgrade, takings less tax and card
 * cash were settled earlier; only fines move cash now, even below the credit floor. Day profit = revenue − tea −
 * toppings − tax − fines; the upgrade, card cash and delayed cash are report lines of their own. On the cartel day
 * with the cartel agreed: the `cards.cartel.fine` and `cards.cartel.fineRep` either way, and breaking it sets
 * `cartelBroken` and the street's gossip for the next morning. The evening rep items are summed and clamped once; rep 0 loses the run (§16 row 10),
 * on day 5 too. Every AI shop that sold or rested books the day (`aiProfit`), then the exits run (also after day 5).
 * Writes the day's `DaySummary` and `DayReport` and moves to the report.
 */
export function closeDay(run: RunState, cfg: SimConfig = CONFIG): RunState {
  if (run.phase !== 'cards') throw new Error(`cannot close the day in phase ${run.phase}`);
  if (run.cardIndex !== run.cards.length) throw new Error('cards left to choose');
  const { rushResult: result, today } = run;
  if (result === null || today === null) throw new Error('no day to close');
  const { day } = run;
  const plan = today.plan;
  const p = result.player;
  const rules = dayRules(run, cfg);

  const cost = today.cost.tea + today.cost.toppings;
  const fines = rules.cartel ? cfg.cards.cartel.fine : 0;
  const profit = p.revenue - cost - p.tax - fines;
  const cash = run.cash - fines;
  const unit = toppingUnit(run, cfg);
  // R75: everything bought that did not go into a handed-over cup: leftover stock, trashed cups, the cup at close.
  // A run saved at the cards before R75 has no `handed`: it then counts the leftover stock alone, as it did.
  const valueOf = (s: Stock): K => (s.teaMl * cfg.supplies.teaGrades[plan.tea].costPer100Ml) / 100
    + cfg.customers.toppingOrder.reduce((sum, t) => sum + s.toppings[t] * unit, 0);
  const wasteValue = valueOf(p.used) - valueOf(p.handed ?? p.used) + valueOf(p.left);

  const items = eveningRep(run, plan, p, rules, cfg);
  const rep = clampRep(run.rep + items.reduce((sum, i) => sum + i.delta, 0), cfg);
  const lost = rep <= cfg.run.minRep;

  let { flags, pending } = run;
  if (rules.cartel && p.brokeCartel) {
    const c = cfg.cards.cartel;
    const on = day + c.breakDelayDays;
    if (on > cfg.run.dayCount) throw new Error('the cartel break lands after the last day');
    flags = { ...flags, cartelBroken: true };
    pending = [...pending, { day: on as Day, source: 'cartelBreak', rep: c.breakRep }];
  }

  const aiDay = new Map<ShopId, K>();
  const booked: AiShopState[] = run.shops.map(s => {
    if (s.status !== 'active') return s;
    const row = result.shops.find(x => x.id === s.id);
    if (row === undefined) throw new Error(`no result for ${s.id}`);
    const earned = aiProfit(s.id, row, rules, cfg);
    aiDay.set(s.id, earned);
    return { ...s, history: [...s.history,
      { day, closePrice: row.closePrice, sold: row.sold, profit: earned, rested: s.resting }] };
  });
  const street = result.shops.map(row => ({ ...row, profit: row.id === 'player' ? profit : aiDay.get(row.id) ?? null }));

  const summary: DaySummary = {
    day, openPrice: plan.price, closePrice: p.closePrice, tea: plan.tea,
    bought: { teaMl: plan.teaMl, toppings: { ...plan.toppings } },
    used: { teaMl: p.used.teaMl, toppings: { ...p.used.toppings } }, wasteValue,
    cups: p.cups, wrong: p.wrong, walkouts: p.walkouts,
    revenue: p.revenue, cost, tax: p.tax, fines, profit, cash, rep, score: score({ ...run, cash, rep }, cfg).total,
    upgrade: plan.upgrade, cards: run.choices.map(c => ({ ...c })), labels: dayLabels(run, plan, p, rules), lost,
  };
  const before = run.reports.find(r => r.summary.day === day - 1);
  const report: DayReport = {
    summary,
    repItems: [...run.morningNews, ...items],
    repBefore: before === undefined ? cfg.run.startRep : before.summary.rep,
    street, emptyHanded: result.emptyHanded, eligible: result.eligible, taxFund: result.taxFund,
    missedNoStock: p.missedNoStock, teaCost: today.cost.tea, toppingCost: today.cost.toppings,
    upgradeCost: today.cost.upgrade, cardCash: today.cardCash,
    delayedCash: today.applied.reduce((sum, e) => sum + (e.cash ?? 0), 0),
    lesson: lessonOf(run, result, fines, rules, cfg),
  };
  return {
    ...run, phase: 'report', cash, rep, flags, pending, shops: applyExits(booked, day, cfg),
    reports: [...run.reports, report], outcome: lost ? 'lostTrust' : run.outcome,
  };
}
