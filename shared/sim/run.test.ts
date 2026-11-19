import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { shuffleSideDeck } from './cards';
import { quickFill } from './day';
import { newRun } from './run';

describe('newRun', () => {
  const run = newRun(42, 'run-1');

  it('starts on the morning of day 1 with the starting cash and reputation', () => {
    expect(run.v).toBe(1);
    expect(run.seed).toBe(42);
    expect(run.runId).toBe('run-1');
    expect(run.day).toBe(1);
    expect(run.phase).toBe('morning');
    expect(run.cash).toBe(300);
    expect(run.rep).toBe(50);
    expect(run.upgrades).toEqual([]);
    expect(run.skimpDays).toBe(0);
  });

  it('starts with no flags, effects, cards or reports', () => {
    expect(run.flags).toEqual({
      cartel: 'none', cartelBroken: false, shockTopping: false, blackMarket: false,
      taxEvaded: false, inspection: 'none', reporter: null,
    });
    expect(run.pending).toEqual([]);
    expect(run.sideDrawn).toEqual([]);
    expect(run.morningNews).toEqual([]);
    expect(run.today).toBeNull();
    expect(run.rushResult).toBeNull();
    expect(run.cards).toEqual([]);
    expect(run.cardIndex).toBe(0);
    expect(run.choices).toEqual([]);
    expect(run.cardRep).toEqual([]);
    expect(run.reports).toEqual([]);
    expect(run.outcome).toBeNull();
  });

  it('shuffles the side deck from the seed', () => {
    expect(run.sideDeck).toEqual(shuffleSideDeck(42));
    expect(newRun(43, 'run-1').sideDeck).toEqual(shuffleSideDeck(43));
  });

  it('opens the five day-1 AI shops; Chuỗi Tập Đoàn is not open yet', () => {
    expect(run.shops.map(s => [s.id, s.status])).toEqual([
      ['batu', 'active'], ['giare', 'active'], ['cochap', 'active'], ['luotsong', 'active'],
      ['sinhvien', 'active'], ['tapdoan', 'notYet'],
    ]);
    for (const s of run.shops) {
      expect(s.todayPrice).toBeNull();
      expect(s.resting).toBe(false);
      expect(s.history).toEqual([]);
      expect(s.closedOn).toBeNull();
    }
    expect(run.shops.find(s => s.id === 'sinhvien')!.probeDir).toBe(CONFIG.aiPricing.sinhvienFirstDir);
    expect(run.shops.find(s => s.id === 'sinhvien')!.probeDir).toBe(-1);
  });

  it('pre-fills day 1 at 30k, standard tea and the "mid" quick fill (§5)', () => {
    expect(run.plan).toEqual({ price: 30, tea: 'standard', upgrade: null, ...quickFill(run, 'mid') });
    expect(run.plan.teaMl).toBe(5500);
  });

  it('is plain data that survives a JSON round trip unchanged', () => {
    expect(JSON.parse(JSON.stringify(run))).toStrictEqual(run);
  });

  it('is deterministic', () => {
    expect(newRun(42, 'run-1')).toStrictEqual(run);
  });
});
