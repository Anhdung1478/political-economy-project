import { describe, expect, it } from 'vitest';
import { STRATEGIES } from '../../../shared/sim/autoplay';
import { openDay } from '../../../shared/sim/day';
import { newRun } from '../../../shared/sim/run';
import type {
  Customer, LeaveCause, RushState, ShopId, ShopVerdict, SimEvent, StockItem,
} from '../../../shared/sim/types';
import { replayOf, rushOfDay, stateAt, walkRush, type Replay } from '../pages/Dev/replay';
import { BROWSE_TICKS, considerTopic, Director, LAG_TICKS, MAX_ACTORS, type Actor } from './director';
import { asidePoint, fitTo, LANDSCAPE, PORTRAIT, queuePoint, slotOf, type StreetLayout } from './layout';

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Day 1 of seed 1 as it opens: Bà Tư, GiáRẻ, Cố Chấp, Lướt Sóng, Sinh Viên and the player open; Tập Đoàn not yet. */
function day1(): RushState {
  const run = newRun(1, 'test');
  return openDay(run, run.plan).rush;
}

/**
 * The street with its own customers due long after any test looks, so the director brings nobody in by itself:
 * the tests bring people in with `customerEnter` (which fills in for a walker not brought in yet).
 */
const quiet = (rush: RushState): RushState =>
  ({ ...rush, customers: rush.customers.map(c => ({ ...c, arriveTick: c.arriveTick + 100_000 })) });

const enter = (t: number, customer: number, entry: Customer['entry'] = 'left'): SimEvent =>
  ({ t, type: 'customerEnter', customer, entry });
const consider = (t: number, customer: number, chosen: ShopId | null, verdicts: ShopVerdict[] = [],
  reshop = false): SimEvent => ({ t, type: 'customerConsider', customer, reshop, verdicts, chosen });
const join = (t: number, customer: number, shop: ShopId, position: number): SimEvent =>
  ({ t, type: 'customerJoin', customer, shop, position });
const served = (t: number, customer: number, shop: ShopId, correct = true): SimEvent =>
  ({ t, type: 'customerServed', customer, shop, by: shop === 'player' ? 'player' : 'ai', correct, paid: 30, full: 30 });
const abandon = (t: number, customer: number, shop: ShopId, cause: LeaveCause, missing?: StockItem): SimEvent =>
  (missing === undefined
    ? { t, type: 'customerAbandon', customer, shop, cause, repHit: cause === 'patience' && shop === 'player' }
    : { t, type: 'customerAbandon', customer, shop, cause, repHit: false, missing });
const leave = (t: number, customer: number, outcome: 'served' | 'servedWrong' | 'noOffer' | 'gaveUp' | 'rushEnd' | 'scared',
  emptyHanded = false): SimEvent => ({ t, type: 'customerLeave', customer, outcome, emptyHanded });
const verdict = (shop: ShopId, reason: ShopVerdict['reason'], missing?: StockItem): ShopVerdict =>
  (missing === undefined ? { shop, score10: null, reason } : { shop, score10: null, reason, missing });

/** A director on a quiet day 1, its clock at 0. */
function director(layout = PORTRAIT, rush = day1()): Director {
  const d = new Director(layout);
  d.reset(quiet(rush));
  return d;
}

/** Advances to `t`, then applies the events (as the scene does when the sim pushes tick t). */
function at(d: Director, t: number, ...events: SimEvent[]) {
  d.advanceTo(t);
  d.apply(events);
}

/** Advances in small frames, as the render loop does. */
function play(d: Director, to: number, frame = 0.25) {
  for (let t = d.now + frame; t < to; t += frame) d.advanceTo(t);
  d.advanceTo(to);
}

/** A walker who comes in at t and queues at `shop` 15 ticks later, at the back. */
function queueUp(d: Director, t: number, customer: number, shop: ShopId, entry: Customer['entry'] = 'left') {
  at(d, t, enter(t, customer, entry));
  const position = d.shop(shop).queue.length;
  at(d, t + 15, consider(t + 15, customer, shop), join(t + 15, customer, shop, position));
}

const actor = (d: Director, id: number): Actor => {
  const a = d.actor(id);
  if (a === undefined) throw new Error(`no actor ${id}`);
  return a;
};
const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
const placeOf = (shop: ShopId, i: number, L = PORTRAIT) => queuePoint(L, slotOf(L, shop), i);

// ── Coming in: the director's own schedule (R44) ────────────────────────────────────────────────────────────────────

