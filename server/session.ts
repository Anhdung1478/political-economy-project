// The class session (spec §2, §11): players, votes, progress, the days they send, the awards. Pure and
// deterministic under the injected clock, random and uuid; `persist` is called after every change.
import { randomUUID } from 'node:crypto';
import {
  type Ack, type AwardsResult, type BoardMember, CHOICE_LABELS, type HostBoard, LIMITS, type Progress,
  type SessionCounts, type SessionPhase, type SessionSnapshot, type Vote, type VoteChoice,
  parseDaySummary, parseProgress, parseVote,
} from '../shared/protocol';
import type { ChoiceLabel, Day, DaySummary, Phase } from '../shared/sim/types';
import { computeAwards, totals } from './awards';

export interface SessionOptions {
  now?: () => number;
  random?: () => number;
  uuid?: () => string;
  persist?: (s: Session) => void;
}

interface Player {
  id: string; token: string; name: string; order: number;
  connected: boolean;
  /** The first run id this player sent; every other run is ignored (spec §11 "Mã ván"). */
  runId: string | null;
  /** Days 1..n in order. */
  days: DaySummary[];
  votes: { before: VoteChoice | null; after: VoteChoice | null };
  progress: Progress | null;
  lastActive: number;
}

/** What `toJSON` writes; `connected` is not kept (every socket is gone after a restart). */
export interface SessionData {
  v: 1; code: string; seed: number; phase: SessionPhase; seq: number;
  awards: AwardsResult | null;
  players: Omit<Player, 'connected'>[];
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const SEED_RANGE = 2 ** 31;
const TOP_COUNT = 5;

export class Session {
  private phase: SessionPhase = 'lobby';
  private code = '';
  private seed = 0;
  private seq = 0;
  private frozen: AwardsResult | null = null;
  private players = new Map<string, Player>();
  private byToken = new Map<string, string>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly uuid: () => string;
  private readonly persist: (s: Session) => void;

  constructor(opts: SessionOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.uuid = opts.uuid ?? randomUUID;
    this.persist = opts.persist ?? (() => {});
    this.newIdentity();
  }

  /** A fresh seed and session code, both different from the current ones. */
  private newIdentity(): void {
    const old = { code: this.code, seed: this.seed };
    for (let i = 0; i < 20 && (this.code === old.code || this.seed === old.seed); i++) {
      let code = '';
      for (let k = 0; k < CODE_LENGTH; k++) code += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
      this.code = code;
      this.seed = Math.floor(this.random() * SEED_RANGE);
    }
  }

  private changed(): void { this.persist(this); }

  join(raw: string): Ack<{ playerId: string; token: string }> {
    if (this.phase === 'awards') return { ok: false, error: 'Buổi đã kết thúc' };
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > LIMITS.nickname) return { ok: false, error: `Tên phải từ 1 đến ${LIMITS.nickname} ký tự` };
    if (this.players.size >= LIMITS.maxPlayers) return { ok: false, error: 'Phố đông quá, hết chỗ rồi 😭' };
    const id = `p${++this.seq}`;
    const token = this.uuid();
    this.players.set(id, {
      id, token, name, order: this.seq, connected: true, runId: null, days: [],
      votes: { before: null, after: null }, progress: null, lastActive: this.now(),
    });
    this.byToken.set(token, id);
    this.changed();
    return { ok: true, playerId: id, token };
  }

  resume(token: string): { playerId: string; name: string } | null {
    const id = typeof token === 'string' ? this.byToken.get(token) : undefined;
    const p = id === undefined ? undefined : this.players.get(id);
    return p ? { playerId: p.id, name: p.name } : null;
  }

  hasPlayer(id: string): boolean { return this.players.has(id); }

