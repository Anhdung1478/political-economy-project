// Day 5 in the rush (spec §4 "Tin đồn", §9 day-5 props, §16.8–9; ruling R19) and the determinism of the whole engine
// with the player's price change and the rumor in play.
import { describe, expect, it } from 'vitest';
import {
  CLOSE, TRASH, about, at, cust, deepFreeze, deliver, input, make, ofType, playerShop, rules, runTo, shop, stock, street,
  type PlayerIn,
} from './rush.fixtures';
import { counterView, createRush, finishRush, step } from './rush';
import type { Action, AiShopState, K, RushState } from './types';

const DAY5 = { rules: rules(5) };
/** Bà Tư, Chuỗi GiáRẻ, Ông Cố Chấp, a resting Anh Lướt Sóng, Chuỗi Tập Đoàn; Sinh Viên is not on the street. */
const day5Ai = (): AiShopState[] => [shop('batu', 27), shop('giare', 22), shop('cochap', 30),
  shop('luotsong', null, { resting: true }), shop('tapdoan', 27)];
const rumorRows = (s: RushState) => s.shops.map(x => [x.id, x.rumorPenalty, x.certified, x.named]);
const day5 = (player: Partial<PlayerIn> = {}) => street(day5Ai(), [], player, DAY5);

describe('day 5: the temporary rumor penalty (§4 Tin đồn, R19)', () => {
  it('10 + 5 per skimp day for every shop selling today; Chuỗi GiáRẻ counts 4 days; the self-certified pay nothing', () => {
    expect(rumorRows(day5({ skimpDays: 1 }))).toEqual([
      ['batu', 10, false, false],
      ['giare', 30, false, false],
      ['cochap', 0, true, false],
      ['luotsong', 0, false, false], // resting: not on the board
      ['player', 15, false, false],
      ['tapdoan', 0, true, false],
    ]);
  });

  it('the player\'s penalty follows their skimp days, and a passed self-paid inspection waives it', () => {
    const player = (p: Partial<PlayerIn>) => rumorRows(day5(p)).find(r => r[0] === 'player');
    expect(player({ skimpDays: 0 })).toEqual(['player', 10, false, false]);
    expect(player({ skimpDays: 3 })).toEqual(['player', 25, false, false]);
    expect(player({ skimpDays: 1, selfCertified: true })).toEqual(['player', 0, true, false]);
  });

  it('there is no penalty and no badge on any other day', () => {
    const s = street(day5Ai(), [], { skimpDays: 4 }, { rules: rules(4) });
    for (const r of rumorRows(s)) expect(r.slice(1)).toEqual([0, false, false]);
  });

  it('customers judge the shop by rep minus the penalty; the shop\'s rep itself does not change', () => {
    // Player rep 50, penalty 10 until the inspection at 450 clears it.
    const s = street([], [
      cust(0, { arriveTick: 100, trust: 45 }), cust(1, { arriveTick: 100 }),
      cust(2, { arriveTick: 450, trust: 45 }), cust(3, { arriveTick: 450 }),
    ], {}, DAY5);
    const { events, state } = runTo(s);
    const verdict = (id: number) => ofType(about(events, id), 'customerConsider')[0].verdicts[0];
    expect(verdict(0)).toEqual({ shop: 'player', score10: null, reason: 'lowTrust' });
    expect(verdict(1)).toEqual({ shop: 'player', score10: 80, reason: 'chosen' }); // 400 − 300 + (40 − 50)·2
    expect(verdict(2)).toEqual({ shop: 'player', score10: 100, reason: 'chosen' });
    expect(verdict(3)).toEqual({ shop: 'player', score10: 80, reason: 'chosen' }); // one ahead
    expect(playerShop(state).rep).toBe(50);
  });
});

