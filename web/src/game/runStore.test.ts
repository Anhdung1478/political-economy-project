import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../../shared/sim/config';
import { planCost, quickFill } from '../../../shared/sim/day';
import { newRun, score } from '../../../shared/sim/run';
import type { Choice, RunState } from '../../../shared/sim/types';
import {
  KEYS, SAVE_VERSION, afterTransition, load, loadBest, recordBest, reduce, save, startRun, transition,
  type Intent, type RunStoreState,
} from './runStore';
import { memoryStore, webStore, type KeyValueStore } from './storage';

const fresh = () => startRun(7, 'run-7');
const run = (s: RunStoreState, ...intents: Intent[]) => intents.reduce(reduce, s);
const opened = () => run(fresh(), { type: 'open' });
const atCards = () => run(opened(), { type: 'endRush' });
/** Chooses A on every card of the afternoon. */
function chooseAll(s: RunStoreState, choice: Choice = 'A'): RunStoreState {
  while (s.run.phase === 'cards') s = reduce(s, { type: 'chooseCard', choice });
  return s;
}
const atReport = () => chooseAll(atCards());
/** Opens with the draft; when the draft is refused (credit), with an empty plan, which is always allowed. */
function openAnyway(s: RunStoreState): RunStoreState {
  const o = reduce(s, { type: 'open' });
  if (o !== s) return o;
  const empty = run(s, { type: 'setTeaMl', teaMl: 0 }, { type: 'setUpgrade', upgrade: null },
    ...(['pearl', 'jelly', 'pudding'] as const).map(id => ({ type: 'setTopping', id, count: 0 }) as Intent));
  const e = reduce(empty, { type: 'open' });
  if (e === empty) throw new Error('cannot open');
  return e;
}
/** Plays whole days until the end, opening with the draft each morning. */
function toEnd(s: RunStoreState): RunStoreState {
  for (let guard = 0; s.run.phase !== 'end'; guard++) {
    if (guard > 10) throw new Error('the run does not end');
    s = run(openAnyway(s), { type: 'endRush' });
    s = run(chooseAll(s), { type: 'nextDay' });
  }
  return s;
}

describe('startRun', () => {
  it('starts on the morning of day 1 with the run’s pre-filled plan as the draft', () => {
    const s = fresh();
    expect(s.run).toStrictEqual(newRun(7, 'run-7'));
    expect(s.planDraft).toStrictEqual(s.run.plan);
    expect(s.rush).toBeNull();
    expect(s.beforeOpen).toBeNull();
  });
});

describe('editing the draft plan', () => {
  it('sets the price, tea grade, tea ml, a topping and the upgrade', () => {
    const s = run(fresh(),
      { type: 'setPlanPrice', price: 34 }, { type: 'setTea', tea: 'premium' }, { type: 'setTeaMl', teaMl: 2000 },
      { type: 'setTopping', id: 'jelly', count: 9 }, { type: 'setUpgrade', upgrade: 'machine' });
    expect(s.planDraft).toMatchObject({ price: 34, tea: 'premium', teaMl: 2000, upgrade: 'machine' });
    expect(s.planDraft.toppings.jelly).toBe(9);
    // The run itself is untouched.
    expect(s.run.plan).toStrictEqual(fresh().run.plan);
  });

  it('clears the upgrade', () => {
    const s = run(fresh(), { type: 'setUpgrade', upgrade: 'staff' }, { type: 'setUpgrade', upgrade: null });
    expect(s.planDraft.upgrade).toBeNull();
  });

  it('applies the quick-fill levels to the draft', () => {
    const s0 = run(fresh(), { type: 'setUpgrade', upgrade: 'machine' });
    for (const level of ['low', 'mid', 'high'] as const) {
      const s = reduce(s0, { type: 'quickFill', level });
      const fill = quickFill(s0.run, level, s0.planDraft);
      expect(s.planDraft.teaMl).toBe(fill.teaMl);
      expect(s.planDraft.toppings).toStrictEqual(fill.toppings);
      expect(s.planDraft.upgrade).toBe('machine');
    }
  });

  it('ignores edits that are not numbers, out of the sets, negative or fractional where whole', () => {
    const s = fresh();
    const bad: Intent[] = [
      { type: 'setPlanPrice', price: Number.NaN }, { type: 'setPlanPrice', price: Infinity }, { type: 'setPlanPrice', price: -1 },
      { type: 'setTea', tea: 'gold' as never }, { type: 'setTeaMl', teaMl: -100 }, { type: 'setTeaMl', teaMl: Number.NaN },
      { type: 'setTopping', id: 'boba' as never, count: 3 }, { type: 'setTopping', id: 'pearl', count: -1 },
      { type: 'setTopping', id: 'pearl', count: 1.5 }, { type: 'setUpgrade', upgrade: 'jetpack' as never },
      { type: 'quickFill', level: 'max' as never }, { type: 'bogus' } as never,
    ];
    for (const i of bad) expect(reduce(s, i)).toBe(s);
  });

  it('ignores an upgrade the shop already owns', () => {
    const s = fresh();
    const owned: RunStoreState = { ...s, run: { ...s.run, upgrades: ['staff'] } };
    expect(reduce(owned, { type: 'setUpgrade', upgrade: 'staff' })).toBe(owned);
  });

  it('ignores plan edits outside the morning', () => {
    for (const s of [opened(), atCards(), atReport()]) {
      expect(reduce(s, { type: 'setPlanPrice', price: 34 })).toBe(s);
      expect(reduce(s, { type: 'quickFill', level: 'low' })).toBe(s);
    }
  });
});

