// Retries with a growing pause (min, 2×min, … up to max), for acks that may be lost and for a queue that could not
// be sent. Timers are injectable for tests.
export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (t: unknown) => void;
}
export const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: t => clearTimeout(t as ReturnType<typeof setTimeout>) };

/** The pause before retry number `attempt` (0 is the first retry). */
export const backoff = (attempt: number, min: number, max: number): number => Math.min(max, min * 2 ** attempt);

/** Runs `attempt` now; while it resolves false, runs it again after a growing pause. Returns the cancel function. */
export function retryUntilOk(
  attempt: () => Promise<boolean>, min: number, max: number, timers: Timers = realTimers,
): () => void {
  let cancelled = false;
  let timer: unknown = null;
  let n = 0;
  const go = () => {
    timer = null;
    void attempt().then(ok => {
      if (cancelled || ok) return;
      timer = timers.set(go, backoff(n++, min, max));
    });
  };
  go();
  return () => { cancelled = true; if (timer !== null) timers.clear(timer); };
}