  /** Not persisted: connection is runtime state, so no save is triggered. */
  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id);
    if (p) p.connected = connected;
  }

  /** `before` in the lobby or while open; `after` while open or after the awards. */
  vote(id: string, raw: Vote): void {
    const p = this.players.get(id);
    const v = parseVote(raw);
    if (!p || !v) return;
    const allowed = v.when === 'before' ? this.phase !== 'awards' : this.phase !== 'lobby';
    if (!allowed || p.votes[v.when] === v.choice) return;
    p.votes[v.when] = v.choice;
    p.lastActive = this.now();
    this.changed();
  }

  /** Where the player is in their run; only once the market is open. */
  progress(id: string, day: Day, phase: Phase): void {
    const p = this.players.get(id);
    const pr = parseProgress({ day, phase });
    if (!p || !pr || this.phase === 'lobby') return;
    p.progress = pr;
    p.lastActive = this.now();
    this.changed();
  }

  /**
   * One day of a run. Only the player's first run id, only the next expected day; a day already stored is a
   * duplicate: ignored, answered with its rank. Accepted while open and after the awards (which stay frozen).
   */
  submitDay(id: string, runId: string, raw: DaySummary): Ack<{ rank: number }> {
    const p = this.players.get(id);
    if (!p) return { ok: false, error: 'unknownPlayer' };
    if (this.phase === 'lobby') return { ok: false, error: 'notOpen' };
    if (typeof runId !== 'string' || runId === '' || runId.length > 100) return { ok: false, error: 'badRun' };
    if (p.runId !== null && p.runId !== runId) return { ok: false, error: 'otherRun' };
    const s = parseDaySummary(raw);
    if (!s) return { ok: false, error: 'badSummary' };
    if (s.day <= p.days.length) return { ok: true, rank: this.rankOnDay(p, s.day) };
    if (totals(p.days).finished) return { ok: false, error: 'finished' };
    if (s.day !== p.days.length + 1) return { ok: false, error: 'notNext' };
    p.runId = runId;
    p.days.push(s);
    p.lastActive = this.now();
    this.changed();
    return { ok: true, rank: this.rankOnDay(p, s.day) };
  }

  /** The score a player stands on for day `d`: that day's, or the last one if they lost trust earlier; else null. */
  private scoreOnDay(p: Player, d: number): number | null {
    if (p.days.length >= d) return p.days[d - 1].score;
    const t = totals(p.days);
    return t.lost ? t.score : null;
  }

  /** 1 + the players who finished day `d` with a strictly higher score. */
  private rankOnDay(me: Player, d: number): number {
    const mine = this.scoreOnDay(me, d) ?? -Infinity;
    let rank = 1;
    for (const p of this.players.values()) {
      const s = this.scoreOnDay(p, d);
      if (p !== me && s !== null && s > mine) rank++;
    }
    return rank;
  }

  open(): void {
    if (this.phase !== 'lobby') return;
    this.phase = 'open';
    this.changed();
  }

  /** Freezes the awards, the top 5 and everyone's rank over the days sent so far. */
  awards(): void {
    if (this.phase !== 'open') return;
    const ranked = this.ranked();
    const ranks: Record<string, number> = {};
    let prev: number | null | undefined;
    ranked.forEach(({ p, score }, i) => {
      ranks[p.id] = i > 0 && score === prev ? ranks[ranked[i - 1].p.id] : i + 1;
      prev = score;
    });
    const top = ranked.filter(r => r.score !== null).slice(0, TOP_COUNT)
      .map(({ p, score }) => ({ playerId: p.id, name: p.name, score: score as number, rank: ranks[p.id] }));
    const awards = computeAwards(ranked.map(({ p }) => ({ playerId: p.id, name: p.name, order: p.order, days: p.days })));
    this.frozen = { awards, top, ranks };
    this.phase = 'awards';
    this.changed();
  }

  /** New seed and session code; results, votes and progress cleared; only the connected players stay. */
  reset(): void {
    this.phase = 'lobby';
    this.frozen = null;
    this.newIdentity();
    for (const p of [...this.players.values()]) {
      if (!p.connected) { this.players.delete(p.id); this.byToken.delete(p.token); continue; }
      p.runId = null;
      p.days = [];
      p.votes = { before: null, after: null };
      p.progress = null;
    }
    this.changed();
  }

  /** Players by score (none last), then total profit, then join order. */
  private ranked(): { p: Player; score: number | null }[] {
    return [...this.players.values()]
      .map(p => ({ p, t: totals(p.days) }))
      .sort((a, b) => (b.t.score ?? -Infinity) - (a.t.score ?? -Infinity)
        || (a.t.score === null ? 0 : b.t.profit - a.t.profit) || a.p.order - b.p.order)
      .map(({ p, t }) => ({ p, score: t.score }));
  }

  private counts(): SessionCounts {
    const c: SessionCounts = { joined: this.players.size, playing: 0, finished: 0, lostTrust: 0 };
    for (const p of this.players.values()) {
      const t = totals(p.days);
      if (t.finished) c.finished++;
      else if (p.progress !== null || t.days > 0) c.playing++;
      if (t.lost) c.lostTrust++;
    }
    return c;
  }

  snapshot(): SessionSnapshot {
    return {
      phase: this.phase, code: this.code, seed: this.seed, counts: this.counts(),
      awards: this.phase === 'awards' ? this.frozen : null,
    };
  }

  board(): HostBoard {
    const players = [...this.players.values()];
    const withDays = players.filter(p => p.days.length > 0);
    const mean = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const avgPrice = ([1, 2, 3, 4, 5] as Day[]).map(day => {
      const ds = players.flatMap(p => (p.days.length >= day ? [p.days[day - 1]] : []));
      return { day, open: mean(ds.map(d => d.openPrice)), close: mean(ds.map(d => d.closePrice)), n: ds.length };
    });
    const labelsOf = (p: Player): ChoiceLabel[] => CHOICE_LABELS.filter(l => p.days.some(d => d.labels.includes(l)));
    const count = Object.fromEntries(CHOICE_LABELS.map(l => [l, 0])) as Record<ChoiceLabel, number>;
    for (const p of withDays) for (const l of labelsOf(p)) count[l]++;
    const votes = { n: 0, before: { invisible: 0, visible: 0 }, after: { invisible: 0, visible: 0 } };
    for (const p of players) {
      const { before, after } = p.votes;
      if (before === null || after === null) continue;
      votes.n++;
      votes.before[before]++;
      votes.after[after]++;
    }
    const members: BoardMember[] = this.ranked().map(({ p }) => {
      const t = totals(p.days);
      return {
        id: p.id, name: p.name, connected: p.connected, progress: p.progress,
        score: t.score, rep: t.rep, lastPrice: t.lastPrice,
        profit: t.profit, cups: t.cups, wrong: t.wrong, walkouts: t.walkouts,
        labels: labelsOf(p), vote: { ...p.votes }, finished: t.finished, lost: t.lost,
        days: [...p.days], lastActive: p.lastActive,
      };
    });
    return {
      phase: this.phase, code: this.code, seed: this.seed,
      overview: { counts: this.counts(), avgPrice, labels: { n: withDays.length, count }, votes },
      members,
    };
  }

  toJSON(): SessionData {
    return {
      v: 1, code: this.code, seed: this.seed, phase: this.phase, seq: this.seq, awards: this.frozen,
      players: [...this.players.values()].map(({ connected: _c, ...p }) => structuredClone(p)),
    };
  }

  /** Throws when `data` is not a session written by `toJSON`. Every player comes back disconnected. */
  static fromJSON(data: unknown, opts: SessionOptions = {}): Session {
    const d = data as Partial<SessionData> | null;
    const fail = (why: string): never => { throw new Error(`not a session file: ${why}`); };
    if (typeof d !== 'object' || d === null || d.v !== 1) fail('version');
    const v = d as SessionData;
    if (typeof v.code !== 'string' || v.code === '') fail('code');
    if (!Number.isInteger(v.seed) || !Number.isInteger(v.seq) || v.seq < 0) fail('seed');
    if (!['lobby', 'open', 'awards'].includes(v.phase)) fail('phase');
    if (!Array.isArray(v.players)) fail('players');
    const a = v.awards as unknown;
    if (a !== null && !(typeof a === 'object' && a !== null && Array.isArray((a as AwardsResult).awards)
      && Array.isArray((a as AwardsResult).top) && typeof (a as AwardsResult).ranks === 'object')) fail('awards');
    if (v.phase === 'awards' && a === null) fail('awards');

    const s = new Session(opts);
    s.phase = v.phase;
    s.code = v.code;
    s.seed = v.seed;
    s.seq = v.seq;
    s.frozen = v.awards;
    const vote = (x: unknown) => (x === null || x === 'invisible' || x === 'visible' ? x : fail('vote'));
    for (const raw of v.players as unknown[]) {
      const p = raw as Player;
      if (typeof p !== 'object' || p === null || typeof p.id !== 'string' || typeof p.token !== 'string'
        || typeof p.name !== 'string' || !Number.isInteger(p.order) || !Array.isArray(p.days)
        || typeof p.votes !== 'object' || p.votes === null) fail('player');
      if (p.runId !== null && typeof p.runId !== 'string') fail('runId');
      const days = p.days.map((x, i) => {
        const ds = parseDaySummary(x);
        return ds !== null && ds.day === i + 1 ? ds : fail('day');
      });
      const progress = p.progress === null ? null : parseProgress(p.progress) ?? fail('progress');
      s.players.set(p.id, {
        id: p.id, token: p.token, name: p.name, order: p.order, connected: false, runId: p.runId, days,
        votes: { before: vote(p.votes.before), after: vote(p.votes.after) }, progress,
        lastActive: Number.isFinite(p.lastActive) ? p.lastActive : 0,
      });
      s.byToken.set(p.token, p.id);
    }
    return s;
  }
}
