import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../../../shared/sim/config';
import { craftInput, craftTick } from '../../../../shared/sim/rush';
import type { CraftState, Cup, Order } from '../../../../shared/sim/types';
import {
  buttonStates, bufferLabels, counterRow, fmtMl, handOver, inputOf, leaveKind, orderLabel, outcomeOf, patienceLook,
  patienceUsed, practiceLine, practiceNext, PRACTICE_ORDER, priceImpact, priceLines, projectCup, rejectText,
  stepProgress, stepTicks, stockView, type Departure, type LiveSlot,
} from './rush';

const empty = (): CraftState => ({ cup: null, anim: null, buffer: [] });
const stock = (teaMl = 5000, pearl = 10, jelly = 10, pudding = 10) => ({ teaMl, toppings: { pearl, jelly, pudding } });
const lit = (c: CraftState, s = stock(), closed = false) =>
  buttonStates(c, s, closed).filter(b => b.why === null).map(b => b.id);

/** Presses inputs in order at tick t on an idle-or-busy station (no ticking in between). */
function press(c: CraftState, ...ids: Parameters<typeof inputOf>[0][]): CraftState {
  let x = c;
  for (const id of ids) x = craftInput(x, inputOf(id), null, 0, false).craft;
  return x;
}
/** Runs the station to tick `to`. */
function runTo(c: CraftState, to: number): CraftState {
  let x = c;
  for (let t = 0; t <= to; t++) x = craftTick(x, null, t, false).craft;
  return x;
}

describe('craft buttons follow checkInput', () => {
  it('lights only the sizes on an empty counter, with a reason on the rest', () => {
    expect(lit(empty())).toEqual(['S', 'M', 'L']);
    const tea = buttonStates(empty(), stock(), false).find(b => b.id === 'tea')!;
    expect(tea.why).toBe('noCup');
    expect(tea.reason).toBe('Chưa có ly: chọn size trước');
  });

  it('judges against the projected cup: the next step is lit while earlier ones are queued', () => {
    const c = press(empty(), 'M');           // size running
    expect(lit(c)).toEqual(['ice']);
    const c2 = press(c, 'ice', 'tea');        // queued behind the size step
    expect(lit(c2)).toEqual(['pearl', 'jelly', 'pudding']);
    const c3 = press(c2, 'pearl');            // buffer full (3)
    expect(lit(c3)).toEqual([]);
    expect(buttonStates(c3, stock(), false).find(b => b.id === 'jelly')!.reason).toMatch(/bấm trước 3 bước/);
  });

  it('a topping already in the cup or queued is a duplicate, with its name', () => {
    const c = runTo(press(empty(), 'L', 'ice', 'tea'), 60);
    const c2 = press(c, 'jelly');
    const b = buttonStates(c2, stock(), false).find(x => x.id === 'jelly')!;
    expect(b.why).toBe('duplicate');
    expect(b.reason).toBe('Ly đã có thạch');
  });

  it('checks stock: tea for the projected size, toppings by portion; null stock is the practice cup', () => {
    const c = runTo(press(empty(), 'L', 'ice'), 30);
    expect(buttonStates(c, stock(400), false).find(b => b.id === 'tea')!.reason).toBe('Không đủ trà cho ly L');
    expect(buttonStates(c, null, false).find(b => b.id === 'tea')!.why).toBeNull();
    const poured = runTo(press(c, 'tea'), 60);
    expect(buttonStates(poured, stock(5000, 0), false).find(b => b.id === 'pearl')!.reason).toBe('Hết trân châu');
  });

  it('everything is dark after closing early', () => {
    expect(lit(empty(), stock(), true)).toEqual([]);
    expect(buttonStates(empty(), stock(), true)[0].reason).toBe('Quán đã đóng cửa');
  });

  it('explains step order in words that fit the cup', () => {
    const cup = projectCup(runTo(press(empty(), 'S', 'ice'), 20));
    expect(rejectText('order', { k: 'ice' }, cup)).toBe('Ly đã có đá');
    expect(rejectText('order', { k: 'size', size: 'M' }, cup)).toMatch(/Đang có ly/);
    expect(rejectText('order', { k: 'topping', id: 'pearl' }, cup)).toMatch(/Rót trà trước/);
    expect(rejectText('order', { k: 'tea' }, projectCup(press(empty(), 'S')))).toBe('Đổ đá trước đã');
  });
});

