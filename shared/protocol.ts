// The class-session protocol (spec §11): limits, session state, the host board, socket events and input checks.
import type {
  CardId, ChoiceLabel, Day, DaySummary, K, Phase, Stock, TeaGrade, UpgradeId,
} from './sim/types';

export const LIMITS = { nickname: 20, maxPlayers: 200, joinId: 64 } as const;

/** The solo leaderboard: one best score per name; the board shows this many. */
export const SOLO_BOARD_SIZE = 50;
/** Solo scores are trusted from the device, like class mode's; this only keeps absurd numbers out. */
export const SOLO_SCORE_MAX = 1e7;
export interface SoloEntry { name: string; score: number; at: number }
/** The top of the solo board, best first, and how many names it holds in all. */
export interface SoloBoard { entries: SoloEntry[]; total: number }
export interface SoloSubmit { name: string; score: number; runId: string }
/** `rank`: 1 + the names with a better best (ties share a rank); `best`: this name's best; `improved`: it moved. */
export type SoloSubmitAck = Ack<{ rank: number; best: number; improved: boolean; durable?: false }>;

/** A name as the board keys it: trimmed, spaces collapsed, case-insensitive. */
export const soloKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
/** A name as shown: trimmed, spaces collapsed. */
export const soloDisplay = (name: string): string => name.trim().replace(/\s+/g, ' ');

export type SessionPhase = 'lobby' | 'open' | 'awards';
export type VoteChoice = 'invisible' | 'visible';
/** §16 row 15: the vote before playing and the vote after, both sent through the phone's result queue. */
export interface Vote { choice: VoteChoice; when: 'before' | 'after' }
export interface Progress { day: Day; phase: Phase }

export interface SessionCounts {
  joined: number;
  /** Started (progress or a day sent) and not finished. */
  playing: number;
  /** Sent day 5, or lost trust early. */
  finished: number;
  lostTrust: number;
}

export type AwardId = 'tycoon' | 'beloved' | 'hoarder' | 'goldenHand';
/** The four awards of spec §11 "Giải", in display order. */
export const AWARDS: readonly { id: AwardId; emoji: string; title: string }[] = [
  { id: 'tycoon', emoji: '🏆', title: 'Đại Gia Trân Châu' },
  { id: 'beloved', emoji: '⭐', title: 'Quán Quốc Dân' },
  { id: 'hoarder', emoji: '📦', title: 'Ông Hoàng Tồn Kho' },
  { id: 'goldenHand', emoji: '🎯', title: 'Bàn Tay Vàng' },
];
export interface Award {
  id: AwardId; emoji: string; title: string; playerId: string; name: string;
  /** What won it: the score (tycoon), final rep (beloved), total waste value in k (hoarder), the share of wrong
   *  cups 0..1 (goldenHand). */
  value: number;
}
export interface TopEntry { playerId: string; name: string; score: K; rank: number }
/** Frozen when the host presses Trao giải. */
export interface AwardsResult {
  awards: Award[];
  top: TopEntry[];
  /** Every player's rank by score at that moment (ties share a rank); players with no day sent rank last. */
  ranks: Record<string, number>;
}

/** Broadcast to every phone and the projector (`state`). */
export interface SessionSnapshot {
  phase: SessionPhase;
  code: string;
  seed: number;
  counts: SessionCounts;
  /** Only in `awards`. */
  awards: AwardsResult | null;
}

