// The pure parts of the student's class screen (spec §2, §11, §13): which screen to show, which reports of a run to
// send, the vote mapping, the awards the phone shows. No React, storage or socket here; `PlayController` and `Play`
// use them.
import type {
  Award, AwardsResult, SessionPhase, SessionSnapshot, TopEntry, VoteChoice, Vote,
} from '../../../../shared/protocol';
import type { Choice, DaySummary, Phase, RunState } from '../../../../shared/sim/types';
import type { DayPayload } from '../../game/reportQueue';

/** Where the phone keeps its bits: the token and name survive a session, the rest belongs to one session code. */
export const PLAY_KEYS = {
  token: 'pts.token',
  name: 'pts.name',
  /** `{ code, seed }` of the session this phone last saw (so a reload offline can go on with the saved run). */
  session: 'pts.session',
  /** `{ code, choice }`: the "before" vote of the session `code`. */
  vote: 'pts.vote',
  /** `{ code, day, rank }`: the rank from the latest day the server answered. */
  rank: 'pts.rank',
  runId: (code: string) => `pts.class.${code}.runId`,
} as const;

export type Resume = 'checking' | 'anon' | 'in';
export type ScreenId = 'boot' | 'join' | 'ended' | 'lobby' | 'game' | 'awards';

/**
 * The screen for the phone's state. `phase` is the session phase from the latest `state` (null before the first one,
 * or offline after a reload); `hasRun` says a run of this session is saved on the phone.
 *
 * - Not joined: the join form, or "Buổi đã kết thúc" once the awards are out (the server would refuse the join).
 * - Joined: the lobby, then the game when the market opens (late joiners start at once). At `awards` a phone with a run
 *   keeps its game (spec §2 step 4: whoever has not finished plays on), one without sees the awards.
 */
export function chooseScreen(p: { resume: Resume; phase: SessionPhase | null; hasRun: boolean }): ScreenId {
  if (p.phase === null) return p.resume !== 'anon' && p.hasRun ? 'game' : 'boot';
  if (p.resume === 'checking') return 'boot';
  if (p.resume === 'anon') return p.phase === 'awards' ? 'ended' : 'join';
  if (p.phase === 'lobby') return 'lobby';
  if (p.phase === 'open') return 'game';
  return p.hasRun ? 'game' : 'awards';
}

/** The reporter card (A: the invisible hand, B: the visible one) as the class vote. */
export const voteOfReporter = (choice: Choice): VoteChoice => (choice === 'A' ? 'invisible' : 'visible');

/** Whether the run is over: it ended, or the last evening report lost the trust of the street. */
export function runFinished(run: RunState): boolean {
  return run.phase === 'end' || run.outcome !== null
    || run.reports.some(r => r.summary.day >= 5 || r.summary.lost);
}

/** The "after" vote of a run that is over and whose reporter card was answered; null otherwise. */
export function afterVoteOf(run: RunState): Vote | null {
  if (!runFinished(run) || run.flags.reporter === null) return null;
  return { when: 'after', choice: voteOfReporter(run.flags.reporter) };
}

/**
 * What to put in the outbox for a run (R63): every day reported so far, in day order, then the "after" vote when it is
 * known. The outbox ignores the days it already sent or holds and the server ignores duplicates, so this is safe to
 * ask again on every mount, resume and report: a reload at the day-5 report cannot leave day 5 unsent.
 */
export function reportsOf(run: RunState): { days: DayPayload[]; vote: Vote | null } {
  const days = [...run.reports].map(r => r.summary).sort((a, b) => a.day - b.day)
    .map(summary => ({ runId: run.runId, summary }));
  return { days, vote: afterVoteOf(run) };
}

/** The outbox's `resync` source: the summaries of `run` from day `from` on ([] for another run). */
export function summariesFrom(run: RunState | null, runId: string, from: number): DaySummary[] {
  if (run === null || run.runId !== runId) return [];
  return run.reports.map(r => r.summary).filter(s => s.day >= from);
}

/** A rank answered by the server for `day`; an older day's answer (a resent one) does not replace a newer rank. */
export interface RankNote { day: number; rank: number }
export function noteRank(prev: RankNote | null, day: number, rank: number): RankNote {
  return prev !== null && prev.day > day ? prev : { day, rank };
}

/** What the awards screen shows for one player. */
export interface AwardsView {
  /** The player's rank at the moment the awards were handed out; null when unknown (not in the list). */
  rank: number | null;
  mine: Award[];
  /** The top 5 (the server sends them), the player's own row marked. */
  top: (TopEntry & { me: boolean })[];
  /** The player is not in the top 5: their own line goes below it. */
  outside: boolean;
}
export function awardsView(awards: AwardsResult | null, playerId: string | null): AwardsView | null {
  if (awards === null) return null;
  const top = awards.top.slice(0, 5).map(t => ({ ...t, me: t.playerId === playerId }));
  return {
    rank: playerId !== null ? awards.ranks[playerId] ?? null : null,
    mine: awards.awards.filter(a => a.playerId === playerId),
    top,
    outside: !top.some(t => t.me),
  };
}

/** The line under "Chờ thầy/cô mở chợ…". */
export function lobbyLine(s: Pick<SessionSnapshot, 'phase' | 'counts'> | null): string {
  const n = s?.counts.joined ?? 0;
  return n > 1 ? `${n} người đã vào phố` : 'Bạn là người đầu tiên vào phố';
}

/** Reads `{ ... }` JSON from storage; null when absent or not an object. */
export function readJson(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const o = JSON.parse(raw) as unknown;
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? o as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export interface LocalSession { code: string; seed: number }
export function parseLocalSession(raw: string | null): LocalSession | null {
  const o = readJson(raw);
  return o && typeof o.code === 'string' && o.code !== '' && typeof o.seed === 'number' && Number.isFinite(o.seed)
    ? { code: o.code, seed: o.seed } : null;
}
export function parseVoteRecord(raw: string | null, code: string): VoteChoice | null {
  const o = readJson(raw);
  return o && o.code === code && (o.choice === 'invisible' || o.choice === 'visible') ? o.choice : null;
}
export function parseRankRecord(raw: string | null, code: string): RankNote | null {
  const o = readJson(raw);
  return o && o.code === code && Number.isInteger(o.day) && Number.isInteger(o.rank)
    ? { day: o.day as number, rank: o.rank as number } : null;
}

/** The phases the progress event carries (the game's own). */
export type GamePhase = Phase;
export const isGamePhase = (x: unknown): x is GamePhase =>
  x === 'morning' || x === 'rush' || x === 'cards' || x === 'report' || x === 'end';
