import { describe, expect, it, vi } from 'vitest';
import { daySummary } from '../shared/protocol.fixtures';
import type { DaySummary } from '../shared/sim/types';
import { Session, type SessionOptions } from './session';

/** A repeatable random stream and uuid counter, so seeds, codes and tokens are deterministic. */
function opts(over: Partial<SessionOptions> = {}): SessionOptions & { persist: ReturnType<typeof vi.fn> } {
  let r = 0.123;
  let u = 0;
  let t = 1000;
  const persist = vi.fn();
  return {
    now: () => t++,
    random: () => { r = (r * 9301 + 0.49297) % 1; return r; },
    uuid: () => `tok-${++u}`,
    persist,
    ...over,
  } as SessionOptions & { persist: ReturnType<typeof vi.fn> };
}
/** The current session code, which every vote and day must carry. */
const C = (s: Session) => s.snapshot().code;
const day = (d: number, over: Partial<DaySummary> = {}) => daySummary({ day: d as DaySummary['day'], ...over });

function joined(names: string[], o = opts()) {
  const s = new Session(o);
  const ids = names.map(n => {
    const r = s.join(n);
    if (!r.ok) throw new Error(r.error);
    return r.playerId;
  });
  return { s, ids, o };
}

describe('a new session', () => {
  it('starts in the lobby with a seed and a session code', () => {
    const s = new Session(opts());
    const snap = s.snapshot();
    expect(snap.phase).toBe('lobby');
    expect(snap.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(Number.isInteger(snap.seed)).toBe(true);
    expect(snap.seed).toBeGreaterThanOrEqual(0);
    expect(snap.counts).toEqual({ joined: 0, playing: 0, finished: 0, lostTrust: 0 });
    expect(snap.awards).toBeNull();
  });
  it('is deterministic under the injected random', () => {
    expect(new Session(opts()).snapshot()).toEqual(new Session(opts()).snapshot());
  });
});

describe('join and resume', () => {
  it('trims and collapses the name and hands out a token', () => {
    const { s, o } = joined([]);
    const r = s.join('  Bé   Na  ');
    expect(r).toEqual({ ok: true, playerId: 'p1', token: 'tok-1' });
    expect(s.board().members[0]).toMatchObject({ id: 'p1', name: 'Bé Na', connected: true });
    expect(o.persist).toHaveBeenCalled();
  });
  it('refuses empty and too-long names', () => {
    const s = new Session(opts());
    expect(s.join('   ').ok).toBe(false);
    expect(s.join('x'.repeat(21)).ok).toBe(false);
    expect(s.join('x'.repeat(20)).ok).toBe(true);
    expect(s.join(undefined as unknown as string).ok).toBe(false);
    for (const x of [{}, ['a', 'b'], 5, null]) expect(s.join(x as never).ok).toBe(false);
    expect(s.board().members).toHaveLength(1);
  });
  it('refuses the 201st player', () => {
    const s = new Session(opts());
    for (let i = 0; i < 200; i++) expect(s.join(`n${i}`).ok).toBe(true);
    expect(s.join('late').ok).toBe(false);
  });
  it('lets late players join while the market is open, not after the awards', () => {
    const { s } = joined(['a']);
    s.open();
    expect(s.join('late').ok).toBe(true);
    s.awards();
    expect(s.join('later').ok).toBe(false);
  });
  it('resumes by token only', () => {
    const { s } = joined(['An']);
    expect(s.resume('tok-1')).toEqual({ playerId: 'p1', name: 'An' });
    expect(s.resume('nope')).toBeNull();
    expect(s.resume(42 as unknown as string)).toBeNull();
  });
  it('tracks the connection flag', () => {
    const { s, ids } = joined(['An']);
    s.setConnected(ids[0], false);
    expect(s.board().members[0].connected).toBe(false);
    expect(() => s.setConnected('ghost', true)).not.toThrow();
  });
});

describe('votes', () => {
  it('takes the before vote in the lobby and the after vote once the market is open', () => {
    const { s, ids } = joined(['An']);
    s.vote(ids[0], C(s), { choice: 'invisible', when: 'before' });
    s.vote(ids[0], C(s), { choice: 'visible', when: 'after' });
    expect(s.board().members[0].vote).toEqual({ before: 'invisible', after: null });
    s.open();
    s.vote(ids[0], C(s), { choice: 'visible', when: 'after' });
    expect(s.board().members[0].vote).toEqual({ before: 'invisible', after: 'visible' });
  });
  it('still takes the after vote after the awards, but no longer a before vote', () => {
    const { s, ids } = joined(['An', 'Bo']);
    s.open();
    s.awards();
    s.vote(ids[0], C(s), { choice: 'visible', when: 'after' });
    s.vote(ids[1], C(s), { choice: 'visible', when: 'before' });
    expect(s.board().members.find(m => m.id === ids[0])?.vote.after).toBe('visible');
    expect(s.board().members.find(m => m.id === ids[1])?.vote.before).toBeNull();
  });
  it('ignores malformed votes and unknown players', () => {
    const { s, ids } = joined(['An']);
    s.vote(ids[0], C(s), { choice: 'maybe', when: 'before' } as never);
    s.vote('ghost', C(s), { choice: 'visible', when: 'before' });
    expect(s.board().members[0].vote).toEqual({ before: null, after: null });
  });
});

describe('progress', () => {
  it('is ignored in the lobby and kept once the market is open', () => {
    const { s, ids } = joined(['An']);
    expect(s.progress(ids[0], 1, 'morning')).toBe(false);
    expect(s.board().members[0].progress).toBeNull();
    s.open();
    s.progress(ids[0], 2, 'rush');
    expect(s.board().members[0].progress).toEqual({ day: 2, phase: 'rush' });
    expect(s.progress(ids[0], 9 as never, 'rush')).toBe(false);
    expect(s.progress(ids[0], 3, 'nap' as never)).toBe(false);
    expect(s.progress('nobody', 3, 'rush')).toBe(false);
    expect(s.board().members[0].progress).toEqual({ day: 2, phase: 'rush' });
  });
  it('counts a player as playing once they have progress', () => {
    const { s, ids } = joined(['An', 'Bo']);
    s.open();
    s.progress(ids[0], 1, 'morning');
    expect(s.snapshot().counts).toEqual({ joined: 2, playing: 1, finished: 0, lostTrust: 0 });
  });
});

describe('submitDay', () => {
  it('is refused in the lobby', () => {
    const { s, ids } = joined(['An']);
    expect(s.submitDay(ids[0], C(s), 'run-a', day(1)).ok).toBe(false);
  });
  it('keeps only the first run id of each player', () => {
    const { s, ids } = joined(['An']);
    s.open();
    expect(s.submitDay(ids[0], C(s), 'run-a', day(1))).toEqual({ ok: true, rank: 1 });
    expect(s.submitDay(ids[0], C(s), 'run-b', day(2)).ok).toBe(false);
    expect(s.board().members[0].days).toHaveLength(1);
    expect(s.submitDay(ids[0], C(s), 'run-a', day(2)).ok).toBe(true);
  });
  it('accepts only the next expected day and says which one it expects', () => {
    const { s, ids } = joined(['An']);
    s.open();
    expect(s.submitDay(ids[0], C(s), 'run-a', day(2))).toEqual({ ok: false, error: 'notNext', expected: 1 });
    expect(s.board().members[0].days).toHaveLength(0);
    expect(s.submitDay(ids[0], C(s), 'run-a', day(1)).ok).toBe(true);
    expect(s.submitDay(ids[0], C(s), 'run-a', day(3))).toEqual({ ok: false, error: 'notNext', expected: 2 });
  });
  it('ignores duplicates but still answers with the rank', () => {
    const { s, ids, o } = joined(['An']);
    s.open();
    s.submitDay(ids[0], C(s), 'run-a', day(1, { score: 500 }));
    const calls = o.persist.mock.calls.length;
    expect(s.submitDay(ids[0], C(s), 'run-a', day(1, { score: 9999 }))).toEqual({ ok: true, rank: 1 });
    expect(s.board().members[0].days[0].score).toBe(500);
    expect(o.persist.mock.calls.length).toBe(calls);
  });
  it('rejects malformed summaries, unknown players and a non-string run id', () => {
    const { s, ids } = joined(['An']);
    s.open();
    expect(s.submitDay(ids[0], C(s), 'run-a', { day: 1 } as never).ok).toBe(false);
    expect(s.submitDay('ghost', C(s), 'run-a', day(1)).ok).toBe(false);
    expect(s.submitDay(ids[0], C(s), 7 as never, day(1)).ok).toBe(false);
    expect(s.submitDay(ids[0], C(s), '', day(1)).ok).toBe(false);
    expect(s.submitDay(ids[0], C(s), 'run-a', day(1)).ok).toBe(true);
  });
  it('takes nothing after day 5 or a lost day', () => {
    const { s, ids } = joined(['An', 'Bo']);
    s.open();
    for (let d = 1; d <= 5; d++) s.submitDay(ids[0], C(s), 'r0', day(d));
    s.submitDay(ids[1], C(s), 'r1', day(1, { lost: true }));
    expect(s.submitDay(ids[1], C(s), 'r1', day(2)).ok).toBe(false);
    expect(s.snapshot().counts).toEqual({ joined: 2, playing: 0, finished: 2, lostTrust: 1 });
  });
  it('ranks among the players who have finished that day, by that day’s score', () => {
    const { s, ids } = joined(['An', 'Bo', 'Chi']);
    s.open();
    expect(s.submitDay(ids[0], C(s), 'a', day(1, { score: 100 }))).toEqual({ ok: true, rank: 1 });
    expect(s.submitDay(ids[1], C(s), 'b', day(1, { score: 200 }))).toEqual({ ok: true, rank: 1 });
    expect(s.submitDay(ids[2], C(s), 'c', day(1, { score: 100 }))).toEqual({ ok: true, rank: 2 });
    // Day 2 only compares with those who have sent day 2.
    expect(s.submitDay(ids[0], C(s), 'a', day(2, { score: 50 }))).toEqual({ ok: true, rank: 1 });
    expect(s.submitDay(ids[1], C(s), 'b', day(2, { score: 40 }))).toEqual({ ok: true, rank: 2 });
    // A duplicate answers with the rank as it stands now.
    expect(s.submitDay(ids[0], C(s), 'a', day(1, { score: 100 }))).toEqual({ ok: true, rank: 2 });
  });
  it('counts a player who lost trust early as finished on every later day, with their last score', () => {
    const { s, ids } = joined(['An', 'Bo']);
    s.open();
    s.submitDay(ids[0], C(s), 'a', day(1, { score: 900, lost: true }));
    s.submitDay(ids[1], C(s), 'b', day(1, { score: 300 }));
    expect(s.submitDay(ids[1], C(s), 'b', day(2, { score: 400 }))).toEqual({ ok: true, rank: 2 });
    expect(s.submitDay(ids[1], C(s), 'b', day(3, { score: 950 }))).toEqual({ ok: true, rank: 1 });
  });
  it('still takes days after the awards (without changing them)', () => {
    const { s, ids } = joined(['An', 'Bo']);
    s.open();
    s.submitDay(ids[0], C(s), 'a', day(1, { score: 100 }));
    s.awards();
    const frozen = s.snapshot().awards;
    expect(s.submitDay(ids[1], C(s), 'b', day(1, { score: 5000 })).ok).toBe(true);
    expect(s.snapshot().awards).toEqual(frozen);
    expect(s.board().members[0].id).toBe(ids[1]);
  });
});

describe('open and awards', () => {
  it('moves lobby → open → awards and ignores steps in the wrong phase', () => {
    const { s, o } = joined(['An']);
    s.awards();
    expect(s.snapshot().phase).toBe('lobby');
    s.open();
    expect(s.snapshot().phase).toBe('open');
    const calls = o.persist.mock.calls.length;
    s.open();
    expect(o.persist.mock.calls.length).toBe(calls);
    s.awards();
    expect(s.snapshot().phase).toBe('awards');
    s.open();
    expect(s.snapshot().phase).toBe('awards');
  });
  it('freezes the awards, the top 5 and everyone’s rank', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const { s, ids } = joined(names);
    s.open();
    const scores = [300, 700, 500, 700, 100, 900];
    scores.forEach((score, i) => s.submitDay(ids[i], C(s), `r${i}`, day(1, { score, cash: 300 + i })));
    s.awards();
    const a = s.snapshot().awards;
    expect(a).not.toBeNull();
    if (!a) return;
    expect(a.awards.find(x => x.id === 'tycoon')?.playerId).toBe(ids[5]);
    expect(a.top.map(t => [t.playerId, t.score, t.rank])).toEqual([
      [ids[5], 900, 1], [ids[3], 700, 2], [ids[1], 700, 2], [ids[2], 500, 4], [ids[0], 300, 5],
    ]);
    expect(a.ranks).toEqual({
      [ids[0]]: 5, [ids[1]]: 2, [ids[2]]: 4, [ids[3]]: 2, [ids[4]]: 6, [ids[5]]: 1, [ids[6]]: 7,
    });
    expect(a.top[0].name).toBe('F');
  });
});

