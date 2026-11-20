import { describe, expect, it } from 'vitest';
import type { AwardsResult } from '../../../../shared/protocol';
import { playRun, STRATEGIES } from '../../../../shared/sim/autoplay';
import type { RunState } from '../../../../shared/sim/types';
import {
  afterVoteOf, awardsView, chooseScreen, lobbyLine, noteRank, parseLocalSession, parseRankRecord, parseVoteRecord,
  reportsOf, runFinished, summariesFrom, voteOfReporter,
} from './playLogic';

const full = playRun(7, STRATEGIES.reasonable).run;
/** The run as it stands at the evening report of day `d` (the reports so far, nothing after). */
const atReport = (d: number): RunState => ({
  ...full, day: d as RunState['day'], phase: 'report', outcome: null, reports: full.reports.slice(0, d),
  flags: { ...full.flags, reporter: null },
});

describe('chooseScreen', () => {
  const base = { resume: 'in', phase: 'lobby', hasRun: false } as const;
  it('waits for the first state and the token check', () => {
    expect(chooseScreen({ ...base, phase: null })).toBe('boot');
    expect(chooseScreen({ ...base, phase: null, resume: 'anon' })).toBe('boot');
    expect(chooseScreen({ ...base, resume: 'checking' })).toBe('boot');
  });
  it('goes on with a saved run before any state arrives (a reload while offline)', () => {
    expect(chooseScreen({ resume: 'in', phase: null, hasRun: true })).toBe('game');
    expect(chooseScreen({ resume: 'checking', phase: null, hasRun: true })).toBe('game');
    expect(chooseScreen({ resume: 'anon', phase: null, hasRun: true })).toBe('boot');
  });
  it('shows the join form, or "session over" once the awards are out', () => {
    expect(chooseScreen({ ...base, resume: 'anon' })).toBe('join');
    expect(chooseScreen({ ...base, resume: 'anon', phase: 'open' })).toBe('join');
    expect(chooseScreen({ ...base, resume: 'anon', phase: 'awards' })).toBe('ended');
  });
  it('walks a joined player lobby -> game -> awards', () => {
    expect(chooseScreen(base)).toBe('lobby');
    expect(chooseScreen({ ...base, phase: 'open' })).toBe('game');
    expect(chooseScreen({ ...base, phase: 'open', hasRun: true })).toBe('game');
  });
  it('lets a run in progress go on after the awards, and shows the awards to a phone with no run', () => {
    expect(chooseScreen({ ...base, phase: 'awards', hasRun: true })).toBe('game');
    expect(chooseScreen({ ...base, phase: 'awards', hasRun: false })).toBe('awards');
  });
});

describe('votes', () => {
  it('maps the reporter card to the class vote (A: invisible, B: visible)', () => {
    expect(voteOfReporter('A')).toBe('invisible');
    expect(voteOfReporter('B')).toBe('visible');
  });
  it('sends the after vote only for a finished run whose reporter card was answered', () => {
    expect(afterVoteOf({ ...full, flags: { ...full.flags, reporter: 'B' } })).toEqual({ when: 'after', choice: 'visible' });
    expect(afterVoteOf({ ...full, flags: { ...full.flags, reporter: 'A' } })).toEqual({ when: 'after', choice: 'invisible' });
    expect(afterVoteOf({ ...full, flags: { ...full.flags, reporter: null } })).toBeNull();
    expect(afterVoteOf({ ...atReport(2), flags: { ...full.flags, reporter: 'A' } })).toBeNull(); // still playing
  });
  it('knows when a run is over, including an early loss', () => {
    expect(runFinished(full)).toBe(true);
    expect(runFinished(atReport(3))).toBe(false);
    const lost = atReport(2);
    lost.reports = [lost.reports[0], { ...lost.reports[1], summary: { ...lost.reports[1].summary, lost: true } }];
    expect(runFinished(lost)).toBe(true);
  });
});

describe('what to send for a run (R63)', () => {
  it('lists every reported day in order with the run id, so a reload at the day-5 report cannot lose day 5', () => {
    const run = atReport(5);
    const { days, vote } = reportsOf({ ...run, reports: [...run.reports].reverse() });
    expect(days.map(d => d.summary.day)).toEqual([1, 2, 3, 4, 5]);
    expect(days.every(d => d.runId === run.runId)).toBe(true);
    expect(vote).toBeNull();
  });
  it('adds the after vote of a finished run', () => {
    const r = { ...full, flags: { ...full.flags, reporter: 'A' as const } };
    expect(reportsOf(r).vote).toEqual({ when: 'after', choice: 'invisible' });
  });
  it('is empty before the first report', () => {
    expect(reportsOf({ ...atReport(1), reports: [] })).toEqual({ days: [], vote: null });
  });
});

