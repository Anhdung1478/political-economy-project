import { describe, expect, it } from 'vitest';
import { gameAt } from '../Dev/gameAt';
import { afternoonStreet, morningStreet } from './street';

describe('morningStreet', () => {
  it('has every shop and nobody on the street', () => {
    const s = gameAt(7, 1, 'morning');
    const v = morningStreet(s.run, 27)!;
    expect(v.snapshot.shops).toHaveLength(7);
    expect(v.snapshot.customers).toEqual([]);
    expect(v.snapshot.arrivalOrder).toEqual([]);
    expect(v.snapshot.shops.find(x => x.id === 'player')).toMatchObject({ price: 27, status: 'open' });
    expect(v.entrants).toEqual([]);
  });

  it('day 2: AI boards at yesterday\'s close, the newcomer at its opening price', () => {
    const s = gameAt(7, 2, 'morning');
    const v = morningStreet(s.run)!;
    const yesterday = s.run.reports[0].street;
    for (const shop of v.snapshot.shops) {
      if (shop.id === 'player' || shop.id === 'tapdoan' || shop.price === 0) continue;
      expect(shop.price).toBe(yesterday.find(r => r.id === shop.id)?.closePrice);
    }
    const tap = v.snapshot.shops.find(x => x.id === 'tapdoan')!;
    expect(tap.grandOpening).toBe(true);
    expect(v.entrants).toEqual([{ id: 'tapdoan', price: tap.price }]);
  });

  it('day 3: the player\'s price is held under the ceiling, resting shops show it', () => {
    const s = gameAt(7, 3, 'morning');
    const v = morningStreet(s.run, 45)!;
    expect(v.snapshot.shops.find(x => x.id === 'player')?.price).toBe(20);
    expect(v.snapshot.shops.some(x => x.status === 'resting')).toBe(true);
    for (const shop of v.snapshot.shops) expect(shop.price).toBeLessThanOrEqual(20);
  });

  it('is null outside the morning', () => {
    expect(morningStreet(gameAt(7, 1, 'cards').run)).toBeNull();
  });
});

describe('afternoonStreet', () => {
  it('shows the day\'s closing prices in the afternoon and evening', () => {
    for (const phase of ['cards', 'report'] as const) {
      const s = gameAt(7, 2, phase);
      const snap = afternoonStreet(s.run)!;
      expect(snap.customers).toEqual([]);
      const result = s.run.rushResult!.shops;
      const player = snap.shops.find(x => x.id === 'player')!;
      expect(player.price).toBe(result.find(r => r.id === 'player')!.closePrice);
    }
  });

  it('works at the end of the run, and is null in the morning', () => {
    expect(afternoonStreet(gameAt(7, 5, 'end').run)?.shops).toHaveLength(7);
    expect(afternoonStreet(gameAt(7, 1, 'morning').run)).toBeNull();
  });
});
