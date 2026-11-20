import { describe, expect, it } from 'vitest';
import { memoryStore, webStore } from './storage';

/** A Storage-like object backed by a Map. */
function fakeLocalStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    map: m,
  };
}

const throwing = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('SecurityError'); },
};

describe('memoryStore', () => {
  it('reads back what was written and removes on null', () => {
    const s = memoryStore();
    expect(s.get('a')).toBeNull();
    s.set('a', '1');
    expect(s.get('a')).toBe('1');
    s.set('a', null);
    expect(s.get('a')).toBeNull();
  });

  it('starts from the given entries', () => {
    expect(memoryStore({ k: 'v' }).get('k')).toBe('v');
  });
});

describe('webStore', () => {
  it('reads, writes and removes through localStorage', () => {
    const ls = fakeLocalStorage();
    const s = webStore(() => ls);
    s.set('x', 'y');
    expect(ls.map.get('x')).toBe('y');
    expect(s.get('x')).toBe('y');
    s.set('x', null);
    expect(ls.map.has('x')).toBe(false);
  });

  it('behaves as empty and never throws when storage throws (private mode, blocked, full)', () => {
    const s = webStore(() => throwing);
    expect(() => s.set('x', 'y')).not.toThrow();
    expect(() => s.set('x', null)).not.toThrow();
    expect(s.get('x')).toBeNull();
  });

  it('behaves as empty when localStorage itself cannot be reached (node, sandboxed iframe)', () => {
    const s = webStore(() => { throw new Error('no localStorage'); });
    expect(s.get('x')).toBeNull();
    expect(() => s.set('x', 'y')).not.toThrow();
    // The default store works in node too, where there is no localStorage.
    const d = webStore();
    expect(() => d.set('x', 'y')).not.toThrow();
  });
});
