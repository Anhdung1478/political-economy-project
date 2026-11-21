// The lesson texts, the report rows and the end-screen lessons (Task 21), from hand-made reports and from real runs.
import { describe, expect, it } from 'vitest';
import { playRun, STRATEGIES, storyCombos } from '../../../../shared/sim/autoplay';
import { CONFIG } from '../../../../shared/sim/config';
import { report as fixtureReport, shopRow } from '../../../../shared/sim/day.fixtures';
import { ending } from '../../../../shared/sim/run';
import type { DayReport, RunState } from '../../../../shared/sim/types';
import {
  choiceLessons, converged, convergence, exitMoral, lessonText, movesSentence, openClose, priceMoves, shopExits,
} from './lessons';
import {
  cashBefore, customerRows, meterValue, moneyRows, priceScale, repLabel, repSteps, skimpTrade, streetRows, trailPath,
} from './report';

const flags = (over: Partial<RunState['flags']> = {}): RunState['flags'] => ({
  cartel: 'refused', cartelBroken: false, shockTopping: false, blackMarket: false, taxEvaded: false,
  inspection: 'none', reporter: null, ...over,
});

const combo = (id: string) => {
  const s = storyCombos(STRATEGIES.reasonable).find(x => x.id === id);
  if (s === undefined) throw new Error(id);
  return s;
};

describe('convergence (day 1)', () => {
  it('counts the shops that moved and the spread around the mean at open and close', () => {
    const c = convergence([
      { trail: [[0, 28], [300, 30]] },
      { trail: [[0, 34], [300, 31], [600, 30]] },
      { trail: [[0, 30]] },
      { trail: [] },
    ]);
    expect(c).toEqual({ shops: 3, changed: 2, openMean: 30.7, closeMean: 30, openSpread: 2.2, closeSpread: 0 });
  });
  it('reads open and close from the trail', () => {
    expect(openClose({ trail: [[0, 30], [450, 27]] })).toEqual({ open: 30, close: 27 });
    expect(openClose({ trail: [] })).toBeNull();
  });
  it('is empty-safe', () => {
    expect(convergence([])).toMatchObject({ shops: 0, changed: 0, openSpread: 0 });
  });
});