describe('walkers come in on the director\'s schedule and read the boards before they choose', () => {
  it('every customer is on the street before the sim walks them in, and reading the boards when they choose', () => {
    const r = replayOf(7, 3, 'reasonable');
    const d = new Director(PORTRAIT);
    d.reset(r.rush);
    let entered = 0;
    let choices = 0;
    walkRush(r, (t, events) => {
      d.advanceTo(t);
      for (const e of events) {
        if (e.type === 'customerEnter') {
          expect(d.actor(e.customer)).toBeDefined();
          entered++;
        }
        if (e.type === 'customerConsider' && !e.reshop) {
          expect(actor(d, e.customer).activity).toBe('lookBoard');
          choices++;
        }
      }
      d.apply(events);
    });
    expect(entered).toBe(r.rush.customers.length);
    expect(choices).toBe(r.rush.customers.length);
  });

  it('comes in at its entry, walks to its spot in the middle of the street, reads the boards facing their row', () => {
    const rush = day1();
    const d = new Director(PORTRAIT);
    d.reset(rush);
    const id = rush.arrivalOrder.find(i => rush.customers[i].arriveTick > 200 && rush.customers[i].entry === 'left');
    if (id === undefined) throw new Error('no fixture customer');
    const due = d.enterTime(id);
    play(d, due - 0.25);
    expect(d.actor(id)).toBeUndefined();
    play(d, due + 0.25);
    const a = actor(d, id);
    expect(a.x).toBeLessThan(0);
    expect(a.heading).toBe('right');
    play(d, rush.customers[id].arriveTick - BROWSE_TICKS + 0.25);
    expect(a.activity).toBe('lookBoard');
    expect(a.x).toBeGreaterThanOrEqual(PORTRAIT.browse.x0);
    expect(a.x).toBeLessThanOrEqual(PORTRAIT.browse.x1);
    expect(slotOf(PORTRAIT, a.gaze as ShopId).row).toBe(a.heading === 'up' ? 'top' : 'bottom');
  });

  it('customerEnter only fills in for a walker not brought in yet: it does not move one already walking', () => {
    const rush = day1();
    const d = new Director(PORTRAIT);
    d.reset(rush);
    const id = rush.arrivalOrder[20];
    const c = rush.customers[id];
    play(d, c.arriveTick - 15);
    const before = { x: actor(d, id).x, y: actor(d, id).y };
    d.apply([enter(c.arriveTick - 15, id, c.entry)]);
    expect(near(actor(d, id), before)).toBe(true);
  });

  it('bus passengers step off at the bus stop', () => {
    const d = director();
    at(d, 0, enter(0, 0, 'bus'));
    expect(near(actor(d, 0), PORTRAIT.busStop)).toBe(true);
  });
});

// ── Walkers and queues ──────────────────────────────────────────────────────────────────────────────────────────────

describe('a customer joins the right queue at the right place', () => {
  it('stands at its queue place within 15 ticks of the join, the queue in join order', () => {
    const d = director();
    queueUp(d, 0, 0, 'batu');
    queueUp(d, 5, 1, 'batu', 'right');
    queueUp(d, 6, 2, 'player');
    expect(d.shop('batu').queue).toEqual([0, 1]);
    expect(d.shop('player').queue).toEqual([2]);
    expect(actor(d, 1).shop).toBe('batu');
    expect(actor(d, 1).slot).toBe(1);
    expect(near(actor(d, 0), placeOf('batu', 0))).toBe(false);   // still on the way
    play(d, 21 + LAG_TICKS);
    expect(near(actor(d, 0), placeOf('batu', 0))).toBe(true);
    expect(near(actor(d, 1), placeOf('batu', 1))).toBe(true);
    expect(near(actor(d, 2), placeOf('player', 0))).toBe(true);
    expect(actor(d, 0).activity).toBe('queue');
    expect(actor(d, 0).joinedAt).toBe(15);
  });

  it('turns in straight from the boards to its place, at walking pace when there is time', () => {
    const d = director();
    at(d, 0, enter(0, 0));
    play(d, 40);
    const a = actor(d, 0);
    expect(a.activity).toBe('lookBoard');
    at(d, 40, consider(40, 0, 'cochap'), join(40, 0, 'cochap', 0));
    const seen = new Set<string>();
    let fastest = 0;
    for (let t = 40.25; t <= 40 + LAG_TICKS; t += 0.25) {
      d.advanceTo(t);
      seen.add(a.activity);
      fastest = Math.max(fastest, a.speed);
    }
    expect(seen.has('lookBoard')).toBe(false);
    expect(near(a, placeOf('cochap', 0))).toBe(true);
    expect(fastest).toBeLessThan(2 * PORTRAIT.walk);
  });

  it('a walker who picks nothing takes a last look, then walks on out of the street and is gone', () => {
    const d = director();
    at(d, 0, enter(0, 0, 'left'));
    at(d, 30, consider(30, 0, null, [verdict('player', 'tooExpensive')]), leave(30, 0, 'noOffer'));
    play(d, 32);
    expect(actor(d, 0).activity).toBe('lookBoard');
    expect(actor(d, 0).gaze).toBe('player');
    expect(actor(d, 0).leaving).toBe(true);
    play(d, 40);
    expect(actor(d, 0).heading).toBe('right');   // on the way they came
    play(d, 140);
    expect(d.actor(0)).toBeUndefined();
  });
});