export interface BoardMember {
  id: string; name: string; connected: boolean;
  progress: Progress | null;
  /** From the last day sent; null before any. */
  score: K | null; rep: number | null; lastPrice: K | null;
  /** "Tổng lãi" (R51): the last day's cash − the starting cash, consistent with the score; null before any day. */
  profit: K | null;
  /** Sums over the days sent. */
  cups: number; wrong: number; walkouts: number;
  /** Every label of every day, once each, in the order of `CHOICE_LABELS`. */
  labels: ChoiceLabel[];
  vote: { before: VoteChoice | null; after: VoteChoice | null };
  finished: boolean; lost: boolean;
  /** The detail view, in day order. */
  days: DaySummary[];
  /** Server time of this player's last join, vote, progress or day. */
  lastActive: number;
}
export interface HostBoard {
  phase: SessionPhase; code: string; seed: number;
  overview: {
    counts: SessionCounts;
    /** Days 1..5: the class's average opening and closing price over the players who sent that day. */
    avgPrice: { day: Day; open: K | null; close: K | null; n: number }[];
    /** How many players had each label on some day, out of `n` players who sent at least one day. */
    labels: { n: number; count: Record<ChoiceLabel, number> };
    /** Over the `n` players who voted both before and after. */
    votes: { n: number; before: Record<VoteChoice, number>; after: Record<VoteChoice, number> };
  };
  /** By score, highest first; players with no day last; then join order. */
  members: BoardMember[];
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * The reply to `player:vote` and `player:day` once handled. The server answers only after the session file holds
 * the change, so a server killed right after the reply keeps it. `durable: false`: accepted, but the save failed
 * (the change lives only in the server's memory) - the phone keeps the item and sends it again later; the resend is
 * answered as a duplicate once a save succeeds.
 */
export type ReportAck<T extends object = object> = Ack<T & { durable?: false }>;
/** `notNext`: the day is not the one the server waits for; `expected` is that day (null: none, the run is full). */
export interface NotNext { ok: false; error: 'notNext'; expected: Day | null }
export type DayAck = ReportAck<{ rank: number }> | NotNext;

/** `expected` of a `notNext` reply (null when the server waits for no day); undefined for any other reply. */
export function notNextExpected(r: unknown): Day | null | undefined {
  if (!isObj(r) || r.ok !== false || r.error !== 'notNext') return undefined;
  // A missing or garbled `expected` (an older server) reads as null: nothing to resend.
  return safe(() => day(r.expected));
}

/** Whether a handled reply is final: false for an accepted report the server could not save yet. */
export const isDurable = (r: Ack<object>): boolean => !(r.ok && (r as { durable?: unknown }).durable === false);

/**
 * Socket events. A reply from the server to `player:vote` or `player:day` means "handled, drop it from the queue",
 * whether ok or not (a refused summary will never be accepted on resend); only a timeout (or `unknownPlayer`, or
 * `durable: false`) means resend, and a `notNext` with a lower `expected` means "send the missing days first".
 */
export interface ClientToServer {
  'player:join': (p: { nickname: string; joinId?: string }, ack: (r: Ack<{ playerId: string; token: string }>) => void) => void;
  'player:resume': (p: { token: string }, ack: (r: Ack<{ playerId: string; name: string }>) => void) => void;
  /** `code`: the session the vote was queued in; a vote from before a reset is refused (`wrongSession`). */
  'player:vote': (p: Vote & { code: string }, ack: (r: ReportAck) => void) => void;
  'player:progress': (p: Progress) => void;
  /** Rank among the players who have finished that day (by that day's score). `code`: the session the run was
   *  played in; a run from before a reset (old seed) is refused (`wrongSession`). */
  'player:day': (p: { code: string; runId: string; summary: DaySummary }, ack: (r: DayAck) => void) => void;
  'host:auth': (p: { key: string }, ack: (r: Ack) => void) => void;
  'host:open': () => void;
  'host:awards': () => void;
  'host:reset': () => void;
  /** Starts watching the solo board; the ack carries it, then `solo:board` follows every change. */
  'solo:watch': (p: object, ack: (r: Ack<{ board: SoloBoard }>) => void) => void;
  'solo:unwatch': () => void;
  /** A finished solo run. `runId` makes a resend harmless. `durable: false`: not saved yet, send again later. */
  'solo:submit': (p: SoloSubmit, ack: (r: SoloSubmitAck) => void) => void;
  /** Host only: empties the solo board. */
  'host:soloReset': (p: object, ack: (r: Ack) => void) => void;
}
export interface ServerToClient {
  state: (s: SessionSnapshot) => void;
  /** Only to sockets authenticated with HOST_KEY. */
  'host:board': (b: HostBoard) => void;
  /** To the sockets watching the solo board. */
  'solo:board': (b: SoloBoard) => void;
}

export const CHOICE_LABELS: readonly ChoiceLabel[] = ['skimp', 'cartelKept', 'cartelBroke', 'shockTopping',
  'blackMarket', 'taxEvaded', 'inspectPass', 'inspectFail'];
const TEAS: readonly TeaGrade[] = ['skimp', 'standard', 'premium'];
const UPGRADES: readonly UpgradeId[] = ['staff', 'machine', 'banner'];
const CARDS: readonly CardId[] = ['cartel', 'shockTopping', 'blackMarket', 'tax', 'inspection', 'reporter',
  'kol', 'tab', 'student', 'complaint', 'deliveryAd', 'scholarship'];
const PHASES: readonly Phase[] = ['morning', 'rush', 'cards', 'report', 'end'];
/** No honest run comes near this; it only keeps absurd numbers out of sums and averages. */
const MAX_ABS = 1e7;
const MAX_LIST = 20;

class Bad extends Error {}
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
function obj(x: unknown): Obj { if (!isObj(x)) throw new Bad(); return x; }
function num(x: unknown, min = -MAX_ABS, max = MAX_ABS): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) throw new Bad();
  return x;
}
function int(x: unknown, min = 0, max = MAX_ABS): number {
  const n = num(x, min, max);
  if (!Number.isInteger(n)) throw new Bad();
  return n;
}
function oneOf<T>(x: unknown, set: readonly T[]): T {
  if (!set.includes(x as T)) throw new Bad();
  return x as T;
}
function list<T>(x: unknown, item: (v: unknown) => T): T[] {
  if (!Array.isArray(x) || x.length > MAX_LIST) throw new Bad();
  return x.map(item);
}
function stock(x: unknown): Stock {
  const o = obj(x);
  const t = obj(o.toppings);
  return { teaMl: num(o.teaMl, 0), toppings: { pearl: num(t.pearl, 0), jelly: num(t.jelly, 0), pudding: num(t.pudding, 0) } };
}
const day = (x: unknown) => int(x, 1, 5) as Day;

