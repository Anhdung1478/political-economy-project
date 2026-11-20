// Real summaries from whole simulated runs must pass the server's checks unchanged.
import { describe, expect, it } from 'vitest';
import { parseDaySummary } from './protocol';
import { STRATEGIES, playRun } from './sim/autoplay';

describe('parseDaySummary on real runs', () => {
  it.each([1, 2, 3])('round-trips every day of seed %i under every strategy', seed => {
    for (const strategy of Object.values(STRATEGIES)) {
      const { reports } = playRun(seed, strategy);
      expect(reports.length).toBeGreaterThan(0);
      for (const r of reports) {
        const wire = JSON.parse(JSON.stringify(r.summary));
        expect(parseDaySummary(wire)).toEqual(r.summary);
      }
    }
  });
});
