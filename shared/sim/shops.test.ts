import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import {
  STREET, aiProfit, applyExits, clampAiPrice, earned, midRushPrice, morningPrices, restsToday,
} from './shops';
import type { AiShopId, AiShopState, Day, DayRules, K, RunFlags, RushShop, ShopDayResult } from './types';

type Entry = AiShopState['history'][number];
type PlayerEntry = { day: Day; closePrice: K; sold: number };

const rules = (day: Day, over: Partial<DayRules> = {}): DayRules => {
  const d = CONFIG.days[day];
  return { day, ceiling: d.ceiling, taxPerCup: d.taxPerCup, rumor: d.rumor, cartel: false,
    customerFactor: d.customerFactor, ...over };
};

const flags = (over: Partial<RunFlags> = {}): RunFlags => ({
  cartel: 'none', cartelBroken: false, shockTopping: false, blackMarket: false,
  taxEvaded: false, inspection: 'none', reporter: null, ...over,
});

const ai = (id: AiShopId, history: Entry[] = [], over: Partial<AiShopState> = {}): AiShopState => ({
  id, status: 'active', closedOn: null, todayPrice: null, resting: false, probeDir: -1, history, ...over,
});

const h = (day: Day, closePrice: K | null, sold: number, profit: K = 0): Entry =>
  ({ day, closePrice, sold, profit, rested: closePrice === null });

const p = (day: Day, closePrice: K, sold: number): PlayerEntry => ({ day, closePrice, sold });

const priceOf = (shops: AiShopState[], id: AiShopId) => shops.find(s => s.id === id)!.todayPrice;

/** Day-1 street. Earned = (close − 13) × sold: batu 168, giare 108, cochap 170, luotsong 176,
 *  sinhvien 126, player 270 → the player earned most. */
const day1Shops = (): AiShopState[] => [
  ai('batu', [h(1, 27, 12)]),
  ai('giare', [h(1, 22, 12)]),
  ai('cochap', [h(1, 30, 10)]),
  ai('luotsong', [h(1, 29, 11)]),
  ai('sinhvien', [h(1, 34, 6)]),
  ai('tapdoan', [], { status: 'notYet' }),
];
const day1Player = [p(1, 31, 15)];
/** The day-1 street without the entrant, to test each shop's own rule on day 2 apart from the entry reaction. */
const incumbents = (): AiShopState[] => day1Shops().filter(s => s.id !== 'tapdoan');

const AP = CONFIG.aiPricing;
const costOf = (id: AiShopId) => CONFIG.aiShops[id].cost;
const TAX = CONFIG.days[4].taxPerCup;

/** CONFIG with some `aiPricing` fields replaced. */
const withPricing = (over: Partial<typeof CONFIG.aiPricing>) => ({ ...CONFIG, aiPricing: { ...CONFIG.aiPricing, ...over } });

describe('STREET', () => {
  it('lists the slots: top row batu, giare, cochap, luotsong; bottom row sinhvien, player, tapdoan', () => {
    expect(STREET).toEqual(['batu', 'giare', 'cochap', 'luotsong', 'sinhvien', 'player', 'tapdoan']);
  });
});

describe('earned', () => {
  it('is (close − 13k) × sold, the same measure for every shop', () => {
    expect(earned(31, 15)).toBe(270);
    expect(earned(27, 12)).toBe(168);
    expect(earned(12, 5)).toBe(-5);
  });
});

describe('clampAiPrice', () => {
  it('keeps prices between cost + 1k and 50k on a free day', () => {
    expect(clampAiPrice('batu', 5, rules(1))).toBe(costOf('batu') + AP.clampMargin);
    expect(clampAiPrice('batu', 60, rules(1))).toBe(50);
    expect(clampAiPrice('batu', 27, rules(1))).toBe(27);
  });

  it('caps at the ceiling', () => {
    expect(clampAiPrice('batu', 25, rules(3))).toBe(20);
  });

  it('raises the floor by the tax on a tax day: cost + 5k + 1k', () => {
    expect(clampAiPrice('batu', 15, rules(4))).toBe(costOf('batu') + TAX + AP.clampMargin);
    expect(clampAiPrice('tapdoan', 10, rules(4))).toBe(costOf('tapdoan') + TAX + AP.clampMargin);
  });
});