describe('heading: which way they face, for the walk-cycle view', () => {
  it('side-on along the road; in a queue the head faces the shop and the rest the head; served, toward us', () => {
    const d = director();
    at(d, 0, enter(0, 9, 'right'));
    play(d, 3);
    expect(actor(d, 9).heading).toBe('left');
    queueUp(d, 3, 0, 'batu');
    queueUp(d, 4, 1, 'batu');
    queueUp(d, 5, 2, 'player');
    play(d, 60);
    expect(actor(d, 0).heading).toBe('up');      // top row: the counter is up the screen
    expect(actor(d, 1).heading).toBe('left');
    expect(actor(d, 2).heading).toBe('down');    // bottom row
    at(d, 60, served(60, 0, 'batu'), leave(60, 0, 'served'));
    play(d, 64);
    expect(actor(d, 0).activity).toBe('served');
    expect(actor(d, 0).heading).toBe('down');
  });
});

describe('served: steps out with a cup and walks off; the queue moves up', () => {
  it('leaves the queue, carries a cup, and is gone once off the street', () => {
    const d = director();
    queueUp(d, 0, 0, 'batu');
    queueUp(d, 2, 1, 'batu');
    play(d, 100);
    at(d, 100, served(100, 0, 'batu'), leave(100, 0, 'served'));
    expect(d.shop('batu').queue).toEqual([1]);
    const a = actor(d, 0);
    expect(a.shop).toBeNull();
    expect(a.carrying).toBe(true);
    expect(a.leaving).toBe(true);
    play(d, 103);
    expect(a.activity).toBe('served');
    play(d, 100 + LAG_TICKS + 1);
    expect(actor(d, 1).slot).toBe(0);
    expect(near(actor(d, 1), placeOf('batu', 0))).toBe(true);
    play(d, 260);
    expect(d.actor(0)).toBeUndefined();
  });

  it('the player may hand a cup to the third in line: those behind move up, those ahead stay', () => {
    const d = director();
    for (let i = 0; i < 4; i++) queueUp(d, i, i, 'player');
    play(d, 60);
    at(d, 60, served(60, 2, 'player'), leave(60, 2, 'served'));
    expect(d.shop('player').queue).toEqual([0, 1, 3]);
    play(d, 60 + LAG_TICKS + 1);
    expect(near(actor(d, 0), placeOf('player', 0))).toBe(true);
    expect(near(actor(d, 1), placeOf('player', 1))).toBe(true);
    expect(near(actor(d, 3), placeOf('player', 2))).toBe(true);
  });

  it('a shuffle does not push back the deadline of someone still on the way to their first place', () => {
    const d = director();
    queueUp(d, 0, 0, 'batu');
    play(d, 40);
    at(d, 40, enter(40, 1, 'right'));
    at(d, 60, consider(60, 1, 'batu'), join(60, 1, 'batu', 1));
    at(d, 70, served(70, 0, 'batu'), leave(70, 0, 'served'));
    play(d, 60 + LAG_TICKS + 0.25);
    expect(near(actor(d, 1), placeOf('batu', 0))).toBe(true);
  });

  it('a wrong cup: confused, and a bubble says so', () => {
    const d = director();
    queueUp(d, 0, 0, 'player');
    play(d, 50);
    d.takeBubbles();
    at(d, 50, served(50, 0, 'player', false), leave(50, 0, 'servedWrong'));
    expect(d.takeBubbles()).toEqual([
      { customer: 0, t: 50, topic: 'wrongCup', shop: 'player', playerRelated: true },
    ]);
    play(d, 56);
    expect(actor(d, 0).activity).toBe('wrongCup');
  });

  it('a sale is a cue for the coin and counts on the shop', () => {
    const d = director();
    queueUp(d, 0, 0, 'giare');
    play(d, 80);
    d.takeCues();
    at(d, 80, served(80, 0, 'giare'), leave(80, 0, 'served'));
    expect(d.takeCues()).toEqual([
      { kind: 'sale', t: 80, shop: 'giare', customer: 0, paid: 30, full: 30, correct: true },
    ]);
    expect(d.shop('giare').sold).toBe(1);
    expect(d.shop('giare').lastSaleAt).toBe(80);
  });
});

