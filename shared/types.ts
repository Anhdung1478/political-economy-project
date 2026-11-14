import type { Emoji } from './config';

export type Phase = 'lobby' | 'event' | 'pricing' | 'reveal' | 'awards';
export type PollChoice = 'invisible' | 'visible';

export interface ShopResult {
  playerId: string; price: number; sold: number; unsold: number; profit: number;
  /** Cost per cup actually paid (ingredients + tax). */
  cost: number;
  /** Most cups customers would buy here (lower after skimping on ingredients). */
  capacity: number;
  /** Cups bought by loyal customers won by selling at a loss last round. */
  loyal: number;
}
export interface RoundResult {
  roundIndex: number;
  customers: number;
  served: number;
  unserved: number;
  pricedOut: number;
  taxCollected: number;
  avgPrice: number;
  /** Market-clearing price for this round's rules: where cups demanded equal cups on offer. */
  optimalPrice: number;
  shops: ShopResult[];
}
export interface PublicPlayer {
  id: string;
  nickname: string;
  total: number;
  rank: number;
  connected: boolean;
  submitted: boolean;
  /** Most cups this shop can sell in the coming round (lost reputation lowers it). */
  capacity: number;
  /** Loyal buyers are guaranteed if this round's price is at most this; null when none. */
  loyalMaxPrice: number | null;
}
export type AwardId = 'tycoon' | 'saint' | 'shark' | 'hoarder';
export interface Award { id: AwardId; emoji: string; title: string; playerId: string; detail: string }

export interface RoomSnapshot {
  phase: Phase;
  roundIndex: number;
  totalRounds: number;
  deadline: number | null;
  serverNow: number;
  players: PublicPlayer[];
  poll: Record<PollChoice, number>;
  lastResult: RoundResult | null;
  awards: Award[];
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServer {
  'player:join': (p: { nickname: string }, ack: (r: Ack<{ playerId: string; token: string }>) => void) => void;
  'player:resume': (p: { token: string }, ack: (r: Ack<{ playerId: string }>) => void) => void;
  'player:vote': (p: { choice: PollChoice }) => void;
  'player:price': (p: { price: number; cost?: number }, ack: (r: Ack) => void) => void;
  'player:emoji': (p: { emoji: Emoji }) => void;
  'host:auth': (p: { key: string }, ack: (r: Ack) => void) => void;
  /** Carries the phase the host is looking at, so double clicks cannot skip a step. */
  'host:next': (p: { phase: Phase; roundIndex: number }) => void;
  'host:reset': () => void;
}
export interface ServerToClient {
  state: (s: RoomSnapshot) => void;
  emoji: (e: { emoji: Emoji; id: number }) => void;
}