/** Wraps a parser so any bad field (or a throwing getter) gives null. */
function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

/**
 * Checks the types and value ranges of a summary from a phone, so bad data cannot crash the server. Returns a clean
 * copy holding only the known fields, or null. It does not check that the numbers are consistent (spec §11).
 */
export function parseDaySummary(x: unknown): DaySummary | null {
  return safe(() => {
    const o = obj(x);
    return {
      day: day(o.day), openPrice: num(o.openPrice, 0), closePrice: num(o.closePrice, 0), tea: oneOf(o.tea, TEAS),
      bought: stock(o.bought), used: stock(o.used), wasteValue: num(o.wasteValue, 0),
      cups: int(o.cups), wrong: int(o.wrong), walkouts: int(o.walkouts),
      revenue: num(o.revenue, 0), cost: num(o.cost, 0), tax: num(o.tax, 0), fines: num(o.fines, 0),
      profit: num(o.profit), cash: num(o.cash), rep: num(o.rep, 0, 100), score: num(o.score),
      upgrade: o.upgrade === null ? null : oneOf(o.upgrade, UPGRADES),
      cards: list(o.cards, c => { const co = obj(c); return { id: oneOf(co.id, CARDS), choice: oneOf(co.choice, ['A', 'B'] as const) }; }),
      labels: list(o.labels, l => oneOf(l, CHOICE_LABELS)),
      lost: oneOf(o.lost, [true, false] as const),
    };
  });
}

/** The optional idempotency key of a join: a short non-empty string, else null (an old client sends none). */
export function parseJoinId(x: unknown): string | null {
  return typeof x === 'string' && x.length > 0 && x.length <= LIMITS.joinId ? x : null;
}

export function parseVote(x: unknown): Vote | null {
  return safe(() => {
    const o = obj(x);
    return { choice: oneOf(o.choice, ['invisible', 'visible'] as const), when: oneOf(o.when, ['before', 'after'] as const) };
  });
}

export function parseProgress(x: unknown): Progress | null {
  return safe(() => {
    const o = obj(x);
    return { day: day(o.day), phase: oneOf(o.phase, PHASES) };
  });
}

/** A solo submission: a name (1..LIMITS.nickname chars after trimming), a finite score, a short runId; else null. */
export function parseSoloSubmit(x: unknown): SoloSubmit | null {
  return safe(() => {
    const o = obj(x);
    if (typeof o.name !== 'string' || typeof o.runId !== 'string') throw new Bad();
    const name = soloDisplay(o.name);
    if (name.length === 0 || name.length > LIMITS.nickname) throw new Bad();
    if (o.runId.length === 0 || o.runId.length > LIMITS.joinId) throw new Bad();
    return { name, score: num(o.score, -SOLO_SCORE_MAX, SOLO_SCORE_MAX), runId: o.runId };
  });
}
