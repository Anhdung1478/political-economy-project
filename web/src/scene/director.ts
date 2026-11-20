// The street scene's model (spec §9 "Cảnh phố", "Kỹ thuật dựng hình"): reads the rush's `SimEvent`s tick by tick and
// keeps what the street shows. Each customer on the street is an actor with a queue of intents (steps): walk in along
// the road, stop in the middle of the street to read the price boards, turn in to a place in the chosen shop's queue,
// shuffle forward, be served and walk off drinking, or stomp off and try a second shop, or walk on out of the street
// (spec §9: "đi dọc đường, dừng nhìn bảng giá, rồi rẽ vào xếp hàng ở quán đã chọn hoặc đi tiếp ra khỏi phố"). Shops
// keep their sign (open, sold out, resting, closed, grand opening), their price with the one it flipped from, their
// badges; the day's policy moments are kept; bubble requests (why a customer did what they did) and cues (a sale, a
// price flip, a walker coming in) are handed to the renderers once.
//
// Pure: no DOM, no canvas, no clock of its own. Time is the sim's tick, fractional between ticks; the scene advances
// it every frame (`advanceTo`) and applies each tick's events as they come (`apply`).
//
// Walkers come in on the director's own schedule (R44): every customer of the day is known from the rush state, so
// each one enters early enough to walk to the middle of the street and read the boards for BROWSE_TICKS before the sim
// has them choose (`customerEnter` only fills in for someone the director did not know). The picture may lag the sim
// by at most 1.5 s (LAG_TICKS): every step that brings an actor to where the sim has them carries a deadline 15 ticks
// after its event; actors hurry to meet it, and one still behind after it jumps there. At most MAX_ACTORS show: past
// that, walkers leaving who have nothing to do with the player go first, then long queues fold into "+n".
import { CONFIG } from '../../../shared/sim/config';
import { STREET } from '../../../shared/sim/shops';
import type {
  Customer, CustomerOutcome, Day, DayRules, K, LeaveCause, RejectReason, RushState, ShopId, ShopStatus, ShopVerdict,
  SimEvent, StockItem, Tick,
} from '../../../shared/sim/types';
import {
  asidePoint, busWaitPoint, fullView, queuePoint, slotOf, type Pt, type Rect, type ShopSlot, type StreetLayout,
} from './layout';
import { planBus, type BusVisit } from './schedule';
import { clamp } from './tween';

/** How far the picture may lag the sim (spec §9: 1.5 s). */
export const LAG_TICKS = 15;
/** Most actors drawn at once (spec §9). */
export const MAX_ACTORS = 40;
/** A walker the cap pushes off the screen fades out over this many ticks before going (no pop). */
export const FADE_TICKS = 4;
/** Least time a walker reads the boards in the middle of the street before the sim has them choose (ticks). */
export const BROWSE_TICKS = 10;
/** Fastest hurry, in walking speeds. */
const HURRY_MAX = 4;
/** Folding stops at this many queue places for AI shops; the player keeps its counter's four. */
const MIN_SHOWN_AI = 2;
/** Unfold only when the street would stay this far under the cap (no flicker at the edge). */
const UNFOLD_MARGIN = 2;
/** Pause lengths, in ticks. */
const PASS_LOOK_TICKS = 6;
const SERVED_TICKS = 8;
const WRONG_TICKS = 12;
const STOMP_TICKS = 9;
const UPSET_TICKS = 7;
/** The stomp before walking to a second shop; the anger goes on in the walk (`cause`). */
const RESHOP_STOMP_TICKS = 3;
/** Arrive this early before a deadline, so float error never makes a step late. */
const DUE_MARGIN = 0.5;
/** A walk turns the actor's back or front to us (`up` / `down`) only when it is this much steeper than it is wide. */
const STEEP = 1.2;

