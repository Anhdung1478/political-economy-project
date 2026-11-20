// The six AI shops: morning price rules, mid-rush nudges, clamp, rest days, profit and exit
// (spec §4 "6 quán AI", "Chỉnh giá giữa trưa", "Nghỉ bán", "Rút lui"; §7 cartel; §16.1, §16.12).
import { CONFIG, type SimConfig } from './config';
import type { AiShopId, AiShopState, Day, DayRules, K, RunFlags, RushShop, ShopDayResult, ShopId, Tick } from './types';

/** Slot order on the street: top row batu, giare, cochap, luotsong; bottom row sinhvien, player, tapdoan. */
export const STREET: readonly ShopId[] = ['batu', 'giare', 'cochap', 'luotsong', 'sinhvien', 'player', 'tapdoan'];

/** "Kiếm" of a day, the one measure used for every shop including the player: (close − 13k) × sold. */
export function earned(closePrice: K, sold: number, cfg: SimConfig = CONFIG): K {
  return (closePrice - cfg.aiPricing.earnedCost) * sold;
}

function highestAllowed(rules: DayRules, cfg: SimConfig): K {
  const max = cfg.aiPricing.maxPrice;
  return rules.ceiling === null ? max : Math.min(max, rules.ceiling);
}

/** AI prices stay within [cost + tax + 1k, min(50k, ceiling)]; the ceiling wins if the two cross. */
export function clampAiPrice(id: AiShopId, price: K, rules: DayRules, cfg: SimConfig = CONFIG): K {
  const lowest = cfg.aiShops[id].cost + rules.taxPerCup + cfg.aiPricing.clampMargin;
  return Math.min(highestAllowed(rules, cfg), Math.max(lowest, price));
}

/** A shop sits the whole day out when the highest allowed price is below its cost + 7k. */
export function restsToday(id: AiShopId, rules: DayRules, cfg: SimConfig = CONFIG): boolean {
  return highestAllowed(rules, cfg) < cfg.aiShops[id].cost + cfg.aiPricing.restMargin;
}

type PlayerDay = { day: Day; closePrice: K; sold: number };
interface Close { id: ShopId; price: K; sold: number }

/**
 * Days before `today`, latest first, that the rules of `shop` may read (§16.12 "giá tự do gần nhất"):
 * not under a price ceiling, not a cartel day, not a day this shop rested.
 */
function freeDays(shop: AiShopState, today: Day, flags: RunFlags, cfg: SimConfig): Day[] {
  const days: Day[] = [];
  for (let d = today - 1; d >= 1; d--) {
    const day = d as Day;
    const sched = cfg.days[day];
    const cartel = flags.cartel === 'agreed' && sched.cartelPossible;
    const rested = shop.history.some(e => e.day === day && e.rested);
    if (sched.ceiling === null && !cartel && !rested) days.push(day);
  }
  return days;
}

/**
 * Closing prices of every shop (AI and player) that sold on `day`, in street order. On a tax day
 * the 3k pass-through is taken back off the AI closes before any rule reads them (§16.12); the
 * player's close is read as is, since the player set it (ruling R7).
 */
function closesOn(day: Day, shops: readonly AiShopState[], player: readonly PlayerDay[], cfg: SimConfig): Close[] {
  const back = cfg.days[day].taxPerCup > 0 ? cfg.aiPricing.taxPassThrough : 0;
  const closes: Close[] = [];
  for (const s of shops) {
    const e = s.history.find(x => x.day === day);
    if (e && e.closePrice !== null) closes.push({ id: s.id, price: e.closePrice - back, sold: e.sold });
  }
  const pe = player.find(x => x.day === day);
  if (pe) closes.push({ id: 'player', price: pe.closePrice, sold: pe.sold });
  return closes.sort((a, b) => STREET.indexOf(a.id) - STREET.indexOf(b.id));
}

function ownClose(closes: readonly Close[], id: AiShopId): Close {
  const own = closes.find(c => c.id === id);
  if (!own) throw new Error(`no close price for ${id}`);
  return own;
}