describe('reset', () => {
  it('starts a new session keeping only the connected players', () => {
    const { s, ids } = joined(['An', 'Bo']);
    const before = s.snapshot();
    s.vote(ids[0], C(s), { choice: 'visible', when: 'before' });
    s.open();
    s.progress(ids[0], 2, 'rush');
    s.submitDay(ids[0], C(s), 'old-run', day(1));
    s.setConnected(ids[1], false);
    s.awards();
    s.reset();
    const after = s.snapshot();
    expect(after.phase).toBe('lobby');
    expect(after.awards).toBeNull();
    expect(after.code).not.toBe(before.code);
    expect(after.seed).not.toBe(before.seed);
    expect(after.counts).toEqual({ joined: 1, playing: 0, finished: 0, lostTrust: 0 });
    const m = s.board().members;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ id: ids[0], name: 'An', days: [], progress: null, vote: { before: null, after: null } });
    expect(s.resume('tok-1')?.playerId).toBe(ids[0]);
    expect(s.resume('tok-2')).toBeNull();
    s.open();
    expect(s.submitDay(ids[0], C(s), 'new-run', day(1)).ok).toBe(true);
  });
  it('keeps numbering new players after the old ones', () => {
    const { s } = joined(['An', 'Bo']);
    s.reset();
    expect(s.join('Chi')).toMatchObject({ playerId: 'p3' });
  });
});