/** What an actor is doing; Task 15 picks the pose and the gait (with `speed` and `heading`) from it. */
export type Activity =
  | 'walk' | 'idle' | 'queue'
  /** Reading `gaze`'s price board (in the middle of the street, or before walking on). */
  | 'lookBoard'
  /** Got a cup: happy. */
  | 'served'
  /** Got the wrong cup: confused. */
  | 'wrongCup'
  /** Left a queue; `cause` says why (patience: a stomp). */
  | 'abandon';

/** Which way an actor is turned, for the view of the walk cycle: side-on, back to us (`up`) or facing us (`down`). */
export type Heading = 'left' | 'right' | 'up' | 'down';

export interface Actor {
  readonly id: number;
  /** Appearance seed (`Customer.look`). */
  readonly look: number;
  readonly entry: Customer['entry'];
  x: number;
  y: number;
  /** Left or right, for mirroring; agrees with `heading` when that is side-on. */
  facing: 1 | -1;
  /**
   * The way they walk, or face while standing: in a queue the head faces the shop (up for the top row, down for the
   * bottom row) and the rest face the head (left); reading a board, they face its row; served or upset, they face us.
   */
  heading: Heading;
  /** Logical units per tick while walking; 0 while standing. */
  speed: number;
  activity: Activity;
  /** Director time the activity started. */
  since: number;
  /** The shop whose board they read. */
  gaze: ShopId | null;
  /** Why they left their last queue (null if they never did); still set on the walk to a second shop, an angry walk. */
  cause: LeaveCause | null;
  /** A cup in hand. */
  carrying: boolean;
  /** The cup in hand is the wrong one (served wrong): they walk off grumbling. */
  cupWrong: boolean;
  /** Day 5: the rumor scared them off (`Customer.scared`); they whisper at the boards and hurry away. */
  readonly scared: boolean;
  /** The queue they stand in, as the sim has it, and their place in it (0 at the counter); null / −1 otherwise. */
  shop: ShopId | null;
  slot: number;
  /** Sim tick they joined their current queue. */
  joinedAt: number | null;
  /** On their way off the street; gone once past its end. */
  leaving: boolean;
  /** Folded into their shop's "+n". */
  hidden: boolean;
  /** Has queued at the player's shop: kept on screen longest when the street is full. */
  playerRelated: boolean;
  /** Pushed off by the cap while on screen: fading out since this director time, gone FADE_TICKS later; else null. */
  fadeAt: number | null;
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

/**
 * One-off things for the renderers to animate (coins, flips, the bus); handed out once by `takeCues`. `enter`: a
 * walker came onto the street (at their entry, or at the bus stop), at director time `t`.
 */
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
  /**
   * `tooExpensive` only: whether the shop's price alone was within the customer's budget. Then it was low reputation
   * that sank the shop's score (spec §4: the score adds (rep − 50) × 0.2k), and the words are about trust and value,
   * not the price.
   */
  priceOk?: boolean;
  /** About the player's shop, or said by someone who queued there. */
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
  /** The actor's lane at x; x null: wherever the actor is when the step starts. */
  | { k: 'lane'; x: number | null }
  | { k: 'exit'; side: Side }
  /** Waiting spot `i` at the bus shelter. */
  | { k: 'busWait'; i: number };

interface Step {
  /** null: a pause. */
  to: Target | null;
  ticks: number;
  act: Activity;
  gaze: ShopId | null;
  /** The sim tick this step must be done by (its event + LAG_TICKS); null: none. */
  due: number | null;
  /** Dropped as soon as the actor has something to do (walking in and browsing, a look before leaving). */
  hold: boolean;
  /** On the way into the actor's queue place: dropped if they leave the queue first. */
  toQueue: boolean;
  /** Follows the actor's queue place as the queue moves. */
  place: boolean;
  /** Stepping out of a queue toward the road; skipped when they head straight for a second shop. */
  stepOut: boolean;
  started: boolean;
}

const walkStep = (to: Target, o: Partial<Step> = {}): Step => ({
  to, ticks: 0, act: 'walk', gaze: null, due: null, hold: false, toQueue: false, place: false, stepOut: false,
  started: false, ...o,
});
const pauseStep = (ticks: number, act: Activity, o: Partial<Step> = {}): Step => ({
  to: null, ticks, act, gaze: null, due: null, hold: false, toQueue: false, place: false, stepOut: false,
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

/** Lane, lane offset and where along the browse span a walker with this look stops (0..1). */
const laneOf = (look: number, entry: Customer['entry']): 0 | 1 => (entry === 'bus' ? 1 : ((look & 1) as 0 | 1));
const laneOffsetOf = (look: number, L: StreetLayout) => (((look >>> 3) % 7) - 3) * L.actorH * 0.05;
const browseAt = (look: number) => ((look >>> 11) % 64) / 63;

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
  /** `customers` is the director's own copy (customers were added), not the rush state's. */
  private ownCustomers = false;
  /** Customers not on the street yet, by the time they come in. */
  private pending: { id: number; at: number }[] = [];
  private readonly shopViews = new Map<ShopId, ShopView>();
  private readonly cast = new Map<number, ActorState>();
  private momentList: Moment[] = [];
  private bubbles: BubbleRequest[] = [];
  private cues: Cue[] = [];
  private endedV = false;
  /** Bus-stop days: the bus's visits, and when each rider steps off, where they wait and how long. */
  private busVisitsV: BusVisit[] = [];
  private readonly busRide = new Map<number, { off: number; spot: number; wait: number }>();
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
  /** The bus's visits today (bus-stop days; empty otherwise), for the street to drive it. */
  get busVisits(): readonly BusVisit[] { return this.busVisitsV; }
  /** In `STREET` order. */
  get shops(): ShopView[] { return STREET.flatMap(id => this.shopViews.get(id) ?? []); }
  get actors(): IterableIterator<Actor> { return this.cast.values(); }
  get actorCount(): number { return this.cast.size; }
  /** Customers known (the rush state's, and any added); the next added one takes this id. */
  get customerCount(): number { return this.customers.length; }
  actor(id: number): Actor | undefined { return this.cast.get(id); }

  shop(id: ShopId): ShopView {
    const v = this.shopViews.get(id);
    if (v === undefined) throw new Error(`no shop ${id} on the street`);
    return v;
  }

  /**
   * When customer `id` comes onto the street: early enough to walk from their entry to their spot in the middle of
   * the street and read the boards there for BROWSE_TICKS before they arrive (R44). Depends on the layout and view.
   */
  enterTime(id: number): number {
    const ride = this.busRide.get(id);
    if (ride !== undefined) return ride.off;
    return this.ownEnterTime(id);
  }

  /** When customer `id` would come in on their own (for a bus rider: stepping off right as they need to). */
  private ownEnterTime(id: number): number {
    const c = this.customers[id];
    const L = this.L;
    const lane = laneOf(c.look, c.entry);
    const y = L.lanes[lane] + laneOffsetOf(c.look, L);
    const bx = this.browseX(c.look);
    const start = c.entry === 'bus' ? L.busStop : { x: this.exitX(c.entry), y };
    // Off the bus: to the lane first, then along it (the walk `walkIn` plans).
    const d = Math.abs(y - start.y) + Math.abs(bx - start.x);
    return c.arriveTick - d / L.walk - BROWSE_TICKS;
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
   * Rebuilds everything from a rush state (on mount, after a seek or a hidden tab): shops as they stand, badges
   * included (a shop certified from the start shows its badge, R20); queued customers at their places; customers yet
   * to arrive on the director's schedule, those already due on their way in where they would be by now. Customers
   * already gone are not shown. The clock is set to `s.tick`.
   */
  reset(s: RushState): void {
    this.t = s.tick;
    this.dayN = s.day;
    this.rulesV = s.rules;
    this.customers = s.customers;
    this.ownCustomers = false;
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
        this.settle(a, s.tick);
      });
    }
    this.planBusRides();
    this.pending = s.arrivalOrder.slice(s.nextArrival).map(id => ({ id, at: this.enterTime(id) }));
    this.pending.sort((a, b) => a.at - b.at);
    this.comeIn(s.tick, false);
    this.enforceCap();
  }

