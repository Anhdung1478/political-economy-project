import { describe, expect, it } from 'vitest';
import {
  BUS, busAt, busX, catAt, hash01, motoAt, newBusState, newCat, newRider, newWalker, officerAt, planBus, ROUND,
  VAN, vanProgress,
} from './schedule';

describe('the bus plan', () => {
  const riders = (latest: number[]) => latest.map((l, id) => ({ id, latest: l }));

  it('lets every rider off at or before their latest, in turn, while the doors are open', () => {
    const visits = planBus(riders([100, 104, 130, 170, 400, 420, 700]));
    const offs = new Map<number, number>();
    for (const v of visits) {
      v.riders.forEach((r, i) => {
        offs.set(r.id, r.off);
        expect(r.off).toBeGreaterThanOrEqual(v.open + BUS.doors);
        expect(r.off).toBeLessThanOrEqual(v.close - BUS.doors);
        expect(r.spot).toBe(i);
        if (i > 0) expect(r.off - v.riders[i - 1].off).toBeCloseTo(BUS.stagger);
      });
      expect(v.open - v.arrive).toBe(BUS.driveIn);
      expect(v.depart - v.close).toBe(BUS.driveOut);
    }
    expect(offs.size).toBe(7);
    [100, 104, 130, 170, 400, 420, 700].forEach((l, id) => expect(offs.get(id)).toBeLessThanOrEqual(l));
  });

  it('groups riders within groupWindow of a visit\'s first into one bus; buses never overlap', () => {
    const visits = planBus(riders([100, 104, 130, 170, 400, 420, 700]));
    expect(visits.map(v => v.riders.map(r => r.id))).toEqual([[0, 1, 2, 3], [4, 5], [6]]);
    for (let i = 1; i < visits.length; i++) expect(visits[i].arrive).toBeGreaterThanOrEqual(visits[i - 1].depart + BUS.rest);
  });

  it('merges a visit that would come too soon after the last into it', () => {
    // With a short wait, 125 is past the first group's window but its bus would arrive before the first one left.
    const visits = planBus(riders([100, 125]), { ...BUS, groupWindow: 20 });
    expect(visits).toHaveLength(1);
    expect(visits[0].riders.map(r => r.id)).toEqual([0, 1]);
    expect(visits[0].riders[1].off).toBeLessThanOrEqual(125);
  });

  it('none for no riders; the plan does not depend on the input order', () => {
    expect(planBus([])).toEqual([]);
    const a = planBus(riders([300, 100, 200]));
    const b = planBus(riders([300, 100, 200]).reverse());
    expect(a).toEqual(b);
  });

  it('busAt: driving in, stopped with the doors opening and closing, driving out, gone', () => {
    const [v] = planBus(riders([200, 210]));
    const s = newBusState();
    expect(busAt([v], v.arrive - 1, s)).toBe(false);
    expect(busAt([v], v.arrive + 1, s)).toBe(true);
    expect(s.phase).toBe('in');
    expect(s.doors).toBe(0);
    busAt([v], v.open + 1.5, s);
    expect(s.phase).toBe('stop');
    expect(s.doors).toBeCloseTo(0.5);
    busAt([v], v.riders[0].off, s);
    expect(s.doors).toBe(1);
    busAt([v], v.close + 1, s);
    expect(s.phase).toBe('out');
    expect(busAt([v], v.depart, s)).toBe(false);
  });

  it('busX: from beyond the left end to its stop with the door at the stop, then off past the right end', () => {
    const s = newBusState();
    s.phase = 'in';
    s.k = 0;
    expect(busX(s, 300, 80, 110, 0, 400)).toBeLessThan(-110);
    s.k = 1;
    expect(busX(s, 300, 80, 110, 0, 400)).toBe(220);
    s.phase = 'stop';
    expect(busX(s, 300, 80, 110, 0, 400)).toBe(220);
    s.phase = 'out';
    s.k = 1;
    expect(busX(s, 300, 80, 110, 0, 400)).toBeGreaterThan(400);
  });
});

