import { describe, expect, it } from 'vitest';
import { CONFIG, type SimConfig } from './config';
import { evaluate, passesSkeptic, score10, staysAfterReprice, type ShopOffer } from './choice';
import type { Customer, ShopId } from './types';

const cust = (over: Partial<Customer> = {}): Customer => ({
  id: 0, budget: 35, trust: 20, skeptic: 500,
  order: { size: 'M', toppings: ['pearl'] }, arriveTick: 0, entry: 'left',
  tie: 0, look: 0, scared: false, onlyShop: null, ...over,
});

const offer = (id: ShopId, slot: number, over: Partial<ShopOffer> = {}): ShopOffer => ({
  id, slot, open: true, price: 30, rep: 50, queue: 0, canServe: true, dropPermille: 0, ...over,
});

const reasons = (r: ReturnType<typeof evaluate>) => Object.fromEntries(r.verdicts.map(v => [v.shop, v.reason]));

describe('score10', () => {
  it('is budget − price + (rep − 50) × 0.2k − 2k × queue, in tenths of k', () => {
    // 35 − 30 + 10 × 0.2 − 2 × 2 = 3k
    expect(score10(cust(), offer('batu', 0, { rep: 60, queue: 2 }))).toBe(30);
    // 35 − 30 − 20 × 0.2 = 1k
    expect(score10(cust(), offer('giare', 1, { rep: 30 }))).toBe(10);
  });

  it('handles half-k budgets and prices as whole tenths', () => {
    expect(score10(cust({ budget: 22.5 }), offer('batu', 0, { price: 20.5 }))).toBe(20);
  });

  it('uses queueAhead instead of the queue length when given', () => {
    expect(score10(cust(), offer('batu', 0, { queue: 4 }), 1)).toBe(30);
    expect(score10(cust(), offer('batu', 0, { queue: 4 }), 0)).toBe(50);
  });

  it('reads its weights from the config', () => {
    const cfg: SimConfig = { ...CONFIG, score: { repPivot: 40, repWeight10: 1, queueWeight10: 10 } };
    expect(score10(cust(), offer('batu', 0, { rep: 60, queue: 2 }), undefined, cfg)).toBe(50 + 20 - 20);
  });
});

describe('passesSkeptic (§6: leave if skeptic > 1 − (drop − 20%) × 2.5)', () => {
  it('everyone passes when there is no steep discount (drop ≤ 20%)', () => {
    expect(passesSkeptic(cust({ skeptic: 1000 }), 0)).toBe(true);
    expect(passesSkeptic(cust({ skeptic: 1000 }), 150)).toBe(true);
    expect(passesSkeptic(cust({ skeptic: 1000 }), 200)).toBe(true);
  });

  it('at a 30% drop customers up to skeptic 0.75 stay', () => {
    expect(passesSkeptic(cust({ skeptic: 750 }), 300)).toBe(true);
    expect(passesSkeptic(cust({ skeptic: 751 }), 300)).toBe(false);
  });

  it('at a 40% drop half stay', () => {
    expect(passesSkeptic(cust({ skeptic: 500 }), 400)).toBe(true);
    expect(passesSkeptic(cust({ skeptic: 501 }), 400)).toBe(false);
  });

  it('a 60% cut makes the whole queue leave, and so does anything deeper', () => {
    for (const skeptic of [0, 1, 500, 1000]) {
      expect(passesSkeptic(cust({ skeptic }), 600)).toBe(false);
      expect(passesSkeptic(cust({ skeptic }), 700)).toBe(false);
    }
  });

  it('just under a 60% cut only the least skeptical stay', () => {
    // 59.9%: limit = 10000 − 399 × 25 = 25 → skeptic ≤ 2
    expect(passesSkeptic(cust({ skeptic: 2 }), 599)).toBe(true);
    expect(passesSkeptic(cust({ skeptic: 3 }), 599)).toBe(false);
  });
});

