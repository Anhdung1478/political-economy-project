import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../../../shared/sim/config';
import { morningBrief, planCost, validatePlan } from '../../../../shared/sim/day';
import type { MorningBrief, MorningPlan } from '../../../../shared/sim/types';
import { transition } from '../../game/runStore';
import { gameAt } from '../Dev/gameAt';
import { dayTitle, hudMoney } from './copy';
import {
  affordablePlan, averageHint, avgOrderMl, bulletinRows, clampPrice, cupsFromTea, entryNote, hintLine, issueText, newsLine, planIntents,
  peekKeyAction, priceRange, ruleLines, samePlan, shelfOf, stepCount, stepTea, streetAverage, streetSummary,
} from './morning';
import { morningStreet } from './street';

const plan = (over: Partial<MorningPlan> = {}): MorningPlan => ({
  price: 30, tea: 'standard', teaMl: 5000, upgrade: null, toppings: { pearl: 8, jelly: 4, pudding: 4 }, ...over,
});

describe('price and stock steps', () => {
  it('caps the range at the ceiling and snaps to whole k', () => {
    expect(priceRange(null)).toEqual({ min: CONFIG.pricing.min, max: CONFIG.pricing.max, step: 1 });
    expect(priceRange(20).max).toBe(20);
    expect(clampPrice(27.4, null)).toBe(27);
    expect(clampPrice(35, 20)).toBe(20);
    expect(clampPrice(2, null)).toBe(CONFIG.pricing.min);
    expect(clampPrice(Number.NaN, null)).toBe(CONFIG.pricing.min);
  });

  it('steps tea on the 250 ml grid and never below zero', () => {
    expect(stepTea(5000, 1)).toBe(5250);
    expect(stepTea(5000, -4)).toBe(4000);
    expect(stepTea(5100, 0)).toBe(5000);
    expect(stepTea(250, -3)).toBe(0);
    expect(stepCount(2, -5)).toBe(0);
    expect(stepCount(2.6, 1)).toBe(4);
  });

  it('counts average cups from tea', () => {
    expect(avgOrderMl()).toBeCloseTo(350);   // 362.5 ml over ice, 300 ml for the 20% with no ice
    expect(cupsFromTea(3500)).toBe(10);
    expect(cupsFromTea(3499)).toBe(9);
    expect(cupsFromTea(0)).toBe(0);
  });
});

describe('shelf', () => {
  it('draws a bottle per litre, the last one partial, and jars filling up', () => {
    const s = shelfOf({ teaMl: 2500, toppings: { pearl: 10, jelly: 0, pudding: 40 } });
    expect(s.bottles).toEqual([1, 1, 0.5]);
    expect(s.moreBottles).toBe(0);
    expect(s.jars.map(j => j.fill)).toEqual([0.5, 0, 1]);
    const big = shelfOf({ teaMl: 10_250, toppings: { pearl: 0, jelly: 0, pudding: 0 } }, 8);
    expect(big.bottles).toHaveLength(8);
    expect(big.moreBottles).toBe(3);
  });
});

describe('planIntents', () => {
  it('sends only the fields that changed, in a fixed order', () => {
    const a = plan();
    expect(planIntents(a, a)).toEqual([]);
    const b = plan({ price: 25, teaMl: 6000, toppings: { pearl: 8, jelly: 6, pudding: 4 }, upgrade: 'machine' });
    expect(planIntents(a, b)).toEqual([
      { type: 'setPlanPrice', price: 25 },
      { type: 'setTeaMl', teaMl: 6000 },
      { type: 'setTopping', id: 'jelly', count: 6 },
      { type: 'setUpgrade', upgrade: 'machine' },
    ]);
    expect(samePlan(a, { ...a, toppings: { ...a.toppings } })).toBe(true);
  });

  it('brings the store draft to the edited plan', () => {
    let s = gameAt(7, 1, 'morning');
    const to = plan({ price: 26, tea: 'premium', upgrade: 'banner' });
    for (const i of planIntents(s.planDraft, to)) s = transition(s, i).state;
    expect(s.planDraft).toEqual(to);
  });
});