describe('opening the shop', () => {
  it('opens with the draft: the rush starts, the plan is paid, the morning run is kept', () => {
    const s0 = run(fresh(), { type: 'setPlanPrice', price: 32 });
    const s = reduce(s0, { type: 'open' });
    expect(s.run.phase).toBe('rush');
    expect(s.run.plan.price).toBe(32);
    expect(s.run.cash).toBe(s0.run.cash - planCost(s0.run, s0.planDraft).total);
    expect(s.rush?.tick).toBe(0);
    expect(s.beforeOpen).toBe(s0.run);
  });

  it('ignores an invalid plan (no throw) and opening outside the morning', () => {
    const s = run(fresh(), { type: 'setPlanPrice', price: 5 }); // below the price range
    expect(reduce(s, { type: 'open' })).toBe(s);
    const r = opened();
    expect(reduce(r, { type: 'open' })).toBe(r);
  });
});

describe('the rush', () => {
  it('steps one tick per tick intent with the batch of actions, and hands back the events', () => {
    const s0 = opened();
    const r = transition(s0, { type: 'tick', actions: [{ type: 'craft', input: { k: 'size', size: 'M' } }] });
    expect(r.state.rush?.tick).toBe(1);
    expect(r.events.map(e => e.type)).toContain('rushStart');
    expect(r.events.some(e => e.type === 'craftStep')).toBe(true);
    expect(r.state.run).toBe(s0.run);
  });

  it('ignores ticks outside the rush and once the rush is done', () => {
    const s = fresh();
    expect(transition(s, { type: 'tick', actions: [] })).toEqual({ state: s, events: [] });
    const done = reduce(opened(), { type: 'closeEarly' });
    expect(reduce(done, { type: 'tick', actions: [] })).toBe(done);
  });

  it('closes early: the queued actions, the close, then the rest of the street at once', () => {
    const r = transition(opened(), { type: 'closeEarly', actions: [{ type: 'craft', input: { k: 'size', size: 'S' } }] });
    expect(r.state.rush?.done).toBe(true);
    expect(r.state.run.phase).toBe('rush');
    expect(r.events.some(e => e.type === 'craftStep')).toBe(true);
    expect(r.events.at(-1)).toMatchObject({ type: 'rushEnd', early: true });
    expect(r.state.rush?.shops.find(x => x.id === 'player')?.status).toBe('closedEarly');
  });

  it('ignores closing early outside the rush or when done', () => {
    const s = fresh();
    expect(reduce(s, { type: 'closeEarly' })).toBe(s);
    const done = reduce(opened(), { type: 'closeEarly' });
    expect(reduce(done, { type: 'closeEarly' })).toBe(done);
  });

  it('ends the rush mid-way (finishing the street first) and deals the afternoon cards', () => {
    const s1 = run(opened(), { type: 'tick', actions: [] }, { type: 'tick', actions: [] });
    const r = transition(s1, { type: 'endRush' });
    expect(r.state.run.phase).toBe('cards');
    expect(r.state.run.cards.length).toBeGreaterThan(0);
    expect(r.state.rush).toBeNull();
    expect(r.state.beforeOpen).toBeNull();
    expect(r.events.at(-1)).toMatchObject({ type: 'rushEnd', early: false });
  });

  it('ends a finished rush with no further events', () => {
    const done = reduce(opened(), { type: 'closeEarly' });
    const r = transition(done, { type: 'endRush' });
    expect(r.state.run.phase).toBe('cards');
    expect(r.events).toEqual([]);
  });

  it('ignores ending the rush outside the rush', () => {
    const s = atCards();
    expect(reduce(s, { type: 'endRush' })).toBe(s);
  });
});

