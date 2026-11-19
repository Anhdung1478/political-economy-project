import { describe, expect, it } from 'vitest';
import { CARDS, applyChoice, cardsForDay, shuffleSideDeck } from './cards';
import { CONFIG } from './config';
import { shuffle, stream } from './rng';
import { newRun } from './run';
import { deepFreeze } from './rush.fixtures';
import type {
  CardId, Choice, Day, PendingEffect, RepItem, RunFlags, RunState, RushResult, SideCardId, StoryCardId, UpgradeId,
} from './types';

const SIDE: SideCardId[] = ['kol', 'tab', 'student', 'complaint', 'deliveryAd', 'scholarship'];
const STORY: StoryCardId[] = ['cartel', 'shockTopping', 'blackMarket', 'tax', 'inspection', 'reporter'];

const run = (over: Partial<RunState> = {}): RunState => ({ ...newRun(11, 'cards-test'), ...over });

/** A day result whose only meaningful number is the player's tax. */
const rushResult = (tax: number): RushResult => ({
  player: {
    revenue: 400, tax, cups: tax / 5, wrong: 0, staffCups: 0, walkouts: 0, missedNoStock: 0, trashed: 0,
    closePrice: 30, used: { teaMl: 0, toppings: { pearl: 0, jelly: 0, pudding: 0 } },
    left: { teaMl: 0, toppings: { pearl: 0, jelly: 0, pudding: 0 } }, gouged: false, brokeCartel: false,
  },
  shops: [], customers: 130, eligible: 100, emptyHanded: 0, taxFund: tax,
});

const ev = (reason: CardId, delta: number): RepItem => ({ reason, delta, when: 'evening' });

describe('CARDS', () => {
  it('has the twelve cards, six story and six side', () => {
    expect(Object.keys(CARDS).sort()).toEqual([...STORY, ...SIDE].sort());
    for (const id of STORY) expect(CARDS[id].kind).toBe('story');
    for (const id of SIDE) expect(CARDS[id].kind).toBe('side');
    for (const [id, card] of Object.entries(CARDS)) expect(card.id).toBe(id);
  });

  it('gives each card a speaker, one or two lines and two labelled options', () => {
    for (const card of Object.values(CARDS)) {
      expect(card.speaker.length).toBeGreaterThan(0);
      expect(card.lines.length).toBeGreaterThanOrEqual(1);
      expect(card.lines.length).toBeLessThanOrEqual(2);
      for (const line of card.lines) expect(line.length).toBeGreaterThan(0);
      for (const opt of [card.a, card.b]) {
        expect(opt.label.length).toBeGreaterThan(0);
        expect(opt.label).not.toMatch(/\d/);
        expect(new Set(opt.affects).size).toBe(opt.affects.length);
        for (const a of opt.affects) expect(['cash', 'rep', 'stock', 'law']).toContain(a);
      }
    }
  });

  it('shows the cash icon on every option that moves cash and the rep icon on every option that moves rep', () => {
    for (const id of [...STORY, ...SIDE]) {
      for (const choice of ['A', 'B'] as Choice[]) {
        // Inspection A passes at 0 skimp days and fails at 2; check both outcomes.
        for (const skimpDays of [0, 2]) {
          const before = run({ day: 3, skimpDays, rushResult: rushResult(65) });
          const after = applyChoice(before, id, choice);
          const added = after.pending.slice(before.pending.length);
          const cash = after.cash !== before.cash || added.some(p => p.cash !== undefined);
          const rep = after.cardRep.length > before.cardRep.length || added.some(p => p.rep !== undefined);
          const icons = CARDS[id][choice === 'A' ? 'a' : 'b'].affects;
          if (cash) expect(icons, `${id} ${choice}`).toContain('cash');
          if (rep) expect(icons, `${id} ${choice}`).toContain('rep');
        }
      }
    }
  });

  it('shows no icon on options that change nothing', () => {
    expect(CARDS.shockTopping.b.affects).toEqual([]);
    expect(CARDS.tax.a.affects).toEqual([]);
    expect(CARDS.student.b.affects).toEqual([]);
    expect(CARDS.deliveryAd.b.affects).toEqual([]);
    expect(CARDS.scholarship.b.affects).toEqual([]);
  });

  it('puts no number in any line or label except the cartel price, which comes from the config (R25)', () => {
    for (const card of Object.values(CARDS)) {
      for (const label of [card.a.label, card.b.label]) expect(label, card.id).not.toMatch(/\d/);
      for (const line of card.lines) {
        const numbers = line.match(/\d+/g) ?? [];
        if (card.id === 'cartel' && numbers.length > 0) expect(numbers).toEqual([`${CONFIG.cards.cartel.price}`]);
        else expect(numbers, `${card.id}: ${line}`).toEqual([]);
      }
    }
    expect(CARDS.cartel.lines.join(' ')).toContain(`${CONFIG.cards.cartel.price}k`);
  });
});

