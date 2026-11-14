import { randomUUID } from 'node:crypto';
import { GAME, ROUNDS, capacityAfter, ingredientBase, roundCustomers } from '../../shared/config';
import type { Ack, Award, Phase, PollChoice, RoomSnapshot, RoundResult } from '../../shared/types';
import { computeAwards } from './awards';
import { clearingPrice, runMarket } from './market';

interface Player {
  id: string;
  token: string;
  nickname: string;
  joinOrder: number;
  total: number;
  connected: boolean;
  vote: PollChoice | null;
  pendingPrice: number | null;
  /** Ingredient cost chosen for this round (before tax); null = full base cost. */
  pendingCost: number | null;
  lastPrice: number | null;
  history: { price: number; sold: number; unsold: number; ingredient: number; profit: number }[];
}

/**
 * The single game room. Phases: lobby → (event → pricing → reveal) × rounds → awards.
 * `next()` advances one step; `reset()` returns to the lobby keeping players and votes.
 */
export class GameRoom {
  phase: Phase = 'lobby';
  roundIndex = -1;
  deadline: number | null = null;
  private lastResult: RoundResult | null = null;
  private awards: Award[] = [];
  private players = new Map<string, Player>();
  private byToken = new Map<string, string>();
  private seq = 0;
  private now: () => number;
  private random: () => number;

  constructor(opts: { now?: () => number; random?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  join(raw: string): Ack<{ playerId: string; token: string }> {
    const nickname = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!nickname || nickname.length > GAME.nicknameMax) {
      return { ok: false, error: `Tên phải từ 1 đến ${GAME.nicknameMax} ký tự` };
    }
    if (this.players.size >= GAME.maxPlayers) return { ok: false, error: 'Chợ đông quá, hết chỗ rồi 😭' };
    const id = `p${++this.seq}`;
    const token = randomUUID();
    this.players.set(id, {
      id, token, nickname, joinOrder: this.seq,
      total: 0, connected: true, vote: null, pendingPrice: null, pendingCost: null, lastPrice: null, history: [],
    });
    this.byToken.set(token, id);
    return { ok: true, playerId: id, token };
  }

  resume(token: string): string | null {
    return this.byToken.get(String(token)) ?? null;
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id);
    if (p) p.connected = connected;
  }

  vote(id: string, choice: PollChoice): void {
    const p = this.players.get(id);
    if (p && (choice === 'invisible' || choice === 'visible')) p.vote = choice;
  }

  /** `cost` is the ingredient cost per cup (before tax); omitted = full base cost. */
  submitPrice(id: string, price: number, cost?: number): Ack {
    const p = this.players.get(id);
    const round = ROUNDS[this.roundIndex];
    if (!p || this.phase !== 'pricing' || !round) return { ok: false, error: 'Chưa tới lúc chọn giá' };
    if (!Number.isInteger(price) || price < GAME.priceMin || price > round.maxPrice) {
      return { ok: false, error: `Giá phải từ ${GAME.priceMin}k đến ${round.maxPrice}k` };
    }
    const base = ingredientBase(round);
    const c = cost ?? base;
    if (round.fixedCost && c !== base) return { ok: false, error: `Vòng này nguyên liệu cố định ${base}k` };
    if (!Number.isInteger(c) || c < GAME.costMin || c > base) {
      return { ok: false, error: `Nguyên liệu phải từ ${GAME.costMin}k đến ${base}k` };
    }
    p.pendingPrice = price;
    p.pendingCost = c;
    return { ok: true };
  }

  /** What last round left this shop with: fewer sellable cups after skimping, loyal fans after a loss. */
  private standing(p: Player): { capacity: number; loyalMaxPrice: number | null } {
    const last = p.history[p.history.length - 1];
    if (!last) return { capacity: GAME.capacity, loyalMaxPrice: null };
    return {
      capacity: capacityAfter(last.ingredient),
      loyalMaxPrice: last.profit < 0 ? Math.floor(last.price * GAME.loyalPriceRatio) : null,
    };
  }

