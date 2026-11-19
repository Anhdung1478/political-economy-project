// The street scene's model (spec §9 "Cảnh phố", "Kỹ thuật dựng hình"): reads the rush's `SimEvent`s tick by tick and
// keeps what the street shows. Each customer on the street is an actor with a queue of intents (steps): walk in, walk
// to a shop's price board, read it, take a place in its queue, shuffle forward, be served and walk off drinking, or
// stomp off and try a second shop, or leave. Shops keep their sign (open, sold out, resting, closed, grand opening),
// their price with the one it flipped from, their badges; the day's policy moments are kept; bubble requests (why a
// customer did what they did) and cues (a sale, a price flip) are handed to the renderers once.
//
// Pure: no DOM, no canvas, no clock of its own. Time is the sim's tick, fractional between ticks; the scene advances
// it every frame (`advanceTo`) and applies each tick's events as they come (`apply`). The picture may lag the sim by
// at most 1.5 s (LAG_TICKS): every step that brings an actor to where the sim has them carries a deadline 15 ticks
// after its event; actors hurry to meet it, and one still behind after it jumps there. At most MAX_ACTORS show: past
// that, walkers leaving who have nothing to do with the player go first, then long queues fold into "+n".
import { CONFIG } from '../../../shared/sim/config';
import { STREET } from '../../../shared/sim/shops';
import type {
  Customer, CustomerOutcome, Day, DayRules, K, LeaveCause, RejectReason, RushState, ShopId, ShopStatus, ShopVerdict,
  SimEvent, StockItem, Tick,
} from '../../../shared/sim/types';
import {
  asidePoint, fullView, queuePoint, slotOf, type Pt, type Rect, type ShopSlot, type StreetLayout,
} from './layout';
import { clamp } from './tween';

/** How far the picture may lag the sim (spec §9: 1.5 s). */
export const LAG_TICKS = 15;
/** Most actors drawn at once (spec §9). */
export const MAX_ACTORS = 40;
/** Fastest hurry, in walking speeds. */
const HURRY_MAX = 4;
/** Past this hurry (in walking speeds) a walker skips reading the board. */
const SKIP_LOOK_AT = 3;
/** Leaving walkers stroll a little slower (drinking). */
const STROLL = 0.85;
/** Folding stops at this many queue places for AI shops; the player keeps its counter's four. */
const MIN_SHOWN_AI = 2;
/** Unfold only when the street would stay this far under the cap (no flicker at the edge). */
const UNFOLD_MARGIN = 2;
/** Pause lengths, in ticks. */
const LOOK_TICKS = 5;
const PASS_LOOK_TICKS = 8;
const SERVED_TICKS = 8;
const WRONG_TICKS = 12;
const STOMP_TICKS = 9;
const UPSET_TICKS = 7;
/** Arrive this early before a deadline, so float error never makes a step late. */
const DUE_MARGIN = 0.5;

/** What an actor is doing; Task 15 picks the pose and the gait (with `speed`) from it. */
export type Activity =
  | 'walk' | 'idle' | 'queue'
  /** Reading `gaze`'s price board. */
  | 'lookBoard'
  /** Got a cup: happy. */
  | 'served'
  /** Got the wrong cup: confused. */
  | 'wrongCup'
  /** Left a queue; `cause` says why (patience: a stomp). */
  | 'abandon';

export interface Actor {
  readonly id: number;
  /** Appearance seed (`Customer.look`). */
  readonly look: number;
  readonly entry: Customer['entry'];
  x: number;
  y: number;
  facing: 1 | -1;
  /** Logical units per tick while walking; 0 while standing. */
  speed: number;
  activity: Activity;
  /** Director time the activity started. */
  since: number;
  /** The shop whose board they read. */
  gaze: ShopId | null;
  /** Why they left their last queue. */
  cause: LeaveCause | null;
  /** A cup in hand. */
  carrying: boolean;
  /** The queue they stand in, as the sim has it, and their place in it (0 at the counter); null / −1 otherwise. */
  shop: ShopId | null;
  slot: number;
  /** Sim tick they joined their current queue. */
  joinedAt: number | null;
  /** On their way off the street; gone once past its end. */
  leaving: boolean;
  /** Folded into their shop's "+n". */
  hidden: boolean;
  /** Queued at the player's shop, or said something about it. */
  playerRelated: boolean;
}

