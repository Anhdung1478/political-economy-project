// How a customer scores the shops and picks one, with a reason for every shop (spec §4 Khách, §6, §16.2/5/6).
import { CONFIG, type SimConfig } from './config';
import type { Customer, K, LeaveCause, RejectReason, ShopId, ShopVerdict } from './types';

/** What a customer sees of one shop at the moment of choosing. */
export interface ShopOffer {
  id: ShopId; slot: number; open: boolean; price: K;
  /** Effective reputation: rep − today's rumor penalty (computed by the caller). */
  rep: number;
  /** People already in the queue. */
  queue: number;
  /** The shop has stock for this customer's order. */
  canServe: boolean;
  /** Price cut against the morning price, in permille; 0 when not cut. */
  dropPermille: number;
}

/** Appeal of a shop in tenths of K: budget − M price + (rep − 50)·0.2k − 2k per person ahead. */
export function score10(c: Customer, o: ShopOffer, queueAhead: number = o.queue, cfg: SimConfig = CONFIG): number {
  const s = cfg.score;
  return Math.round(c.budget * 10) - Math.round(o.price * 10)
    + (o.rep - s.repPivot) * s.repWeight10 - s.queueWeight10 * queueAhead;
}

/** Skeptic test of a steep cut (§6): leaves if skeptic > 1 − (drop − 20%) × 2.5, on the 0..1000 / permille scale. */
export function passesSkeptic(c: Customer, dropPermille: number, cfg: SimConfig = CONFIG): boolean {
  const p = cfg.priceChange;
  if (dropPermille <= p.discountPermille) return true;
  return c.skeptic * 10 <= 10000 - (dropPermille - p.discountPermille) * p.skepticSlopeTenths;
}

/** Why the customer cannot pick this shop, before comparing scores; null if it is a candidate. */
function rejectReason(c: Customer, o: ShopOffer, visited: readonly ShopId[], cfg: SimConfig):
  { reason: RejectReason; score10: number | null } | null {
  if (!o.open) return { reason: 'closed', score10: null };
  if (visited.includes(o.id)) return { reason: 'visited', score10: null };
  if (!o.canServe) return { reason: 'outOfStock', score10: null };
  if (o.rep < c.trust) return { reason: 'lowTrust', score10: null };
  if (!passesSkeptic(c, o.dropPermille, cfg)) return { reason: 'steepDiscount', score10: null };
  const s = score10(c, o, o.queue, cfg);
  if (o.queue >= cfg.rush.maxQueue) return { reason: 'tooCrowded', score10: s };
  if (s > 0) return null;
  return { reason: score10(c, o, 0, cfg) <= 0 ? 'tooExpensive' : 'tooCrowded', score10: s };
}

/**
 * Scores every shop and picks the best one above 0. Ties rotate by `c.tie` over the tied
 * shops in slot order. Verdicts follow the order of `offers`; an ad customer's verdicts
 * list only its shop; a scared customer picks nothing and every reason is `rumor`.
 * Shops the customer never scores (closed, visited, out of stock, low trust, steep discount) have score10 null.
 */
export function evaluate(c: Customer, offers: readonly ShopOffer[], visited: readonly ShopId[],
  cfg: SimConfig = CONFIG): { chosen: ShopId | null; verdicts: ShopVerdict[] } {
  const seen = c.onlyShop === null ? offers : offers.filter(o => o.id === c.onlyShop);
  if (c.scared) return { chosen: null, verdicts: seen.map(o => ({ shop: o.id, score10: null, reason: 'rumor' })) };

  const verdicts: ShopVerdict[] = [];
  const candidates: { offer: ShopOffer; score: number }[] = [];
  for (const o of seen) {
    const rejected = rejectReason(c, o, visited, cfg);
    if (rejected) {
      verdicts.push({ shop: o.id, ...rejected });
    } else {
      const score = score10(c, o, o.queue, cfg);
      candidates.push({ offer: o, score });
      verdicts.push({ shop: o.id, score10: score, reason: 'otherBetter' });
    }
  }
  if (candidates.length === 0) return { chosen: null, verdicts };

  const best = Math.max(...candidates.map(x => x.score));
  const tied = candidates.filter(x => x.score === best).map(x => x.offer).sort((a, b) => a.slot - b.slot);
  const chosen = tied[c.tie % tied.length].id;
  for (const v of verdicts) if (v.shop === chosen) v.reason = 'chosen';
  return { chosen, verdicts };
}

/**
 * Re-scoring of a queued customer after the shop changed its price (§6, §16.6): `ahead` people
 * stand before them. Leaves on a failed skeptic test, or when the score is 0 or less.
 */
export function staysAfterReprice(c: Customer, o: ShopOffer, ahead: number,
  cfg: SimConfig = CONFIG): { stay: boolean; cause?: LeaveCause } {
  if (!passesSkeptic(c, o.dropPermille, cfg)) return { stay: false, cause: 'steepDiscount' };
  if (score10(c, o, ahead, cfg) <= 0) return { stay: false, cause: 'priceUp' };
  return { stay: true };
}