describe('bulletin', () => {
  it('day 1: no table, the day-1 hint, the free-market rule', () => {
    const b = morningBrief(gameAt(7, 1, 'morning').run);
    expect(bulletinRows(b)).toEqual([]);
    expect(hintLine(b)).toMatch(/Ngày đầu/);
    expect(ruleLines(b)[0]).toMatch(/Chợ tự do/);
    expect(dayTitle(b.theme, b.rules)).toEqual({ kicker: 'Ngày 1', emoji: '👻', title: 'Khai trương' });
  });

  it('day 2: yesterday\'s table, the newcomer and the plain note that the street cuts to its price', () => {
    const s = gameAt(7, 2, 'morning');
    const b = morningBrief(s.run);
    const rows = bulletinRows(b);
    expect(rows.find(r => r.you)?.name).toBe('Quán bạn');
    const tap = rows.find(r => r.id === 'tapdoan');
    expect(tap?.note).toEqual({ text: 'Mới mở', tone: 'info' });
    expect(tap?.price).toBe('—');
    for (const r of rows.filter(x => x.id !== 'tapdoan')) {
      expect(r.price).toMatch(/k$/);
      expect(r.sold).toMatch(/ ly$/);
    }
    const street = morningStreet(s.run);
    expect(street?.entrants.map(e => e.id)).toEqual(['tapdoan']);
    const note = entryNote(b, street!.entrants);
    expect(note).toContain('Chuỗi Tập Đoàn khai trương với giá');
    expect(note).toContain('trừ Quán Ông Cố Chấp');
    expect(note).toContain(`về bằng ${street!.entrants[0].price}k`);
    expect(hintLine(b)).toMatch(/^Hôm qua bạn bán \d+ ly, dùng [\d.]+ ml trà, \d+ trân châu, \d+ thạch, \d+ pudding\.$/);
  });

  it('day 3: the ceiling from the rules, in the title and the rule line', () => {
    const b = morningBrief(gameAt(7, 3, 'morning').run);
    expect(dayTitle(b.theme, b.rules).title).toBe(`Giá trần ${CONFIG.days[3].ceiling}k`);
    expect(ruleLines(b)[0]).toContain(`${CONFIG.days[3].ceiling}k`);
    expect(entryNote(b, [])).toBeNull();
  });

  it('day 5: rumor timing and the bus line from the brief', () => {
    const b = morningBrief(gameAt(7, 5, 'morning').run);
    const lines = ruleLines(b).join(' ');
    expect(lines).toContain(`giây ${CONFIG.rumor.inspectionTick / 10}`);
    expect(lines).toContain(`không có trạm ${b.bus!.without} khách, có trạm ${b.bus!.with} khách`);
  });

  it('notes sold out, unsold, resting and closed rows', () => {
    const base = morningBrief(gameAt(7, 2, 'morning').run);
    const b: MorningBrief = {
      ...base, day: 3,
      street: [
        { id: 'player', status: 'open', closePrice: 25, sold: 14, soldOut: true, unsold: null, closedOn: null },
        { id: 'batu', status: 'open', closePrice: 27, sold: 9, soldOut: false, unsold: 3, closedOn: null },
        { id: 'cochap', status: 'rested', closePrice: null, sold: 0, soldOut: false, unsold: 0, closedOn: null },
        { id: 'sinhvien', status: 'closed', closePrice: 24, sold: 4, soldOut: false, unsold: 8, closedOn: 2 },
        { id: 'giare', status: 'closed', closePrice: null, sold: 0, soldOut: false, unsold: 0, closedOn: 1 },
        { id: 'tapdoan', status: 'notYet', closePrice: null, sold: 0, soldOut: false, unsold: 0, closedOn: null },
      ],
    };
    const rows = bulletinRows(b);
    expect(rows.map(r => r.note?.text ?? null)).toEqual(['Bán hết', 'Ế 3 ly', 'Nghỉ bán', 'Vừa đóng', 'Đã đóng']);
    expect(rows.map(r => r.dim)).toEqual([false, false, false, false, true]);
  });
});

describe('news and issues', () => {
  it('writes each delayed effect with its numbers', () => {
    expect(newsLine({ day: 3, source: 'tab', cash: 30, rep: 3 })).toMatchObject({ effects: ['+30k', '+3 uy tín'] });
    expect(newsLine({ day: 3, source: 'cartelBreak', rep: -8 }).effects).toEqual(['−8 uy tín']);
    expect(newsLine({ day: 3, source: 'student', tempStaff: true }).effects).toEqual(['+1 người phụ hôm nay']);
    expect(newsLine({ day: 3, source: 'deliveryAd', adCustomers: 6 }).effects).toEqual(['+6 khách từ app']);
  });

  it('every issue has a sentence; the ceiling and credit numbers come from the day and config', () => {
    expect(issueText('ceiling', 20)).toContain('20k');
    expect(issueText('credit', null)).toContain(`${CONFIG.run.creditFloor}`.replace('-', '−'));
    for (const i of ['price', 'teaStep', 'toppingStep', 'negative', 'upgradeOwned'] as const) {
      expect(issueText(i, null).length).toBeGreaterThan(5);
    }
  });
});

