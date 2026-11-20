// The ambient street (spec §9 "Cảnh phố": the live background of the title, the lobby, the morning and the evening,
// and the host's projector): no rush is running, but people still stroll along, glance at the price boards, and now
// and then buy a cup. The walkers are made up here, deterministically from a seed and the day, and played through the
// same director and characters as the rush's customers, so they look and move exactly alike; the street stays light
// on the CPU (a handful of walkers, short queues, no speech bubbles, a lower frame rate in StreetCanvas).
//
// - `AmbientCrowd` (pure): the made-up walkers and what they do, as `Customer`s and the `SimEvent`s the rush would
//   have sent for them. Three kinds: strollers walk straight through; glancers stop to read the boards, take a last
//   look and walk on; buyers pick an open shop, queue (never more than two deep) and walk off drinking. How often
//   people come, and how many buy, follows the hour (`timeOfDay`); with reduced motion only a few stroll by.
// - `AmbientDriver`: feeds a crowd into a `Director` as time goes on, and can warm the street up so it opens busy.
// - `ambientStreet(seed)`: a street to walk on when the screen has none of its own (title, lobby, projector): the
//   first morning of a run from that seed, with nobody on it.
import { CONFIG } from '../../../shared/sim/config';
import { openDay } from '../../../shared/sim/day';
import { stream, type Rng } from '../../../shared/sim/rng';
import { newRun } from '../../../shared/sim/run';
import type { Customer, Day, K, RushState, ShopId, SimEvent } from '../../../shared/sim/types';
import { BROWSE_TICKS, type Director } from './director';
import type { TimeOfDay } from './lighting';

/** How busy each hour is: mean ticks between walkers, and the shares of buyers and glancers (the rest stroll). */
export const PACE: Readonly<Record<TimeOfDay, { gap: number; buy: number; glance: number }>> = {
  morning: { gap: 13, buy: 0.24, glance: 0.3 },
  noon: { gap: 10, buy: 0.3, glance: 0.3 },
  afternoon: { gap: 12, buy: 0.26, glance: 0.3 },
  evening: { gap: 15, buy: 0.26, glance: 0.26 },
};
/** Reduced motion: this many times fewer walkers, and none stop or buy. */
const CALM_SPARSER = 3;
/** Walkers are made this far ahead of their arrival (ticks), so they can walk in from the street's ends in time. */
export const LOOKAHEAD = 160;
/** At most this many ambient customers in one queue. */
export const MAX_QUEUE = 2;
/** From choosing to being served: the walk to the counter, then making the cup (ticks). */
const TO_COUNTER = 28;
const SERVE_MIN = 22;
const SERVE_SPAN = 26;

export interface AmbientShop { id: ShopId; price: K; open: boolean }

export interface AmbientOptions {
  seed: number;
  day: Day;
  timeOfDay: TimeOfDay;
  /** Reduced motion: a few strollers only. */
  calm: boolean;
  /** The first customer id (after the street's own customers). */
  firstId: number;
  /** The first walker arrives this tick. */
  start: number;
}

/** What a made-up walker does. */
export type AmbientKind = 'stroll' | 'glance' | 'buy';

/**
 * The made-up walkers of an ambient street. `take(now)` hands out the walkers who must be known by `now` (LOOKAHEAD
 * before they arrive) and the events due by `now`, in order. The same options give the same street, tick for tick.
 */
export class AmbientCrowd {
  private readonly rng: Rng;
  private next: number;
  private nextId: number;
  private readonly events: SimEvent[] = [];
  /** Per shop: when each ambient customer in its queue is served (ascending). */
  private readonly served = new Map<ShopId, number[]>();
  /** Per shop: when its counter is free again. */
  private readonly freeAt = new Map<ShopId, number>();
  /** Kinds of the walkers made so far (for the tests and the dev page). */
  readonly kinds: AmbientKind[] = [];