describe('cards, report and the next day', () => {
  it('chooses each card, then the evening report follows', () => {
    const s0 = atCards();
    const s1 = reduce(s0, { type: 'chooseCard', choice: 'B' });
    expect(s1.run.cardIndex === 1 || s1.run.phase === 'report').toBe(true);
    const s = chooseAll(s1);
    expect(s.run.phase).toBe('report');
    expect(s.run.reports).toHaveLength(1);
  });

  it('ignores a choice that is not A or B, or outside the afternoon', () => {
    const s = atCards();
    expect(reduce(s, { type: 'chooseCard', choice: 'C' as never })).toBe(s);
    const m = fresh();
    expect(reduce(m, { type: 'chooseCard', choice: 'A' })).toBe(m);
  });

  it('moves to the next morning with yesterday’s plan as the draft', () => {
    const s = reduce(atReport(), { type: 'nextDay' });
    expect(s.run.phase).toBe('morning');
    expect(s.run.day).toBe(2);
    expect(s.planDraft).toStrictEqual(s.run.plan);
    expect(s.planDraft.upgrade).toBeNull();
  });

  it('ignores next day outside the report', () => {
    const s = fresh();
    expect(reduce(s, { type: 'nextDay' })).toBe(s);
  });

  it('plays to the end; the end ignores every game intent', () => {
    const s = toEnd(fresh());
    expect(s.run.phase).toBe('end');
    for (const i of [{ type: 'open' }, { type: 'nextDay' }, { type: 'endRush' }] as Intent[]) expect(reduce(s, i)).toBe(s);
  });
});

describe('a new run', () => {
  it('starts over from any phase', () => {
    const s = reduce(atReport(), { type: 'newRun', seed: 9, runId: 'run-9' });
    expect(s).toStrictEqual(startRun(9, 'run-9'));
  });

  it('ignores a seed that is not a whole number or an empty run id', () => {
    const s = fresh();
    expect(reduce(s, { type: 'newRun', seed: 1.5, runId: 'x' })).toBe(s);
    expect(reduce(s, { type: 'newRun', seed: 1, runId: '' })).toBe(s);
  });
});