describe('board', () => {
  it('sums up the class and lists members by score', () => {
    const { s, ids } = joined(['An', 'Bo', 'Chi']);
    s.vote(ids[0], C(s), { choice: 'invisible', when: 'before' });
    s.vote(ids[1], C(s), { choice: 'invisible', when: 'before' });
    s.open();
    s.vote(ids[0], C(s), { choice: 'visible', when: 'after' });
    s.vote(ids[2], C(s), { choice: 'visible', when: 'after' });
    s.submitDay(ids[0], C(s), 'a', day(1, { openPrice: 30, closePrice: 28, score: 100, labels: ['skimp'] }));
    s.submitDay(ids[0], C(s), 'a', day(2, { openPrice: 26, closePrice: 26, score: 300, labels: ['cartelKept', 'skimp'],
      cups: 10, wrong: 2, walkouts: 1, profit: 40, cash: 520, rep: 70 }));
    s.submitDay(ids[1], C(s), 'b', day(1, { openPrice: 34, closePrice: 30, score: 400, labels: [] }));
    const b = s.board();
    expect(b.phase).toBe('open');
    expect(b.overview.counts).toEqual({ joined: 3, playing: 2, finished: 0, lostTrust: 0 });
    expect(b.overview.avgPrice[0]).toEqual({ day: 1, open: 32, close: 29, n: 2 });
    expect(b.overview.avgPrice[1]).toEqual({ day: 2, open: 26, close: 26, n: 1 });
    expect(b.overview.avgPrice[2]).toEqual({ day: 3, open: null, close: null, n: 0 });
    expect(b.overview.labels.n).toBe(2);
    expect(b.overview.labels.count.skimp).toBe(1);
    expect(b.overview.labels.count.cartelKept).toBe(1);
    expect(b.overview.labels.count.blackMarket).toBe(0);
    expect(b.overview.votes).toEqual({ n: 1, before: { invisible: 1, visible: 0 }, after: { invisible: 0, visible: 1 } });
    expect(b.members.map(m => m.id)).toEqual([ids[1], ids[0], ids[2]]);
    const an = b.members[1];
    expect(an).toMatchObject({
      // Σ daily profit would be 300; the board shows cash − start (R51).
      name: 'An', score: 300, profit: 520 - 300, rep: 70, lastPrice: 26, cups: 30, wrong: 3, walkouts: 3,
      labels: ['skimp', 'cartelKept'], vote: { before: 'invisible', after: 'visible' }, finished: false, lost: false,
    });
    expect(an.days).toHaveLength(2);
    expect(b.members[2]).toMatchObject({ score: null, profit: null, rep: null, lastPrice: null, days: [] });
  });
});