  constructor(private o: AmbientOptions, private shops: readonly AmbientShop[]) {
    this.rng = stream(o.seed, `ambient/${o.day}/${o.timeOfDay}`);
    this.next = o.start;
    this.nextId = o.firstId;
  }

  /** The hour (or reduced motion) changed: walkers made from now on follow it. */
  setPace(timeOfDay: TimeOfDay, calm: boolean): void {
    this.o = { ...this.o, timeOfDay, calm };
  }

  /** The shops changed (a price, a status): later buyers choose among these. */
  setShops(shops: readonly AmbientShop[]): void {
    this.shops = shops;
  }

  /** Walkers to add now (in id order) and the events due by `now` (in tick order, removed from the crowd). */
  take(now: number): { customers: Customer[]; events: SimEvent[] } {
    const customers: Customer[] = [];
    while (this.next <= now + LOOKAHEAD) {
      customers.push(this.make(this.next));
      this.next += this.gap();
    }
    let n = 0;
    while (n < this.events.length && this.events[n].t <= now) n++;
    return { customers, events: n === 0 ? [] : this.events.splice(0, n) };
  }

  private gap(): number {
    const p = PACE[this.o.timeOfDay];
    const mean = p.gap * (this.o.calm ? CALM_SPARSER : 1);
    // 0.4 to 1.6 times the mean: a street, not a metronome.
    return Math.max(4, Math.round(mean * (0.4 + this.rng() * 1.2)));
  }

  private make(arrive: number): Customer {
    const r = this.rng;
    const id = this.nextId++;
    const look = Math.floor(r() * 4294967296);
    const entry: Customer['entry'] = r() < 0.5 ? 'left' : 'right';
    const roll = r();
    const pick = r();
    const serveRoll = r();
    const c: Customer = {
      id, budget: 40, trust: 0, skeptic: 0, order: { size: 'M', toppings: ['pearl'] }, arriveTick: arrive, entry,
      tie: 0, look, scared: false, onlyShop: null,
    };
    const p = PACE[this.o.timeOfDay];
    let kind: AmbientKind = this.o.calm ? 'stroll' : roll < p.buy ? 'buy' : roll < p.buy + p.glance ? 'glance' : 'stroll';
    let shop: ShopId | null = null;
    if (kind === 'buy') {
      shop = this.choose(arrive, pick);
      if (shop === null) kind = 'glance';
    }
    this.kinds.push(kind);
    if (kind === 'stroll') {
      // Walks on just before the spot where they would stop to read the boards: straight through.
      this.push({ t: arrive - BROWSE_TICKS - 1, type: 'customerLeave', customer: id, outcome: 'noOffer', emptyHanded: false });
    } else if (kind === 'glance') {
      this.push({ t: arrive, type: 'customerConsider', customer: id, reshop: false, verdicts: [], chosen: null });
      this.push({ t: arrive, type: 'customerLeave', customer: id, outcome: 'noOffer', emptyHanded: false });
    } else if (shop !== null) {
      const q = this.queueAt(shop, arrive);
      const at = Math.max(arrive + TO_COUNTER, this.freeAt.get(shop) ?? -Infinity)
        + SERVE_MIN + Math.floor(serveRoll * SERVE_SPAN);
      this.freeAt.set(shop, at);
      this.served.get(shop)?.push(at) ?? this.served.set(shop, [at]);
      const price = this.shops.find(s => s.id === shop)?.price ?? 0;
      this.push({ t: arrive, type: 'customerConsider', customer: id, reshop: false,
        verdicts: [{ shop, score10: 10, reason: 'chosen' }], chosen: shop });
      this.push({ t: arrive, type: 'customerJoin', customer: id, shop, position: q });
      this.push({ t: at, type: 'customerServed', customer: id, shop, by: shop === 'player' ? 'staff' : 'ai',
        correct: true, paid: price, full: price });
      this.push({ t: at, type: 'customerLeave', customer: id, outcome: 'served', emptyHanded: false });
    }
    return c;
  }