describe('shuffleSideDeck', () => {
  it('is a permutation of the six side cards drawn from the side-deck stream', () => {
    for (let seed = 0; seed < 20; seed++) {
      const deck = shuffleSideDeck(seed);
      expect([...deck].sort()).toEqual([...SIDE].sort());
      expect(deck).toEqual(shuffle(SIDE, stream(seed, 'side-deck')));
      expect(shuffleSideDeck(seed)).toEqual(deck);
    }
  });

  it('varies with the seed', () => {
    const orders = new Set(Array.from({ length: 20 }, (_, seed) => shuffleSideDeck(seed).join()));
    expect(orders.size).toBeGreaterThan(10);
  });
});

describe('cardsForDay', () => {
  const deck: SideCardId[] = ['student', 'kol', 'tab', 'complaint', 'deliveryAd', 'scholarship'];

  it('deals the side card first, then the story card, on days 1–3', () => {
    expect(cardsForDay(run({ day: 1, sideDeck: deck }))).toEqual(['student', 'cartel']);
    expect(cardsForDay(run({ day: 2, sideDeck: deck, sideDrawn: ['student'] }))).toEqual(['kol', 'shockTopping']);
    expect(cardsForDay(run({ day: 3, sideDeck: deck, sideDrawn: ['student', 'kol'] })))
      .toEqual(['tab', 'blackMarket']);
  });

  it('deals tax then inspection on day 4 and only the reporter on day 5', () => {
    expect(cardsForDay(run({ day: 4, sideDeck: deck }))).toEqual(['tax', 'inspection']);
    expect(cardsForDay(run({ day: 5, sideDeck: deck }))).toEqual(['reporter']);
  });

  it('takes the first undrawn card in deck order, not in drawn order', () => {
    expect(cardsForDay(run({ day: 2, sideDeck: deck, sideDrawn: ['kol'] }))).toEqual(['student', 'shockTopping']);
  });

  it('skips the student card while the player owns the staff upgrade, and keeps it in the deck', () => {
    const owned: UpgradeId[] = ['staff'];
    expect(cardsForDay(run({ day: 1, sideDeck: deck, upgrades: owned }))).toEqual(['kol', 'cartel']);
    expect(cardsForDay(run({ day: 2, sideDeck: deck, sideDrawn: ['kol'], upgrades: owned })))
      .toEqual(['tab', 'shockTopping']);
    expect(cardsForDay(run({ day: 2, sideDeck: deck, upgrades: ['machine'] }))).toEqual(['student', 'shockTopping']);
  });

  it('never repeats a side card over days 1–3 and never deals the student to a shop with staff', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const upgrades of [[], ['staff']] as UpgradeId[][]) {
        let r = { ...newRun(seed, 'deal'), upgrades };
        const dealt: CardId[] = [];
        for (const day of [1, 2, 3] as Day[]) {
          r = { ...r, day };
          const cards = cardsForDay(r);
          expect(cards).toHaveLength(2);
          dealt.push(cards[0]);
          r = applyChoice(r, cards[0], 'B');
        }
        expect(new Set(dealt).size).toBe(3);
        expect(r.sideDrawn).toEqual(dealt);
        if (upgrades.length > 0) expect(dealt).not.toContain('student');
        else expect(dealt).toEqual(r.sideDeck.slice(0, 3));
      }
    }
  });
});

interface Case {
  card: CardId; choice: Choice; day: Day; cash?: number; rep?: RepItem[];
  flags?: Partial<RunFlags>; pending?: PendingEffect[]; skimpDays?: number;
}