describe('abandon and re-shop', () => {
  it('stomps briefly, walks on angry to the second shop and queues there; bubbles say why', () => {
    const d = director();
    queueUp(d, 0, 0, 'batu');
    queueUp(d, 1, 1, 'batu');
    play(d, 300);
    d.takeBubbles();
    at(d, 300, abandon(300, 0, 'batu', 'patience'),
      consider(300, 0, 'player', [verdict('batu', 'visited'), verdict('player', 'chosen')], true),
      join(300, 0, 'player', 0));
    expect(d.shop('batu').queue).toEqual([1]);
    expect(d.shop('player').queue).toEqual([0]);
    expect(d.takeBubbles()).toEqual([
      { customer: 0, t: 300, topic: 'patience', shop: 'batu', playerRelated: false },
      { customer: 0, t: 300, topic: 'chosePlayer', shop: 'player', playerRelated: true },
    ]);
    play(d, 301.5);
    expect(actor(d, 0).activity).toBe('abandon');
    play(d, 304);
    expect(actor(d, 0).activity).toBe('walk');
    expect(actor(d, 0).cause).toBe('patience');   // the stomp goes on in the walk
    play(d, 300 + LAG_TICKS + 1);
    expect(actor(d, 0).shop).toBe('player');
    expect(near(actor(d, 0), placeOf('player', 0))).toBe(true);
    expect(near(actor(d, 1), placeOf('batu', 0))).toBe(true);
    expect(actor(d, 0).playerRelated).toBe(true);
  });

  it('a re-shop across the whole street is walked, never jumped, and lands in time', () => {
    const L = LANDSCAPE;
    const d = director(L);
    queueUp(d, 0, 0, 'batu');
    play(d, 300);
    at(d, 300, abandon(300, 0, 'batu', 'patience'), consider(300, 0, 'tapdoan', [], true),
      join(300, 0, 'tapdoan', 0));
    const a = actor(d, 0);
    const frame = 0.25;
    let prev = { x: a.x, y: a.y };
    for (let t = 300 + frame; t <= 300 + LAG_TICKS; t += frame) {
      d.advanceTo(t);
      expect(Math.hypot(a.x - prev.x, a.y - prev.y)).toBeLessThanOrEqual(L.walk * 4 * frame + 1e-6);
      prev = { x: a.x, y: a.y };
    }
    expect(near(a, queuePoint(L, slotOf(L, 'tapdoan'), 0))).toBe(true);
  });

  it('leaves the street when no second shop will do', () => {
    const d = director();
    queueUp(d, 0, 0, 'player');
    play(d, 300);
    at(d, 300, abandon(300, 0, 'player', 'stockOut', 'pearl'),
      consider(300, 0, null, [verdict('player', 'visited'), verdict('batu', 'tooCrowded')], true),
      leave(300, 0, 'gaveUp'));
    expect(d.shop('player').queue).toEqual([]);
    expect(actor(d, 0).leaving).toBe(true);
    play(d, 500);
    expect(d.actor(0)).toBeUndefined();
  });
});

// ── Catch-up ────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('catch-up: an actor more than 15 ticks behind the sim jumps to where the sim has it', () => {
  it('after a long pause (a hidden tab), everyone is where the sim has them in one frame', () => {
    const d = director();
    at(d, 0, enter(0, 0), enter(0, 1, 'right'));
    at(d, 15, consider(15, 0, 'luotsong'), join(15, 0, 'luotsong', 0),
      consider(15, 1, 'sinhvien'), join(15, 1, 'sinhvien', 0));
    d.advanceTo(15 + LAG_TICKS + 1);   // one frame
    expect(near(actor(d, 0), placeOf('luotsong', 0))).toBe(true);
    expect(near(actor(d, 1), placeOf('sinhvien', 0))).toBe(true);
  });

  it('never jumps a walker who is only leaving: the sim has nothing more to say about them', () => {
    const d = director();
    at(d, 0, enter(0, 0));
    at(d, 15, consider(15, 0, null), leave(15, 0, 'noOffer'));
    play(d, 15 + LAG_TICKS + 2);
    const a = actor(d, 0);
    expect(a.x).toBeGreaterThan(-PORTRAIT.actorH);
    expect(a.x).toBeLessThan(PORTRAIT.width);
  });
});