describe('JSON round trip', () => {
  it('restores the whole session with everyone disconnected', () => {
    const { s, ids } = joined(['An', 'Bo']);
    s.vote(ids[0], C(s), { choice: 'visible', when: 'before' });
    s.open();
    s.progress(ids[0], 2, 'cards');
    s.submitDay(ids[0], C(s), 'run-a', day(1));
    s.awards();
    const json = JSON.parse(JSON.stringify(s.toJSON()));
    const back = Session.fromJSON(json, opts());
    expect(back.snapshot()).toEqual(s.snapshot());
    expect(back.board().members.map(m => m.connected)).toEqual([false, false]);
    expect(back.resume('tok-2')?.playerId).toBe(ids[1]);
    // The first run id survives: another run is still refused.
    expect(back.submitDay(ids[0], C(back), 'run-b', day(2)).ok).toBe(false);
    expect(back.submitDay(ids[0], C(back), 'run-a', day(2)).ok).toBe(true);
    back.reset();
    expect(back.join('Chi')).toMatchObject({ playerId: 'p3' });
  });
  it('throws on data that is not a session', () => {
    expect(() => Session.fromJSON(null, opts())).toThrow();
    expect(() => Session.fromJSON({ v: 1 }, opts())).toThrow();
    const good = new Session(opts()).toJSON();
    expect(() => Session.fromJSON({ ...good, phase: 'party' }, opts())).toThrow();
    expect(() => Session.fromJSON({ ...good, players: [{ id: 'p1' }] }, opts())).toThrow();
  });
});