describe('day 5: the state inspection at second 45 (§4 Tin đồn, §16.9, R19)', () => {
  it('clears the shops with fewer than 2 skimp days, names the others, then lifts the rumor', () => {
    const { events, states } = runTo(day5({ skimpDays: 1 }), 451);
    expect(ofType(events, 'policy')).toEqual([
      { t: 450, type: 'policy', kind: 'inspection', certified: ['batu', 'player'], named: ['giare'] },
      { t: 450, type: 'policy', kind: 'rumorLifted' },
    ]);
    expect(rumorRows(states[449])).toEqual(rumorRows(day5({ skimpDays: 1 })));
    expect(rumorRows(states[450])).toEqual([
      ['batu', 0, true, false],
      ['giare', 30, false, true], // named: keeps its penalty to the end of the day
      ['cochap', 0, true, false],
      ['luotsong', 0, false, false],
      ['player', 0, true, false],
      ['tapdoan', 0, true, false],
    ]);
  });

  it('a player with 2 skimp days is named and keeps the penalty; one who passed their own inspection is not checked again', () => {
    const two = runTo(day5({ skimpDays: 2 }), 451);
    expect(ofType(two.events, 'policy')[0]).toMatchObject({ certified: ['batu'], named: ['giare', 'player'] });
    expect(playerShop(two.state)).toMatchObject({ rumorPenalty: 20, certified: false, named: true });
    const self = runTo(day5({ skimpDays: 1, selfCertified: true }), 451);
    expect(ofType(self.events, 'policy')[0]).toMatchObject({ certified: ['batu'], named: ['giare'] });
  });

  it('a player who closed early before 450 is still inspected (R20)', () => {
    const closed = (skimpDays: number) => runTo(day5({ skimpDays }), 451, { 100: [CLOSE] });
    const cleared = closed(1);
    expect(playerShop(cleared.state)).toMatchObject({ status: 'closedEarly', rumorPenalty: 0, certified: true });
    expect(ofType(cleared.events, 'policy')[0]).toMatchObject({ certified: ['batu', 'player'], named: ['giare'] });
    const named = closed(3);
    expect(playerShop(named.state)).toMatchObject({ status: 'closedEarly', rumorPenalty: 25, named: true });
    expect(ofType(named.events, 'policy')[0]).toMatchObject({ certified: ['batu'], named: ['giare', 'player'] });
  });

  it('a named shop still loses the customers who do not trust it after the inspection', () => {
    // Chuỗi GiáRẻ: rep 35 − 30 = 5 < trust 10. Bà Tư (rep 50, cleared) is chosen.
    const s = street(day5Ai(), [cust(0, { arriveTick: 460, trust: 10 })], {}, DAY5);
    const { events } = runTo(s, 461);
    const v = ofType(events, 'customerConsider')[0].verdicts;
    expect(v.find(x => x.shop === 'giare')).toEqual({ shop: 'giare', score10: null, reason: 'lowTrust' });
  });

  it('runs in the timeline phase: before customers walk in and arrive at 450', () => {
    const s = street([], [cust(0, { arriveTick: 450 }), cust(1, { arriveTick: 465 })], {}, DAY5);
    const { events } = runTo(s, 451);
    expect(at(events, 450).map(e => e.type))
      .toEqual(['policy', 'policy', 'customerEnter', 'customerConsider', 'customerJoin']);
  });

  it('happens once, on day 5 only', () => {
    const ai = [shop('batu', 28), shop('giare', 25), shop('cochap', 30), shop('luotsong', 31), shop('sinhvien', 31),
      shop('tapdoan', 27)];
    const five = finishRush(createRush(input({ seed: 2, rules: rules(5), ai })).state).events;
    expect(ofType(five, 'policy').map(e => [e.t, e.kind])).toEqual([[450, 'inspection'], [450, 'rumorLifted']]);
    const four = finishRush(createRush(input({ seed: 2, rules: rules(4), ai })).state).events;
    expect(ofType(four, 'policy')).toEqual([]);
  });
});

