import { describe, expect, it } from 'vitest';
import { CONFIG, type SimConfig } from './config';
import { generateCustomers } from './customers';
import { capacityEstimate, quickFill } from './day';
import { newRun } from './run';
import type { MorningPlan, PendingEffect, RunState, UpgradeId } from './types';

const run = (over: Partial<RunState> = {}): RunState => ({ ...newRun(7, 'day-test'), ...over });
const plan = (r: RunState, upgrade: UpgradeId | null = null): MorningPlan => ({ ...r.plan, upgrade });
const temp = (day: RunState['day']): PendingEffect => ({ day, source: 'student', tempStaff: true });

describe('capacityEstimate', () => {
  it('gives ~18 cups with no upgrade, ~21 with the machine and ~10 more with staff (§4 Nâng cấp)', () => {
    const r = run();
    expect(capacityEstimate(r, plan(r))).toBe(18);
    expect(capacityEstimate(run({ upgrades: ['machine'] }), plan(r))).toBe(21);
    expect(capacityEstimate(r, plan(r, 'machine'))).toBe(21);
    expect(capacityEstimate(run({ upgrades: ['staff'] }), plan(r))).toBe(28);
    expect(capacityEstimate(r, plan(r, 'staff'))).toBe(28);
    expect(capacityEstimate(run({ upgrades: ['machine'] }), plan(r, 'staff'))).toBe(31);
  });

  it('ignores the banner', () => {
    const r = run();
    expect(capacityEstimate(run({ upgrades: ['banner'] }), plan(r, 'banner'))).toBe(18);
  });

  it("counts the student's helper on the morning it arrives, not on other days", () => {
    const r = run({ day: 2, pending: [temp(2)] });
    expect(capacityEstimate(r, plan(r))).toBe(28);
    const later = run({ day: 2, pending: [temp(3)] });
    expect(capacityEstimate(later, plan(later))).toBe(18);
  });

  it('derives from the config, not from fixed numbers', () => {
    const cfg: SimConfig = {
      ...CONFIG,
      craft: { ...CONFIG.craft, cupTicksEstimate: 45, staffTicks: 100 },
    };
    const r = run();
    expect(capacityEstimate(r, plan(r), cfg)).toBe(20);              // 900 / 45
    expect(capacityEstimate(r, plan(r, 'machine'), cfg)).toBe(24);   // 900 / (45 − 8) = 24.3
    expect(capacityEstimate(r, plan(r, 'staff'), cfg)).toBe(29);     // 20 + 900 / 100
  });
});

describe('quickFill', () => {
  // Average order: 362.5 ml of tea; per cup 0.6917 pearl and 0.4792 each of jelly and pudding (1–3 distinct
  // toppings 50/35/15 %, drawn without repetition at weights 2/1/1).
  it('fills ~10 cups for "low"', () => {
    expect(quickFill(run(), 'low')).toEqual({ teaMl: 3750, toppings: { pearl: 7, jelly: 5, pudding: 5 } });
  });

  it('fills ~15 cups for "mid"', () => {
    expect(quickFill(run(), 'mid')).toEqual({ teaMl: 5500, toppings: { pearl: 11, jelly: 8, pudding: 8 } });
  });

  it("fills today's capacity for \"high\"", () => {
    expect(quickFill(run(), 'high')).toEqual({ teaMl: 6750, toppings: { pearl: 13, jelly: 9, pudding: 9 } });
    const withMachine = run();
    const machine = { ...withMachine, plan: plan(withMachine, 'machine') };
    expect(quickFill(machine, 'high')).toEqual({ teaMl: 7750, toppings: { pearl: 15, jelly: 11, pudding: 11 } });
  });

  it('rounds tea up to the 250 ml step', () => {
    for (const level of ['low', 'mid', 'high'] as const) {
      expect(quickFill(run(), level).teaMl % CONFIG.supplies.teaStepMl).toBe(0);
    }
  });

  it('follows the order mix customers are actually generated with', () => {
    const cups = 10000;
    const cfg: SimConfig = { ...CONFIG, morning: { ...CONFIG.morning, quickFillCups: { low: 10, mid: cups } } };
    const fill = quickFill(run(), 'mid', cfg);
    let ml = 0;
    const portions = { pearl: 0, jelly: 0, pudding: 0 };
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const c of generateCustomers(seed, 1)) {
        n++;
        ml += CONFIG.supplies.sizeMl[c.order.size];
        for (const t of c.order.toppings) portions[t]++;
      }
    }
    expect(Math.abs(fill.teaMl / cups / (ml / n) - 1)).toBeLessThan(0.02);
    for (const t of ['pearl', 'jelly', 'pudding'] as const) {
      expect(Math.abs(fill.toppings[t] / cups - portions[t] / n)).toBeLessThan(0.02);
    }
  });
});