// ── Motion quality over whole rushes ────────────────────────────────────────────────────────────────────────────────

/** Plays a recorded rush at 60 frames a second into a director on a phone-sized canvas; counts hurry and jumps. */
function motion(r: Replay, L: StreetLayout, w: number, h: number) {
  const d = new Director(L, fitTo(L, w, h).view);
  d.reset(r.rush);
  const dt = 1 / 6;
  const prev = new Map<number, { x: number; y: number }>();
  const fastTicks = new Map<number, number>();
  const jumps: number[] = [];
  let joins = 0;
  let fi = 0;
  for (let t = 0; t <= 960; t += dt) {
    d.advanceTo(t);
    while (fi < r.frames.length && r.frames[fi].t <= t) {
      const f = r.frames[fi++];
      joins += f.events.filter(e => e.type === 'customerJoin').length;
      d.apply(f.events);
    }
    for (const a of d.actors) {
      const p = prev.get(a.id);
      if (p !== undefined) {
        const moved = Math.hypot(a.x - p.x, a.y - p.y);
        if (moved > L.walk * 4 * dt * 1.05 + 1e-6) jumps.push(moved / L.actorH);
      }
      prev.set(a.id, { x: a.x, y: a.y });
      if (!a.leaving && a.speed >= 2 * L.walk) fastTicks.set(a.id, (fastTicks.get(a.id) ?? 0) + dt);
    }
  }
  const fast = [...fastTicks.values()].filter(ticks => ticks >= 3).length;
  return { joins, fast, jumps };
}

describe('motion over a whole rush: people walk, they rarely hurry and do not teleport', () => {
  for (const day of [1, 3] as const) {
    for (const [name, L, w, h] of [['portrait', PORTRAIT, 390, 844], ['landscape', LANDSCAPE, 844, 390]] as const) {
      it(`day ${day}, ${name}: at most 10% of joiners at 2× or more for 0.3 s; at most 2 jumps, each under 2 bodies`, () => {
        const m = motion(replayOf(7, day, 'reasonable'), L, w, h);
        expect(m.joins).toBeGreaterThan(50);
        expect(m.fast).toBeLessThanOrEqual(Math.ceil(m.joins * 0.1));
        expect(m.jumps.length).toBeLessThanOrEqual(2);
        for (const j of m.jumps) expect(j).toBeLessThan(2);
      });
    }
  }
});

// ── The 40-actor cap ────────────────────────────────────────────────────────────────────────────────────────────────

const visible = (d: Director) => [...d.actors].filter(a => !a.hidden);
const OPEN_DAY1: ShopId[] = ['batu', 'giare', 'cochap', 'luotsong', 'sinhvien', 'player'];

/** Fills every open queue of day 1 with 5 people (30 actors, the player's are ids 25–29). */
function fullQueues(d: Director): number {
  let id = 0;
  for (const shop of OPEN_DAY1) for (let i = 0; i < 5; i++) queueUp(d, id % 10, id++, shop, id % 2 ? 'left' : 'right');
  play(d, 40);
  return id;
}

/** `n` walkers who come in at `t` and are in the middle of the street by `t + 30`. */
function walkersIn(d: Director, from: number, n: number, t: number): number[] {
  const ids: number[] = [];
  for (let k = 0; k < n; k++) {
    ids.push(from + k);
    at(d, t, enter(t, from + k, k % 2 ? 'left' : 'right'));
  }
  return ids;
}