  /**
   * More customers for the street after the rush state's (the ambient walkers, ambient.ts): their ids follow on from
   * the known ones, and each comes in on the director's schedule like the rush's (early enough to read the boards
   * before their `arriveTick`). The rush state's own list is never changed.
   */
  addCustomers(cs: readonly Customer[]): void {
    if (cs.length === 0) return;
    if (!this.ownCustomers) {
      this.customers = this.customers.slice();
      this.ownCustomers = true;
    }
    const list = this.customers as Customer[];
    for (const c of cs) {
      if (c.id !== list.length) throw new Error(`customer ${c.id} added out of order (next is ${list.length})`);
      list.push(c);
      this.pending.push({ id: c.id, at: this.enterTime(c.id) });
    }
    this.pending.sort((a, b) => a.at - b.at);
  }

  /** Applies one tick's events, in order. */
  apply(events: readonly SimEvent[]): void {
    for (const e of events) this.on(e);
    this.enforceCap();
  }

  /**
   * Moves time on to `now` (sim ticks, fractional): actors walk, pause, catch up; walkers due come in; leavers past
   * the street go.
   */
  advanceTo(now: number): void {
    if (!(now > this.t)) return;
    const from = this.t;
    this.t = now;
    for (const a of this.cast.values()) {
      this.catchUp(a, now);
      this.advanceActor(a, now - from, from);
      if ((a.leaving && a.plan.length === 0) || (a.fadeAt !== null && now - a.fadeAt >= FADE_TICKS)) {
        this.cast.delete(a.id);
      }
    }
    this.comeIn(now, true);
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
      a.laneOffset = laneOffsetOf(a.look, layout);
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
    this.planBusRides();
    this.reschedule();
    this.enforceCap();
  }

