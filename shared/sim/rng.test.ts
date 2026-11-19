import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, nextState, shuffle, stream } from './rng';

const take = (rng: () => number, n: number) => Array.from({ length: n }, () => rng());

describe('mulberry32', () => {
  it('gives the same sequence for the same seed', () => {
    expect(take(mulberry32(42), 20)).toEqual(take(mulberry32(42), 20));
  });

  it('gives values in [0, 1)', () => {
    for (const x of take(mulberry32(7), 5000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('nextState', () => {
  /** The first n values of the state sequence that starts at s. */
  const walk = (s: number, n: number) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const [v, next] = nextState(s);
      out.push(v);
      s = next;
    }
    return out;
  };

  it('walks the same sequence as mulberry32 from the same seed', () => {
    for (const seed of [0, 1, 42, -7, 0xffffffff, hashSeed(3, 'bot/1')]) {
      expect(walk(seed, 30)).toEqual(take(mulberry32(seed), 30));
    }
  });

  it('is pure: the same state gives the same value and next state, an integer', () => {
    const [v, s] = nextState(123);
    expect(nextState(123)).toEqual([v, s]);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).not.toBe(123);
  });

  it('gives values in [0, 1)', () => {
    for (const x of walk(9, 5000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('hashSeed', () => {
  it('is a deterministic unsigned 32-bit integer', () => {
    const h = hashSeed(123, 'cust/1/0');
    expect(h).toBe(hashSeed(123, 'cust/1/0'));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });

  it('is FNV-1a over "seed|key" with the seed taken as unsigned', () => {
    const fnv = (s: string) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
      return h >>> 0;
    };
    expect(fnv('a')).toBe(0xe40c292c); // published FNV-1a 32-bit test vector
    expect(hashSeed(5, 'side-deck')).toBe(fnv('5|side-deck'));
    expect(hashSeed(-1, 'k')).toBe(fnv('4294967295|k'));
  });

  it('differs between keys and between seeds', () => {
    expect(hashSeed(1, 'cust/1/0')).not.toBe(hashSeed(1, 'cust/1/1'));
    expect(hashSeed(1, 'cust/1/0')).not.toBe(hashSeed(2, 'cust/1/0'));
  });
});

describe('stream', () => {
  it('gives the same sequence for the same seed and key', () => {
    expect(take(stream(99, 'strata/3/budget'), 50)).toEqual(take(stream(99, 'strata/3/budget'), 50));
  });

  it('gives a different sequence for a different key', () => {
    expect(take(stream(99, 'cust/1/0'), 10)).not.toEqual(take(stream(99, 'cust/1/1'), 10));
  });

  it('gives a different sequence for a different seed', () => {
    expect(take(stream(1, 'side-deck'), 10)).not.toEqual(take(stream(2, 'side-deck'), 10));
  });

  it('equals mulberry32 seeded by hashSeed', () => {
    expect(take(stream(7, 'ad/2/3'), 10)).toEqual(take(mulberry32(hashSeed(7, 'ad/2/3')), 10));
  });

  it('gives values in [0, 1)', () => {
    for (const x of take(stream(3, 'look/5/12'), 5000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('shuffle', () => {
  it('does not change the input array', () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = shuffle(input, stream(1, 'side-deck'));
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out).not.toBe(input);
  });

  it('returns a permutation of the input', () => {
    const out = shuffle([1, 2, 3, 4, 5, 6, 7, 8], stream(1, 'side-deck'));
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('is deterministic for the same stream', () => {
    const a = shuffle(['a', 'b', 'c', 'd', 'e', 'f'], stream(4, 'side-deck'));
    const b = shuffle(['a', 'b', 'c', 'd', 'e', 'f'], stream(4, 'side-deck'));
    expect(a).toEqual(b);
  });
});