describe('projected cup and buffer', () => {
  it('folds the buffer into the cup, a size in the buffer starting a new one', () => {
    const c: CraftState = { cup: null, anim: { step: 'deliver', endsAt: 9 }, buffer: [{ k: 'size', size: 'S' }, { k: 'ice' }] };
    expect(projectCup(c)).toEqual({ size: 'S', iced: true, tea: false, toppings: [] });
    expect(bufferLabels(c)).toEqual(['Ly S', 'Đá']);
    expect(projectCup(empty())).toBeNull();
  });
});

describe('step timing', () => {
  it('has the spec durations, the machine halving the pour', () => {
    expect(stepTicks('size', 'M', false)).toBe(4);
    expect(stepTicks('tea', 'L', false)).toBe(20);
    expect(stepTicks('tea', 'L', true)).toBe(10);
    expect(stepTicks('topping', null, false)).toBe(6);
    expect(stepTicks('deliver', null, false)).toBe(4);
  });

  it('runs 0..1 over start..endsAt (R14)', () => {
    const anim = { step: 'tea' as const, endsAt: 36 };    // M tea, 16 ticks, started at 20
    expect(stepProgress(anim, 20, 'M', false)).toBe(0);
    expect(stepProgress(anim, 28, 'M', false)).toBe(0.5);
    expect(stepProgress(anim, 36, 'M', false)).toBe(1);
    expect(stepProgress(anim, 50, 'M', false)).toBe(1);
    expect(stepProgress(null, 0, null, false)).toBe(1);
  });
});

describe('the day-1 practice cup', () => {
  it('walks the order step by step, then asks for the hand-over', () => {
    let c = empty();
    expect(practiceNext(c, PRACTICE_ORDER)).toBe('M');
    c = press(c, 'M');
    expect(practiceNext(c, PRACTICE_ORDER)).toBe('ice');
    c = press(c, 'ice');
    expect(practiceNext(c, PRACTICE_ORDER)).toBe('tea');
    c = press(c, 'tea');
    expect(practiceNext(c, PRACTICE_ORDER)).toBe('pearl');
    c = press(c, 'pearl');
    expect(practiceNext(c, PRACTICE_ORDER)).toBe('wait');
    c = runTo(c, 80);
    expect(practiceNext(c, PRACTICE_ORDER)).toBe('deliver');
    expect(practiceLine('deliver', PRACTICE_ORDER)).toMatch(/Kéo ly/);
  });

  it('sends a wrong cup to the bin', () => {
    expect(practiceNext(press(empty(), 'L'), PRACTICE_ORDER)).toBe('trash');
    const wrongTop = runTo(press(empty(), 'M', 'ice', 'tea'), 40);
    expect(practiceNext(press(wrongTop, 'jelly'), PRACTICE_ORDER)).toBe('trash');
  });
});

describe('orders and hand-over', () => {
  const order: Order = { size: 'L', toppings: ['pearl', 'jelly'] };
  it('labels an order', () => {
    expect(orderLabel(order)).toBe('L · trân châu, thạch');
    expect(orderLabel({ size: 'S', toppings: [] })).toBe('S · không topping');
  });

  it('pays the order in full when right; 70% of the cheaper, floored, when wrong (41k → 31k cup → 21k)', () => {
    const right: Cup = { size: 'L', iced: true, teaMl: 500, toppings: ['jelly', 'pearl'] };
    expect(handOver(26, order, right)).toEqual({ correct: true, paid: 41, full: 41, cut: 0, cutLabel: null });
    const wrong: Cup = { size: 'M', iced: true, teaMl: 350, toppings: [] };
    const h = handOver(26, order, wrong);
    expect(h.correct).toBe(false);
    expect(h.paid).toBe(18);           // min(41, 26) = 26 → 18.2 → 18
    expect(h.cut).toBe(23);
    expect(h.cutLabel).toBe('−56%');
    expect(outcomeOf(false, 21, 30).cutLabel).toBe('−30%');
  });
});