  /** The canvas shows a different part of the logical plane (entries and exits sit just outside it). */
  setView(view: Rect): void {
    this.viewRect = view;
    this.reschedule();
  }

  // ── Events ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private on(e: SimEvent): void {
    switch (e.type) {
      case 'rushStart':
        this.dayN = e.day;
        this.rulesV = e.rules;
        this.moment({ kind: 'rushStart', t: e.t });
        return;
      case 'customerEnter':
        // The director brings walkers in itself; this only fills in for one it did not know or has not brought yet.
        if (!this.cast.has(e.customer)) this.ensure(e.customer, e.entry);
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
        if (a !== null) {
          a.carrying = true;
          a.cupWrong = !e.correct;
        }
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
    const playerRelated = shop === 'player' || (this.cast.get(customer)?.playerRelated ?? false);
    const b: BubbleRequest = missing === undefined
      ? { customer, t, topic, shop, playerRelated }
      : { customer, t, topic, shop, missing, playerRelated };
    const c = this.customers[customer];
    const v = shop === null ? undefined : this.shopViews.get(shop);
    if (topic === 'tooExpensive' && c !== undefined && v !== undefined && v.price > 0) b.priceOk = c.budget >= v.price;
    this.bubbles.push(b);
  }

  private onConsider(t: Tick, id: number, reshop: boolean, verdicts: readonly ShopVerdict[],
    chosen: ShopId | null): void {
    const a = this.ensure(id);
    const topic = considerTopic(verdicts, chosen);
    if (topic !== null) this.say(t, id, topic.topic, topic.shop, topic.missing);
    if (reshop || chosen !== null) return;
    // Nothing will do: a last look at the board they talk about (else the nearest), then they walk on.
    a.plan = a.plan.filter(s => !s.hold);
    a.plan.push(pauseStep(PASS_LOOK_TICKS, 'lookBoard', { gaze: topic?.shop ?? this.nearestShop(a), hold: true }));
  }

