import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../shared/sim/types';
import {
  AmbientCrowd, AmbientDriver, ambientStreet, LOOKAHEAD, MAX_QUEUE, PACE, type AmbientOptions, type AmbientShop,
} from './ambient';
import { BROWSE_TICKS, Director } from './director';
import { LANDSCAPE, PORTRAIT } from './layout';

const SHOPS: AmbientShop[] = [
  { id: 'batu', price: 20, open: true }, { id: 'giare', price: 18, open: true }, { id: 'cochap', price: 25, open: false },
  { id: 'player', price: 22, open: true },
];
const opts = (o: Partial<AmbientOptions> = {}): AmbientOptions => ({
  seed: 7, day: 1, timeOfDay: 'noon', calm: false, firstId: 0, start: 1, ...o,
});

/** Everything a crowd hands out up to `until`, one tick at a time. */
function runCrowd(c: AmbientCrowd, until: number) {
  const customers = [];
  const events: SimEvent[] = [];
  for (let t = 1; t <= until; t++) {
    const r = c.take(t);
    customers.push(...r.customers);
    events.push(...r.events);
    for (const e of r.events) expect(e.t).toBeLessThanOrEqual(t);
  }
  return { customers, events };
}

describe('the ambient crowd', () => {
  it('is the same street for the same seed, day and hour, and another for another seed', () => {
    const a = runCrowd(new AmbientCrowd(opts(), SHOPS), 1500);
    const b = runCrowd(new AmbientCrowd(opts(), SHOPS), 1500);
    const c = runCrowd(new AmbientCrowd(opts({ seed: 8 }), SHOPS), 1500);
    expect(b).toEqual(a);
    expect(c.customers.map(x => x.look)).not.toEqual(a.customers.map(x => x.look));
  });

  it('makes walkers ahead of their arrival, ids in order, and hands events out in tick order', () => {
    const c = new AmbientCrowd(opts({ firstId: 40 }), SHOPS);
    let lastT = -Infinity;
    let id = 40;
    for (let t = 1; t <= 1200; t++) {
      const r = c.take(t);
      for (const k of r.customers) {
        expect(k.id).toBe(id++);
        expect(k.arriveTick).toBeGreaterThanOrEqual(t);
        expect(k.arriveTick).toBeLessThanOrEqual(t + LOOKAHEAD);
      }
      for (const e of r.events) {
        expect(e.t).toBeGreaterThanOrEqual(lastT);
        lastT = e.t;
      }
    }
  });

  it('strolls, glances and buys in about the hour\'s shares; buyers queue at open shops, never more than two deep', () => {
    const c = new AmbientCrowd(opts(), SHOPS);
    const { customers, events } = runCrowd(c, 6000);
    const n = c.kinds.length;
    const share = (k: string) => c.kinds.filter(x => x === k).length / n;
    expect(n).toBeGreaterThan(400);
    expect(share('buy')).toBeGreaterThan(PACE.noon.buy * 0.7);
    expect(share('buy')).toBeLessThan(PACE.noon.buy * 1.1);
    expect(share('glance')).toBeGreaterThan(0.2);
    expect(share('stroll')).toBeGreaterThan(0.25);
    // Joins only at open shops, at a place under MAX_QUEUE; each buyer served once, then gone.
    const joins = events.filter(e => e.type === 'customerJoin');
    expect(joins.length).toBeGreaterThan(0);
    for (const j of joins) {
      if (j.type !== 'customerJoin') continue;
      expect(SHOPS.find(s => s.id === j.shop)?.open).toBe(true);
      expect(j.position).toBeLessThan(MAX_QUEUE);
    }
    const byCustomer = new Map<number, SimEvent[]>();
    for (const e of events) if ('customer' in e) byCustomer.set(e.customer, [...(byCustomer.get(e.customer) ?? []), e]);
    for (const k of customers) {
      const mine = byCustomer.get(k.id) ?? [];
      if (k.arriveTick > 6000 - 200) continue; // still on their way when the run stops
      expect(mine[mine.length - 1].type).toBe('customerLeave');
      const kind = mine.map(e => e.type).join(',');
      expect(['customerLeave', 'customerConsider,customerLeave',
        'customerConsider,customerJoin,customerServed,customerLeave']).toContain(kind);
      // A stroller walks on just before the spot where they would stop.
      if (kind === 'customerLeave') expect(mine[0].t).toBe(k.arriveTick - BROWSE_TICKS - 1);
    }
  });

  it('follows the hour: the evening is quieter than noon; reduced motion only strolls, and sparsely', () => {
    const count = (o: Partial<AmbientOptions>) => {
      const c = new AmbientCrowd(opts(o), SHOPS);
      runCrowd(c, 3000);
      return c;
    };
    expect(count({ timeOfDay: 'evening' }).kinds.length).toBeLessThan(count({ timeOfDay: 'noon' }).kinds.length);
    const calm = count({ calm: true });
    expect(calm.kinds.every(k => k === 'stroll')).toBe(true);
    expect(calm.kinds.length).toBeLessThan(count({}).kinds.length / 2);
  });

  it('buys nothing when no shop is open', () => {
    const c = new AmbientCrowd(opts(), SHOPS.map(s => ({ ...s, open: false })));
    const { events } = runCrowd(c, 2000);
    expect(events.some(e => e.type === 'customerJoin')).toBe(false);
  });
});

describe('the ambient street on a director', () => {
  for (const [name, L] of [['portrait', PORTRAIT], ['landscape', LANDSCAPE]] as const) {
    it(`${name}: opens busy, people queue, get served and walk off, and nobody is left reading the boards`, () => {
      const street = ambientStreet(7);
      expect(street).not.toBeNull();
      const d = new Director(L);
      d.reset(street!);
      const drv = new AmbientDriver(d, { seed: 7, day: 1, timeOfDay: 'noon', calm: false });
      drv.warm(220);
      expect(d.actorCount).toBeGreaterThan(3);
      let queued = 0;
      let drinking = 0;
      const browsingSince = new Map<number, number>();
      for (let t = d.now + 1; t < 3000; t++) {
        drv.step(t);
        d.advanceTo(t);
        for (const a of d.actors) {
          if (a.shop !== null) queued++;
          if (a.carrying) drinking++;
          if (a.activity === 'lookBoard') {
            if (!browsingSince.has(a.id)) browsingSince.set(a.id, t);
            // Nobody browses for ever: a glance and their choice come within a few seconds.
            expect(t - (browsingSince.get(a.id) ?? t)).toBeLessThan(80);
          } else {
            browsingSince.delete(a.id);
          }
        }
        expect(d.actorCount).toBeLessThan(40);
      }
      expect(queued).toBeGreaterThan(0);
      expect(drinking).toBeGreaterThan(0);
      expect(d.takeBubbles().length).toBeGreaterThanOrEqual(0);
    });
  }

  it('leaves the rush state\'s customer list alone when walkers are added', () => {
    const street = ambientStreet(3)!;
    const d = new Director(PORTRAIT);
    d.reset(street);
    new AmbientDriver(d, { seed: 3, day: 1, timeOfDay: 'morning', calm: false }).warm(100);
    expect(street.customers).toHaveLength(0);
    expect(d.customerCount).toBeGreaterThan(0);
  });
});