export interface ShopView {
  readonly id: ShopId;
  status: ShopStatus;
  /** When the status changed (−Infinity: as the rush opened or as reset). */
  statusSince: number;
  grandOpening: boolean;
  price: K;
  /** The price the board flipped from at `priceSince`; null before any change. */
  prevPrice: K | null;
  priceSince: number;
  certified: boolean;
  named: boolean;
  /** When the badge came (−Infinity: certified from the start). */
  badgeSince: number;
  /** Carries the day-5 rumor penalty. */
  rumor: boolean;
  /** Customer ids in the queue, as the sim has it. */
  queue: number[];
  /** Queue places drawn; the rest of the queue shows as "+n". */
  shown: number;
  /** How many of the queue are folded into "+n". */
  overflow: number;
  sold: number;
  lastSaleAt: number;
  /** Player's shop: the counter's running step ends at this tick (`craftStep`). */
  busyUntil: number;
}

export type Moment =
  | { kind: 'rushStart'; t: Tick }
  | { kind: 'inspection'; t: Tick; certified: ShopId[]; named: ShopId[] }
  | { kind: 'rumorLifted'; t: Tick }
  | { kind: 'rushEnd'; t: Tick; early: boolean };

/** One-off things for the renderers to animate (coins, flips, the bus); handed out once by `takeCues`. */
export type Cue =
  | Moment
  | { kind: 'sale'; t: Tick; shop: ShopId; customer: number; paid: K; full: K; correct: boolean }
  | { kind: 'price'; t: Tick; shop: ShopId; from: K; to: K }
  | { kind: 'status'; t: Tick; shop: ShopId; status: ShopStatus }
  | { kind: 'enter'; t: Tick; customer: number; entry: Customer['entry'] };

/** What a bubble is about, after spec §9's table. */
export type BubbleTopic =
  | 'tooExpensive' | 'tooCrowded' | 'lowTrust' | 'outOfStock' | 'otherBetter' | 'steepDiscount' | 'chosePlayer'
  | 'patience' | 'priceUp' | 'shopClosed' | 'wrongCup' | 'emptyHanded' | 'rumor';

/** A customer has something to say (Task 17 words it, picks at most 3 at once, the player's first). */
export interface BubbleRequest {
  customer: number;
  t: Tick;
  topic: BubbleTopic;
  /** The shop it is about; null for the whole street. */
  shop: ShopId | null;
  /** What ran out (`outOfStock`). */
  missing?: StockItem;
  playerRelated: boolean;
}

export interface OverflowMarker { shop: ShopId; n: number; x: number; y: number }

const TOPIC_OF_REASON: Partial<Record<ShopVerdict['reason'], BubbleTopic>> = {
  tooExpensive: 'tooExpensive', tooCrowded: 'tooCrowded', lowTrust: 'lowTrust', outOfStock: 'outOfStock',
  steepDiscount: 'steepDiscount', otherBetter: 'otherBetter',
};
/** When the player's shop is out of play and nobody was chosen: the street's reason, the most telling first. */
const STREET_REASONS: RejectReason[] = ['tooExpensive', 'tooCrowded', 'outOfStock', 'lowTrust', 'steepDiscount'];
const TOPIC_OF_CAUSE: Record<LeaveCause, BubbleTopic> = {
  patience: 'patience', priceUp: 'priceUp', steepDiscount: 'steepDiscount', stockOut: 'outOfStock',
  shopClosed: 'shopClosed',
};

/**
 * What a customer says on looking at the street: the rumor if it scared them; the player's shop when they chose it,
 * or why they passed it (so the player reads why they lost the customer); with the player out of play, why the
 * street failed them if they chose nothing; else nothing.
 */
export function considerTopic(verdicts: readonly ShopVerdict[], chosen: ShopId | null):
  { topic: BubbleTopic; shop: ShopId | null; missing?: StockItem } | null {
  if (verdicts.some(v => v.reason === 'rumor')) return { topic: 'rumor', shop: null };
  if (chosen === 'player') return { topic: 'chosePlayer', shop: 'player' };
  const about = (v: ShopVerdict, topic: BubbleTopic) =>
    (v.missing === undefined ? { topic, shop: v.shop } : { topic, shop: v.shop, missing: v.missing });
  const p = verdicts.find(v => v.shop === 'player');
  const pt = p === undefined ? undefined : TOPIC_OF_REASON[p.reason];
  if (p !== undefined && pt !== undefined) return about(p, pt);
  if (chosen !== null) return null;
  for (const r of STREET_REASONS) {
    const v = verdicts.find(x => x.reason === r);
    if (v !== undefined) return about(v, TOPIC_OF_REASON[r] as BubbleTopic);
  }
  return null;
}

// ── Steps ───────────────────────────────────────────────────────────────────────────────────────────────────────────