describe('resync source', () => {
  it('gives the summaries from the day asked for, of the same run only', () => {
    const run = atReport(4);
    expect(summariesFrom(run, run.runId, 2).map(s => s.day)).toEqual([2, 3, 4]);
    expect(summariesFrom(run, run.runId, 5)).toEqual([]);
    expect(summariesFrom(run, 'other', 1)).toEqual([]);
    expect(summariesFrom(null, run.runId, 1)).toEqual([]);
  });
});

describe('rank', () => {
  it('keeps the newest day rank, so a resent older day does not overwrite it', () => {
    let n = noteRank(null, 1, 5);
    n = noteRank(n, 2, 3);
    expect(noteRank(n, 1, 9)).toEqual({ day: 2, rank: 3 });
    expect(noteRank(n, 2, 4)).toEqual({ day: 2, rank: 4 });
    expect(noteRank(n, 3, 1)).toEqual({ day: 3, rank: 1 });
  });
});

describe('awards view', () => {
  const awards: AwardsResult = {
    awards: [
      { id: 'tycoon', emoji: '🏆', title: 'Đại Gia Trân Châu', playerId: 'p2', name: 'Bình', value: 900 },
      { id: 'beloved', emoji: '⭐', title: 'Quán Quốc Dân', playerId: 'p1', name: 'An', value: 80 },
    ],
    top: [1, 2, 3, 4, 5, 6].map(i => ({ playerId: `p${i}`, name: `N${i}`, score: 1000 - i, rank: i })),
    ranks: { p1: 1, p2: 2, p9: 7 },
  };
  it('gives the rank, the awards the player won and the top 5 with their own row marked', () => {
    const v = awardsView(awards, 'p2')!;
    expect(v.rank).toBe(2);
    expect(v.mine.map(a => a.id)).toEqual(['tycoon']);
    expect(v.top).toHaveLength(5);
    expect(v.top.filter(t => t.me).map(t => t.playerId)).toEqual(['p2']);
    expect(v.outside).toBe(false);
  });
  it('says when the player is below the top 5', () => {
    const v = awardsView(awards, 'p9')!;
    expect(v.rank).toBe(7);
    expect(v.mine).toEqual([]);
    expect(v.outside).toBe(true);
  });
  it('has no rank for a player the list does not know, and nothing before the awards', () => {
    expect(awardsView(awards, 'ghost')!.rank).toBeNull();
    expect(awardsView(awards, null)!.rank).toBeNull();
    expect(awardsView(null, 'p1')).toBeNull();
  });
});

describe('stored records', () => {
  it('reads the session, vote and rank only for the right code and shape', () => {
    expect(parseLocalSession('{"code":"ABCD","seed":7}')).toEqual({ code: 'ABCD', seed: 7 });
    expect(parseLocalSession('{"code":"","seed":7}')).toBeNull();
    expect(parseLocalSession('[1]')).toBeNull();
    expect(parseLocalSession('nope')).toBeNull();
    expect(parseLocalSession(null)).toBeNull();
    expect(parseVoteRecord('{"code":"A","choice":"visible"}', 'A')).toBe('visible');
    expect(parseVoteRecord('{"code":"A","choice":"visible"}', 'B')).toBeNull();
    expect(parseVoteRecord('{"code":"A","choice":"x"}', 'A')).toBeNull();
    expect(parseRankRecord('{"code":"A","day":2,"rank":3}', 'A')).toEqual({ day: 2, rank: 3 });
    expect(parseRankRecord('{"code":"A","day":2,"rank":"3"}', 'A')).toBeNull();
    expect(parseRankRecord('{"code":"A","day":2,"rank":3}', 'B')).toBeNull();
  });
  it('words the lobby count', () => {
    const counts = { joined: 1, playing: 0, finished: 0, lostTrust: 0 };
    expect(lobbyLine({ phase: 'lobby', counts })).toContain('đầu tiên');
    expect(lobbyLine({ phase: 'lobby', counts: { ...counts, joined: 12 } })).toContain('12 người');
    expect(lobbyLine(null)).toContain('đầu tiên');
  });
});