describe('save and load', () => {
  const key = KEYS.solo;

  it('restores the morning, with the draft plan', () => {
    const store = memoryStore();
    const s = run(fresh(), { type: 'setPlanPrice', price: 36 });
    save(store, key, s);
    expect(load(store, key)).toStrictEqual(s);
  });

  it('a reload mid-rush returns to that morning with the plan filled in and nothing paid', () => {
    const store = memoryStore();
    const s0 = run(fresh(), { type: 'setPlanPrice', price: 34 }, { type: 'quickFill', level: 'high' });
    const s = run(s0, { type: 'open' }, { type: 'tick', actions: [] }, { type: 'tick', actions: [] });
    save(store, key, s);
    const back = load(store, key);
    expect(back?.run).toStrictEqual(s0.run);
    expect(back?.run.phase).toBe('morning');
    expect(back?.run.cash).toBe(fresh().run.cash);
    expect(back?.planDraft).toStrictEqual(s0.planDraft);
    expect(back?.rush).toBeNull();
    // And the shop opens again from it exactly as before.
    expect(reduce(back!, { type: 'open' }).run).toStrictEqual(reduce(s0, { type: 'open' }).run);
  });

  it('restores the afternoon cards, the report and the end', () => {
    const store = memoryStore();
    for (const s of [atCards(), reduce(atCards(), { type: 'chooseCard', choice: 'A' }), atReport(), toEnd(fresh())]) {
      save(store, key, s);
      expect(load(store, key)).toStrictEqual(s);
    }
  });

  it('keeps class runs to their session: a different session code discards the run', () => {
    const store = memoryStore();
    const k = KEYS.class('ABCD');
    save(store, k, atCards(), { sessionCode: 'ABCD' });
    expect(load(store, k, { sessionCode: 'ABCD' })?.run.phase).toBe('cards');
    expect(load(store, k, { sessionCode: 'WXYZ' })).toBeNull();
    // Discarded for good.
    expect(store.get(k)).toBeNull();
    expect(load(store, k, { sessionCode: 'ABCD' })).toBeNull();
  });

  it('a solo save (no session) is not taken for a class run, nor the reverse', () => {
    const store = memoryStore();
    save(store, 'k', fresh());
    expect(load(store, 'k', { sessionCode: 'ABCD' })).toBeNull();
    save(store, 'k', fresh(), { sessionCode: 'ABCD' });
    expect(load(store, 'k')).toBeNull();
  });

  it('names the keys per mode', () => {
    expect(KEYS).toMatchObject({ solo: 'pts.solo.run', best: 'pts.solo.best' });
    expect(KEYS.class('ABCD')).toBe('pts.class.ABCD.run');
  });

  it('treats missing, corrupt, foreign and old-version data as no save', () => {
    const good = JSON.parse(JSON.stringify({ v: SAVE_VERSION, sessionCode: null, run: fresh().run, planDraft: fresh().planDraft }));
    const cases: unknown[] = [
      '{not json', 'null', '42', '"text"', '[]',
      JSON.stringify({ ...good, v: SAVE_VERSION + 1 }), JSON.stringify({ ...good, v: 0 }),
      JSON.stringify({ ...good, run: { ...good.run, v: 2 } }),
      JSON.stringify({ ...good, run: { ...good.run, phase: 'rush' } }),
      JSON.stringify({ ...good, run: { ...good.run, day: 6 } }),
      JSON.stringify({ ...good, run: { ...good.run, cash: 'lots' } }),
      JSON.stringify({ ...good, run: { ...good.run, shops: null } }),
      JSON.stringify({ ...good, planDraft: { ...good.planDraft, toppings: null } }),
      JSON.stringify({ ...good, planDraft: undefined }),
    ];
    expect(load(memoryStore(), 'k')).toBeNull();
    for (const raw of cases) {
      const store = memoryStore({ k: raw as string });
      expect(load(store, 'k')).toBeNull();
    }
    expect(load(memoryStore({ k: JSON.stringify(good) }), 'k')).toStrictEqual(fresh());
  });

  it('survives storage that throws: saving is a no-op and loading finds nothing', () => {
    const broken = webStore(() => { throw new Error('blocked'); });
    expect(() => save(broken, key, atCards())).not.toThrow();
    expect(load(broken, key)).toBeNull();
    const raw: KeyValueStore = { get: () => { throw new Error('x'); }, set: () => { throw new Error('x'); } };
    expect(() => save(raw, key, atCards())).not.toThrow();
    expect(load(raw, key)).toBeNull();
    expect(() => recordBest(raw, KEYS.best, 10)).not.toThrow();
    expect(loadBest(raw, KEYS.best)).toBeNull();
  });
});

describe('best score', () => {
  it('keeps the highest total and ignores corrupt values', () => {
    const store = memoryStore();
    expect(loadBest(store, KEYS.best)).toBeNull();
    expect(recordBest(store, KEYS.best, 500)).toBe(500);
    expect(recordBest(store, KEYS.best, 300)).toBe(500);
    expect(recordBest(store, KEYS.best, 800.5)).toBe(800.5);
    expect(loadBest(store, KEYS.best)).toBe(800.5);
    store.set(KEYS.best, 'garbage');
    expect(loadBest(store, KEYS.best)).toBeNull();
    expect(recordBest(store, KEYS.best, -20)).toBe(-20);
  });
});