/** Sum of twice each price: whole numbers, since prices are multiples of 0.5k. */
const sum2 = (closes: readonly Close[]) => closes.reduce((s, c) => s + c.price * 2, 0);

/** The shop's own pricing rule, before tax pass-through and clamp; Sinh Viên also updates its direction. */
function rulePrice(shop: AiShopState, today: Day, shops: readonly AiShopState[], player: readonly PlayerDay[],
  flags: RunFlags, cfg: SimConfig): { price: K; probeDir: -1 | 1 } {
  const ap = cfg.aiPricing;
  const keep = shop.probeDir;
  const free = freeDays(shop, today, flags, cfg);
  if (free.length === 0) {
    const open = cfg.aiShops[shop.id].openPrice;
    if (open === null) throw new Error(`${shop.id} has no day to price from`);
    return { price: open, probeDir: keep };
  }
  const closes = closesOn(free[0], shops, player, cfg);
  const others = closes.filter(c => c.id !== shop.id);

  switch (shop.id) {
    case 'batu': {
      // Toward the average of the others: compare Σ2·others with 2·own·n, all whole numbers.
      const own = ownClose(closes, 'batu').price;
      const total = sum2(others);
      const ownTotal = own * 2 * others.length;
      return { price: own + (total > ownTotal ? ap.batuNudge : total < ownTotal ? -ap.batuNudge : 0), probeDir: keep };
    }
    case 'giare':
      return { price: Math.min(...others.map(c => c.price)) - ap.giareUndercut, probeDir: keep };
    case 'cochap':
      return { price: ap.cochapPrice, probeDir: keep };
    case 'luotsong': {
      // Strict > keeps the first shop in street order on a tie.
      let best = closes[0];
      for (const c of closes) if (earned(c.price, c.sold, cfg) > earned(best.price, best.sold, cfg)) best = c;
      return { price: best.price, probeDir: keep };
    }
    case 'sinhvien': {
      const last = ownClose(closes, 'sinhvien');
      const before = free.length > 1 ? closesOn(free[1], shops, player, cfg).find(c => c.id === 'sinhvien') : undefined;
      const flip = before !== undefined && earned(last.price, last.sold, cfg) < earned(before.price, before.sold, cfg);
      const dir = flip ? (-keep as -1 | 1) : keep;
      return { price: last.price + ap.sinhvienStep * dir, probeDir: dir };
    }
    case 'tapdoan': {
      // Average rounded to the nearest 0.5k, halves up: round(Σ2 / n) / 2 in whole numbers.
      const n = others.length;
      const avg2 = Math.floor((2 * sum2(others) + n) / (2 * n));
      return { price: avg2 / 2 - ap.tapdoanUndercut, probeDir: keep };
    }
  }
}

/**
 * Morning prices of the AI shops. Opens shops whose first day has come; closed and not-yet shops
 * get no price; a resting shop gets no price. With an agreed cartel every shop asks the cartel price
 * (the rush freezes them). Otherwise each rule reads the latest free day (§16.12), then the tax
 * pass-through is added; on the morning a shop opens, every incumbent not listed in
 * `aiPricing.entryReaction.exempt` is capped at the entrant's opening price + `gap` (§4 "Phản ứng khi
 * có quán mới"); last the result is clamped.
 */