describe('day 5: scared customers (§16.8, R19)', () => {
  it('walk past every shop with the rumor bubble and never buy', () => {
    const s = street(day5Ai(), [cust(0, { arriveTick: 100, budget: 60, scared: true })], {}, DAY5);
    const { events, state } = runTo(s, 101);
    expect(about(events, 0).slice(1)).toEqual([
      { t: 100, type: 'customerConsider', customer: 0, reshop: false, chosen: null, verdicts: [
        { shop: 'batu', score10: null, reason: 'rumor' }, { shop: 'giare', score10: null, reason: 'rumor' },
        { shop: 'cochap', score10: null, reason: 'rumor' }, { shop: 'luotsong', score10: null, reason: 'rumor' },
        { shop: 'player', score10: null, reason: 'rumor' }, { shop: 'tapdoan', score10: null, reason: 'rumor' },
      ] },
      { t: 100, type: 'customerLeave', customer: 0, outcome: 'scared', emptyHanded: false },
    ]);
    expect(state.rt[0]).toMatchObject({ outcome: 'scared', eligible: false, visited: [], shop: null });
  });

  it('on seeded day-5 streets: about half the early crowd, none after 450, none of them served or queued', () => {
    for (const seed of [1, 2, 3]) {
      const ai = [shop('batu', 28), shop('giare', 25), shop('cochap', 30), shop('tapdoan', 27)];
      const { state, events } = finishRush(createRush(input({ seed, rules: rules(5), ai, adCustomers: 6 })).state);
      const scared = state.customers.filter(c => c.scared);
      const early = state.customers.filter(c => c.arriveTick < 450 && c.onlyShop === null);
      expect(scared.length).toBeGreaterThan(early.length / 4);
      expect(scared.length).toBeLessThan(early.length * 3 / 4);
      for (const c of scared) {
        expect(c.arriveTick).toBeLessThan(450);
        const mine = about(events, c.id);
        expect(mine.map(e => e.type)).toEqual(['customerEnter', 'customerConsider', 'customerLeave']);
        const consider = ofType(mine, 'customerConsider')[0];
        expect(consider.chosen).toBeNull();
        expect(consider.verdicts.every(v => v.reason === 'rumor' && v.score10 === null)).toBe(true);
        expect(state.rt[c.id]).toMatchObject({ outcome: 'scared', eligible: false, shop: null });
      }
    }
  });
});

describe('determinism with the price change and the rumor (§14)', () => {
  const setPrice = (price: K): Action => ({ type: 'setPrice', price });
  /** A plain bot: makes the order of the first customer at the counter, hands it over, and cuts to 26k at tick 200. */
  const bot = (s: RushState): Action[] => {
    const acts: Action[] = s.tick === 200 ? [setPrice(26)] : [];
    const c = s.player.craft;
    if (c.anim !== null || playerShop(s).status !== 'open') return acts;
    const first = counterView(s).first;
    if (c.cup === null) return first.length > 0 ? [...acts, ...make(first[0].order)] : acts;
    if (c.cup.teaMl > 0 && first.length > 0) return [...acts, deliver(first[0].customer)];
    return [...acts, TRASH];
  };
  const start = () => createRush(input({
    seed: 4, rules: rules(5), adCustomers: 6,
    ai: [shop('batu', 28), shop('giare', 25), shop('cochap', 30), shop('luotsong', 31), shop('tapdoan', 27)],
  }, { price: 31, stock: stock(3000, 8), skimpDays: 1, staff: true })).state;

  it('the same seed and the same actions give the same state and the same events', () => {
    // runTo deep-freezes every state before stepping it, so this also checks that `step` never writes to its input.
    const a = runTo(start(), Infinity, bot);
    const b = runTo(start(), Infinity, bot);
    expect(a.state.done).toBe(true);
    expect(ofType(a.events, 'shopPrice').filter(e => e.shop === 'player')).toEqual([
      { t: 200, type: 'shopPrice', shop: 'player', from: 31, to: 26 },
    ]);
    expect(ofType(a.events, 'customerServed').filter(e => e.shop === 'player').length).toBeGreaterThan(0);
    expect(ofType(a.events, 'policy')).toHaveLength(2);
    expect(b.events).toEqual(a.events);
    expect(b.state).toEqual(a.state);
  });

  it('step leaves a deep-frozen state untouched at the price change and at the inspection', () => {
    const run = runTo(start(), 451, bot);
    for (const t of [199, 449]) {
      const before = run.states[t];
      const copy = JSON.parse(JSON.stringify(before));
      const r = step(deepFreeze(before), t === 199 ? [setPrice(40)] : []);
      expect(r.events.some(e => e.type === (t === 199 ? 'shopPrice' : 'policy'))).toBe(true);
      expect(before).toEqual(copy);
    }
  });

  it('stepping to the end and finishing at once agree after a price change', () => {
    const script = { 120: [setPrice(25)] };
    const stepped = runTo(start(), Infinity, script);
    const half = runTo(start(), 121, script).state;
    const fast = finishRush(half);
    expect(fast.state).toEqual(stepped.state);
    expect(fast.events).toEqual(stepped.events.filter(e => e.t > 120));
  });
});