describe('evaluate: choosing a shop', () => {
  it('picks the highest score and marks the others otherBetter, with their scores', () => {
    const r = evaluate(cust(), [
      offer('batu', 0, { price: 30 }),
      offer('giare', 1, { price: 25 }),
      offer('player', 6, { price: 28 }),
    ], []);
    expect(r.chosen).toBe('giare');
    expect(r.verdicts).toEqual([
      { shop: 'batu', score10: 50, reason: 'otherBetter' },
      { shop: 'giare', score10: 100, reason: 'chosen' },
      { shop: 'player', score10: 70, reason: 'otherBetter' },
    ]);
  });

  it('weighs reputation and the queue in the score', () => {
    const r = evaluate(cust(), [
      offer('batu', 0, { price: 28, queue: 2 }),
      offer('cochap', 2, { price: 30, rep: 70 }),
    ], []);
    // batu: 70 − 40 = 30; cochap: 50 + 40 = 90
    expect(r.chosen).toBe('cochap');
  });

  it('leaves the street (chosen null) when no shop scores above 0', () => {
    const r = evaluate(cust({ budget: 20 }), [offer('batu', 0, { price: 30 }), offer('giare', 1, { price: 20 })], []);
    expect(r.chosen).toBeNull();
    expect(reasons(r)).toEqual({ batu: 'tooExpensive', giare: 'tooExpensive' });
    expect(r.verdicts.find(v => v.shop === 'giare')?.score10).toBe(0);
  });

  it('rotates ties by customer.tie over the tied shops in slot order', () => {
    const offers = [offer('player', 6), offer('batu', 0), offer('cochap', 2, { price: 31 }), offer('giare', 1)];
    const picks = [0, 1, 2, 3, 4, 5, 6].map(tie => evaluate(cust({ tie }), offers, []).chosen);
    expect(picks).toEqual(['batu', 'giare', 'player', 'batu', 'giare', 'player', 'batu']);
  });

  it('lists verdicts in the order of the offers', () => {
    const offers = [offer('player', 6), offer('batu', 0), offer('giare', 1)];
    expect(evaluate(cust(), offers, []).verdicts.map(v => v.shop)).toEqual(['player', 'batu', 'giare']);
  });
});

describe('evaluate: one reason per rejected shop', () => {
  it('closed: shop not open', () => {
    const r = evaluate(cust(), [offer('batu', 0, { open: false }), offer('giare', 1)], []);
    expect(r.verdicts[0]).toEqual({ shop: 'batu', score10: null, reason: 'closed' });
    expect(r.chosen).toBe('giare');
  });

  it('visited: shop already tried', () => {
    const r = evaluate(cust(), [offer('batu', 0, { price: 20 }), offer('giare', 1)], ['batu']);
    expect(r.verdicts[0]).toEqual({ shop: 'batu', score10: null, reason: 'visited' });
    expect(r.chosen).toBe('giare');
  });

  it('outOfStock: shop cannot serve this order', () => {
    const r = evaluate(cust(), [offer('player', 6, { price: 20, canServe: false }), offer('giare', 1)], []);
    expect(r.verdicts[0]).toEqual({ shop: 'player', score10: null, reason: 'outOfStock' });
    expect(r.chosen).toBe('giare');
  });

  it('lowTrust: effective rep below the customer trust; equal is enough', () => {
    const r = evaluate(cust({ trust: 40 }), [offer('giare', 1, { price: 20, rep: 39 }), offer('batu', 0, { rep: 40 })], []);
    expect(r.verdicts[0]).toEqual({ shop: 'giare', score10: null, reason: 'lowTrust' });
    expect(r.chosen).toBe('batu');
  });

  it('steepDiscount: fails the skeptic test of a shop that cut more than 20%', () => {
    const offers = [offer('player', 6, { price: 18, dropPermille: 400 }), offer('batu', 0)];
    const doubter = evaluate(cust({ skeptic: 501 }), offers, []);
    expect(doubter.verdicts[0]).toEqual({ shop: 'player', score10: null, reason: 'steepDiscount' });
    expect(doubter.chosen).toBe('batu');
    expect(evaluate(cust({ skeptic: 500 }), offers, []).chosen).toBe('player');
  });

  it('tooCrowded: queue already at 5, even if it would score well', () => {
    const r = evaluate(cust({ budget: 60 }), [offer('batu', 0, { queue: 5 }), offer('giare', 1, { queue: 4 })], []);
    expect(r.verdicts[0]).toEqual({ shop: 'batu', score10: 200, reason: 'tooCrowded' });
    expect(r.chosen).toBe('giare');
  });

  it('tooCrowded: score ≤ 0 only because of the queue', () => {
    // 35 − 30 = 5k > 0 when empty; with 3 waiting: 50 − 60 = −10
    const r = evaluate(cust(), [offer('batu', 0, { queue: 3 })], []);
    expect(r.verdicts[0]).toEqual({ shop: 'batu', score10: -10, reason: 'tooCrowded' });
    expect(r.chosen).toBeNull();
  });

  it('tooExpensive: score ≤ 0 even with an empty queue', () => {
    const r = evaluate(cust(), [offer('batu', 0, { price: 36, queue: 3 }), offer('giare', 1, { price: 35 })], []);
    expect(r.verdicts).toEqual([
      { shop: 'batu', score10: -70, reason: 'tooExpensive' },
      { shop: 'giare', score10: 0, reason: 'tooExpensive' },
    ]);
  });

  it('tooExpensive also covers low rep dragging the score down', () => {
    const r = evaluate(cust({ trust: 0 }), [offer('giare', 1, { price: 33, rep: 30 })], []);
    // 20 − 40 = −20 with an empty queue
    expect(r.verdicts[0]).toEqual({ shop: 'giare', score10: -20, reason: 'tooExpensive' });
  });
});

