import { describe, expect, it } from 'vitest';
import type { BoardMember } from '../../../../shared/protocol';
import { daySummary } from '../../../../shared/protocol.fixtures';
import {
  avgPriceText, awardDetail, DAY_COLUMNS, dayCells, labelShares, memberVoteText, progressText, sortMembers, voteRows,
} from './hostFormat';

function member(id: string, over: Partial<BoardMember> = {}): BoardMember {
  return {
    id, name: id, connected: true, progress: null, score: null, rep: null, lastPrice: null, profit: null,
    cups: 0, wrong: 0, walkouts: 0, labels: [], vote: { before: null, after: null }, finished: false, lost: false,
    days: [], lastActive: 0, ...over,
  };
}

describe('labelShares', () => {
  it('lists every label in order with its share of n', () => {
    const rows = labelShares({ n: 4, count: { skimp: 2, cartelKept: 1, cartelBroke: 0, shockTopping: 4, blackMarket: 0,
      taxEvaded: 0, inspectPass: 0, inspectFail: 0 } });
    expect(rows.map(r => r.icon)).toEqual(['🥄', '🤝', '🗡️', '📦', '💵', '🐀', '✅', '❌']);
    expect(rows[0]).toMatchObject({ label: 'skimp', count: 2, share: 0.5 });
    expect(rows[3].share).toBe(1);
  });
  it('gives 0 shares when nobody sent a day', () => {
    const rows = labelShares({ n: 0, count: { skimp: 0, cartelKept: 0, cartelBroke: 0, shockTopping: 0, blackMarket: 0,
      taxEvaded: 0, inspectPass: 0, inspectFail: 0 } });
    expect(rows.every(r => r.share === 0)).toBe(true);
  });
});

describe('votes', () => {
  it('summarizes before → after with shares over n', () => {
    const rows = voteRows({ n: 10, before: { invisible: 7, visible: 3 }, after: { invisible: 4, visible: 6 } });
    expect(rows).toEqual([
      { choice: 'invisible', text: 'Vô hình', before: 7, after: 4, beforeShare: 0.7, afterShare: 0.4 },
      { choice: 'visible', text: 'Hữu hình', before: 3, after: 6, beforeShare: 0.3, afterShare: 0.6 },
    ]);
    expect(voteRows({ n: 0, before: { invisible: 0, visible: 0 }, after: { invisible: 0, visible: 0 } })[0].beforeShare).toBe(0);
  });
  it('shows a member vote with gaps', () => {
    expect(memberVoteText({ before: null, after: null })).toBe('—');
    expect(memberVoteText({ before: 'invisible', after: null })).toBe('Vô → ?');
    expect(memberVoteText({ before: 'invisible', after: 'visible' })).toBe('Vô → Hữu');
    expect(memberVoteText({ before: null, after: 'visible' })).toBe('? → Hữu');
  });
});

describe('progressText', () => {
  it('covers not started, playing, finished and lost', () => {
    expect(progressText(member('a'))).toBe('Chưa chơi');
    expect(progressText(member('a', { progress: { day: 3, phase: 'rush' } }))).toBe('Ngày 3 · Trưa');
    expect(progressText(member('a', { finished: true, progress: { day: 5, phase: 'end' } }))).toBe('Đã xong');
    expect(progressText(member('a', { finished: true, lost: true, days: [daySummary(), daySummary({ day: 2 })] })))
      .toBe('Thua sớm · ngày 2');
  });
});

describe('sortMembers', () => {
  const ms = [
    member('p1', { name: 'Linh', score: 900, cups: 40 }),
    member('p2', { name: 'an', score: 900, cups: 55 }),
    member('p3', { name: 'Bảo', score: 700, cups: 60 }),
    member('p4', { name: 'Đạt' }),
  ];
  it('keeps the board order for score desc, ties by board order', () => {
    expect(sortMembers(ms, 'score').map(m => m.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
  it('puts missing values last in both directions', () => {
    expect(sortMembers(ms, 'score', false).map(m => m.id)).toEqual(['p3', 'p1', 'p2', 'p4']);
  });
  it('sorts names A→Z in Vietnamese, ignoring case', () => {
    expect(sortMembers(ms, 'name').map(m => m.name)).toEqual(['an', 'Bảo', 'Đạt', 'Linh']);
  });
  it('sorts numbers high → low by default and does not mutate', () => {
    const copy = [...ms];
    expect(sortMembers(ms, 'cups').map(m => m.id)).toEqual(['p3', 'p2', 'p1', 'p4']);
    expect(ms).toEqual(copy);
  });
  it('sorts by progress: finished first, then the furthest day and phase', () => {
    const ps = [
      member('a', { progress: { day: 2, phase: 'morning' }, days: [daySummary()] }),
      member('b', { finished: true, days: [1, 2, 3, 4, 5].map(d => daySummary({ day: d as 1 })) }),
      member('c'),
      member('d', { progress: { day: 2, phase: 'report' }, days: [daySummary()] }),
    ];
    expect(sortMembers(ps, 'progress').map(m => m.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('text cells', () => {
  it('describes each award', () => {
    expect(awardDetail({ id: 'tycoon', value: 1250 })).toBe('Điểm 1.250k');
    expect(awardDetail({ id: 'beloved', value: 87 })).toBe('Uy tín cuối 87');
    expect(awardDetail({ id: 'hoarder', value: 42.5 })).toBe('Bỏ đi 42,5k nguyên liệu');
    expect(awardDetail({ id: 'goldenHand', value: 0.025 })).toBe('Chỉ 2,5% ly giao sai');
  });
  it('shows the class average price or a dash', () => {
    expect(avgPriceText({ open: 30, close: 27.5 })).toBe('30k → 27,5k');
    expect(avgPriceText({ open: null, close: null })).toBe('—');
  });
  it('gives one cell per day column', () => {
    const cells = dayCells(daySummary({ upgrade: 'machine', labels: ['skimp', 'taxEvaded'], lost: true }));
    expect(cells).toHaveLength(DAY_COLUMNS.length);
    expect(cells[0]).toBe('1 ☠');
    expect(cells[1]).toBe('30k → 28k');
    expect(cells[3]).toBe('3L / 2,5L');
    expect(cells[13]).toBe('+260k');
    expect(cells[17]).toBe('Máy pha');
    expect(cells[18]).toBe('KOL A');
    expect(cells[19]).toBe('🥄 🐀');
  });
});