describe(`at most ${MAX_ACTORS} actors on screen`, () => {
  it('drops walkers leaving who never queued at the player\'s first', () => {
    const d = director();
    const id = fullQueues(d);
    const walkers = walkersIn(d, id, 14, 41);
    play(d, 70);
    // The last of the player's queue gives up and leaves: someone the player would want to see go.
    const related = 29;
    at(d, 70, abandon(70, related, 'player', 'patience'), consider(70, related, null, [], true),
      leave(70, related, 'gaveUp'));
    for (const w of walkers) at(d, 70, consider(70, w, null), leave(70, w, 'noOffer'));
    d.advanceTo(71);
    expect(visible(d)).toHaveLength(MAX_ACTORS);
    expect(d.actorCount).toBe(MAX_ACTORS);
    expect(d.actor(related)).toBeDefined();
    for (const shop of OPEN_DAY1) expect(d.shop(shop).overflow).toBe(0);
  });

  it('then folds long queues into "+n", the player\'s last, never under its four counter places', () => {
    const d = director();
    const id = fullQueues(d);
    walkersIn(d, id, 15, 41);   // 45 on the street once they are in, none leaving
    play(d, 70);
    expect(visible(d)).toHaveLength(MAX_ACTORS);
    for (const shop of OPEN_DAY1.filter(s => s !== 'player')) {
      expect(d.shop(shop).shown).toBe(4);
      expect(d.shop(shop).overflow).toBe(1);
      expect(actor(d, d.shop(shop).queue[4]).hidden).toBe(true);
    }
    expect(d.shop('player').overflow).toBe(0);
    // The markers sit where the hidden part of the line begins.
    const plus = d.overflowMarkers();
    expect(plus).toHaveLength(5);
    expect(plus[0]).toEqual({ shop: 'batu', n: 1, ...placeOf('batu', 4) });
  });

  it('walkers still off the street\'s ends do not count', () => {
    const d = director();
    const id = fullQueues(d);
    walkersIn(d, id, 15, 41);
    d.advanceTo(41.5);   // all still beyond the ends of the view
    expect(d.actorCount).toBe(45);
    for (const shop of OPEN_DAY1) expect(d.shop(shop).overflow).toBe(0);
  });

  it('unfolds again once the street thins out', () => {
    const d = director();
    const id = fullQueues(d);
    const walkers = walkersIn(d, id, 15, 41);
    play(d, 70);
    expect(d.shop('batu').overflow).toBe(1);
    for (const w of walkers) at(d, 70, consider(70, w, null), leave(70, w, 'noOffer'));
    play(d, 200);   // they walk off the street
    expect(d.shop('batu').overflow).toBe(0);
    expect(actor(d, d.shop('batu').queue[4]).hidden).toBe(false);
  });

  it('a queue longer than the drawn places shows the rest as "+n" whatever the count', () => {
    const d = director();
    for (let i = 0; i < 7; i++) queueUp(d, i, i, 'player');
    play(d, 40);
    expect(d.shop('player').shown).toBe(PORTRAIT.queueSlots);
    expect(d.shop('player').overflow).toBe(2);
  });
});

// ── Shops, policy, every event ──────────────────────────────────────────────────────────────────────────────────────

describe('shop states and badges', () => {
  it('reads status, prices and the grand opening from the snapshot', () => {
    const rush = rushOfDay(3, 2, STRATEGIES.reasonable);
    const d = new Director(PORTRAIT);
    d.reset(rush);
    for (const s of rush.shops) {
      const v = d.shop(s.id);
      expect(v.status).toBe(s.status);
      expect(v.price).toBe(s.price);
      expect(v.grandOpening).toBe(s.grandOpening);
    }
    expect(d.shop('tapdoan').grandOpening).toBe(true);
    expect(d.day).toBe(2);
  });

  it('day 5: shops certified from the start show their badge from the initial state', () => {
    const rush = rushOfDay(1, 5, STRATEGIES.reasonable);
    const d = new Director(PORTRAIT);
    d.reset(rush);
    const certified = rush.shops.filter(s => s.certified).map(s => s.id);
    expect(certified.length).toBeGreaterThan(0);
    for (const s of rush.shops) {
      expect(d.shop(s.id).certified).toBe(s.certified);
      expect(d.shop(s.id).rumor).toBe(s.rumorPenalty > 0);
    }
    expect(d.shop(certified[0]).badgeSince).toBe(-Infinity);
  });

  it('price changes keep where they came from and when; status flips; the inspection badges', () => {
    const d = director();
    at(d, 300, { t: 300, type: 'shopPrice', shop: 'batu', from: 27, to: 29 });
    expect(d.shop('batu')).toMatchObject({ price: 29, prevPrice: 27, priceSince: 300 });
    at(d, 420, { t: 420, type: 'shopStatus', shop: 'giare', status: 'soldOut' });
    expect(d.shop('giare')).toMatchObject({ status: 'soldOut', statusSince: 420 });
    at(d, 450, { t: 450, type: 'policy', kind: 'inspection', certified: ['player', 'batu'], named: ['giare'] },
      { t: 450, type: 'policy', kind: 'rumorLifted' });
    expect(d.shop('player')).toMatchObject({ certified: true, named: false, badgeSince: 450, rumor: false });
    expect(d.shop('giare')).toMatchObject({ certified: false, named: true, badgeSince: 450 });
    expect(d.moments).toEqual([
      { kind: 'inspection', t: 450, certified: ['player', 'batu'], named: ['giare'] },
      { kind: 'rumorLifted', t: 450 },
    ]);
  });
});