describe('afterTransition', () => {
  it('saves whenever the run changes (opening saves the morning) and on draft edits, not on rush ticks', () => {
    const writes: string[] = [];
    const store: KeyValueStore = { get: () => null, set: (k, v) => { if (v !== null) writes.push(k); } };
    const p = { key: 'k' };
    const s0 = fresh();
    const s1 = reduce(s0, { type: 'setPlanPrice', price: 34 });
    afterTransition(store, p, s0, s1);
    expect(writes).toHaveLength(1);
    const s1b = reduce(s1, { type: 'quickFill', level: 'low' });
    afterTransition(store, p, s1, s1b);
    expect(writes).toHaveLength(2);
    const s2 = reduce(s1b, { type: 'open' });
    afterTransition(store, p, s1b, s2);
    expect(writes).toHaveLength(3);
    const s3 = reduce(s2, { type: 'tick', actions: [] });
    afterTransition(store, p, s2, s3);
    expect(writes).toHaveLength(3);
    const s4 = reduce(s3, { type: 'endRush' });
    afterTransition(store, p, s3, s4);
    expect(writes).toHaveLength(4);
  });

  it('a reload after editing the morning plan comes back to the edited draft', () => {
    const store = memoryStore();
    const p = { key: KEYS.solo };
    const s0 = fresh();
    const s1 = reduce(s0, { type: 'setPlanPrice', price: 37 });
    afterTransition(store, p, s0, s1);
    const s2 = reduce(s1, { type: 'setTopping', id: 'pudding', count: 4 });
    afterTransition(store, p, s1, s2);
    const back = load(store, KEYS.solo);
    expect(back).toStrictEqual(s2);
    expect(back?.planDraft.price).toBe(37);
    expect(back?.planDraft.toppings.pudding).toBe(4);
  });

  it('records the solo best score when the run reaches its end, once', () => {
    const store = memoryStore();
    const p = { key: KEYS.solo, bestKey: KEYS.best };
    let s = fresh();
    while (s.run.phase !== 'end') {
      const before: RunState['phase'] = s.run.phase;
      const next = before === 'morning' ? openAnyway(s)
        : before === 'rush' ? reduce(s, { type: 'endRush' })
          : before === 'cards' ? reduce(s, { type: 'chooseCard', choice: 'A' }) : reduce(s, { type: 'nextDay' });
      afterTransition(store, p, s, next);
      if (next.run.phase !== 'end') expect(loadBest(store, KEYS.best)).toBeNull();
      s = next;
    }
    expect(loadBest(store, KEYS.best)).toBe(score(s.run).total);
    expect(load(store, KEYS.solo)?.run.phase).toBe('end');
  });

  it('writes nothing when there is no key (a preview that must not touch the saves)', () => {
    const store = memoryStore();
    const s0 = fresh();
    afterTransition(store, { key: null }, s0, reduce(s0, { type: 'open' }));
    expect(store.get(KEYS.solo)).toBeNull();
  });
});

describe('sim errors', () => {
  it('drops (and reports) only the actions that make a tick throw; the tick still runs', () => {
    const errors: string[] = [];
    const s0 = opened();
    const good = { type: 'craft', input: { k: 'size', size: 'M' } } as const;
    const r = transition(s0, { type: 'tick', actions: [null as never, good, { type: 'craft' } as never] }, CONFIG,
      (_e, ctx) => { errors.push(ctx); });
    expect(r.state.rush?.tick).toBe(1);
    expect(r.events.some(e => e.type === 'craftStep')).toBe(true);
    expect(errors[0]).toMatch(/tick failed/);
    expect(errors.filter(e => e.startsWith('action dropped'))).toHaveLength(2);
  });

  it('reports a throwing intent and ignores it', () => {
    const errors: unknown[] = [];
    const s0 = opened();
    const broken: RunStoreState = { ...s0, rush: { ...s0.rush!, shops: [] } };
    const r = transition(broken, { type: 'endRush' }, CONFIG, e => { errors.push(e); });
    expect(r.state).toBe(broken);
    expect(errors).toHaveLength(1);
  });

  it('stays silent for intents that are merely refused', () => {
    const errors: unknown[] = [];
    const s = fresh();
    transition(s, { type: 'nextDay' }, CONFIG, e => { errors.push(e); });
    transition(s, { type: 'setPlanPrice', price: Number.NaN }, CONFIG, e => { errors.push(e); });
    expect(errors).toHaveLength(0);
  });
});

it('uses the shared config by default', () => {
  expect(fresh().run.cash).toBe(CONFIG.run.startCash);
});