  /** How many ambient customers are still queued at `shop` at tick `t`. */
  private queueAt(shop: ShopId, t: number): number {
    const list = this.served.get(shop);
    if (list === undefined) return 0;
    while (list.length > 0 && list[0] <= t) list.shift();
    return list.length;
  }

  /** An open shop with room in its queue, the player's a little likelier; null if none has room. */
  private choose(t: number, roll: number): ShopId | null {
    const open = this.shops.filter(s => s.open && s.price > 0 && this.queueAt(s.id, t) < MAX_QUEUE);
    if (open.length === 0) return null;
    const weight = (s: AmbientShop) => (s.id === 'player' ? 1.6 : 1);
    let total = 0;
    for (const s of open) total += weight(s);
    let x = roll * total;
    for (const s of open) {
      x -= weight(s);
      if (x < 0) return s.id;
    }
    return open[open.length - 1].id;
  }

  /** Into the event list by tick, after any already at that tick (the order they were made in). */
  private push(e: SimEvent): void {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].t > e.t) i--;
    this.events.splice(i, 0, e);
  }
}

/** The shops of the street the director shows, as the crowd needs them. */
export function shopsOf(d: Pick<Director, 'shops'>): AmbientShop[] {
  return d.shops.map(s => ({ id: s.id, price: s.price, open: s.status === 'open' }));
}

/**
 * Plays an ambient crowd on a director: each frame (`step(now)`) the walkers due are added and their events applied.
 * `warm(ticks)` plays the first ticks at once, so the street opens with people already about.
 */
export class AmbientDriver {
  private readonly crowd: AmbientCrowd;
  /** Events about walkers not on the street yet (they come in on the director's schedule): applied once they are. */
  private held: SimEvent[] = [];

  constructor(private readonly d: Director, o: Omit<AmbientOptions, 'firstId' | 'start'>) {
    this.crowd = new AmbientCrowd({ ...o, firstId: d.customerCount, start: d.now + 1 }, shopsOf(d));
  }

  step(now: number): void {
    const { customers, events } = this.crowd.take(now);
    if (customers.length > 0) this.d.addCustomers(customers);
    if (this.held.length === 0 && events.length === 0) return;
    const due = this.held.length > 0 ? [...this.held, ...events] : events;
    this.held = [];
    const ready: SimEvent[] = [];
    for (const e of due) {
      // Someone not walking yet (or with an earlier event of theirs held) waits: the director must have them on
      // the street to play their choice, or they would read the boards for ever.
      const id = 'customer' in e ? e.customer : -1;
      if (id >= 0 && (this.d.actor(id) === undefined || this.held.some(h => 'customer' in h && h.customer === id))) {
        this.held.push(e);
      } else {
        ready.push(e);
      }
    }
    if (ready.length > 0) this.d.apply(ready);
  }

  setPace(timeOfDay: TimeOfDay, calm: boolean): void {
    this.crowd.setPace(timeOfDay, calm);
  }

  /** The shops changed on the street (a price on the morning board): later buyers see them. */
  refreshShops(): void {
    this.crowd.setShops(shopsOf(this.d));
  }

  warm(ticks: number): void {
    const t0 = this.d.now;
    for (let t = t0 + 1; t <= t0 + ticks; t++) {
      this.step(t);
      this.d.advanceTo(t);
    }
  }
}

/**
 * A street with nobody on it for a screen that has no run of its own (the title, the lobby, the host's projector):
 * the first morning of a run from `seed`, every shop at its opening price. Null if the sim cannot build it.
 */
export function ambientStreet(seed: number): RushState | null {
  try {
    const run = newRun(seed, 'ambient');
    const { rush } = openDay(run, run.plan, CONFIG);
    return {
      ...rush,
      customers: [], rt: [], arrivalOrder: [], nextArrival: 0, nextEnter: 0,
      shops: rush.shops.map(s => ({ ...s, queue: [], status: s.id === 'player' && s.status === 'soldOut' ? 'open' : s.status })),
    };
  } catch {
    return null;
  }
}