describe('every SimEvent type is handled', () => {
  const rules = day1().rules;
  const all: SimEvent[] = [
    { t: 0, type: 'rushStart', day: 1, rules },
    enter(0, 0),
    consider(15, 0, 'player', [verdict('player', 'chosen')]),
    join(15, 0, 'player', 0),
    { t: 20, type: 'craftStep', step: 'size', endsAt: 24 },
    { t: 21, type: 'inputRejected', action: 'craft', why: 'bufferFull' },
    { t: 22, type: 'cupTrashed' },
    { t: 30, type: 'shopPrice', shop: 'player', from: 30, to: 34 },
    abandon(30, 0, 'player', 'priceUp'),
    consider(30, 0, 'batu', [verdict('player', 'visited'), verdict('batu', 'chosen')], true),
    join(30, 0, 'batu', 0),
    served(60, 0, 'batu'),
    leave(60, 0, 'served'),
    { t: 70, type: 'shopStatus', shop: 'player', status: 'closedEarly' },
    { t: 450, type: 'policy', kind: 'inspection', certified: [], named: [] },
    { t: 450, type: 'policy', kind: 'rumorLifted' },
    { t: 900, type: 'rushEnd', early: true },
  ];

  it('covers the whole union', () => {
    const types = new Set(all.map(e => (e.type === 'policy' ? `policy:${e.kind}` : e.type)));
    // 14 event types, policy counted once per kind.
    expect(types.size).toBe(15);
  });

  it('applies each in turn', () => {
    const d = director();
    for (const e of all) at(d, e.t, e);
    expect(d.shop('player').busyUntil).toBe(24);
    expect(d.shop('player').status).toBe('closedEarly');
    expect(d.ended).toBe(true);
    expect(d.moments.map(m => m.kind)).toEqual(['rushStart', 'inspection', 'rumorLifted', 'rushEnd']);
    expect(d.rules).toEqual(rules);
  });
});

// ── Bubble requests ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('bubble requests carry the real reason', () => {
  it('a customer the player lost says why the player lost them', () => {
    expect(considerTopic([verdict('player', 'tooExpensive'), verdict('batu', 'chosen')], 'batu'))
      .toEqual({ topic: 'tooExpensive', shop: 'player' });
    expect(considerTopic([verdict('player', 'outOfStock', 'pearl'), verdict('batu', 'chosen')], 'batu'))
      .toEqual({ topic: 'outOfStock', shop: 'player', missing: 'pearl' });
    expect(considerTopic([verdict('player', 'otherBetter'), verdict('giare', 'chosen')], 'giare'))
      .toEqual({ topic: 'otherBetter', shop: 'player' });
    expect(considerTopic([verdict('player', 'chosen')], 'player')).toEqual({ topic: 'chosePlayer', shop: 'player' });
  });

  it('a scared customer talks of the rumor; with the player out of play, why the street failed them', () => {
    expect(considerTopic([verdict('batu', 'rumor'), verdict('player', 'rumor')], null))
      .toEqual({ topic: 'rumor', shop: null });
    expect(considerTopic([verdict('player', 'closed'), verdict('batu', 'tooCrowded')], null))
      .toEqual({ topic: 'tooCrowded', shop: 'batu' });
    expect(considerTopic([verdict('player', 'closed'), verdict('batu', 'chosen')], 'batu')).toBeNull();
  });

  it('abandons carry their cause and what ran out; the ceiling day tells who went home empty-handed', () => {
    const d = director(PORTRAIT, rushOfDay(2, 3, STRATEGIES.reasonable));
    queueUp(d, 0, 0, 'player');
    play(d, 100);
    d.takeBubbles();
    at(d, 100, abandon(100, 0, 'player', 'stockOut', 'jelly'), consider(100, 0, null, [], true),
      leave(100, 0, 'gaveUp', true));
    expect(d.takeBubbles()).toEqual([
      { customer: 0, t: 100, topic: 'outOfStock', shop: 'player', missing: 'jelly', playerRelated: true },
      { customer: 0, t: 100, topic: 'emptyHanded', shop: null, playerRelated: true },
    ]);
  });
});