describe('price change', () => {
  it('keeps confirm dark when unchanged, after the one change, off-range or above the ceiling (R20)', () => {
    expect(priceImpact(30, 30, 30, false, null)).toMatchObject({ kind: 'same', ok: false, issue: 'Giá chưa đổi' });
    expect(priceImpact(30, 30, 32, true, null).ok).toBe(false);
    expect(priceImpact(30, 30, 9, false, null).ok).toBe(false);
    expect(priceImpact(20, 20, 21, false, 20).issue).toBe('Giá trần hôm nay là 20k');
    expect(priceImpact(30, 30, 32, false, null)).toMatchObject({ kind: 'raise', ok: true, pct: 7 });
  });

  it('25k → 30k is exactly 20%, not gouging; 31k is', () => {
    expect(priceImpact(25, 25, 30, false, null).kind).toBe('raise');
    expect(priceImpact(25, 25, 31, false, null).kind).toBe('gouge');
    expect(priceLines(priceImpact(25, 25, 31, false, null))[0].text).toMatch(/chặt chém.*−5 uy tín/);
  });

  it('a cut past 20% scares (drop − 20%) × 2.5 of the customers; 60% scares everyone', () => {
    expect(priceImpact(30, 30, 24, false, null)).toMatchObject({ kind: 'cut', scareShare: 0 });     // exactly 20%
    expect(priceImpact(30, 30, 18, false, null)).toMatchObject({ kind: 'steep', scareShare: 0.5 }); // 40%
    expect(priceImpact(30, 30, 12, false, null).scareShare).toBe(1);                                // 60%
    expect(priceLines(priceImpact(30, 30, 18, false, null))[0].text).toMatch(/50% khách đa nghi/);
  });
});

describe('patience and stock', () => {
  it('uses the street thresholds for the face', () => {
    expect(patienceUsed(100, 0)).toBe(100 / CONFIG.rush.patienceTicks);
    expect(patienceUsed(-5, 0)).toBe(0);
    expect(patienceLook(0.05).mood).toBe('happy');
    expect(patienceLook(0.3).mood).toBe('neutral');
    expect(patienceLook(0.5)).toEqual({ mood: 'annoyed', clip: 'tap', tone: 'warn' });
    expect(patienceLook(0.75).clip).toBe('crossed');
    expect(patienceLook(0.95).mood).toBe('angry');
  });

  it('warns on low and out stock', () => {
    const v = stockView(stock(800, 0, 2, 9));
    expect(v.tea).toBe('low');
    expect(v.teaCups).toBe(2);
    expect(v.toppings.pearl.level).toBe('out');
    expect(v.toppings.jelly.level).toBe('low');
    expect(v.toppings.pudding.level).toBe('ok');
    expect(stockView(stock(200)).tea).toBe('out');
    expect(fmtMl(4250)).toBe('4,3 L');
    expect(fmtMl(750)).toBe('750 ml');
  });
});

describe('the counter row', () => {
  const o: Order = { size: 'M', toppings: [] };
  const live = (...ids: number[]): LiveSlot[] => ids.map(id => ({ customer: id, order: o, joinedTick: id }));
  const gone = (customer: number, index: number): Departure =>
    ({ customer, order: o, joinedTick: 0, index, kind: 'cheer', at: 0 });

  it('keeps who just left in their place; whoever moved up waits behind', () => {
    const r = counterRow(live(2, 3, 4, 5), [gone(1, 0)], 2);
    expect(r.items.map(i => i.customer)).toEqual([1, 2, 3, 4]);
    expect(r.items[0].leaving?.kind).toBe('cheer');
    expect(r.rest).toBe(3);   // 5 hidden for now, plus 2 beyond the counter
  });

  it('drops a departure once the customer is live again, and works with a short queue', () => {
    expect(counterRow(live(1), [gone(1, 0)], 0).items).toHaveLength(1);
    expect(counterRow(live(7), [gone(1, 3)], 0).items.map(i => i.customer)).toEqual([7, 1]);
    expect(counterRow([], [], 0)).toEqual({ items: [], rest: 0 });
  });

  it('names the kind of exit', () => {
    expect(leaveKind({ type: 'customerServed', correct: true })).toBe('cheer');
    expect(leaveKind({ type: 'customerServed', correct: false })).toBe('wrong');
    expect(leaveKind({ type: 'customerAbandon', cause: 'patience' })).toBe('angry');
    expect(leaveKind({ type: 'customerAbandon', cause: 'stockOut' })).toBe('gone');
  });
});