describe('the tax officer\'s round', () => {
  const stops = [{ x: 100, y: 10 }, { x: 300, y: 10 }, { x: 200, y: 90 }];
  const from = { x: -40, y: 10 };
  const to = { x: -40, y: 90 };
  const walk = 10;

  it('comes in at the start, stands at each stop in turn for its time, writing, then leaves', () => {
    const w = newWalker();
    expect(officerAt(stops, from, to, walk, ROUND.start - 1, w)).toBe(false);
    expect(officerAt(stops, from, to, walk, ROUND.start + 1, w)).toBe(true);
    expect(w.walking).toBe(true);
    expect(w.facing).toBe(1);
    // Walk to the first stop: 140 units at 0.55 × 10 a tick.
    const reach = ROUND.start + 140 / (walk * ROUND.speed);
    officerAt(stops, from, to, walk, reach + 1, w);
    expect(w.walking).toBe(false);
    expect(w.at).toBe(0);
    expect(w.x).toBe(100);
    officerAt(stops, from, to, walk, reach + ROUND.stand + 1, w);
    expect(w.walking).toBe(true);
    // Visits stops in order.
    const seen: number[] = [];
    for (let t = ROUND.start; t < ROUND.start + 400; t += 1) {
      if (officerAt(stops, from, to, walk, t, w) && !w.walking && seen[seen.length - 1] !== w.at) seen.push(w.at);
    }
    expect(seen.slice(0, 3)).toEqual([0, 1, 2]);
  });

  it('is off the street for a pause between rounds', () => {
    const w = newWalker();
    let off = 0;
    for (let t = ROUND.start; t < ROUND.start + 900; t++) if (!officerAt(stops, from, to, walk, t, w)) off++;
    expect(off).toBeGreaterThan(ROUND.pause / 2);
  });
});

describe('the loudspeaker van', () => {
  it('is on the street around the inspection, crawling past the middle as it speaks', () => {
    expect(vanProgress(450, 450 - VAN.before - 1)).toBe(-1);
    expect(vanProgress(450, 450 + VAN.after)).toBe(-1);
    const mid = vanProgress(450, 450 - VAN.before + (VAN.before + VAN.after) / 2);
    expect(mid).toBeCloseTo(0.5, 5);
    // Slower in the middle than at the start: progress per tick.
    const step = (t: number) => vanProgress(450, t + 1) - vanProgress(450, t);
    const t0 = 450 - VAN.before;
    expect(step(t0 + (VAN.before + VAN.after) / 2 - 0.5)).toBeLessThan(step(t0 + 1));
    let last = -1;
    for (let t = t0; t < 450 + VAN.after; t++) {
      const k = vanProgress(450, t);
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
    }
  });
});

describe('ambience on the wall clock', () => {
  it('motorbikes: deterministic, ride across on the half of the road their direction keeps to', () => {
    const a = newRider();
    const b = newRider();
    let seen = 0;
    for (let ms = 0; ms < 60_000; ms += 250) {
      const on = motoAt(ms, 0, 0, 400, 200, 9000, a);
      expect(motoAt(ms, 0, 0, 400, 200, 9000, b)).toBe(on);
      if (!on) continue;
      seen++;
      expect(a).toEqual(b);
      expect(a.half).toBe(a.dir > 0 ? 1 : 0);
      expect(a.x).toBeGreaterThanOrEqual(-60 - 1e-9);
      expect(a.x).toBeLessThanOrEqual(460 + 1e-9);
    }
    expect(seen).toBeGreaterThan(5);
  });

  it('the cat walks, sits, licks a paw and walks on, within its rooftop line', () => {
    const c = newCat();
    const poses = new Set<string>();
    for (let ms = 0; ms < 41_000; ms += 100) {
      if (!catAt(ms, 50, 350, 41_000, c)) continue;
      poses.add(c.pose);
      expect(c.x).toBeGreaterThanOrEqual(50 - 1e-9);
      expect(c.x).toBeLessThanOrEqual(350 + 1e-9);
    }
    expect([...poses].sort()).toEqual(['lick', 'sit', 'walk']);
  });

  it('hash01 is in 0..1 and spread', () => {
    const v = Array.from({ length: 1000 }, (_, i) => hash01(i));
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...v)).toBeLessThan(1);
    expect(v.filter(x => x < 0.5).length).toBeGreaterThan(400);
  });
});
