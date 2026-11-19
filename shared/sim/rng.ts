export type Rng = () => number;

/** Seeded PRNG; values in [0, 1). Copied from server/game/random.ts. */
export function mulberry32(seed: number): Rng {
  let s = seed | 0;
  return () => {
    const [value, next] = nextState(s);
    s = next;
    return value;
  };
}

/**
 * One step of `mulberry32` as a pure function of its integer state: the value in [0, 1) and the next state. Walking
 * it from a seed gives the same sequence as `mulberry32(seed)`, so a PRNG can live in plain data (the bots' state).
 */
export function nextState(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

/** Fisher–Yates on a copy; the input is left untouched. */
export function shuffle<T>(arr: readonly T[], random: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** FNV-1a 32-bit over `${seed >>> 0}|${key}`, as an unsigned integer. */
export function hashSeed(seed: number, key: string): number {
  const text = `${seed >>> 0}|${key}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Independent random stream for one purpose; see the stream-key table in the plan. */
export function stream(seed: number, key: string): Rng {
  return mulberry32(hashSeed(seed, key));
}