describe('restsToday', () => {
  it('nobody rests on a free day', () => {
    const ids = Object.keys(CONFIG.aiShops) as AiShopId[];
    expect(ids.filter(id => restsToday(id, rules(1)))).toEqual([]);
  });

  it('under the 20k ceiling exactly Ông Cố Chấp, Lướt Sóng and Sinh Viên rest (20 < cost + `restMargin`)', () => {
    const ids = Object.keys(CONFIG.aiShops) as AiShopId[];
    expect(ids.filter(id => restsToday(id, rules(3)))).toEqual(['cochap', 'luotsong', 'sinhvien']);
    // Bà Tư sits on the edge: 20 is not below her cost + the margin.
    expect(costOf('batu') + AP.restMargin).toBe(20);
    expect(restsToday('batu', rules(3))).toBe(false);
  });
});

describe('morningPrices', () => {
  it('opens day 1 at the configured prices; Tập Đoàn is not there yet', () => {
    const shops = day1Shops().map(s => ({ ...s, history: [] }));
    const out = morningPrices(shops, [], rules(1), flags());
    expect(out.map(s => s.todayPrice)).toEqual(out.map(s => CONFIG.aiShops[s.id].openPrice));
    expect(out.map(s => s.todayPrice)).toEqual([30, 28, 28, 32, 34, null]);   // spec §4, the table of AI shops
    expect(out.find(s => s.id === 'tapdoan')!.status).toBe('notYet');
    expect(out.every(s => !s.resting)).toBe(true);
  });

  it('Bà Tư nudges her own close 1k toward the average of the others', () => {
    // others on day 1: 22, 30, 29, 34, player 31 → average 29.2 > 27 → 28
    expect(priceOf(morningPrices(incumbents(), day1Player, rules(2), flags()), 'batu')).toBe(28);
    // others 22 and 24 → average 23 < 27 → 26
    const out = morningPrices([ai('batu', [h(1, 27, 12)]), ai('giare', [h(1, 22, 12)])],
      [p(1, 24, 10)], rules(2), flags());
    expect(priceOf(out, 'batu')).toBe(26);
  });

  it('Chuỗi GiáRẻ undercuts the lowest other close by `giareUndercut`', () => {
    // others: 27, 30, 29, 34, 31 → 27 − the undercut
    expect(priceOf(morningPrices(incumbents(), day1Player, rules(2), flags()), 'giare')).toBe(27 - AP.giareUndercut);
  });

  it('Ông Cố Chấp always asks his one price', () => {
    expect(priceOf(morningPrices(incumbents(), [p(1, 15, 18)], rules(2), flags()), 'cochap')).toBe(AP.cochapPrice);
    expect(CONFIG.aiShops.cochap.openPrice).toBe(AP.cochapPrice);
  });

  it('Lướt Sóng copies whoever earned most yesterday, the player included', () => {
    expect(priceOf(morningPrices(incumbents(), day1Player, rules(2), flags()), 'luotsong')).toBe(31);
    // player sells 4 at 31: earned 72; Ông Cố Chấp (170) and Lướt Sóng (176) lead → Lướt Sóng keeps 29
    const quiet = morningPrices(incumbents(), [p(1, 31, 4)], rules(2), flags());
    expect(priceOf(quiet, 'luotsong')).toBe(29);
    // Ông Cố Chấp sells 12: earned 204 → copy 30
    const shops = incumbents().map(s => s.id === 'cochap' ? ai('cochap', [h(1, 30, 12)]) : s);
    expect(priceOf(morningPrices(shops, [p(1, 31, 4)], rules(2), flags()), 'luotsong')).toBe(30);
  });

  it('Sinh Viên starts by going down 3k, with no flip when there is no day before', () => {
    const out = morningPrices(incumbents(), day1Player, rules(2), flags());
    const sv = out.find(s => s.id === 'sinhvien')!;
    expect(sv.todayPrice).toBe(31);
    expect(sv.probeDir).toBe(-1);
  });

  it('Sinh Viên flips when it earned less on the last free day than on the one before', () => {
    // day 1: (34 − 13) × 10 = 210; day 2: (31 − 13) × 8 = 144 < 210 → flip up.
    // Day 3 rested under the ceiling and is skipped. Day 4: 31 + 3 = 34, + 3k tax pass-through = 37.
    const history = [h(1, 34, 10), h(2, 31, 8), h(3, null, 0, -100)];
    const out = morningPrices([ai('sinhvien', history)], [p(1, 30, 10), p(2, 30, 10), p(3, 20, 10)],
      rules(4), flags());
    expect(out[0].probeDir).toBe(1);
    expect(out[0].todayPrice).toBe(37);
  });

  it('Sinh Viên keeps its direction when it earned more', () => {
    // day 1: 210; day 2: (31 − 13) × 12 = 216 → keep going down: 31 − 3 + 3 = 31
    const history = [h(1, 34, 10), h(2, 31, 12), h(3, null, 0, -100)];
    const out = morningPrices([ai('sinhvien', history)], [p(1, 30, 10), p(2, 30, 10), p(3, 20, 10)],
      rules(4), flags());
    expect(out[0].probeDir).toBe(-1);
    expect(out[0].todayPrice).toBe(31);
  });

  it('Chuỗi Tập Đoàn opens on day 2 at the average of the street, rounded to 0.5k, − `tapdoanUndercut`', () => {
    // all six closes: 27 + 22 + 30 + 29 + 34 + 31 = 173 → 28.83 → 29, − the undercut
    const out = morningPrices(day1Shops(), day1Player, rules(2), flags());
    const td = out.find(s => s.id === 'tapdoan')!;
    expect(td.status).toBe('active');
    expect(td.todayPrice).toBe(29 - AP.tapdoanUndercut);
  });

  it('Chuỗi Tập Đoàn rounds to the nearest 0.5k, halves up', () => {
    const td = (others: K[]) => {
      const shops = [ai('tapdoan', [], { status: 'notYet' }), ...others.slice(1).map((c, i) =>
        ai((['batu', 'giare', 'cochap'] as AiShopId[])[i], [h(1, c, 10)]))];
      return priceOf(morningPrices(shops, [p(1, others[0], 10)], rules(2), flags()), 'tapdoan');
    };
    const u = AP.tapdoanUndercut;
    expect(td([28, 29])).toBe(28.5 - u);
    expect(td([28, 29, 29])).toBe(28.5 - u); // 28.67 → 28.5
    expect(td([28, 28, 28, 29])).toBe(28.5 - u); // 28.25 → 28.5 (half up)
    expect(td([28, 28, 28, 28])).toBe(28 - u);
  });

  it('agreed cartel: on day 2 all six shops ask exactly 36k, Tập Đoàn opens at 36k', () => {
    const out = morningPrices(day1Shops(), day1Player, rules(2, { cartel: true }), flags({ cartel: 'agreed' }));
    expect(out.map(s => s.todayPrice)).toEqual([36, 36, 36, 36, 36, 36]);
    expect(out.every(s => s.status === 'active')).toBe(true);
    // Sinh Viên applies no rule on a cartel day, so its direction stays.
    expect(out.find(s => s.id === 'sinhvien')!.probeDir).toBe(-1);
  });

  it('under the 20k ceiling Ông Cố Chấp, Lướt Sóng and Sinh Viên rest; the others are capped at 20k', () => {
    // day 2 repeats day 1; Tập Đoàn sold 18 at 27
    const shops = day1Shops().map(s => s.id === 'tapdoan'
      ? ai('tapdoan', [h(2, 27, 18)])
      : { ...s, history: [...s.history, { ...s.history[0], day: 2 as Day }] });
    const out = morningPrices(shops, [...day1Player, p(2, 31, 15)], rules(3), flags());
    expect(out.filter(s => s.resting).map(s => s.id)).toEqual(['cochap', 'luotsong', 'sinhvien']);
    expect(priceOf(out, 'cochap')).toBeNull();
    expect(priceOf(out, 'luotsong')).toBeNull();
    expect(priceOf(out, 'sinhvien')).toBeNull();
    expect(priceOf(out, 'batu')).toBe(20); // rule says 28
    expect(priceOf(out, 'giare')).toBe(20); // rule says 27 − the undercut
    expect(priceOf(out, 'tapdoan')).toBe(20); // rule says 29 − the undercut
  });

  it('morning of day 4 uses day-2 closes, not the capped day 3, then adds 3k tax pass-through', () => {
    const shops = [
      ai('batu', [h(1, 27, 12), h(2, 28, 12), h(3, 20, 12)]),
      ai('giare', [h(1, 22, 12), h(2, 25, 12), h(3, 18, 12)]),
    ];
    const player = [p(1, 31, 15), p(2, 30, 15), p(3, 20, 18)];
    const out = morningPrices(shops, player, rules(4), flags());
    // batu: own 28, others (25 + 30) / 2 = 27.5 → 27, + 3 = 30
    expect(priceOf(out, 'batu')).toBe(28 - AP.batuNudge + AP.taxPassThrough);
    // giare: min(28, 30) − the undercut, + 3
    expect(priceOf(out, 'giare')).toBe(28 - AP.giareUndercut + AP.taxPassThrough);
  });

  it('morning of day 4 on the agreed-cartel branch falls back to day-1 closes', () => {
    const shops = [
      ai('batu', [h(1, 27, 12), h(2, 36, 12), h(3, 20, 12)]),
      ai('giare', [h(1, 22, 12), h(2, 36, 12), h(3, 18, 12)]),
    ];
    const player = [p(1, 31, 15), p(2, 36, 15), p(3, 20, 18)];
    const out = morningPrices(shops, player, rules(4), flags({ cartel: 'agreed' }));
    // batu: own 27, others (22 + 31) / 2 = 26.5 → 26, + 3 = 29
    expect(priceOf(out, 'batu')).toBe(27 - AP.batuNudge + AP.taxPassThrough);
    // giare: min(27, 31) − the undercut, + 3
    expect(priceOf(out, 'giare')).toBe(27 - AP.giareUndercut + AP.taxPassThrough);
  });

  const day5Shops = () => [
    ai('batu', [h(1, 27, 12), h(2, 28, 12), h(3, 20, 12), h(4, 30, 12)]),
    ai('giare', [h(1, 22, 12), h(2, 25, 12), h(3, 18, 12), h(4, 29, 12)]),
    ai('luotsong', [h(1, 29, 11), h(2, 29, 11), h(3, 20, 12), h(4, 31, 5)]),
  ];
  const day5Player = (close4: K) => [p(1, 31, 15), p(2, 30, 15), p(3, 20, 18), p(4, close4, 15)];

  it('morning of day 5 takes the 3k pass-through back off the AI day-4 closes, not the player\'s (R7)', () => {
    const out = morningPrices(day5Shops(), day5Player(33), rules(5), flags());
    // day-4 closes become batu 27, giare 26, luotsong 28; the player stays 33.
    // batu: others (26 + 28 + 33) / 3 = 29 > 27 → 28
    expect(priceOf(out, 'batu')).toBe(28);
    // giare: min(27, 28, 33) − the undercut
    expect(priceOf(out, 'giare')).toBe(27 - AP.giareUndercut);
    // earned: batu 14 × 12 = 168, giare 13 × 12 = 156, luotsong 15 × 5 = 75, player 20 × 15 = 300 → copy 33
    expect(priceOf(out, 'luotsong')).toBe(33);
  });

  it('morning of day 5: a player day-4 close at the street minimum is read as is (R7)', () => {
    const out = morningPrices(day5Shops(), day5Player(25), rules(5), flags());
    // giare: min(27, 28, 25) − the undercut (taking 3k off the player too would start from 22)
    expect(priceOf(out, 'giare')).toBe(25 - AP.giareUndercut);
  });

  it('clamps the rule result', () => {
    // giare undercuts a 10k player: 7k → floor 11k
    const out = morningPrices([ai('giare', [h(1, 22, 12)])], [p(1, 10, 18)], rules(2), flags());
    expect(priceOf(out, 'giare')).toBe(11);
  });

  it('leaves closed shops closed, without a price', () => {
    const shops = [ai('batu', [h(1, 27, 0, -150), h(2, 27, 0, -150)], { status: 'closed', closedOn: 2, todayPrice: 27 }),
      ai('giare', [h(1, 22, 12), h(2, 22, 12)])];
    const out = morningPrices(shops, [p(1, 30, 10), p(2, 30, 10)], rules(3), flags());
    expect(out[0].status).toBe('closed');
    expect(out[0].todayPrice).toBeNull();
    expect(out[0].resting).toBe(false);
  });

  describe('entry reaction (§4 "Phản ứng khi có quán mới")', () => {
    /** The rule with its numbers spelled out, so the cases below do not move with the tuning. */
    const fixed = (over: Partial<typeof CONFIG.aiPricing> = {}) => withPricing({
      cochapPrice: 40, giareUndercut: 3, tapdoanUndercut: 4, entryReaction: { gap: 2, exempt: ['cochap'] }, ...over,
    });

    it('the morning Tập Đoàn opens, every incumbent but Ông Cố Chấp asks at most its open price + the gap', () => {
      // Tập Đoàn opens at 29 − 4 = 25 → cap 27. Own rules: batu 28, giare 24, luotsong 31, sinhvien 31.
      const out = morningPrices(day1Shops(), day1Player, rules(2), flags(), fixed());
      expect(priceOf(out, 'tapdoan')).toBe(25);
      expect(priceOf(out, 'batu')).toBe(27);
      expect(priceOf(out, 'giare')).toBe(24);
      expect(priceOf(out, 'luotsong')).toBe(27);
      expect(priceOf(out, 'sinhvien')).toBe(27);
      expect(priceOf(out, 'cochap')).toBe(40);   // not reacting (config)
      // The reaction does not touch Sinh Viên's direction.
      expect(out.find(s => s.id === 'sinhvien')!.probeDir).toBe(-1);
    });

    it('takes the gap and the shops that do not react from config', () => {
      // The configured numbers: Tập Đoàn opens at 29 − its undercut; Bà Tư's own rule says 28, Ông Cố Chấp stays.
      const { gap, exempt } = AP.entryReaction;
      expect(exempt).toEqual(['cochap']);
      const open = 29 - AP.tapdoanUndercut;
      const cfgOut = morningPrices(day1Shops(), day1Player, rules(2), flags());
      expect(priceOf(cfgOut, 'tapdoan')).toBe(open);
      expect(priceOf(cfgOut, 'batu')).toBe(Math.min(28, open + gap));
      expect(priceOf(cfgOut, 'cochap')).toBe(AP.cochapPrice);
      // Another gap, and nobody exempt.
      const out = morningPrices(day1Shops(), day1Player, rules(2),
        flags(), fixed({ entryReaction: { gap: 0, exempt: [] } }));
      expect(priceOf(out, 'batu')).toBe(25);
      expect(priceOf(out, 'cochap')).toBe(25);
      expect(priceOf(out, 'giare')).toBe(24);
    });

    it('does not apply on the cartel day: the cartel price wins', () => {
      const out = morningPrices(day1Shops(), day1Player, rules(2, { cartel: true }), flags({ cartel: 'agreed' }),
        withPricing({ entryReaction: { gap: 0, exempt: [] } }));
      expect(out.map(s => s.todayPrice)).toEqual([36, 36, 36, 36, 36, 36]);
    });

    it('does not apply once the entrant has opened: day 3 onwards is unchanged', () => {
      const shops = [
        ai('batu', [h(1, 27, 12), h(2, 28, 12), h(3, 20, 12)]),
        ai('tapdoan', [h(2, 15, 18), h(3, 20, 18)]),
      ];
      const out = morningPrices(shops, [p(1, 31, 15), p(2, 30, 15), p(3, 20, 18)], rules(4), flags());
      // batu: own 28, others (15 + 30) / 2 = 22.5 → 27, + 3 = 30; no cap at Tập Đoàn's close + 2k
      expect(priceOf(out, 'batu')).toBe(30);
    });

    it('caps after the tax pass-through and before the clamp', () => {
      // An entrant opening on day 4: Tập Đoàn = avg(28 batu, 30 player) − 4 = 25, + 3 = 28 → cap 30.
      // batu: own 28, others 30 → 29, + 3 = 32 → 30.
      const cfg = { ...fixed(), aiShops: { ...CONFIG.aiShops, tapdoan: { ...CONFIG.aiShops.tapdoan, firstDay: 4 as Day } } };
      const shops = [ai('batu', [h(1, 27, 12), h(2, 28, 12), h(3, 20, 12)]), ai('tapdoan', [], { status: 'notYet' })];
      const out = morningPrices(shops, [p(1, 31, 15), p(2, 30, 15), p(3, 20, 18)], rules(4), flags(), cfg);
      expect(priceOf(out, 'tapdoan')).toBe(28);
      expect(priceOf(out, 'batu')).toBe(30);
      // The clamp still applies to the capped price: Sinh Viên (floor 16) under an entrant at its floor of 12.
      const low = morningPrices([ai('sinhvien', [h(1, 20, 10)]), ai('tapdoan', [], { status: 'notYet' })],
        [p(1, 12, 10)], rules(2), flags(), fixed());
      expect(priceOf(low, 'tapdoan')).toBe(12);
      expect(priceOf(low, 'sinhvien')).toBe(16);   // rule 17, cap 14, floor 16
    });
  });

  it('does not change its input', () => {
    const shops = day1Shops();
    const before = JSON.stringify(shops);
    morningPrices(shops, day1Player, rules(2), flags());
    expect(JSON.stringify(shops)).toBe(before);
  });
});

