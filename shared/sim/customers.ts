// Who walks down the street each day (spec §4 Khách, plan "Sinh khách").
import { CONFIG, type SimConfig } from './config';
import { shuffle, stream, type Rng } from './rng';
import type { Customer, Day, K, Order, Size, ToppingId } from './types';

/** Customers of the street on `day`: base × day factor, independent of the shops. */
export function customerCount(day: Day, cfg: SimConfig = CONFIG): number {
  return Math.round(cfg.customers.base * cfg.days[day].customerFactor);
}

const roundTo = (x: number, step: number) => Math.round(x / step) * step;

/** Stratum k of n with offset u in [0, 1), mapped onto [min, max]. */
const stratum = (min: number, max: number, k: number, u: number, n: number) => min + ((max - min) * (k + u)) / n;

function drawSize(r: number, budget: K, cfg: SimConfig): Size {
  const c = cfg.customers;
  const mid = (c.budgetMin + c.budgetMax) / 2;
  const pL = c.size.largeBase + (c.size.largeBudgetTilt * (budget - mid)) / (c.budgetMax - c.budgetMin);
  const pS = 1 - c.size.mediumShare - pL;
  if (r < pS) return 'S';
  return r < pS + c.size.mediumShare ? 'M' : 'L';
}

function drawToppings(rng: Rng, cfg: SimConfig): ToppingId[] {
  const c = cfg.customers;
  const roll = rng() * 100;
  let count = c.toppingCountPercent.length - 1;
  for (let i = 0, acc = 0; i < c.toppingCountPercent.length; i++) {
    acc += c.toppingCountPercent[i];
    if (roll < acc) {
      count = i;
      break;
    }
  }
  const left = [...c.toppingOrder];
  const picked: ToppingId[] = [];
  for (let n = 0; n < count; n++) {
    const total = left.reduce((s, t) => s + c.toppingWeights[t], 0);
    let x = rng() * total;
    let i = 0;
    while (i < left.length - 1 && x >= c.toppingWeights[left[i]]) x -= c.toppingWeights[left[i++]];
    picked.push(left[i]);
    left.splice(i, 1);
  }
  return c.toppingOrder.filter(t => picked.includes(t));
}

/** Integer in 0..max inclusive. */
const int = (rng: Rng, max: number) => Math.floor(rng() * (max + 1));

/**
 * Every trait after budget and trust, drawn in a fixed order; the variable-length
 * topping draws come last so they never shift another trait.
 */
function traits(rng: Rng, id: number, budget: K, trust: number, day: Day, look: number, noIce: boolean,
  cfg: SimConfig): Customer {
  const c = cfg.customers;
  const schedule = cfg.days[day];
  const skeptic = int(rng, c.skepticMax);
  const sizeRoll = rng();
  const arriveTick = Math.floor(rng() * cfg.rush.arrivalWindowTicks);
  const busRoll = rng();
  const sideRoll = rng();
  const tie = int(rng, c.tieMax);
  const scaredRoll = rng();
  const order: Order = { size: drawSize(sizeRoll, budget, cfg), toppings: drawToppings(rng, cfg), noIce };
  const side = sideRoll < c.entryLeftShare ? 'left' : 'right';
  return {
    id, budget, trust, skeptic, order, arriveTick,
    entry: schedule.busStop && busRoll < c.busShare ? 'bus' : side,
    tie, look,
    scared: schedule.rumor && arriveTick < cfg.rumor.inspectionTick && scaredRoll < cfg.rumor.scaredShare,
    onlyShop: null,
  };
}

/** Display-only appearance seed of customer `id` (stream `look/{day}/{id}`), a 32-bit unsigned integer. */
const lookOf = (seed: number, day: Day, id: number) => Math.floor(stream(seed, `look/${day}/${id}`)() * 4294967296);

/** Whether customer `id` orders "không đá" (stream `ice/{day}/{id}`, so it never shifts another trait's draw). */
const noIceOf = (seed: number, day: Day, id: number, cfg: SimConfig) =>
  stream(seed, `ice/${day}/${id}`)() * 100 < cfg.customers.noIcePercent;

/** The day's street customers, id = index. Budget and trust are stratified so they cover their range evenly. */
export function generateCustomers(seed: number, day: Day, cfg: SimConfig = CONFIG): Customer[] {
  const c = cfg.customers;
  const n = customerCount(day, cfg);
  const ids = Array.from({ length: n }, (_, i) => i);
  const budgetStrata = shuffle(ids, stream(seed, `strata/${day}/budget`));
  const trustStrata = shuffle(ids, stream(seed, `strata/${day}/trust`));
  return ids.map(i => {
    const rng = stream(seed, `cust/${day}/${i}`);
    const budget = roundTo(stratum(c.budgetMin, c.budgetMax, budgetStrata[i], rng(), n), c.budgetStep);
    const trust = Math.round(stratum(c.trustMin, c.trustMax, trustStrata[i], rng(), n));
    return traits(rng, i, budget, trust, day, lookOf(seed, day, i), noIceOf(seed, day, i, cfg), cfg);
  });
}

/**
 * Customers brought by the delivery-app card: budget uniform in the card's range, trust 0,
 * arriving within the normal window, considering only the player's shop. Their own streams
 * (`ad/{day}/{j}`) leave the street customers untouched.
 */
export function generateAdCustomers(seed: number, day: Day, firstId: number, count: number,
  cfg: SimConfig = CONFIG): Customer[] {
  const ad = cfg.cards.deliveryAd;
  return Array.from({ length: count }, (_, j) => {
    const id = firstId + j;
    const rng = stream(seed, `ad/${day}/${j}`);
    const budget = roundTo(ad.budgetMin + (ad.budgetMax - ad.budgetMin) * rng(), cfg.customers.budgetStep);
    const c = traits(rng, id, budget, ad.trust, day, lookOf(seed, day, id), noIceOf(seed, day, id, cfg), cfg);
    return { ...c, scared: false, onlyShop: 'player' };
  });
}
