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

describe('name hygiene', () => {
  it('normalises to NFC, so composed and decomposed forms are the same name', () => {
    const decomposed = 'Du\u0303ng';
    expect(decomposed).not.toBe('D\u0169ng');
    expect(soloDisplay(decomposed)).toBe('D\u0169ng');
    expect(soloKey(decomposed)).toBe(soloKey('D\u0169ng'));
  });
  it('strips zero-width, bidi and control characters and refuses what is left empty', () => {
    expect(soloDisplay('A\u200Bn\u202E\u0007\n')).toBe('An');
    expect(soloKey('A\u200Bn')).toBe(soloKey('An'));
    for (const name of ['\u200B\u200D', '\u0000\u0001', ' \u200B ']) {
      expect(parseSoloSubmit({ name, score: 1, runId: 'r' })).toBeNull();
    }
    expect(parseSoloSubmit({ name: 'x\u200By', score: 1, runId: 'r' })?.name).toBe('xy');
  });
  it('counts the length after cleaning', () => {
    expect(parseSoloSubmit({ name: `${'a'.repeat(LIMITS.nickname)}\u200B`, score: 1, runId: 'r' })).not.toBeNull();
  });
  it('limits scores to a sane range', () => {
    expect(parseSoloSubmit({ name: 'a', score: 20001, runId: 'r' })).toBeNull();
    expect(parseSoloSubmit({ name: 'a', score: -10001, runId: 'r' })).toBeNull();
    expect(parseSoloSubmit({ name: 'a', score: 2700, runId: 'r' })).not.toBeNull();
  });
});

describe('name keys', () => {
  it('trims, collapses spaces and ignores case', () => {
    expect(soloKey('  Dũng   ĐẸP ')).toBe(soloKey('dũng đẹp'));
    expect(soloDisplay('  a   b ')).toBe('a b');
  });
});