type Side = 'left' | 'right';
/** Where a walk goes, resolved against the layout when needed (so a turn of the phone keeps every plan). */
type Target =
  | { k: 'slot'; shop: ShopId; i: number }
  | { k: 'aside'; shop: ShopId; i: number }
  | { k: 'look'; shop: ShopId }
  /** The actor's lane at x; x null: wherever the actor is when the step starts. */
  | { k: 'lane'; x: number | null }
  | { k: 'exit'; side: Side };

interface Step {
  /** null: a pause. */
  to: Target | null;
  ticks: number;
  act: Activity;
  gaze: ShopId | null;
  /** The sim tick this step must be done by (its event + LAG_TICKS); null: none. */
  due: number | null;
  /** A pause skipped when running late (reading the board). */
  optional: boolean;
  /** Dropped as soon as the actor has something to do (walking in, a look before leaving). */
  hold: boolean;
  /** On the way into the actor's queue place: dropped if they leave the queue first. */
  toQueue: boolean;
  /** The walk into the queue place itself: follows the place as the queue moves. */
  place: boolean;
  started: boolean;
}

const walkStep = (to: Target, o: Partial<Step> = {}): Step => ({
  to, ticks: 0, act: 'walk', gaze: null, due: null, optional: false, hold: false, toQueue: false, place: false,
  started: false, ...o,
});
const pauseStep = (ticks: number, act: Activity, o: Partial<Step> = {}): Step => ({
  to: null, ticks, act, gaze: null, due: null, optional: false, hold: false, toQueue: false, place: false,
  started: false, ...o,
});

interface ActorState extends Actor {
  plan: Step[];
  lane: 0 | 1;
  laneOffset: number;
  /** The way they walked in: +1 rightward, −1 leftward. */
  dir: 1 | -1;
  /** Queues joined so far. */
  visits: number;
}

/** A small deterministic hash for actors the director never saw enter. */
const mix = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  return Math.imul(h, 0xc2b2ae35) >>> 0;
};

function viewOf(s: RushState['shops'][number]): ShopView {
  const n = s.trail.length;
  const changed = n >= 2;
  return {
    id: s.id, status: s.status, statusSince: -Infinity, grandOpening: s.grandOpening,
    price: s.price, prevPrice: changed ? s.trail[n - 2][1] : null, priceSince: changed ? s.trail[n - 1][0] : -Infinity,
    certified: s.certified, named: s.named, badgeSince: -Infinity, rumor: s.rumorPenalty > 0,
    queue: [...s.queue], shown: 0, overflow: 0, sold: s.sold, lastSaleAt: -Infinity, busyUntil: -Infinity,
  };
}

export class Director {
  private L: StreetLayout;
  private viewRect: Rect;
  private t = 0;
  private dayN: Day = 1;
  private rulesV: DayRules | null = null;
  private customers: readonly Customer[] = [];
  private readonly shopViews = new Map<ShopId, ShopView>();
  private readonly cast = new Map<number, ActorState>();
  private momentList: Moment[] = [];
  private bubbles: BubbleRequest[] = [];
  private cues: Cue[] = [];
  private endedV = false;
  /** Queue places drawn now, AI shops and the player's (lowered past the cap). */
  private shownAi: number;
  private shownPlayer: number;

  constructor(layout: StreetLayout, view: Rect = fullView(layout)) {
    this.L = layout;
    this.viewRect = view;
    this.shownAi = layout.queueSlots;
    this.shownPlayer = layout.queueSlots;
  }

  // ── Reading the model ─────────────────────────────────────────────────────────────────────────────────────────────

  get now(): number { return this.t; }
  get day(): Day { return this.dayN; }
  get rules(): DayRules | null { return this.rulesV; }
  get ended(): boolean { return this.endedV; }
  get layout(): StreetLayout { return this.L; }
  get view(): Rect { return this.viewRect; }
  get moments(): readonly Moment[] { return this.momentList; }
  /** In `STREET` order. */
  get shops(): ShopView[] { return STREET.flatMap(id => this.shopViews.get(id) ?? []); }
  get actors(): IterableIterator<Actor> { return this.cast.values(); }
  get actorCount(): number { return this.cast.size; }
  actor(id: number): Actor | undefined { return this.cast.get(id); }

  shop(id: ShopId): ShopView {
    const v = this.shopViews.get(id);
    if (v === undefined) throw new Error(`no shop ${id} on the street`);
    return v;
  }

