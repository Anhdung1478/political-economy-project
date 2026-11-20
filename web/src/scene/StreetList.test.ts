import { describe, expect, it } from 'vitest';
import type { ShopView } from './director';
import { streetRows } from './StreetList';

const shop = (o: Partial<ShopView>): ShopView => ({
  id: 'batu', status: 'open', statusSince: 0, grandOpening: false, price: 20, prevPrice: null, priceSince: 0,
  certified: false, named: false, badgeSince: 0, rumor: false, queue: [], shown: 4, overflow: 0, sold: 0,
  lastSaleAt: 0, busyUntil: 0, ...o,
});

describe('the list rows', () => {
  it('name, price, status, queue and badges, in the street\'s order', () => {
    const rows = streetRows({ now: 10, lastEventTick: 10, shops: [
      shop({ id: 'batu', queue: [1, 2] }), shop({ id: 'player', status: 'soldOut', certified: true }),
    ] });
    expect(rows.map(r => [r.id, r.name, r.status, r.price, r.queue, r.certified])).toEqual([
      ['batu', 'Quán Bà Tư', 'open', 20, 2, false], ['player', 'Quán bạn', 'soldOut', 20, 0, true],
    ]);
  });

  it('a price change shows its arrow for a while, by the last event when the picture has stopped', () => {
    const up = shop({ price: 25, prevPrice: 20, priceSince: 100 });
    expect(streetRows({ now: 120, lastEventTick: 120, shops: [up] })[0].trend).toBe(1);
    expect(streetRows({ now: 120, lastEventTick: 120, shops: [{ ...up, price: 15 }] })[0].trend).toBe(-1);
    // The canvas stopped at 100; events go on to 200.
    expect(streetRows({ now: 100, lastEventTick: 200, shops: [up] })[0].trend).toBe(0);
  });
});
