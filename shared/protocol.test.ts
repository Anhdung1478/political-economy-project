import { describe, expect, it } from 'vitest';
import { daySummary as summary } from './protocol.fixtures';
import { isDurable, LIMITS, notNextExpected, parseDaySummary, parseProgress, parseVote } from './protocol';

describe('LIMITS', () => {
  it('keeps the old name and player limits', () => {
    expect(LIMITS).toEqual({ nickname: 20, maxPlayers: 200 });
  });
});

describe('parseDaySummary', () => {
  it('accepts a valid summary and returns a clean copy', () => {
    const s = summary({ upgrade: 'banner', labels: ['cartelKept', 'inspectPass'] });
    const out = parseDaySummary({ ...s, extra: 'junk' });
    expect(out).toEqual(s);
    expect(out).not.toBe(s);
    expect((out as unknown as Record<string, unknown>).extra).toBeUndefined();
  });

  it('accepts negative profit, cash and score', () => {
    expect(parseDaySummary(summary({ profit: -40, cash: -120, score: -80 }))).not.toBeNull();
  });

  it.each([
    ['not an object', 42],
    ['null', null],
    ['an array', []],
  ])('rejects %s', (_label, x) => {
    expect(parseDaySummary(x)).toBeNull();
  });

  const bad: [string, Record<string, unknown>][] = [
    ['day 0', { day: 0 }],
    ['day 6', { day: 6 }],
    ['day 1.5', { day: 1.5 }],
    ['day as text', { day: '1' }],
    ['NaN price', { openPrice: Number.NaN }],
    ['infinite cash', { cash: Number.POSITIVE_INFINITY }],
    ['negative price', { closePrice: -1 }],
    ['unknown tea', { tea: 'gold' }],
    ['missing bought', { bought: undefined }],
    ['negative stock', { used: { teaMl: -1, toppings: { pearl: 0, jelly: 0, pudding: 0 } } }],
    ['missing topping', { used: { teaMl: 1, toppings: { pearl: 0, jelly: 0 } } }],
    ['negative waste', { wasteValue: -2 }],
    ['fractional cups', { cups: 2.5 }],
    ['negative wrong', { wrong: -1 }],
    ['negative revenue', { revenue: -1 }],
    ['rep above 100', { rep: 101 }],
    ['rep below 0', { rep: -1 }],
    ['unknown upgrade', { upgrade: 'rocket' }],
    ['unknown card', { cards: [{ id: 'joker', choice: 'A' }] }],
    ['bad card choice', { cards: [{ id: 'kol', choice: 'C' }] }],
    ['cards not an array', { cards: 'kol' }],
    ['unknown label', { labels: ['cheat'] }],
    ['lost as text', { lost: 'no' }],
    ['huge number', { profit: 1e12 }],
  ];
  it.each(bad)('rejects %s', (_label, over) => {
    expect(parseDaySummary({ ...summary(), ...over })).toBeNull();
  });

  it('rejects absurdly long card and label lists', () => {
    const cards = Array.from({ length: 50 }, () => ({ id: 'kol', choice: 'A' }));
    expect(parseDaySummary({ ...summary(), cards })).toBeNull();
    const labels = Array.from({ length: 50 }, () => 'skimp');
    expect(parseDaySummary({ ...summary(), labels })).toBeNull();
  });

  it('never throws on hostile input', () => {
    const hostile = { get day() { throw new Error('boom'); } };
    expect(() => parseDaySummary(hostile)).not.toThrow();
    expect(parseDaySummary(hostile)).toBeNull();
  });
});

describe('parseVote', () => {
  it('accepts the four valid votes', () => {
    for (const choice of ['invisible', 'visible'] as const) {
      for (const when of ['before', 'after'] as const) {
        expect(parseVote({ choice, when, x: 1 })).toEqual({ choice, when });
      }
    }
  });
  it('rejects bad votes', () => {
    expect(parseVote(null)).toBeNull();
    expect(parseVote({ choice: 'visible' })).toBeNull();
    expect(parseVote({ choice: 'maybe', when: 'before' })).toBeNull();
    expect(parseVote({ choice: 'visible', when: 'during' })).toBeNull();
  });
});

describe('parseProgress', () => {
  it('accepts a day and a run phase', () => {
    expect(parseProgress({ day: 3, phase: 'rush' })).toEqual({ day: 3, phase: 'rush' });
  });
  it('rejects bad progress', () => {
    expect(parseProgress({ day: 0, phase: 'rush' })).toBeNull();
    expect(parseProgress({ day: 2, phase: 'night' })).toBeNull();
    expect(parseProgress('x')).toBeNull();
  });
});

describe('report replies', () => {
  it('reads the expected day of a notNext reply', () => {
    expect(notNextExpected({ ok: false, error: 'notNext', expected: 2 })).toBe(2);
    expect(notNextExpected({ ok: false, error: 'notNext', expected: null })).toBeNull();
    expect(notNextExpected({ ok: false, error: 'notNext' })).toBeNull();
    expect(notNextExpected({ ok: false, error: 'notNext', expected: 9 })).toBeNull();
    expect(notNextExpected({ ok: false, error: 'notNext', expected: '2' })).toBeNull();
    expect(notNextExpected({ ok: false, error: 'finished', expected: 2 })).toBeUndefined();
    expect(notNextExpected({ ok: true, rank: 1 })).toBeUndefined();
    expect(notNextExpected(null)).toBeUndefined();
    expect(notNextExpected('notNext')).toBeUndefined();
  });
  it('tells an accepted report the server could not save yet', () => {
    expect(isDurable({ ok: true })).toBe(true);
    expect(isDurable({ ok: true, rank: 2 } as never)).toBe(true);
    expect(isDurable({ ok: true, rank: 2, durable: false } as never)).toBe(false);
    expect(isDurable({ ok: false, error: 'wrongSession' })).toBe(true);
  });
});