  /** Where each folded queue shows its "+n": the first hidden place. In `STREET` order. */
  overflowMarkers(): OverflowMarker[] {
    const out: OverflowMarker[] = [];
    for (const v of this.shops) {
      if (v.overflow <= 0) continue;
      const p = queuePoint(this.L, slotOf(this.L, v.id), v.shown);
      out.push({ shop: v.id, n: v.overflow, x: p.x, y: p.y });
    }
    return out;
  }

  /** The bubble requests since the last call. */
  takeBubbles(): BubbleRequest[] {
    const b = this.bubbles;
    this.bubbles = [];
    return b;
  }

  /** The cues since the last call. */
  takeCues(): Cue[] {
    const c = this.cues;
    this.cues = [];
    return c;
  }

  // ── Driving it ────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Rebuilds everything from a rush state (on mount, after a turn of the phone or a hidden tab): shops as they stand,
   * badges included (a shop certified from the start shows its badge, R20); queued customers at their places;
   * customers walking in (entered, not yet arrived) on their way from their entry at walking speed. Customers already
   * gone are not shown. The clock is set to `s.tick`.
   */
  reset(s: RushState): void {
    this.t = s.tick;
    this.dayN = s.day;
    this.rulesV = s.rules;
    this.customers = s.customers;
    this.shopViews.clear();
    for (const sh of s.shops) this.shopViews.set(sh.id, viewOf(sh));
    const counter = this.shopViews.get('player');
    if (counter !== undefined) counter.busyUntil = s.player.craft.anim?.endsAt ?? -Infinity;
    this.cast.clear();
    this.momentList = [];
    this.bubbles = [];
    this.cues = [];
    this.endedV = s.done;
    this.shownAi = this.L.queueSlots;
    this.shownPlayer = this.L.queueSlots;
    for (const v of this.shopViews.values()) {
      v.queue.forEach((id, i) => {
        const a = this.spawn(id, s.customers[id]?.entry ?? 'left');
        const p = queuePoint(this.L, slotOf(this.L, v.id), i);
        a.x = p.x;
        a.y = p.y;
        a.shop = v.id;
        a.slot = i;
        a.joinedAt = s.rt[id].joinedTick;
        a.visits = s.rt[id].visited.length;
        a.playerRelated = s.rt[id].visited.includes('player');
        a.facing = -1;
        a.activity = 'queue';
      });
    }
    const lead = CONFIG.rush.enterLeadTicks;
    for (const id of s.arrivalOrder.slice(s.nextArrival, s.nextEnter)) {
      const c = s.customers[id];
      const a = this.walkIn(id, c.entry);
      this.advanceActor(a, s.tick - Math.max(0, c.arriveTick - lead), Math.max(0, c.arriveTick - lead));
    }
    this.enforceCap();
  }

  /** Applies one tick's events, in order. */
  apply(events: readonly SimEvent[]): void {
    for (const e of events) this.on(e);
    this.enforceCap();
  }

  /** Moves time on to `now` (sim ticks, fractional): actors walk, pause, catch up; leavers past the street go. */
  advanceTo(now: number): void {
    if (!(now > this.t)) return;
    const from = this.t;
    this.t = now;
    for (const a of this.cast.values()) {
      this.catchUp(a, now);
      this.advanceActor(a, now - from, from);
      if (a.leaving && a.plan.length === 0) this.cast.delete(a.id);
    }
    this.enforceCap();
  }

  /** A new layout (the phone turned) or view (the canvas resized): plans keep their meaning, people their place. */
  setLayout(layout: StreetLayout, view: Rect = fullView(layout)): void {
    const old = this.L;
    this.L = layout;
    this.viewRect = view;
    this.shownAi = Math.min(this.shownAi, layout.queueSlots);
    this.shownPlayer = Math.min(this.shownPlayer, layout.queueSlots);
    const sx = layout.width / old.width;
    const sy = layout.height / old.height;
    for (const a of this.cast.values()) {
      for (const s of a.plan) if (s.to?.k === 'lane' && s.to.x !== null) s.to = { k: 'lane', x: s.to.x * sx };
      if (a.plan.length === 0 && a.shop !== null) {
        const p = queuePoint(layout, slotOf(layout, a.shop), a.slot);
        a.x = p.x;
        a.y = p.y;
      } else {
        a.x *= sx;
        a.y *= sy;
      }
    }
    this.enforceCap();
  }

  /** The canvas shows a different part of the logical plane (entries and exits sit just outside it). */
  setView(view: Rect): void { this.viewRect = view; }