describe('evaluate: reason precedence (ruling R5)', () => {
  const one = (c: Customer, o: ShopOffer, visited: ShopId[] = []) => evaluate(c, [o], visited).verdicts[0].reason;
  const bad = { open: false, canServe: false, rep: 0, dropPermille: 900, queue: 9, price: 50 };

  it('closed → visited → outOfStock → lowTrust → steepDiscount → tooCrowded → tooExpensive', () => {
    const c = cust({ trust: 30, skeptic: 1000, budget: 20 });
    expect(one(c, offer('player', 6, bad), ['player'])).toBe('closed');
    expect(one(c, offer('player', 6, { ...bad, open: true }), ['player'])).toBe('visited');
    expect(one(c, offer('player', 6, { ...bad, open: true }))).toBe('outOfStock');
    expect(one(c, offer('player', 6, { ...bad, open: true, canServe: true }))).toBe('lowTrust');
    expect(one(c, offer('player', 6, { ...bad, open: true, canServe: true, rep: 50 }))).toBe('steepDiscount');
    expect(one(c, offer('player', 6, { ...bad, open: true, canServe: true, rep: 50, dropPermille: 0 }))).toBe('tooCrowded');
    expect(one(c, offer('player', 6, { ...bad, open: true, canServe: true, rep: 50, dropPermille: 0, queue: 4 })))
      .toBe('tooExpensive');
  });
});

describe('evaluate: special customers', () => {
  it('scared customers choose nothing; every shop gets the rumor reason', () => {
    const r = evaluate(cust({ scared: true, budget: 60 }), [offer('batu', 0), offer('player', 6, { open: false })], []);
    expect(r.chosen).toBeNull();
    expect(r.verdicts).toEqual([
      { shop: 'batu', score10: null, reason: 'rumor' },
      { shop: 'player', score10: null, reason: 'rumor' },
    ]);
  });

  it('ad customers only consider their shop and list only it', () => {
    const c = cust({ onlyShop: 'player', budget: 45, trust: 0 });
    const offers = [offer('batu', 0, { price: 10 }), offer('player', 6, { price: 40 }), offer('giare', 1, { price: 10 })];
    const r = evaluate(c, offers, []);
    expect(r.chosen).toBe('player');
    expect(r.verdicts).toEqual([{ shop: 'player', score10: 50, reason: 'chosen' }]);
  });

  it('ad customers leave when their shop is out of stock', () => {
    const c = cust({ onlyShop: 'player', budget: 45, trust: 0 });
    const r = evaluate(c, [offer('batu', 0), offer('player', 6, { canServe: false })], []);
    expect(r.chosen).toBeNull();
    expect(r.verdicts).toEqual([{ shop: 'player', score10: null, reason: 'outOfStock' }]);
  });
});

describe('staysAfterReprice (§6, §16.6)', () => {
  it('stays when the new score with the people ahead is still above 0', () => {
    expect(staysAfterReprice(cust(), offer('batu', 0, { price: 32, queue: 5 }), 1)).toEqual({ stay: true });
  });

  it('counts only the people ahead, not the whole queue', () => {
    // 35 − 32 = 30; 1 ahead → 10 > 0; 2 ahead → −10
    expect(staysAfterReprice(cust(), offer('batu', 0, { price: 32, queue: 5 }), 1).stay).toBe(true);
    expect(staysAfterReprice(cust(), offer('batu', 0, { price: 32, queue: 5 }), 2))
      .toEqual({ stay: false, cause: 'priceUp' });
  });

  it('leaves at a score of exactly 0', () => {
    expect(staysAfterReprice(cust(), offer('batu', 0, { price: 35 }), 0)).toEqual({ stay: false, cause: 'priceUp' });
  });

  it('rescoring depends on rep: a high-rep shop keeps the customer a low-rep one loses', () => {
    expect(staysAfterReprice(cust(), offer('cochap', 2, { price: 36, rep: 60 }), 0).stay).toBe(true);
    expect(staysAfterReprice(cust(), offer('giare', 1, { price: 36, rep: 40 }), 0))
      .toEqual({ stay: false, cause: 'priceUp' });
  });

  it('a steep cut runs the skeptic test', () => {
    const cut = offer('player', 6, { price: 18, dropPermille: 400 });
    expect(staysAfterReprice(cust({ skeptic: 500 }), cut, 0)).toEqual({ stay: true });
    expect(staysAfterReprice(cust({ skeptic: 501 }), cut, 0)).toEqual({ stay: false, cause: 'steepDiscount' });
    expect(staysAfterReprice(cust({ skeptic: 1000 }), offer('player', 6, { price: 12, dropPermille: 600 }), 0))
      .toEqual({ stay: false, cause: 'steepDiscount' });
  });
});