const rushShop = (id: RushShop['id'], over: Partial<RushShop> = {}, ai: Partial<NonNullable<RushShop['ai']>> = {}):
  RushShop => ({
  id, slot: STREET.indexOf(id), status: 'open', grandOpening: false, price: 27, openPrice: 27, trail: [[0, 27]],
  rep: 50, rumorPenalty: 0, skimpDays: 0, certified: false, named: false, queue: [], sold: 0, revenue: 0,
  ai: { cost: 13, capacity: 20, cupsLeft: 20, ticksPerCup: 70, busy: 0, frozen: false, ...ai }, ...over,
});

describe('midRushPrice', () => {
  const at = (tick: number, sold: number, queue: number, over: Partial<RushShop> = {}, r = rules(1)) =>
    midRushPrice(rushShop('batu', { sold, queue: Array.from({ length: queue }, (_, i) => i), ...over }), tick, r);
  /** A shop stocking 100 cups, so the cups sold are the percent sold. */
  const at100 = (tick: number, sold: number, queue: number) =>
    midRushPrice(rushShop('batu', { sold, queue: Array.from({ length: queue }, (_, i) => i) },
      { capacity: 100, cupsLeft: 100 - sold }), tick, rules(1));
  /** A shop of the real street: `capacity` cups, `sold` of them gone, `queue` people waiting. */
  const real = (id: 'batu' | 'tapdoan', capacity: number, sold: number, queue: number, tick: number) =>
    midRushPrice(rushShop(id, { sold, queue: Array.from({ length: queue }, (_, i) => i) },
      { capacity, cupsLeft: capacity - sold }), tick, rules(2));

  it('raises 2k at tick 300 when 4 or more wait', () => {
    expect(at(300, 0, 4)).toBe(29);
    expect(at(300, 0, 3)).toBeNull();
  });

  it('raises 2k at tick 300 once 33% of the stock is sold (inclusive)', () => {
    expect(at100(300, 33, 1)).toBe(29);
    expect(at100(300, 32, 1)).toBeNull();
  });

  it('cuts 2k at tick 300 only with an empty queue and under 33% sold (strict)', () => {
    expect(at100(300, 32, 0)).toBe(25);
    expect(at100(300, 33, 0)).toBe(29); // exactly 33%: the raise wins
    expect(at100(300, 0, 1)).toBeNull(); // someone waits
    expect(at(300, 6, 0)).toBe(25); // 6 / 20 = 30%
  });

  it('uses 66% / 66% at tick 600', () => {
    expect(at100(600, 66, 0)).toBe(29);
    expect(at100(600, 65, 1)).toBeNull();
    expect(at100(600, 65, 0)).toBe(25);
    expect(at100(600, 0, 4)).toBe(29);
  });

  it('the thresholds are the most a shop can have sold: 4 and 8 of 12 cups at 7 s a cup, 6 and 12 of 18 at 5 s (§16 row 1)', () => {
    for (const id of ['batu', 'tapdoan'] as const) {
      const { capacity, ticksPerCup } = CONFIG.aiShops[id];
      for (const tick of [300, 600]) {
        const most = Math.floor(tick / ticksPerCup);
        expect(real(id, capacity, most, 1, tick)).toBe(29);        // selling flat out: up
        expect(real(id, capacity, most - 1, 1, tick)).toBeNull();  // one cup short, someone waits: stays
        expect(real(id, capacity, most - 1, 0, tick)).toBe(25);    // one cup short, nobody waits: down
      }
    }
  });

  it('does nothing at other ticks', () => {
    expect(at(450, 0, 4)).toBeNull();
    expect(at(0, 0, 0)).toBeNull();
  });

  it('never moves Ông Cố Chấp or Chuỗi GiáRẻ, nor the player', () => {
    for (const id of ['cochap', 'giare', 'player'] as const) {
      expect(midRushPrice(rushShop(id, { queue: [1, 2, 3, 4] }), 300, rules(1))).toBeNull();
    }
  });

  it('never moves a frozen (cartel) shop', () => {
    expect(midRushPrice(rushShop('batu', { price: 36, queue: [1, 2, 3, 4] }, { frozen: true }), 300,
      rules(2, { cartel: true }))).toBeNull();
  });

  it('does not move a shop that is not open', () => {
    expect(at(300, 20, 0, { status: 'soldOut' })).toBeNull();
  });

  it('clamps, and reports no change when the clamp eats the move', () => {
    expect(at(300, 0, 4, { price: 49 })).toBe(50);
    expect(at(300, 0, 4, { price: 20 }, rules(3))).toBeNull();
    const floor = costOf('batu') + AP.clampMargin;
    expect(at(300, 0, 0, { price: floor })).toBeNull();
    expect(at(300, 0, 0, { price: floor + TAX + 1 }, rules(4))).toBe(floor + TAX); // the tax day's floor: cost + 5 + 1
  });
});