  /**
   * Into the queue at `position`: straight from where they are to the front of their place, then into it, by the
   * deadline. Coming from another queue, the stomp is cut short (the walk carries it on, `cause`) and they do not step
   * out toward the road first.
   */
  private onJoin(t: Tick, id: number, shop: ShopId, position: number): void {
    const a = this.ensure(id);
    const v = this.shop(shop);
    const at = Math.min(position, v.queue.length);
    v.queue.splice(at, 0, id);
    a.shop = shop;
    a.joinedAt = t;
    a.leaving = false;
    if (shop === 'player') a.playerRelated = true;
    a.plan = a.plan.filter(s => !s.hold && !(s.stepOut && !s.started));
    for (const s of a.plan) if (s.to === null && s.act === 'abandon') s.ticks = Math.min(s.ticks, RESHOP_STOMP_TICKS);
    a.plan.push(
      walkStep({ k: 'aside', shop, i: at }, { toQueue: true, place: true }),
      walkStep({ k: 'slot', shop, i: at }, { due: t + LAG_TICKS, toQueue: true, place: true }),
    );
    a.slot = at;
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
      a.plan.push(walkStep({ k: 'aside', shop, i: place }, { due: t + LAG_TICKS, stepOut: true }), pauseStep(ticks, act));
    }
    this.requeue(v, t);
    return a ?? null;
  }

  private onLeave(t: Tick, id: number, outcome: CustomerOutcome, emptyHanded: boolean): void {
    const a = this.cast.get(id);
    // Whatever they were holding for ends: the walk in, the endless read of the boards while browsing. Only a short
    // last look (the pass-by's, from their consider) is kept before they go.
    if (a !== undefined) a.plan = a.plan.filter(s => !s.hold || (s.to === null && Number.isFinite(s.ticks)));
    if (a !== undefined && a.shop !== null) {
      // Still queued at the end of the rush: they just go home.
      const v = this.shop(a.shop);
      const at = v.queue.indexOf(id);
      if (at >= 0) v.queue.splice(at, 1);
      a.lane = slotOf(this.L, a.shop).row === 'top' ? 0 : 1;
      a.plan = a.plan.filter(s => !s.toQueue);
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

  /**
   * Every queued actor follows its place as the queue moves (the shuffle forward), by 15 ticks after the move; one
   * still on the way to their first place keeps the deadline of their join.
   */
  private requeue(v: ShopView, t: Tick): void {
    v.queue.forEach((id, i) => {
      const a = this.cast.get(id);
      if (a === undefined || a.slot === i) return;
      a.slot = i;
      let following = false;
      for (const s of a.plan) {
        if (!s.place || s.to === null || (s.to.k !== 'slot' && s.to.k !== 'aside')) continue;
        s.to = { k: s.to.k, shop: v.id, i };
        following = true;
      }
      if (!following) {
        a.plan.push(walkStep({ k: 'slot', shop: v.id, i }, { due: t + LAG_TICKS, toQueue: true, place: true }));
      }
    });
  }

  // ── Actors ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private spawn(id: number, entry: Customer['entry']): ActorState {
    const look = this.customers[id]?.look ?? mix(id);
    const dir: 1 | -1 = entry === 'left' ? 1 : -1;
    const a: ActorState = {
      id, look, entry, x: 0, y: 0, facing: dir, heading: dir > 0 ? 'right' : 'left', speed: 0, activity: 'idle',
      since: this.t, gaze: null, cause: null, carrying: false, cupWrong: false,
      scared: this.customers[id]?.scared ?? false, shop: null, slot: -1, joinedAt: null, leaving: false,
      hidden: false, playerRelated: false, fadeAt: null,
      plan: [], lane: laneOf(look, entry), laneOffset: laneOffsetOf(look, this.L), dir, visits: 0,
    };
    this.cast.set(id, a);
    return a;
  }

  private browseX(look: number): number {
    const b = this.L.browse;
    return b.x0 + (b.x1 - b.x0) * browseAt(look);
  }

  private exitX(side: Side): number {
    const v = this.viewRect;
    return side === 'left' ? v.x - this.L.actorH : v.x + v.w + this.L.actorH;
  }

  /**
   * A customer comes in at their entry (or steps off the bus), walks along the road to their spot in the middle of
   * the street and reads the boards there until they choose.
   */
  private walkIn(id: number, entry: Customer['entry'], ride?: { spot: number; wait: number }): ActorState {
    const a = this.spawn(id, entry);
    const start = entry === 'bus' ? this.L.busStop : this.resolve(a, { k: 'exit', side: entry }, a);
    a.x = start.x;
    a.y = start.y;
    a.activity = 'walk';
    if (entry === 'bus' && ride !== undefined) {
      // Let off early: over to the shelter, wait there for their time, then on like everyone.
      a.plan.push(walkStep({ k: 'busWait', i: ride.spot }, { hold: true }));
      if (ride.wait > 0) a.plan.push(pauseStep(ride.wait, 'idle', { hold: true }));
    }
    if (entry === 'bus') a.plan.push(walkStep({ k: 'lane', x: null }, { hold: true }));
    const bx = this.browseX(a.look);
    a.plan.push(
      walkStep({ k: 'lane', x: bx }, { hold: true }),
      pauseStep(Infinity, 'lookBoard', { gaze: this.nearestShop(a, bx), hold: true }),
    );
    return a;
  }

  /** Brings in every walker due by `now`, each as far along as they would be (with a cue unless rebuilding). */
  private comeIn(now: number, cue: boolean): void {
    while (this.pending.length > 0 && this.pending[0].at <= now) {
      const { id, at } = this.pending.shift() as { id: number; at: number };
      if (this.cast.has(id)) continue;
      const entry = this.customers[id].entry;
      const a = this.walkIn(id, entry, this.busRide.get(id));
      a.since = at;
      if (cue) this.cues.push({ kind: 'enter', t: at, customer: id, entry });
      this.advanceActor(a, now - at, at);
    }
  }

  /**
   * Bus-stop days: the bus's visits for the day's riders (all of them, so a rebuild mid-rush gives the same buses).
   * Each rider's latest step-off leaves time to walk from the door to the shelter and on to the boards; the bus lets
   * them off at or before it and they wait at the shelter for the rest (R44's schedule, never later: the lag rule
   * holds).
   */
  private planBusRides(): void {
    this.busRide.clear();
    const L = this.L;
    const riders = this.customers.filter(c => c.entry === 'bus');
    if (riders.length === 0) {
      this.busVisitsV = [];
      return;
    }
    // From the door by way of a waiting spot: never more than this many ticks longer than straight to the lane.
    let detour = 0;
    for (let k = 0; k < 8; k++) {
      const p = busWaitPoint(L, k);
      detour = Math.max(detour, (Math.hypot(p.x - L.busStop.x, p.y - L.busStop.y) + 2 * Math.abs(p.y - L.lanes[1])) / L.walk);
    }
    this.busVisitsV = planBus(riders.map(c => ({ id: c.id, latest: this.ownEnterTime(c.id) - detour })));
    for (const v of this.busVisitsV) {
      for (const r of v.riders) {
        const c = this.customers[r.id];
        const p = busWaitPoint(L, r.spot);
        const y = L.lanes[laneOf(c.look, c.entry)] + laneOffsetOf(c.look, L);
        const walk = (Math.hypot(p.x - L.busStop.x, p.y - L.busStop.y) + Math.abs(y - p.y)
          + Math.abs(this.browseX(c.look) - p.x)) / L.walk;
        const wait = Math.max(0, c.arriveTick - BROWSE_TICKS - walk - r.off);
        this.busRide.set(r.id, { off: r.off, spot: r.spot, wait });
      }
    }
  }

  /** After a layout or view change: entry times of the walkers still to come, never earlier than now. */
  private reschedule(): void {
    for (const p of this.pending) p.at = Math.max(this.t, this.enterTime(p.id));
    this.pending.sort((a, b) => a.at - b.at);
  }

  /** The actor for an event about someone not on the street yet: they come in at their entry now. */
  private ensure(id: number, entry?: Customer['entry']): ActorState {
    const known = this.cast.get(id);
    if (known !== undefined) return known;
    const i = this.pending.findIndex(p => p.id === id);
    if (i >= 0) this.pending.splice(i, 1);
    const e = entry ?? this.customers[id]?.entry ?? 'left';
    this.cues.push({ kind: 'enter', t: this.t, customer: id, entry: e });
    return this.walkIn(id, e);
  }

  private laneY(a: ActorState, lane: 0 | 1 = a.lane): number { return this.L.lanes[lane] + a.laneOffset; }

  private resolve(a: ActorState, to: Target, from: Pt): Pt {
    const L = this.L;
    switch (to.k) {
      case 'slot': return queuePoint(L, slotOf(L, to.shop), to.i);
      case 'aside': return asidePoint(L, slotOf(L, to.shop), to.i);
      case 'lane': return { x: to.x ?? from.x, y: this.laneY(a) };
      case 'exit': return { x: this.exitX(to.side), y: this.laneY(a) };
      case 'busWait': return busWaitPoint(L, to.i);
    }
  }

  /** The shop of the actor's side of the road whose front is nearest x. */
  private nearestShop(a: ActorState, x = a.x): ShopId {
    const row = a.lane === 0 ? 'top' : 'bottom';
    let best: ShopSlot | null = null;
    const mid = (s: ShopSlot) => s.rect.x + s.rect.w / 2;
    for (const s of this.L.shops) {
      if (s.row === row && (best === null || Math.abs(mid(s) - x) < Math.abs(mid(best) - x))) best = s;
    }
    return (best ?? this.L.shops[0]).id;
  }

  /**
   * The speed the actor needs to finish its steps up to the first deadline in time (arriving DUE_MARGIN early); 0
   * when no step has a deadline.
   */
  private needed(a: ActorState, now: number): number {
    let d = 0;
    let pause = 0;
    let p: Pt = a;
    for (const s of a.plan) {
      if (s.to === null) {
        pause += s.ticks;
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
        this.setActivity(a, s.act, now);
        a.gaze = s.gaze;
        if (s.to === null) this.turnFor(a, s);
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
      const base = this.L.walk;
      const v = clamp(this.needed(a, now), base, base * HURRY_MAX);
      a.speed = v;
      if (d > 1e-6) this.turnTo(a, dx, dy);
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

  /** Walking along (dx, dy): side-on unless clearly steeper than wide. */
  private turnTo(a: ActorState, dx: number, dy: number): void {
    if (Math.abs(dx) > 1e-6) a.facing = dx > 0 ? 1 : -1;
    a.heading = Math.abs(dy) > STEEP * Math.abs(dx) ? (dy < 0 ? 'up' : 'down') : a.facing > 0 ? 'right' : 'left';
  }

  /** Standing for a pause: toward the board they read, else toward us. */
  private turnFor(a: ActorState, s: Step): void {
    if (s.gaze !== null) {
      const slot = slotOf(this.L, s.gaze);
      if (Math.abs(slot.board.x - a.x) > 1) a.facing = slot.board.x > a.x ? 1 : -1;
      a.heading = slot.row === 'top' ? 'up' : 'down';
    } else {
      a.heading = 'down';
    }
  }

  /** Standing with nothing left to do: in their queue (the head toward the shop, the rest toward the head), or idle. */
  private settle(a: ActorState, now: number): void {
    if (a.plan.length > 0) return;
    a.speed = 0;
    a.gaze = null;
    if (a.shop !== null) {
      a.facing = -1;
      a.heading = a.slot === 0 ? (slotOf(this.L, a.shop).row === 'top' ? 'up' : 'down') : 'left';
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
   * leaving who could still go, would sit UNFOLD_MARGIN under the cap. A walker pushed off fades out over FADE_TICKS
   * (no longer counted) rather than vanishing. Runs every frame: under the cap with nothing folded it only counts.
   */
  private enforceCap(): void {
    const slots = this.L.queueSlots;
    if (this.shownAi === slots && this.shownPlayer === slots && this.visibleWith(slots, slots) <= MAX_ACTORS) {
      this.applyShown();
      return;
    }
    const counter = Math.min(slots, CONFIG.rush.counterSlots);
    // Undo folds the street has room for again, in the reverse order: the player's first.
    let leaving = -1;
    for (;;) {
      let ai = this.shownAi;
      let player = this.shownPlayer;
      if (player < slots) player++;
      else if (ai < slots) ai++;
      else break;
      if (leaving < 0) leaving = this.leavers(false).length;
      if (this.visibleWith(ai, player) - leaving > MAX_ACTORS - UNFOLD_MARGIN) break;
      this.shownAi = ai;
      this.shownPlayer = player;
    }
    let over = this.visibleWith(this.shownAi, this.shownPlayer) - MAX_ACTORS;
    if (over > 0) over -= this.drop(this.leavers(false), over);
    while (over > 0) {
      if (this.shownAi > MIN_SHOWN_AI) this.shownAi--;
      else if (this.shownPlayer > counter) this.shownPlayer--;
      else break;
      over = this.visibleWith(this.shownAi, this.shownPlayer) - MAX_ACTORS;
    }
    if (over > 0) this.drop(this.leavers(true), over);
    this.applyShown();
  }

  /** Each shop's drawn places and "+n", and who in its queue is folded away. */
  private applyShown(): void {
    for (const v of this.shopViews.values()) {
      v.shown = v.id === 'player' ? this.shownPlayer : this.shownAi;
      v.overflow = Math.max(0, v.queue.length - v.shown);
      for (let i = 0; i < v.queue.length; i++) {
        const a = this.cast.get(v.queue[i]);
        if (a !== undefined) a.hidden = i >= v.shown;
      }
    }
  }

  /** Within the view (walkers coming in or going out beyond its ends are not on screen), and not fading out. */
  private onScreen(a: ActorState): boolean {
    if (a.fadeAt !== null) return false;
    const v = this.viewRect;
    const half = this.L.actorH * 0.3;
    return a.x > v.x - half && a.x < v.x + v.w + half;
  }

  /** Actors on screen if queues showed this many places. */
  private visibleWith(ai: number, player: number): number {
    let n = 0;
    for (const a of this.cast.values()) if (this.onScreen(a)) n++;
    for (const v of this.shopViews.values()) {
      const shown = v.id === 'player' ? player : ai;
      for (let i = shown; i < v.queue.length; i++) {
        const a = this.cast.get(v.queue[i]);
        if (a !== undefined && this.onScreen(a)) n--;
      }
    }
    return n;
  }

  /** Leaving walkers on screen, player-related or not, nearest their way out first. */
  private leavers(related: boolean): ActorState[] {
    const out: ActorState[] = [];
    for (const a of this.cast.values()) if (a.leaving && a.playerRelated === related && this.onScreen(a)) out.push(a);
    const v = this.viewRect;
    const toExit = (a: ActorState) => Math.min(a.x - v.x, v.x + v.w - a.x);
    return out.sort((p, q) => toExit(p) - toExit(q));
  }

  /** Starts the first `n` of `list` fading out (they no longer count); returns how many. */
  private drop(list: ActorState[], n: number): number {
    const k = Math.min(n, list.length);
    for (let i = 0; i < k; i++) list[i].fadeAt = this.t;
    return k;
  }
}