  // ── Events ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private on(e: SimEvent): void {
    switch (e.type) {
      case 'rushStart':
        this.dayN = e.day;
        this.rulesV = e.rules;
        this.moment({ kind: 'rushStart', t: e.t });
        return;
      case 'customerEnter':
        if (!this.cast.has(e.customer)) this.walkIn(e.customer, e.entry);
        this.cues.push({ kind: 'enter', t: e.t, customer: e.customer, entry: e.entry });
        return;
      case 'customerConsider':
        this.onConsider(e.t, e.customer, e.reshop, e.verdicts, e.chosen);
        return;
      case 'customerJoin':
        this.onJoin(e.t, e.customer, e.shop, e.position);
        return;
      case 'customerServed': {
        const v = this.shop(e.shop);
        v.sold++;
        v.lastSaleAt = e.t;
        this.cues.push({ kind: 'sale', t: e.t, shop: e.shop, customer: e.customer, paid: e.paid, full: e.full,
          correct: e.correct });
        const a = this.leaveQueue(e.t, e.customer, e.shop, e.correct ? 'served' : 'wrongCup',
          e.correct ? SERVED_TICKS : WRONG_TICKS);
        if (a !== null) a.carrying = true;
        if (!e.correct) this.say(e.t, e.customer, 'wrongCup', e.shop);
        return;
      }
      case 'customerAbandon': {
        const a = this.leaveQueue(e.t, e.customer, e.shop, 'abandon',
          e.cause === 'patience' ? STOMP_TICKS : UPSET_TICKS);
        if (a !== null) a.cause = e.cause;
        this.say(e.t, e.customer, TOPIC_OF_CAUSE[e.cause], e.shop, e.missing);
        return;
      }
      case 'customerLeave':
        this.onLeave(e.t, e.customer, e.outcome, e.emptyHanded);
        return;
      case 'shopPrice': {
        const v = this.shop(e.shop);
        v.prevPrice = e.from;
        v.price = e.to;
        v.priceSince = e.t;
        this.cues.push({ kind: 'price', t: e.t, shop: e.shop, from: e.from, to: e.to });
        return;
      }
      case 'shopStatus': {
        const v = this.shop(e.shop);
        v.status = e.status;
        v.statusSince = e.t;
        this.cues.push({ kind: 'status', t: e.t, shop: e.shop, status: e.status });
        return;
      }
      case 'policy':
        if (e.kind === 'inspection') {
          for (const id of e.certified) Object.assign(this.shop(id), { certified: true, rumor: false, badgeSince: e.t });
          for (const id of e.named) Object.assign(this.shop(id), { named: true, badgeSince: e.t });
          this.moment({ kind: 'inspection', t: e.t, certified: [...e.certified], named: [...e.named] });
        } else {
          this.moment({ kind: 'rumorLifted', t: e.t });
        }
        return;
      case 'craftStep':
        this.shop('player').busyUntil = e.endsAt;
        return;
      case 'cupTrashed':
      case 'inputRejected':
        // The counter itself is the craft panel's (DOM); the street has nothing to show.
        return;
      case 'rushEnd':
        this.endedV = true;
        this.moment({ kind: 'rushEnd', t: e.t, early: e.early });
        return;
      default: {
        const never: never = e;
        throw new Error(`unhandled event ${(never as SimEvent).type}`);
      }
    }
  }

  private moment(m: Moment): void {
    this.momentList.push(m);
    this.cues.push(m);
  }

  private say(t: Tick, customer: number, topic: BubbleTopic, shop: ShopId | null, missing?: StockItem): void {
    const a = this.cast.get(customer);
    if (shop === 'player' && a !== undefined) a.playerRelated = true;
    const playerRelated = shop === 'player' || (a?.playerRelated ?? false);
    this.bubbles.push(missing === undefined
      ? { customer, t, topic, shop, playerRelated }
      : { customer, t, topic, shop, missing, playerRelated });
  }

  private onConsider(t: Tick, id: number, reshop: boolean, verdicts: readonly ShopVerdict[],
    chosen: ShopId | null): void {
    const a = this.ensure(id);
    const topic = considerTopic(verdicts, chosen);
    if (topic !== null) this.say(t, id, topic.topic, topic.shop, topic.missing);
    if (reshop || chosen !== null) return;
    // Nothing will do: they stop to read a board (the one they talk about, else the nearest), then walk on.
    a.plan = a.plan.filter(s => !s.hold);
    a.plan.push(pauseStep(PASS_LOOK_TICKS, 'lookBoard', { gaze: topic?.shop ?? this.nearestShop(a), hold: true }));
  }

  private onJoin(t: Tick, id: number, shop: ShopId, position: number): void {
    const a = this.ensure(id);
    const v = this.shop(shop);
    v.queue.splice(Math.min(position, v.queue.length), 0, id);
    a.shop = shop;
    a.joinedAt = t;
    a.leaving = false;
    if (shop === 'player') a.playerRelated = true;
    a.plan = a.plan.filter(s => !s.hold);
    const due = t + LAG_TICKS;
    if (a.visits > 0) a.plan.push(walkStep({ k: 'lane', x: null }, { toQueue: true }));
    a.plan.push(walkStep({ k: 'look', shop }, { toQueue: true }));
    if (a.visits === 0) {
      a.plan.push(pauseStep(LOOK_TICKS, 'lookBoard', { gaze: shop, optional: true, toQueue: true }));
    }
    a.plan.push(walkStep({ k: 'slot', shop, i: position }, { due, toQueue: true, place: true }));
    a.visits++;
    this.requeue(v, t);
  }

  /**
   * Takes a customer out of their queue (served or abandoning): they step aside toward the road, by the deadline,
   * and hold the pose (`act`); the queue behind moves up. Returns the actor, if any.
   */
  private leaveQueue(t: Tick, id: number, shop: ShopId, act: Activity, ticks: number): ActorState | null {
    const v = this.shop(shop);
    const at = v.queue.indexOf(id);
    if (at >= 0) v.queue.splice(at, 1);
    const a = this.cast.get(id);
    if (a !== undefined) {
      const place = Math.max(0, a.slot);
      a.shop = null;
      a.slot = -1;
      a.joinedAt = null;
      a.lane = slotOf(this.L, shop).row === 'top' ? 0 : 1;
      a.plan = a.plan.filter(s => !s.toQueue && !s.hold);
      a.plan.push(walkStep({ k: 'aside', shop, i: place }, { due: t + LAG_TICKS }), pauseStep(ticks, act));
    }
    this.requeue(v, t);
    return a ?? null;
  }

  private onLeave(t: Tick, id: number, outcome: CustomerOutcome, emptyHanded: boolean): void {
    const a = this.cast.get(id);
    if (a !== undefined && a.shop !== null) {
      // Still queued at the end of the rush: they just go home.
      const v = this.shop(a.shop);
      v.queue.splice(v.queue.indexOf(id), 1);
      a.lane = slotOf(this.L, a.shop).row === 'top' ? 0 : 1;
      a.plan = a.plan.filter(s => !s.toQueue && !s.hold);
      a.shop = null;
      a.slot = -1;
      a.joinedAt = null;
      this.requeue(v, t);
    }
    if (emptyHanded && this.rulesV?.ceiling != null) this.say(t, id, 'emptyHanded', null);
    if (a === undefined) return;
    a.leaving = true;
    // Never queued: they walk on the way they came; otherwise to the nearer end of the street.
    const firstLook = outcome === 'noOffer' || outcome === 'scared';
    const side: Side = firstLook ? (a.dir > 0 ? 'right' : 'left')
      : a.x < this.viewRect.x + this.viewRect.w / 2 ? 'left' : 'right';
    a.plan.push(walkStep({ k: 'lane', x: null }), walkStep({ k: 'exit', side }));
  }

  /** Every queued actor follows its place as the queue moves (the shuffle forward), by the deadline. */
  private requeue(v: ShopView, t: Tick): void {
    v.queue.forEach((id, i) => {
      const a = this.cast.get(id);
      if (a === undefined || a.slot === i) return;
      a.slot = i;
      const walk = a.plan.find(s => s.place);
      if (walk !== undefined) {
        walk.to = { k: 'slot', shop: v.id, i };
        walk.due = Math.max(walk.due ?? -Infinity, t + LAG_TICKS);
      } else {
        a.plan.push(walkStep({ k: 'slot', shop: v.id, i }, { due: t + LAG_TICKS, toQueue: true, place: true }));
      }
    });
  }

  // ── Actors ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private spawn(id: number, entry: Customer['entry']): ActorState {
    const look = this.customers[id]?.look ?? mix(id);
    const a: ActorState = {
      id, look, entry, x: 0, y: 0, facing: 1, speed: 0, activity: 'idle', since: this.t, gaze: null, cause: null,
      carrying: false, shop: null, slot: -1, joinedAt: null, leaving: false, hidden: false, playerRelated: false,
      plan: [], lane: entry === 'bus' ? 1 : ((look & 1) as 0 | 1),
      laneOffset: (((look >>> 3) % 7) - 3) * this.L.actorH * 0.05,
      dir: entry === 'left' ? 1 : -1, visits: 0,
    };
    this.cast.set(id, a);
    return a;
  }

  /** A customer comes in at their entry and walks along the street, until they choose. */
  private walkIn(id: number, entry: Customer['entry']): ActorState {
    const a = this.spawn(id, entry);
    const start = entry === 'bus' ? this.L.busStop : this.resolve(a, { k: 'exit', side: entry }, a);
    a.x = start.x;
    a.y = start.y;
    a.facing = a.dir;
    a.activity = 'walk';
    if (entry === 'bus') a.plan.push(walkStep({ k: 'lane', x: null }, { hold: true }));
    a.plan.push(walkStep({ k: 'exit', side: a.dir > 0 ? 'right' : 'left' }, { hold: true }));
    return a;
  }

  /** The actor for an event about someone the director never saw come in (after a reset): from their entry. */
  private ensure(id: number): ActorState {
    return this.cast.get(id) ?? this.walkIn(id, this.customers[id]?.entry ?? 'left');
  }

  private laneY(a: ActorState, lane: 0 | 1 = a.lane): number { return this.L.lanes[lane] + a.laneOffset; }

  private resolve(a: ActorState, to: Target, from: Pt): Pt {
    const L = this.L;
    switch (to.k) {
      case 'slot': return queuePoint(L, slotOf(L, to.shop), to.i);
      case 'aside': return asidePoint(L, slotOf(L, to.shop), to.i);
      case 'look': {
        const s = slotOf(L, to.shop);
        return { x: s.look.x, y: this.laneY(a, s.row === 'top' ? 0 : 1) };
      }
      case 'lane': return { x: to.x ?? from.x, y: this.laneY(a) };
      case 'exit': {
        const v = this.viewRect;
        return { x: to.side === 'left' ? v.x - L.actorH : v.x + v.w + L.actorH, y: this.laneY(a) };
      }
    }
  }

  private nearestShop(a: ActorState): ShopId {
    let best: ShopSlot = this.L.shops[0];
    for (const s of this.L.shops) if (Math.abs(s.look.x - a.x) < Math.abs(best.look.x - a.x)) best = s;
    return best.id;
  }

  /**
   * The speed the actor needs to finish its steps up to the first deadline in time (arriving DUE_MARGIN early),
   * between walking speed and HURRY_MAX times it; `withOptional` counts the optional pauses as kept.
   */
  private needed(a: ActorState, now: number, withOptional: boolean): number {
    let d = 0;
    let pause = 0;
    let p: Pt = a;
    for (const s of a.plan) {
      if (s.to === null) {
        if (withOptional || !s.optional) pause += s.ticks;
      } else {
        const q = this.resolve(a, s.to, p);
        d += Math.hypot(q.x - p.x, q.y - p.y);
        p = q;
      }
      if (s.due !== null) {
        const left = s.due - DUE_MARGIN - now - pause;
        return left <= 0 ? Infinity : d / left;
      }
    }
    return 0;
  }

  /** The speed to walk at now: keeping the board reading if that needs no more than SKIP_LOOK_AT, else skipping it. */
  private speedNeeded(a: ActorState, now: number): number {
    const keep = this.needed(a, now, true);
    return keep <= SKIP_LOOK_AT * this.L.walk ? keep : this.needed(a, now, false);
  }

  /** More than LAG_TICKS behind: every step up to the last overdue deadline is done at once. */
  private catchUp(a: ActorState, now: number): void {
    let last = -1;
    for (let i = 0; i < a.plan.length; i++) {
      const due = a.plan[i].due;
      if (due !== null && due < now) last = i;
    }
    if (last < 0) return;
    for (let i = 0; i <= last; i++) {
      const s = a.plan[i];
      if (s.to === null) continue;
      const p = this.resolve(a, s.to, a);
      if (s.to.k === 'lane' && s.to.x === null) s.to = { k: 'lane', x: p.x };
      a.x = p.x;
      a.y = p.y;
    }
    a.plan.splice(0, last + 1);
    this.settle(a, now);
  }

  /** Runs the actor's steps for `dt` ticks from time `from`. */
  private advanceActor(a: ActorState, dt: number, from: number): void {
    let left = dt;
    while (left > 1e-9 && a.plan.length > 0) {
      const s = a.plan[0];
      const now = from + (dt - left);
      if (!s.started) {
        s.started = true;
        if (s.to?.k === 'lane' && s.to.x === null) s.to = { k: 'lane', x: a.x };
        if (s.optional && this.needed(a, now, true) > SKIP_LOOK_AT * this.L.walk) {
          a.plan.shift();
          continue;
        }
        this.setActivity(a, s.act, now);
        a.gaze = s.gaze;
        if (s.gaze !== null) {
          const bx = slotOf(this.L, s.gaze).board.x;
          if (Math.abs(bx - a.x) > 1) a.facing = bx > a.x ? 1 : -1;
        }
      }
      if (s.to === null) {
        a.speed = 0;
        const use = Math.min(left, s.ticks);
        s.ticks -= use;
        left -= use;
        if (s.ticks <= 1e-9) a.plan.shift();
        continue;
      }
      const p = this.resolve(a, s.to, a);
      const dx = p.x - a.x;
      const dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      const base = this.L.walk * (a.leaving ? STROLL : 1);
      const v = clamp(this.speedNeeded(a, now), base, base * HURRY_MAX);
      a.speed = v;
      if (Math.abs(dx) > 1e-6) a.facing = dx > 0 ? 1 : -1;
      if (d <= v * left + 1e-6) {
        a.x = p.x;
        a.y = p.y;
        left -= d / v;
        a.plan.shift();
      } else {
        a.x += (dx / d) * v * left;
        a.y += (dy / d) * v * left;
        left = 0;
      }
    }
    if (a.plan.length === 0) this.settle(a, from + dt);
  }

  /** Standing with nothing left to do: in their queue, or idle. */
  private settle(a: ActorState, now: number): void {
    if (a.plan.length > 0) return;
    a.speed = 0;
    a.gaze = null;
    if (a.shop !== null) {
      a.facing = -1;   // queues run +x from the counter: face it
      this.setActivity(a, 'queue', now);
    } else {
      this.setActivity(a, 'idle', now);
    }
  }

  private setActivity(a: ActorState, act: Activity, now: number): void {
    if (a.activity === act) return;
    a.activity = act;
    a.since = now;
  }

  // ── The cap ───────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * At most MAX_ACTORS drawn. Over it: walkers leaving who have nothing to do with the player go first (those nearest
   * their way out first), then queues fold into "+n" (AI shops first, down to MIN_SHOWN_AI places; the player's
   * down to its counter's four), then leaving walkers who do. Folds come undone once the street, without the walkers
   * leaving who could still go, would sit UNFOLD_MARGIN under the cap.
   */
  private enforceCap(): void {
    const slots = this.L.queueSlots;
    const counter = Math.min(slots, CONFIG.rush.counterSlots);
    // Undo folds the street has room for again, in the reverse order: the player's first.
    for (;;) {
      let ai = this.shownAi;
      let player = this.shownPlayer;
      if (player < slots) player++;
      else if (ai < slots) ai++;
      else break;
      if (this.visibleWith(ai, player) - this.leavers(false).length > MAX_ACTORS - UNFOLD_MARGIN) break;
      this.shownAi = ai;
      this.shownPlayer = player;
    }
    this.drop(this.leavers(false), this.visibleWith(this.shownAi, this.shownPlayer) - MAX_ACTORS);
    while (this.visibleWith(this.shownAi, this.shownPlayer) > MAX_ACTORS) {
      if (this.shownAi > MIN_SHOWN_AI) this.shownAi--;
      else if (this.shownPlayer > counter) this.shownPlayer--;
      else break;
    }
    this.drop(this.leavers(true), this.visibleWith(this.shownAi, this.shownPlayer) - MAX_ACTORS);
    for (const v of this.shopViews.values()) {
      v.shown = v.id === 'player' ? this.shownPlayer : this.shownAi;
      v.overflow = Math.max(0, v.queue.length - v.shown);
      v.queue.forEach((id, i) => {
        const a = this.cast.get(id);
        if (a !== undefined) a.hidden = i >= v.shown;
      });
    }
  }

  /** Actors drawn if queues showed this many places. */
  private visibleWith(ai: number, player: number): number {
    let hidden = 0;
    for (const v of this.shopViews.values()) {
      const shown = v.id === 'player' ? player : ai;
      for (let i = shown; i < v.queue.length; i++) if (this.cast.has(v.queue[i])) hidden++;
    }
    return this.cast.size - hidden;
  }

  /** Leaving walkers, player-related or not, nearest their way out first. */
  private leavers(related: boolean): ActorState[] {
    const out: ActorState[] = [];
    for (const a of this.cast.values()) if (a.leaving && a.playerRelated === related) out.push(a);
    const v = this.viewRect;
    const toExit = (a: ActorState) => Math.min(a.x - v.x, v.x + v.w - a.x);
    return out.sort((p, q) => toExit(p) - toExit(q));
  }

  private drop(list: ActorState[], n: number): void {
    for (let i = 0; i < n && i < list.length; i++) this.cast.delete(list[i].id);
  }
}