const result = (id: ShopDayResult['id'], over: Partial<ShopDayResult>): ShopDayResult => ({
  id, status: 'open', openPrice: 27, closePrice: 27, trail: [[0, 27]], sold: 0, capacity: 12,
  soldOut: false, profit: null, revenue: 0, ...over,
});

describe('aiProfit', () => {
  it('sums the price at each sale, pays cost for unsold cups and the rent', () => {
    // 8 cups at 27 + 2 at 29 = 274; − cost × 10 sold − cost × 2 unsold − rent
    const r = result('batu', { sold: 10, revenue: 274, closePrice: 29, trail: [[0, 27], [300, 29]] });
    expect(aiProfit('batu', r, rules(1))).toBe(274 - 12 * costOf('batu') - AP.rent);
  });

  it('pays the tax on every cup sold', () => {
    // 18 × 25 = 450; − cost × 18 − 5 × 18 − rent
    const r = result('tapdoan', { sold: 18, capacity: 18, revenue: 450, soldOut: true });
    expect(aiProfit('tapdoan', r, rules(4))).toBe(450 - (costOf('tapdoan') + TAX) * 18 - AP.rent);
  });

  it('a resting day costs only the rent', () => {
    const r = result('cochap', { status: 'resting', openPrice: null, closePrice: null, trail: [] });
    expect(aiProfit('cochap', r, rules(3))).toBe(-AP.rent);
  });
});