// ── reset(snapshot) ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('reset(snapshot) rebuilds the model', () => {
  it('replaying a whole rush keeps every queue equal to the sim\'s, tick by tick', () => {
    const r = replayOf(7, 3, 'reasonable');
    const d = new Director(PORTRAIT);
    d.reset(r.rush);
    let checked = 0;
    walkRush(r, (t, events, after) => {
      d.advanceTo(t);
      d.apply(events);
      for (const s of after.shops) expect(d.shop(s.id).queue).toEqual(s.queue);
      checked++;
    });
    expect(checked).toBe(900);
  });

  it('a director reset mid-rush matches one that watched the rush from the start', () => {
    const r = replayOf(7, 3, 'reasonable');
    const watched = new Director(PORTRAIT);
    watched.reset(r.rush);
    const T = 400;
    walkRush(r, (t, events) => {
      if (t > T) return;
      watched.advanceTo(t);
      watched.apply(events);
    });
    const fresh = new Director(PORTRAIT);
    fresh.reset(stateAt(r, T + 1));
    // No more events: let the watcher's walkers settle into the places the sim gave them.
    const settle = T + 1 + LAG_TICKS + 1;
    play(watched, settle);
    play(fresh, settle);
    // What reset cannot know (when a sign last flipped, the last sale) or the cap decides is left out; the counter
    // compares as busy or not.
    const comparable = (v: typeof fresh.shops[number]) => ({
      ...v, shown: 0, overflow: 0, lastSaleAt: 0, statusSince: 0, priceSince: 0, busyUntil: v.busyUntil > T + 1,
    });
    for (const s of fresh.shops) expect(comparable(watched.shop(s.id))).toEqual(comparable(s));
    // Everyone the sim still has on the street (queued, or not yet arrived and already walking in) is there, at the
    // same place.
    const onStreet = [...fresh.actors].map(a => a.id).sort((a, b) => a - b);
    expect(onStreet.length).toBeGreaterThan(10);
    for (const id of onStreet) {
      const f = actor(fresh, id);
      const w = actor(watched, id);
      expect({ id, shop: w.shop, slot: w.slot }).toEqual({ id, shop: f.shop, slot: f.slot });
      expect(near(w, f, 1e-3)).toBe(true);
    }
  });

  it('places walkers already due on their way in, those the sim has walking in among them', () => {
    const r = replayOf(7, 1, 'reasonable');
    const s = stateAt(r, 200);
    const d = new Director(PORTRAIT);
    d.reset(s);
    const walking = s.arrivalOrder.slice(s.nextArrival, s.nextEnter);
    expect(walking.length).toBeGreaterThan(0);
    for (const id of walking) {
      expect(['walk', 'lookBoard']).toContain(actor(d, id).activity);
      expect(actor(d, id).shop).toBeNull();
    }
    // Exactly those due by now are on their way: the sim's walking-in ones and any due earlier still.
    for (const id of s.arrivalOrder.slice(s.nextArrival)) {
      expect(d.actor(id) !== undefined).toBe(d.enterTime(id) <= 200);
    }
    expect(d.now).toBe(200);
  });
});

describe('layout changes', () => {
  it('turning the phone moves everyone to the same places in the other layout', () => {
    const d = director();
    queueUp(d, 0, 0, 'batu');
    queueUp(d, 0, 1, 'batu');
    play(d, 40);
    d.setLayout(LANDSCAPE);
    d.advanceTo(41);
    expect(near(actor(d, 0), queuePoint(LANDSCAPE, slotOf(LANDSCAPE, 'batu'), 0))).toBe(true);
    expect(near(actor(d, 1), queuePoint(LANDSCAPE, slotOf(LANDSCAPE, 'batu'), 1))).toBe(true);
  });

  it('someone stepping out of a queue goes toward the road', () => {
    const top = slotOf(PORTRAIT, 'batu');
    const bottom = slotOf(PORTRAIT, 'player');
    expect(asidePoint(PORTRAIT, top, 0).y).toBeGreaterThan(queuePoint(PORTRAIT, top, 0).y);
    expect(asidePoint(PORTRAIT, bottom, 0).y).toBeLessThan(queuePoint(PORTRAIT, bottom, 0).y);
  });

  it('five people fit along every shop; the bottom-row queue stands half a body clear of the shops', () => {
    for (const L of [PORTRAIT, LANDSCAPE]) {
      for (const s of L.shops) {
        const last = queuePoint(L, s, L.queueSlots - 1);
        expect(last.x + L.actorH * 0.2).toBeLessThanOrEqual(s.rect.x + s.rect.w);
        if (s.row === 'bottom') expect(s.rect.y - s.counter.y).toBeGreaterThanOrEqual(L.actorH * 0.5);
      }
    }
  });
});