const cases: Case[] = [
  { card: 'cartel', choice: 'A', day: 1, flags: { cartel: 'agreed' } },
  { card: 'cartel', choice: 'B', day: 1, flags: { cartel: 'refused' }, rep: [ev('cartel', 3)] },
  { card: 'shockTopping', choice: 'A', day: 2, flags: { shockTopping: true } },
  { card: 'shockTopping', choice: 'B', day: 2 },
  { card: 'blackMarket', choice: 'A', day: 3, cash: 50, flags: { blackMarket: true },
    pending: [{ day: 4, source: 'blackMarket', rep: -8 }] },
  { card: 'blackMarket', choice: 'B', day: 3, rep: [ev('blackMarket', 2)] },
  { card: 'tax', choice: 'A', day: 4 },
  { card: 'tax', choice: 'B', day: 4, cash: 65, flags: { taxEvaded: true }, rep: [ev('tax', -10)] },
  { card: 'inspection', choice: 'A', day: 4, skimpDays: 0, cash: -40, flags: { inspection: 'pass' } },
  { card: 'inspection', choice: 'A', day: 4, skimpDays: 1, cash: -40, flags: { inspection: 'pass' } },
  { card: 'inspection', choice: 'A', day: 4, skimpDays: 2, cash: -40, flags: { inspection: 'fail' },
    rep: [ev('inspection', -15)] },
  { card: 'inspection', choice: 'A', day: 4, skimpDays: 4, cash: -40, flags: { inspection: 'fail' },
    rep: [ev('inspection', -15)] },
  { card: 'inspection', choice: 'B', day: 4, skimpDays: 3, flags: { inspection: 'wait' } },
  { card: 'reporter', choice: 'A', day: 5, flags: { reporter: 'A' } },
  { card: 'reporter', choice: 'B', day: 5, flags: { reporter: 'B' } },
  { card: 'kol', choice: 'A', day: 1, cash: -30, pending: [{ day: 2, source: 'kol', rep: 8 }] },
  { card: 'kol', choice: 'B', day: 1, rep: [ev('kol', -2)] },
  { card: 'tab', choice: 'A', day: 1, cash: -20, pending: [{ day: 3, source: 'tab', cash: 30, rep: 3 }] },
  { card: 'tab', choice: 'A', day: 3, cash: -20, pending: [{ day: 5, source: 'tab', cash: 30, rep: 3 }] },
  { card: 'tab', choice: 'B', day: 2, rep: [ev('tab', -2)] },
  { card: 'student', choice: 'A', day: 2, cash: -40, pending: [{ day: 3, source: 'student', tempStaff: true }] },
  { card: 'student', choice: 'B', day: 2 },
  { card: 'complaint', choice: 'A', day: 1, cash: -15, rep: [ev('complaint', 3)] },
  { card: 'complaint', choice: 'B', day: 1, rep: [ev('complaint', -3)] },
  { card: 'deliveryAd', choice: 'A', day: 3, cash: -40,
    pending: [{ day: 4, source: 'deliveryAd', adCustomers: 6 }] },
  { card: 'deliveryAd', choice: 'B', day: 3 },
  { card: 'scholarship', choice: 'A', day: 2, cash: -20, rep: [ev('scholarship', 5)] },
  { card: 'scholarship', choice: 'B', day: 2 },
];

describe('applyChoice', () => {
  // Earlier entries must be kept, so every case starts with one of each.
  const earlierRep: RepItem = { reason: 'kol', delta: -2, when: 'evening' };
  const earlierPending: PendingEffect = { day: 5, source: 'tab', cash: 30, rep: 3 };

  for (const c of cases) {
    const name = `${c.card} ${c.choice} on day ${c.day}${c.skimpDays === undefined ? '' : ` with ${c.skimpDays} skimp days`}`;
    it(`applies ${name}`, () => {
      const before = deepFreeze(run({
        day: c.day, cash: 100, skimpDays: c.skimpDays ?? 0, phase: 'cards',
        cardRep: [earlierRep], pending: [earlierPending], choices: [{ id: 'cartel', choice: 'B' }],
        rushResult: rushResult(65),
      }));
      const side = CARDS[c.card].kind === 'side';
      expect(applyChoice(before, c.card, c.choice)).toStrictEqual({
        ...before,
        cash: 100 + (c.cash ?? 0),
        cardRep: [earlierRep, ...(c.rep ?? [])],
        flags: { ...before.flags, ...c.flags },
        pending: [earlierPending, ...(c.pending ?? [])],
        choices: [{ id: 'cartel', choice: 'B' }, { id: c.card, choice: c.choice }],
        sideDrawn: side ? [c.card] : [],
      });
    });
  }

  it('refunds exactly the tax the player paid on day 4', () => {
    for (const tax of [0, 35, 120]) {
      const r = applyChoice(run({ day: 4, cash: 10, rushResult: rushResult(tax) }), 'tax', 'B');
      expect(r.cash).toBe(10 + tax);
    }
  });

  it('takes card money even below the credit floor (§16 row 14)', () => {
    const r = applyChoice(run({ day: 1, cash: CONFIG.run.creditFloor }), 'deliveryAd', 'A');
    expect(r.cash).toBe(CONFIG.run.creditFloor - 40);
  });

  it('leaves the card index alone (chooseCard moves it)', () => {
    const r = applyChoice(run({ day: 1, cards: ['kol', 'cartel'], cardIndex: 0 }), 'kol', 'A');
    expect(r.cardIndex).toBe(0);
    expect(r.cards).toEqual(['kol', 'cartel']);
  });

  it('survives a JSON round trip after every option', () => {
    for (const c of cases) {
      const r = applyChoice(run({ day: c.day, rushResult: rushResult(40) }), c.card, c.choice);
      expect(JSON.parse(JSON.stringify(r))).toStrictEqual(r);
    }
  });
});