describe('applyExits', () => {
  it('closes a shop after two losing days in a row', () => {
    const out = applyExits([ai('batu', [h(1, 27, 3, -20), h(2, 27, 4, -5)])], 2);
    expect(out[0].status).toBe('closed');
    expect(out[0].closedOn).toBe(2);
  });

  it('keeps a shop whose losses are not consecutive, or that broke even', () => {
    const out = applyExits([
      ai('batu', [h(1, 27, 3, -20), h(2, 27, 12, 5), h(3, 20, 10, -10)]),
      ai('giare', [h(2, 22, 12, -10), h(3, 22, 12, 0)]),
    ], 3);
    expect(out.map(s => s.status)).toEqual(['active', 'active']);
  });

  it('counts a resting day as a loss', () => {
    const out = applyExits([ai('cochap', [h(1, 30, 12, 50), h(2, 30, 5, -30), h(3, null, 0, -100)])], 3);
    expect(out[0].status).toBe('closed');
    expect(out[0].closedOn).toBe(3);
  });

  it('also runs after day 5', () => {
    const out = applyExits([ai('luotsong', [h(4, 30, 5, -1), h(5, 30, 6, -1)])], 5);
    expect(out[0].status).toBe('closed');
    expect(out[0].closedOn).toBe(5);
  });

  it('needs two days of history: Tập Đoàn cannot close after its first day', () => {
    const out = applyExits([ai('tapdoan', [h(2, 27, 3, -50)])], 2);
    expect(out[0].status).toBe('active');
  });

  it('leaves closed and not-yet-open shops alone', () => {
    const closed = ai('batu', [h(1, 27, 0, -150), h(2, 27, 0, -150)], { status: 'closed', closedOn: 2 });
    const notYet = ai('tapdoan', [], { status: 'notYet' });
    expect(applyExits([closed, notYet], 3)).toEqual([closed, notYet]);
  });
});
