// The lesson texts, the report rows and the end-screen lessons (Task 21), from hand-made reports and from real runs.
import { describe, expect, it } from 'vitest';
import { playRun, STRATEGIES, storyCombos } from '../../../../shared/sim/autoplay';
import { CONFIG } from '../../../../shared/sim/config';
import { report as fixtureReport, shopRow } from '../../../../shared/sim/day.fixtures';
import { ending } from '../../../../shared/sim/run';
import type { DayReport, RunState } from '../../../../shared/sim/types';
import { choiceLessons, convergence, exitMoral, lessonText, openClose, shopExits } from './lessons';
import {
  cashBefore, customerRows, moneyRows, priceScale, repLabel, repSteps, skimpTrade, streetRows, trailPath,
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
    expect(t.story[0]).toBe('Sáng nay giá trên phố từ 30–34k. Đến cuối trưa còn 29–31k.');
    expect(t.story[1]).toContain('2/3 quán tự đổi giá giữa trưa');
    expect(t.story[1]).toContain('±1,8k lúc mở cửa, còn ±0,7k lúc đóng cửa');
    expect(t.stats.map(s => s.value)).toContain('2/3');
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
    expect(kept.story[0]).toContain('cùng giữ giá cao 36k');
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
    expect(t.story[1]).toContain('3 quán nghỉ bán: bán dưới 20k');
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

  it('explains each shop exit by its losing days', () => {
    const run = playRun(7, STRATEGIES.reasonable).run;
    const exits = shopExits(run.shops);
    expect(exits.map(e => e.id)).toEqual(ending(run).closedShops);
    const cochap = exits.find(e => e.id === 'cochap');
    expect(cochap?.closedOn).toBe(3);
    expect(cochap?.why).toMatch(/^Giá vốn 14k\/ly, lỗ ngày 2 và 3: /);
    expect(exitMoral(exits)).toContain('giá vốn cao');
    expect(exitMoral([])).toBeNull();
  });
});
