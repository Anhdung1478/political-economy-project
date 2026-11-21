// A sliding-window counter per key (a socket, an IP, or one key for everybody). Memory stays bounded: stale keys are
// swept when the map grows.
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly maxKeys = 5000) {}

  /** Counts one hit for `key`; false when it is over the limit (the hit is not counted then). */
  allow(key: string, now = Date.now()): boolean {
    if (this.hits.size > this.maxKeys) this.sweep(now);
    const recent = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.every(t => now - t >= this.windowMs)) this.hits.delete(k);
    // Still too many live keys (an attack from many addresses): forget the oldest half rather than grow.
    if (this.hits.size > this.maxKeys) {
      let drop = this.hits.size - Math.floor(this.maxKeys / 2);
      for (const k of this.hits.keys()) { if (drop-- <= 0) break; this.hits.delete(k); }
    }
  }
}