describe('lesson texts', () => {
  const day1 = (): DayReport => {
    const r = fixtureReport(1, 30, [
      shopRow('batu', 30, 10, 12, { trail: [[0, 30], [300, 29]] }),
      shopRow('sinhvien', 31, 10, 12, { openPrice: 34, trail: [[0, 34], [300, 31]] }),
      shopRow('player', 30, 14, 0),
    ]);
    return { ...r, lesson: { id: 'freeMarket', data: { openMin: 30, openMax: 34, closeMin: 29, closeMax: 31 } } };
  };

  it('day 1 quotes the ranges and a convergence measure that moves', () => {
    const t = lessonText(day1(), { flags: flags() });
    expect(t.hand).toBe('invisible');
    expect(t.story[0]).toBe('Sáng nay giá trên phố từ 30k đến 34k. Đến cuối trưa còn từ 29k đến 31k.');
    expect(t.title).toContain('tự tìm về một mức');
    expect(t.story[1]).toContain('2/3 quán tự đổi giá giữa trưa');
    expect(t.story[1]).toContain('±1,8k lúc mở cửa, còn ±0,7k lúc đóng cửa');
    expect(t.stats.map(s => s.value)).toContain('2/3');
  });

  it('day 1: the convergence threshold', () => {
    expect(converged({ openSpread: 1.8, closeSpread: 1.3 })).toBe(true);
    expect(converged({ openSpread: 1.8, closeSpread: 1.6 })).toBe(false);
    expect(converged({ openSpread: 2.0, closeSpread: 1.75 })).toBe(false);
    expect(converged({ openSpread: 1.8, closeSpread: 2.3 })).toBe(false);
    expect(converged({ openSpread: 0.3, closeSpread: 0 })).toBe(true);
  });

  it('day 1 when prices spread out: says who moved, no "còn", no "chụm lại", softer title', () => {
    const r = fixtureReport(1, 30, [
      shopRow('batu', 34, 12, 12, { openPrice: 30, soldOut: true, trail: [[0, 30], [300, 34]] }),
      shopRow('giare', 28, 6, 12, { trail: [[0, 28]] }),
      shopRow('sinhvien', 32, 4, 12, { openPrice: 34, trail: [[0, 34], [300, 32]] }),
      shopRow('player', 30, 14, 0),
    ]);
    const t = lessonText({ ...r, lesson: { id: 'freeMarket', data: { openMin: 28, openMax: 34, closeMin: 28, closeMax: 34 } } },
      { flags: flags() });
    expect(t.story[0]).toBe('Sáng nay giá trên phố từ 28k đến 34k. Đến cuối trưa vẫn từ 28k đến 34k.');
    expect(t.story[1]).toBe('Quán Bà Tư đông khách nên tăng từ 30k lên 34k và Quán Sinh Viên vắng khách nên hạ từ 34k xuống 32k. '
      + 'Không ai ra lệnh: mỗi quán tự nhìn khách của mình mà chỉnh giá.');
    expect(t.title).toBe('Không ai ra lệnh, giá tự phản ứng theo khách');
    expect(t.moral).not.toContain('một mức chung');
    expect([...t.story, t.moral].join(' ')).not.toContain('chụm lại.');
    expect(t.moral).toContain('Không ai ra lệnh');
  });

  it('day 1 with a range that widens says "Đến cuối trưa" without "còn"', () => {
    const r = fixtureReport(1, 30, [shopRow('batu', 35, 12, 12, { openPrice: 30, trail: [[0, 30], [300, 35]] }), shopRow('player', 30, 14, 0)]);
    const t = lessonText({ ...r, lesson: { id: 'freeMarket', data: { openMin: 30, openMax: 30, closeMin: 30, closeMax: 35 } } },
      { flags: flags() });
    expect(t.story[0]).toBe('Sáng nay giá trên phố đều 30k. Đến cuối trưa từ 30k đến 35k.');
  });

  it('price moves and the sentence for them', () => {
    const moves = priceMoves([
      { id: 'batu', trail: [[0, 30], [300, 31]], soldOut: false },
      { id: 'giare', trail: [[0, 28]], soldOut: true },
    ]);
    expect(moves).toEqual([{ id: 'batu', open: 30, close: 31, soldOut: false }]);
    expect(movesSentence(moves)).toBe('Quán Bà Tư tăng từ 30k lên 31k. Không ai ra lệnh: mỗi quán tự nhìn khách của mình mà chỉnh giá.');
  });

  it('day 1 over many real runs: "còn" only when the range narrows, "chụm lại" only past the threshold', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const st of [STRATEGIES.reasonable, STRATEGIES.flat15, STRATEGIES.flat45]) {
        const run = playRun(seed, st).run;
        const r = run.reports[0];
        const t = lessonText(r, run);
        const d = r.lesson.data;
        const narrowed = d.closeMax - d.closeMin < d.openMax - d.openMin;
        expect(t.story[0].includes('còn')).toBe(narrowed);
        const c = convergence(r.street);
        expect(t.story[1].includes('chụm lại')).toBe(converged(c) && c.changed > 0);
        expect(t.title.includes('một mức')).toBe(converged(c));
      }
    }
  });

  it('day 1 with no price change says so', () => {
    const r = day1();
    const t = lessonText({ ...r, street: r.street.map(s => ({ ...s, trail: [[0, 30]] })) }, { flags: flags() });
    expect(t.story[1]).toContain('chưa quán nào đổi giá');
  });

  it('day 2 contrasts competition with the cartel, per variant', () => {
    const base = fixtureReport(2, 30, []);
    const data = { avgClose1: 30, avgClose2: 26.5, fine: 0 };
    const refused = lessonText({ ...base, lesson: { id: 'entryRefused', data } }, { flags: flags() });
    expect(refused.story[0]).toContain('từ 30k hôm qua xuống 26,5k hôm nay');
    expect(refused.story[1]).toContain('các quán giảm giá theo quán mới');
    expect(refused.moral).toContain('cạnh tranh');

    const kept = lessonText({ ...base, lesson: { id: 'cartelKept', data: { avgClose1: 30, avgClose2: 36, fine: 150 } } },
      { flags: flags({ cartel: 'agreed' }) });
    expect(kept.hand).toBe('visible');
    expect(kept.story[0]).toContain('cùng giữ giá cao 36k. Quán mới');
    expect(kept.story[0]).not.toContain('trung bình 36k');
    expect(kept.story[1]).toContain('phạt bạn 150k');

    const broke = lessonText({ ...base, lesson: { id: 'cartelBroke', data: { avgClose1: 30, avgClose2: 33, fine: 150 } } },
      { flags: flags({ cartel: 'agreed' }) });
    expect(broke.story[0]).toContain('lén bán rẻ hơn');
    expect(broke.story[1]).toContain('phạt 150k');
  });

  it('day 3 gives the shortage: empty-handed of eligible, resting shops, the black market by choice', () => {
    const base = fixtureReport(3, 20, []);
    const lesson = { id: 'ceiling' as const, data: { emptyHanded: 46, eligible: 116, resting: 3 } };
    const t = lessonText({ ...base, lesson }, { flags: flags() });
    expect(t.story[0]).toBe('Hôm nay 116 khách đủ tiền mua một ly, nhưng 46 người (40%) xếp hàng rồi về tay không.');
    expect(t.story[1]).toContain('3 quán nghỉ bán: dưới 20k, lãi mỗi ly sau giá vốn quá mỏng để trả tiền mặt bằng');
    expect(t.story[2]).toContain('Bạn đã từ chối');
    const black = lessonText({ ...base, summary: { ...base.summary, labels: ['blackMarket'] }, lesson }, { flags: flags() });
    expect(black.story[2]).toContain('bán cửa sau');
  });

  it('day 4: the fund and the bus stop; the free rider when evaded', () => {
    const base = fixtureReport(4, 30, []);
    const paid = lessonText({ ...base, lesson: { id: 'tax', data: { taxFund: 410, tax: 140, evaded: 0 } } }, { flags: flags() });
    expect(paid.story[0]).toBe('Mỗi ly bán ra nộp 5k. Cả phố nộp 410k, phần của bạn 140k.');
    expect(paid.story[1]).toContain('trạm xe buýt');
    const evaded = lessonText({ ...base, lesson: { id: 'tax', data: { taxFund: 410, tax: 140, evaded: 1 } } },
      { flags: flags({ taxEvaded: true }) });
    expect(evaded.title).toContain('người ăn theo');
    expect(evaded.story[0]).toContain('lấy lại 140k');
    expect(evaded.story[1]).toContain('người ăn theo');
  });

  it('day 5: the rumor, the inspection at its second, the bus', () => {
    const base = fixtureReport(5, 30, []);
    const t = lessonText({ ...base, lesson: { id: 'rumor', data: { without: 130, with: 163, scared: 45, certified: 4, named: 1 } } },
      { flags: flags() });
    expect(t.story[0]).toContain('45 khách sợ');
    expect(t.story[1]).toBe(`Giây ${CONFIG.rumor.inspectionTick / 10} nhà nước công bố kiểm định: 4 quán đạt, 1 quán bị nêu tên. Khách quay lại.`);
    expect(t.story[2]).toContain('từ 130 lên 163 khách');
  });

  it('every lesson of real runs (both cartel variants) has text and no NaN or undefined', () => {
    const runs = [
      playRun(7, STRATEGIES.reasonable).run,
      playRun(7, combo('reasonable+cartel-keep+shock-A+black-A+tax-B+inspect-A')).run,
      playRun(7, combo('reasonable+cartel-break+shock-B+black-B+tax-A+inspect-B')).run,
    ];
    const ids = new Set<string>();
    for (const run of runs) {
      for (const r of run.reports) {
        const t = lessonText(r, run);
        ids.add(r.lesson.id);
        const all = [t.title, t.moral, ...t.story, ...t.stats.map(s => s.value)].join(' ');
        expect(all).not.toMatch(/NaN|undefined|Infinity/);
        expect(t.story.length).toBeGreaterThan(0);
      }
    }
    expect([...ids].sort()).toEqual(['cartelBroke', 'cartelKept', 'ceiling', 'entryRefused', 'freeMarket', 'rumor', 'tax']);
  });
});