describe('Mua vừa đủ tiền and the credit sentence', () => {
  const broke = () => {
    const run = gameAt(7, 3, 'morning').run;
    return { ...run, cash: 60, plan: { ...run.plan, teaMl: 5500, toppings: { pearl: 11, jelly: 8, pudding: 8 } } };
  };
  it('scales the stock down to what cash and credit allow, keeping the upgrade it can', () => {
    const run = broke();
    expect(validatePlan(run, run.plan)).toContain('credit');
    const fit = affordablePlan(run, run.plan);
    expect(validatePlan(run, fit)).toEqual([]);
    expect(fit.teaMl).toBeGreaterThan(0);
    expect(fit.teaMl).toBeLessThan(run.plan.teaMl);
    expect(fit.teaMl % CONFIG.supplies.teaStepMl).toBe(0);
    // One percent more stock would not fit: it is the most the money allows (to the 1% grid).
    expect(planCost(run, fit).cashAfter).toBeGreaterThanOrEqual(CONFIG.run.creditFloor);
    expect(affordablePlan(run, fit)).toBe(fit);
  });
  it('drops the upgrade only when even an empty shelf cannot pay for it', () => {
    const run = broke();
    const withUp = { ...run.plan, upgrade: 'machine' as const };
    expect(affordablePlan({ ...run, cash: 100 }, withUp).upgrade).toBe('machine');
    const poor = { ...run, cash: CONFIG.run.creditFloor + 10 };
    const plan2 = affordablePlan(poor, withUp);
    expect(plan2).toMatchObject({ upgrade: null, teaMl: expect.any(Number) });
    expect(validatePlan(poor, plan2)).toEqual([]);
  });
  it('does not tell a player with no upgrade to drop one', () => {
    expect(issueText('credit', null, CONFIG, false)).not.toContain('nâng cấp');
    expect(issueText('credit', null, CONFIG, true)).toContain('bỏ nâng cấp');
    expect(issueText('credit', null)).toContain('bỏ nâng cấp');
  });
});

describe('averageHint', () => {
  it('cites yesterday, and after the ceiling day the latest free day (R76)', () => {
    expect(averageHint(morningBrief(gameAt(7, 1, 'morning').run))).toBeNull();
    const d2 = averageHint(morningBrief(gameAt(7, 2, 'morning').run))!;
    expect(d2.text).toBe('Hôm qua cả phố (gồm quán bạn) trung bình');
    const b4 = morningBrief(gameAt(7, 4, 'morning').run);
    expect(b4.beforeCeiling).not.toBeNull();
    const h4 = averageHint(b4)!;
    expect(h4.text).toBe('Hôm kia, trước giá trần, cả phố trung bình');
    expect(h4.average).toBe(b4.beforeCeiling!.average);
    expect(h4.average).toBeGreaterThan(CONFIG.days[3].ceiling!); // not the 20k of the ceiling day
  });
});

describe('compact lines', () => {
  it('rounds big cash for the top bar', () => {
    expect(hudMoney(1326.5)).toBe('1.327k');
    expect(hudMoney(-1500)).toBe('−1.500k');
    expect(hudMoney(673.5)).toBe('673,5k');
  });

  it('sums the table of yesterday up in one line, and averages the whole street', () => {
    const b1 = morningBrief(gameAt(7, 1, 'morning').run);
    expect(streetSummary(b1)).toBeNull();
    expect(streetAverage(b1)).toBeNull();
    const b = morningBrief(gameAt(7, 2, 'morning').run);
    const me = b.street.find(r => r.id === 'player')!;
    expect(streetSummary(b)).toMatch(new RegExp(`^\\d+k – \\d+k · quán bạn ${me.closePrice}k, ${me.sold} ly$`));
    const xs = b.street.flatMap(r => (r.closePrice === null ? [] : [r.closePrice]));
    expect(streetAverage(b)).toBe(Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 2) / 2);
  });
});

describe('peekKeyAction', () => {
  const field = { tagName: 'INPUT' };
  it('H flips the plan, Esc only brings it back', () => {
    expect(peekKeyAction({ key: 'h' }, false)).toBe('toggle');
    expect(peekKeyAction({ key: 'H' }, true)).toBe('toggle');
    expect(peekKeyAction({ key: 'Escape' }, true)).toBe('show');
    expect(peekKeyAction({ key: 'Escape' }, false)).toBeNull();
    expect(peekKeyAction({ key: 'x' }, false)).toBeNull();
  });
  it('is not a shortcut while typing, with a modifier, held down or already handled', () => {
    expect(peekKeyAction({ key: 'h', target: field }, false)).toBeNull();
    expect(peekKeyAction({ key: 'h', target: { tagName: 'DIV', role: 'textbox' } }, false)).toBeNull();
    // the steppers are not text fields: H still works with one focused (the price starts focused)
    expect(peekKeyAction({ key: 'h', target: { tagName: 'DIV', role: 'spinbutton' } }, false)).toBe('toggle');
    expect(peekKeyAction({ key: 'h', target: { tagName: 'DIV', isContentEditable: true } }, false)).toBeNull();
    expect(peekKeyAction({ key: 'h', ctrlKey: true }, false)).toBeNull();
    expect(peekKeyAction({ key: 'h', repeat: true }, false)).toBeNull();
    expect(peekKeyAction({ key: 'h', defaultPrevented: true }, false)).toBeNull();
    expect(peekKeyAction({ key: 'Escape', target: field }, true)).toBe('show');
  });
});
