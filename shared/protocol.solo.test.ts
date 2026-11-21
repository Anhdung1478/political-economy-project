import { describe, expect, it } from 'vitest';
import { LIMITS, parseSoloSubmit, soloDisplay, soloKey } from './protocol';

const ok = { name: 'An', score: 12.5, runId: 'solo-1' };

describe('parseSoloSubmit', () => {
  it('accepts a good submission and returns a clean copy with the name tidied', () => {
    expect(parseSoloSubmit({ ...ok, name: '  An   Binh ', extra: 1 })).toEqual({ name: 'An Binh', score: 12.5, runId: 'solo-1' });
    expect(parseSoloSubmit({ ...ok, score: -300 })?.score).toBe(-300);
  });
  it('refuses a missing, blank or too long name', () => {
    expect(parseSoloSubmit({ ...ok, name: '   ' })).toBeNull();
    expect(parseSoloSubmit({ ...ok, name: undefined })).toBeNull();
    expect(parseSoloSubmit({ ...ok, name: 7 })).toBeNull();
    expect(parseSoloSubmit({ ...ok, name: 'x'.repeat(LIMITS.nickname + 1) })).toBeNull();
    expect(parseSoloSubmit({ ...ok, name: 'x'.repeat(LIMITS.nickname) })).not.toBeNull();
  });
  it('refuses a score that is not a sane finite number', () => {
    for (const score of [NaN, Infinity, -Infinity, '5', null, undefined, 1e12, -1e12]) {
      expect(parseSoloSubmit({ ...ok, score })).toBeNull();
    }
  });
  it('refuses a missing, empty or long runId', () => {
    expect(parseSoloSubmit({ ...ok, runId: '' })).toBeNull();
    expect(parseSoloSubmit({ ...ok, runId: 'r'.repeat(LIMITS.joinId + 1) })).toBeNull();
    expect(parseSoloSubmit({ ...ok, runId: 5 })).toBeNull();
  });
  it('refuses non-objects', () => {
    for (const x of [null, undefined, 'x', 3, [], [ok]]) expect(parseSoloSubmit(x)).toBeNull();
  });
});

describe('name keys', () => {
  it('trims, collapses spaces and ignores case', () => {
    expect(soloKey('  Dũng   ĐẸP ')).toBe(soloKey('dũng đẹp'));
    expect(soloDisplay('  a   b ')).toBe('a b');
  });
});