describe('report rows', () => {
  const run = playRun(7, STRATEGIES.reasonable).run;

  it('money: lines inside the profit sum to the day profit; outside lines and the cash identity hold', () => {
    for (const r of run.reports) {
      const rows = moneyRows(r);
      const inside = rows.filter(x => x.kind === 'in').reduce((s, x) => s + x.value, 0);
      expect(inside).toBeCloseTo(r.summary.profit, 6);
      const outside = rows.filter(x => x.kind === 'out').reduce((s, x) => s + x.value, 0);
      expect(cashBefore(r) + inside + outside).toBeCloseTo(r.summary.cash, 6);
    }
    // the day before's cash is this morning's start
    expect(cashBefore(run.reports[1])).toBe(run.reports[0].summary.cash);
    expect(cashBefore(run.reports[0])).toBe(CONFIG.run.startCash);
  });

  it('money: tax only on tax days or when paid, fines only when fined, waste as a note', () => {
    const base = fixtureReport(1, 30, [], { revenue: 300, profit: 200, wasteValue: 6 });
    const keys = (r: DayReport) => moneyRows(r).map(x => x.key);
    expect(keys({ ...base, teaCost: 60, toppingCost: 40 })).toEqual(['revenue', 'tea', 'toppings', 'waste']);
    const d4 = fixtureReport(4, 30, [], { tax: 70 });
    expect(keys(d4)).toContain('tax');
    const fined = fixtureReport(2, 30, [], { fines: 150 });
    expect(moneyRows(fined).find(x => x.key === 'fines')?.value).toBe(-150);
    const lines = moneyRows({ ...base, upgradeCost: 80, cardCash: -30, delayedCash: 30 });
    expect(lines.filter(x => x.kind === 'out').map(x => [x.key, x.value])).toEqual([['upgrade', -80], ['delayed', 30], ['card', -30]]);
    expect(moneyRows(base).find(x => x.key === 'waste')?.kind).toBe('note');
    const evaded = fixtureReport(4, 30, [], { tax: 145, cards: [{ id: 'tax', choice: 'B' }, { id: 'inspection', choice: 'A' }] });
    expect(moneyRows({ ...evaded, cardCash: 105 }).filter(x => x.kind === 'out').map(x => [x.key, x.value]))
      .toEqual([['refund', 145], ['card', -40]]);
  });

  it('customers: served, wrong, walked out, missed for stock', () => {
    const r = { ...fixtureReport(1, 30, [], { cups: 20, wrong: 2, walkouts: 1 }), missedNoStock: 4 };
    expect(customerRows(r).map(x => x.value)).toEqual([20, 2, 1, 4]);
  });

  it('rep steps run from last evening through every item to tonight, morning first', () => {
    const r: DayReport = {
      ...fixtureReport(3, 20, [], { rep: 41 }),
      repBefore: 50,
      repItems: [
        { reason: 'cartel', delta: -8, when: 'morning' },
        { reason: 'tea', delta: -12, when: 'evening' },
        { reason: 'wrong', delta: -2, count: 1, when: 'evening' },
        { reason: 'clean', delta: 3, when: 'evening' },
        { reason: 'blackMarket', delta: 2, when: 'evening' },
      ],
    };
    const steps = repSteps(r);
    expect(steps.map(s => s.after)).toEqual([42, 30, 28, 31, 41]);
    expect(steps[0].label).toBe('Cả phố nói xấu vì bạn phá thoả thuận');
    expect(steps[1].label).toBe('Trà ăn bớt, khách uống ra nhạt');
    expect(steps[2].label).toBe('Giao sai 1 ly');
  });

  it('rep steps clamp for display and end on the reported rep', () => {
    const r: DayReport = { ...fixtureReport(1, 30, [], { rep: 100 }), repBefore: 98,
      repItems: [{ reason: 'tea', delta: 8, when: 'evening' }, { reason: 'wrong', delta: -2, count: 1, when: 'evening' }] };
    expect(repSteps(r).map(s => s.after)).toEqual([100, 100]);
  });

  it('labels every rep reason with both signs', () => {
    expect(repLabel({ reason: 'cartel', delta: 3, when: 'evening' })).toBe('Từ chối bắt tay nâng giá');
    expect(repLabel({ reason: 'cartel', delta: -2, when: 'evening' })).toBe('Bị phạt vì thông đồng giá');
    expect(repLabel({ reason: 'walkout', delta: -3, count: 3, when: 'evening' })).toBe('3 khách chờ lâu bỏ về');
    expect(repLabel({ reason: 'tea', delta: 8, when: 'evening' })).toContain('cao cấp');
  });

  it('skimp tea is itemised: tea saved against rep and brand value', () => {
    const r: DayReport = {
      ...fixtureReport(1, 30, [], { tea: 'skimp', bought: { teaMl: 5000, toppings: { pearl: 0, jelly: 0, pudding: 0 } } }),
      repItems: [{ reason: 'tea', delta: -12, when: 'evening' }],
    };
    expect(skimpTrade(r)).toEqual({ saved: 50, rep: -12, brand: -144 });
    expect(skimpTrade(fixtureReport(1, 30, []))).toBeNull();
  });

  it('street rows: player first, the day\'s tags, shops not open yet left out', () => {
    const run = playRun(3, STRATEGIES.reasonable).run;
    const r = run.reports[2];
    const after = run.shops;
    const rows = streetRows(r, after);
    expect(rows[0].id).toBe('player');
    expect(rows.some(x => x.tags.includes('resting'))).toBe(true);
    // cochap closed on the evening of day 3 in this run
    expect(rows.find(x => x.id === 'cochap')?.tags).toContain('closedTonight');
    const d2 = streetRows(run.reports[1], after);
    expect(d2.find(x => x.id === 'tapdoan')?.tags).toContain('new');
    const d1 = streetRows(run.reports[0], after);
    expect(d1.find(x => x.id === 'tapdoan')).toBeUndefined();
  });

  it('price chart: a shared scale and step paths to the end of the rush', () => {
    const rows = streetRows(run.reports[0], run.shops);
    const sc = priceScale(rows);
    expect(sc.lo).toBeLessThan(sc.hi);
    expect(trailPath([[0, 30], [450, 28]], { lo: 26, hi: 30 }, 100, 40)).toBe('M0.0 0.0 H50.0 V20.0 H100.0');
    expect(trailPath([], sc, 100, 40)).toBe('');
  });
});