export function morningPrices(shops: readonly AiShopState[], playerHistory: readonly PlayerDay[],
  rules: DayRules, flags: RunFlags, cfg: SimConfig = CONFIG): AiShopState[] {
  // First pass: each shop's own price before the clamp (null when it gets none or asks the cartel price).
  const firstPass = shops.map(shop => {
    const opens = shop.status === 'notYet' && cfg.aiShops[shop.id].firstDay <= rules.day;
    if (shop.status === 'closed' || (shop.status === 'notYet' && !opens)) {
      return { opens, raw: null, state: { ...shop, todayPrice: null, resting: false } };
    }
    const active: AiShopState = { ...shop, status: 'active' };
    if (restsToday(shop.id, rules, cfg)) return { opens, raw: null, state: { ...active, todayPrice: null, resting: true } };
    if (rules.cartel) {
      const price = clampAiPrice(shop.id, cfg.cards.cartel.price, rules, cfg);
      return { opens, raw: null, state: { ...active, todayPrice: price, resting: false } };
    }
    const { price, probeDir } = rulePrice(shop, rules.day, shops, playerHistory, flags, cfg);
    const pass = rules.taxPerCup > 0 ? cfg.aiPricing.taxPassThrough : 0;
    const raw = price + pass;
    return { opens, raw, state: { ...active, todayPrice: clampAiPrice(shop.id, raw, rules, cfg), resting: false, probeDir } };
  });

  // Entry reaction: the entrants' opening prices (their own rule, clamped) cap the incumbents.
  const { gap, exempt } = cfg.aiPricing.entryReaction;
  const entrants = firstPass.flatMap(x => (x.opens && x.raw !== null && x.state.todayPrice !== null ? [x.state.todayPrice] : []));
  if (entrants.length === 0) return firstPass.map(x => x.state);
  const cap = Math.min(...entrants) + gap;
  return firstPass.map(({ opens, raw, state }) => {
    if (opens || raw === null || exempt.includes(state.id)) return state;
    return { ...state, todayPrice: clampAiPrice(state.id, Math.min(raw, cap), rules, cfg) };
  });
}

/**
 * Price nudge at a mid-rush checkpoint (ticks 300 and 600), or null when the price stays.
 * +`midRush.step` if `midRush.queueUp` or more wait, or sold ≥ the checkpoint's `soldUpPercent` of capacity;
 * −`midRush.step` only if nobody waits and sold < its `soldDownPercent` (§4, §16 row 1).
 * Ông Cố Chấp, Chuỗi GiáRẻ, frozen (cartel) shops and shops that are not open never move.
 */
export function midRushPrice(shop: RushShop, tick: Tick, rules: DayRules, cfg: SimConfig = CONFIG): K | null {
  if (shop.id === 'player' || shop.ai === null || shop.ai.frozen || rules.cartel) return null;
  if (shop.status !== 'open' || !cfg.aiShops[shop.id].midRush) return null;
  const cp = cfg.midRush.checkpoints.find(c => c.tick === tick);
  if (!cp) return null;
  const queue = shop.queue.length;
  const sold100 = shop.sold * 100;
  const up = queue >= cfg.midRush.queueUp || sold100 >= cp.soldUpPercent * shop.ai.capacity;
  const down = queue === 0 && sold100 < cp.soldDownPercent * shop.ai.capacity;
  if (!up && !down) return null;
  const next = clampAiPrice(shop.id, shop.price + (up ? cfg.midRush.step : -cfg.midRush.step), rules, cfg);
  return next === shop.price ? null : next;
}

/**
 * Day profit of an AI shop: Σ(price at sale − cost − tax) − cost × unsold cups − rent.
 * AI shops always stock their full capacity. A resting day costs the rent only.
 */
export function aiProfit(id: AiShopId, r: ShopDayResult, rules: DayRules, cfg: SimConfig = CONFIG): K {
  const rent = cfg.aiPricing.rent;
  if (r.status === 'resting') return -rent;
  const cost = cfg.aiShops[id].cost;
  return r.revenue - (cost + rules.taxPerCup) * r.sold - cost * (r.capacity - r.sold) - rent;
}

/**
 * After the evening of `day` (also day 5): an active shop that lost money on `day` and the
 * day before closes for good. `closedOn` is that evening's day; it is gone from the next morning.
 */
export function applyExits(shops: readonly AiShopState[], day: Day, cfg: SimConfig = CONFIG): AiShopState[] {
  return shops.map(shop => {
    if (shop.status !== 'active') return shop;
    for (let k = 0; k < cfg.aiPricing.exitLossDays; k++) {
      const e = shop.history.find(x => x.day === day - k);
      if (!e || e.profit >= 0) return shop;
    }
    return { ...shop, status: 'closed', closedOn: day };
  });
}