  next(): void {
    switch (this.phase) {
      case 'lobby':
        this.roundIndex = 0;
        this.phase = 'event';
        break;
      case 'event':
        for (const p of this.players.values()) { p.pendingPrice = null; p.pendingCost = null; }
        this.phase = 'pricing';
        this.deadline = this.now() + GAME.pricingSeconds * 1000;
        break;
      case 'pricing':
        this.closePricing();
        break;
      case 'reveal':
        if (this.roundIndex < ROUNDS.length - 1) {
          this.roundIndex++;
          this.phase = 'event';
        } else {
          this.phase = 'awards';
          this.awards = computeAwards(this.ranked().map(p => ({ playerId: p.id, total: p.total, rounds: p.history })));
        }
        break;
      case 'awards':
        break;
    }
  }

  reset(): void {
    this.phase = 'lobby';
    this.roundIndex = -1;
    this.deadline = null;
    this.lastResult = null;
    this.awards = [];
    for (const p of [...this.players.values()]) {
      if (!p.connected) { this.players.delete(p.id); this.byToken.delete(p.token); continue; }
      p.total = 0;
      p.history = [];
      p.pendingPrice = null;
      p.pendingCost = null;
      p.lastPrice = null;
    }
  }

  private closePricing(): void {
    const round = ROUNDS[this.roundIndex];
    const list = [...this.players.values()];
    const chosen = new Map(list.map(p => [p.id, p.pendingPrice ?? p.lastPrice ?? GAME.defaultPrice]));
    const base = ingredientBase(round);
    const ingredient = new Map(list.map(p => [p.id, round.fixedCost ? base : (p.pendingCost ?? base)]));
    const shops = list.map(p => {
      const price = Math.min(round.maxPrice, Math.max(GAME.priceMin, chosen.get(p.id)!));
      const { capacity, loyalMaxPrice } = this.standing(p);
      const loyal = loyalMaxPrice !== null && price <= loyalMaxPrice ? GAME.loyalBuyers : 0;
      return { playerId: p.id, price, cost: ingredient.get(p.id)! + round.tax, capacity, loyal };
    });
    const customers = roundCustomers(round, list.length);
    const out = runMarket(
      { shops, customers, wtpMin: GAME.wtpMin, wtpMax: GAME.wtpMax, capacity: GAME.capacity, cost: round.cost, tax: round.tax },
      this.random,
    );
    for (const s of out.shops) {
      const p = this.players.get(s.playerId)!;
      p.total += s.profit;
      // Remember what the player chose, so a price ceiling does not stick into later rounds.
      p.lastPrice = chosen.get(s.playerId)!;
      p.pendingPrice = null;
      p.pendingCost = null;
      p.history.push({ price: s.price, sold: s.sold, unsold: s.unsold, ingredient: ingredient.get(s.playerId)!, profit: s.profit });
    }
    this.lastResult = {
      roundIndex: this.roundIndex,
      customers,
      served: out.served,
      unserved: out.unserved,
      pricedOut: out.pricedOut,
      taxCollected: out.taxCollected,
      shops: out.shops,
      optimalPrice: clearingPrice({
        customersPerShop: shops.length ? customers / shops.length : 0,
        wtpMin: GAME.wtpMin, wtpMax: GAME.wtpMax, capacity: GAME.capacity, cost: round.cost, maxPrice: round.maxPrice,
      }),
      avgPrice: shops.length ? Math.round((shops.reduce((s, x) => s + x.price, 0) / shops.length) * 10) / 10 : 0,
    };
    this.phase = 'reveal';
    this.deadline = null;
  }

  private ranked(): Player[] {
    return [...this.players.values()].sort((a, b) => b.total - a.total || a.joinOrder - b.joinOrder);
  }

  snapshot(): RoomSnapshot {
    const poll = { invisible: 0, visible: 0 };
    for (const p of this.players.values()) if (p.vote) poll[p.vote]++;
    return {
      phase: this.phase,
      roundIndex: this.roundIndex,
      totalRounds: ROUNDS.length,
      deadline: this.deadline,
      serverNow: this.now(),
      players: this.ranked().map((p, i) => ({
        id: p.id, nickname: p.nickname, total: p.total, rank: i + 1,
        connected: p.connected, submitted: p.pendingPrice !== null, ...this.standing(p),
      })),
      poll,
      lastResult: this.lastResult,
      awards: this.awards,
    };
  }
}