describe('end screen lessons', () => {
  it('lists the story choices with their lessons', () => {
    const run = playRun(7, combo('reasonable+cartel-keep+shock-A+black-A+tax-B+inspect-A')).run;
    const ls = choiceLessons(run);
    expect(ls.map(l => l.key)).toEqual(['cartel', 'shockTopping', 'blackMarket', 'tax', 'inspection']);
    expect(ls[0].did).toContain('giữ 36k');
    expect(ls[3].did).toContain('ăn theo');
    expect(ls.every(l => l.tone === 'bad')).toBe(true);
    const good = choiceLessons(playRun(7, STRATEGIES.reasonable).run);
    expect(good.find(l => l.key === 'cartel')?.tone).toBe('good');
    expect(good.find(l => l.key === 'inspection')?.did).toContain('chờ nhà nước');
  });

  it('a broken cartel reads as broken', () => {
    const run = playRun(7, combo('reasonable+cartel-break+shock-B+black-B+tax-A+inspect-B')).run;
    expect(choiceLessons(run)[0].did).toContain('lén phá giá');
  });

  it('a run lost on day 1 only lists what it reached', () => {
    const run = playRun(7, STRATEGIES.plainS).run;
    expect(run.outcome).toBe('lostTrust');
    expect(choiceLessons(run).map(l => l.key)).toEqual(['cartel']);
  });

  it('explains each shop exit from what happened on its losing days', () => {
    const run = playRun(3, STRATEGIES.reasonable).run;
    const exits = shopExits(run);
    expect(exits.map(e => e.id)).toEqual(ending(run).closedShops);
    const cochap = exits.find(e => e.id === 'cochap');
    expect(cochap?.closedOn).toBe(3);
    expect(cochap?.why).toMatch(/^Giá vốn 14k\/ly, lỗ 2 ngày liền\. Ngày 2 Chuỗi Tập Đoàn vào phố chia khách: bán \d+\/\d+ ly/);
    // a resting shop on the ceiling day: the margin after rent is thin, not "cost above the ceiling"
    expect(cochap?.why).toContain('Ngày 3 nghỉ bán: dưới trần 20k, lãi mỗi ly sau giá vốn quá mỏng');
    expect(cochap?.why).not.toContain('không đủ bù giá vốn');
    const moral = (exitMoral(exits) ?? '').toLowerCase();
    expect(moral).toContain('quán mới vào chia khách');
    expect(moral).toContain('giá trần');
    expect(moral).not.toContain('tin đồn');
    expect(exitMoral([])).toBeNull();
  });

  it('a cartel-day exit never blames the entrant pulling prices down', () => {
    let cartelExits = 0;
    for (const seed of [3, 7, 11, 12, 21]) {
      for (const id of ['reasonable+cartel-keep+shock-B+black-B+tax-A+inspect-B', 'reasonable+cartel-break+shock-B+black-B+tax-A+inspect-B']) {
        const run = playRun(seed, combo(id)).run;
        for (const e of shopExits(run)) {
          expect(e.why).not.toMatch(/kéo giá xuống/);
          if (e.factors.includes('cartel')) {
            cartelExits += 1;
            expect(e.why).toMatch(/cả phố (cùng giữ|hẹn giữ) 36k/);
            expect(e.why).not.toContain('Chuỗi Tập Đoàn vào phố');
            expect(exitMoral([e])?.toLowerCase()).toContain('thoả thuận giữ giá');
            if (id.includes('break')) expect(e.why).toContain('phá giá');
          }
        }
      }
    }
    expect(cartelExits).toBeGreaterThan(0);
  });

  it('Chuỗi GiáRẻ closing on day 5 is told it was named by the inspection, and the moral says so', () => {
    let seen = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      for (const st of [STRATEGIES.reasonable, STRATEGIES.skimp, combo('reasonable+cartel-keep+shock-B+black-B+tax-A+inspect-B')]) {
        const run = playRun(seed, st).run;
        const giare = shopExits(run).find(e => e.id === 'giare' && e.closedOn === 5);
        if (giare === undefined) continue;
        seen += 1;
        expect(giare.why).toContain('kiểm định nêu tên');
        expect(giare.factors).toContain('named');
        expect(exitMoral(shopExits(run))).toContain('thông tin thật');
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('every exit over many runs has a reason per losing day and a moral from its own factors', () => {
    const strategies = [STRATEGIES.reasonable, STRATEGIES.flat15, STRATEGIES.premium,
      combo('reasonable+cartel-keep+shock-A+black-A+tax-B+inspect-A'),
      combo('reasonable+cartel-break+shock-B+black-B+tax-A+inspect-B'),
      combo('reasonable+cartel-refuse+shock-B+black-B+tax-A+inspect-B')];
    for (let seed = 1; seed <= 10; seed++) {
      for (const st of strategies) {
        const run = playRun(seed, st).run;
        const exits = shopExits(run);
        for (const e of exits) {
          expect(e.why).toMatch(/^Giá vốn \d+k\/ly, lỗ 2 ngày liền\. Ngày \d/);
          expect(e.why).not.toMatch(/NaN|undefined/);
          expect(e.factors.length).toBeGreaterThan(0);
        }
        const moral = exitMoral(exits)?.toLowerCase();
        if (exits.length === 0) continue;
        const factors = new Set(exits.flatMap(e => e.factors));
        expect(moral?.includes('thuế') ?? false).toBe(factors.has('tax'));
        expect(moral?.includes('giá trần') ?? false).toBe(factors.has('ceiling'));
        expect(moral?.includes('quán mới vào') ?? false).toBe(factors.has('entrant'));
      }
    }
  });
});

describe('empty days (a report with nothing to list)', () => {
  it('no rep items: no steps, and the meter stays on last night for any step count', () => {
    const r: DayReport = { ...fixtureReport(5, 30, [], { rep: 71, cups: 0 }), repBefore: 71, repItems: [] };
    const steps = repSteps(r);
    expect(steps).toEqual([]);
    for (const n of [0, 1, 2, 5]) expect(meterValue(steps, n, r.repBefore)).toBe(71);
    expect(skimpTrade(r)).toBeNull();
  });

  it('meterValue clamps the step count', () => {
    const r: DayReport = { ...fixtureReport(1, 30, [], { rep: 53 }), repBefore: 50,
      repItems: [{ reason: 'clean', delta: 3, when: 'evening' }] };
    const steps = repSteps(r);
    expect(meterValue(steps, 0, 50)).toBe(50);
    expect(meterValue(steps, 1, 50)).toBe(53);
    expect(meterValue(steps, 9, 50)).toBe(53);
  });

  it('a real day with 0 cups and no rep items builds every row without throwing', () => {
    const run = playRun(7, STRATEGIES.flat45).run;
    const d5 = run.reports[4];
    expect(d5.repItems).toEqual([]);
    expect(d5.summary.cups).toBe(0);
    expect(() => [moneyRows(d5), customerRows(d5), repSteps(d5), streetRows(d5, run.shops), lessonText(d5, run),
      choiceLessons(run), shopExits(run), exitMoral(shopExits(run))]).not.toThrow();
    expect(exitMoral(shopExits(run))).toBeNull();
    expect(priceScale(streetRows(d5, run.shops)).lo).toBeLessThan(priceScale(streetRows(d5, run.shops)).hi);
  });
});