describe('session code on votes and days', () => {
  it('refuses a vote or a day carrying another session code', () => {
    const { s, ids } = joined(['An']);
    expect(s.vote(ids[0], 'OLD1', { choice: 'visible', when: 'before' })).toEqual({ ok: false, error: 'wrongSession' });
    expect(s.vote(ids[0], C(s), { choice: 'visible', when: 'before' })).toEqual({ ok: true });
    s.open();
    expect(s.submitDay(ids[0], 'OLD1', 'run-a', day(1))).toEqual({ ok: false, error: 'wrongSession' });
    expect(s.board().members[0].days).toHaveLength(0);
  });
  it('after a reset, an old-session queue cannot pin an old-seed run', () => {
    const { s, ids } = joined(['An']);
    const old = C(s);
    s.reset();
    s.open();
    expect(s.submitDay(ids[0], old, 'old-run', day(1)).ok).toBe(false);
    expect(s.submitDay(ids[0], C(s), 'new-run', day(1)).ok).toBe(true);
  });
  it('answers votes with clear errors', () => {
    const { s, ids } = joined(['An']);
    expect(s.vote('ghost', C(s), { choice: 'visible', when: 'before' })).toEqual({ ok: false, error: 'unknownPlayer' });
    expect(s.vote(ids[0], C(s), { choice: 'x' } as never)).toEqual({ ok: false, error: 'badVote' });
    expect(s.vote(ids[0], C(s), { choice: 'visible', when: 'after' })).toEqual({ ok: false, error: 'wrongPhase' });
  });
});

describe('progress persistence', () => {
  it('does not persist when the progress is unchanged', () => {
    const { s, ids, o } = joined(['An']);
    s.open();
    expect(s.progress(ids[0], 1, 'rush')).toBe(true);
    const calls = o.persist.mock.calls.length;
    expect(s.progress(ids[0], 1, 'rush')).toBe(false);
    expect(o.persist.mock.calls.length).toBe(calls);
    expect(s.progress(ids[0], 1, 'cards')).toBe(true);
    expect(o.persist.mock.calls.length).toBe(calls + 1);
  });
});

describe('fromJSON hardening', () => {
  type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  function saved(): Json {
    const { s, ids } = joined(['An', 'Bo']);
    s.open();
    s.submitDay(ids[0], C(s), 'r', day(1));
    s.awards();
    return JSON.parse(JSON.stringify(s.toJSON()));
  }
  const cases: [string, (j: Json) => void][] = [
    ['a duplicate id', j => { j.players[1].id = 'p1'; j.players[1].order = 1; }],
    ['a duplicate token', j => { j.players[1].token = j.players[0].token; }],
    ['seq below an existing id', j => { j.seq = 1; }],
    ['an id that is not p<n>', j => { j.players[0].id = 'x'; }],
    ['ranks that are not an object', j => { j.awards.ranks = null; }],
    ['ranks that are not numbers', j => { j.awards.ranks.p1 = 'first'; }],
    ['junk top entries', j => { j.awards.top = [null, 5]; }],
    ['junk awards', j => { j.awards.awards = [{ id: 'cheat' }]; }],
    ['awards outside the awards phase', j => { j.phase = 'open'; }],
    ['votes as an array', j => { j.players[0].votes = []; }],
    ['a 5000-character name', j => { j.players[0].name = 'x'.repeat(5000); }],
    ['an empty name', j => { j.players[0].name = ''; }],
    ['more than 200 players', j => {
      for (let i = 3; i < 203; i++) j.players.push({ ...j.players[1], id: `p${i}`, order: i, token: `t${i}` });
      j.seq = 300;
    }],
    ['runId null with stored days', j => { j.players[0].runId = null; }],
    ['a huge seed', j => { j.seed = 1e300; }],
    ['missing progress', j => { delete j.players[0].progress; }],
  ];
  it.each(cases)('rejects %s', (_label, mut) => {
    const j = saved();
    expect(() => Session.fromJSON(j, opts())).not.toThrow();
    mut(j);
    expect(() => Session.fromJSON(j, opts())).toThrow();
  });
});
