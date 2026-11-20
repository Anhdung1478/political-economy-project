// The evening report's rows (spec §8 "Báo cáo tối"), as data: money, customers, reputation steps and the street.
// Pure and node-tested; ReportScreen only lays them out and animates them.
import { CONFIG, type SimConfig } from '../../../../shared/sim/config';
import type {
  AiShopState, DayReport, K, RepItem, ShopDayResult, ShopId, Tick,
} from '../../../../shared/sim/types';
import { fmtMoney } from '../../game/format';
import { SHOP_NAMES } from './copy';

export interface MoneyRow {
  key: string;
  label: string;
  /** Signed: income positive, costs negative. */
  value: K;
  /** A line inside the day profit, or a line outside it (§16 row 13), or a note that is already counted elsewhere. */
  kind: 'in' | 'out' | 'note';
  hint?: string;
}

/**
 * The money lines: revenue, tea, toppings, tax, fines (inside the day profit); the waste as a note (its value is in
 * the tea and toppings already); then upgrade, card cash and delayed cash as lines of their own (R13). Zero lines
 * outside the profit are left out; tax shows on tax days or when paid, fines when fined.
 */
export function moneyRows(r: DayReport, cfg: SimConfig = CONFIG): MoneyRow[] {
  const s = r.summary;
  const rows: MoneyRow[] = [{ key: 'revenue', label: 'Doanh thu', value: s.revenue, kind: 'in', hint: `${s.cups} ly` }];
  rows.push({ key: 'tea', label: 'Tiền trà', value: -r.teaCost, kind: 'in' });
  rows.push({ key: 'toppings', label: 'Tiền topping', value: -r.toppingCost, kind: 'in' });
  if (s.tax > 0 || cfg.days[s.day].taxPerCup > 0) {
    rows.push({ key: 'tax', label: 'Thuế', value: -s.tax, kind: 'in', hint: `${cfg.days[s.day].taxPerCup}k/ly` });
  }
  if (s.fines > 0) rows.push({ key: 'fines', label: 'Tiền phạt', value: -s.fines, kind: 'in', hint: 'Cục Cạnh tranh' });
  if (s.wasteValue > 0) {
    rows.push({ key: 'waste', label: 'Nguyên liệu bỏ đi', value: -s.wasteValue, kind: 'note', hint: 'đã nằm trong tiền trà, topping' });
  }
  if (r.upgradeCost > 0) rows.push({ key: 'upgrade', label: 'Nâng cấp sáng nay', value: -r.upgradeCost, kind: 'out' });
  if (r.delayedCash !== 0) rows.push({ key: 'delayed', label: 'Tiền thẻ hôm trước', value: r.delayedCash, kind: 'out' });
  if (r.cardCash !== 0) rows.push({ key: 'card', label: 'Tiền thẻ chiều nay', value: r.cardCash, kind: 'out' });
  return rows;
}

/** Cash at the start of the day (last evening's): the end cash less every line that moved it today. */
export const cashBefore = (r: DayReport): K =>
  r.summary.cash - (r.delayedCash - r.upgradeCost + r.summary.profit + r.cardCash);

export interface CustomerRow { key: 'served' | 'wrong' | 'walkouts' | 'missed'; label: string; value: number; tone: 'good' | 'bad' }

export function customerRows(r: DayReport): CustomerRow[] {
  const s = r.summary;
  return [
    { key: 'served', label: 'Đã phục vụ', value: s.cups, tone: 'good' },
    { key: 'wrong', label: 'Giao sai món', value: s.wrong, tone: 'bad' },
    { key: 'walkouts', label: 'Chờ lâu, bỏ về', value: s.walkouts, tone: 'bad' },
    { key: 'missed', label: 'Không ghé vì hết món', value: r.missedNoStock, tone: 'bad' },
  ];
}

/** Why rep moved, in words (§4 Uy tín: "Báo cáo tối liệt kê từng khoản"). */
export function repLabel(i: RepItem): string {
  const n = i.count ?? 0;
  const up = i.delta > 0;
  switch (i.reason) {
    case 'tea': return up ? 'Trà cao cấp, khách khen thơm' : 'Trà ăn bớt, khách uống ra nhạt';
    case 'wrong': return `Giao sai ${n} ly`;
    case 'walkout': return `${n} khách chờ lâu bỏ về`;
    case 'gouge': return 'Tăng giá giữa trưa quá tay';
    case 'clean': return 'Phục vụ sạch: không sai ly, không ai bỏ về';
    case 'banner': return 'Treo băng rôn';
    case 'cartel':
      if (up) return 'Từ chối bắt tay nâng giá';
      return i.when === 'morning' ? 'Cả phố nói xấu vì bạn phá thoả thuận' : 'Bị phạt vì thông đồng giá';
    case 'shockTopping': return 'Topping giá sốc không rõ nguồn gốc';
    case 'blackMarket': return up ? 'Từ chối bán chợ đen' : 'Bị bóc phốt bán chợ đen';
    case 'tax': return 'Khai gian thuế';
    case 'inspection': return 'Tự kiểm định và trượt';
    case 'reporter': return 'Trả lời phóng viên';
    case 'kol': return up ? 'KOL review khen hết lời' : 'Từ chối KOL, bị nói là keo';
    case 'tab': return up ? 'Khách quen trả nợ, dắt thêm bạn' : 'Không cho khách quen ghi nợ';
    case 'student': return 'Bạn sinh viên phụ quán';
    case 'complaint': return up ? 'Đền ly nhạt, khách nguôi giận' : 'Cãi khách khó tính, bị đăng lên nhóm';
    case 'deliveryAd': return 'Quảng cáo trên app';
    case 'scholarship': return 'Góp quỹ khuyến học';
  }
}

export interface RepStep {
  label: string;
  delta: number;
  when: RepItem['when'];
  /** The meter after this item (clamped to the scale for display). */
  after: number;
}

/**
 * Rep from last evening to tonight, one step per item (morning items first, then the evening's). The sim sums the
 * evening and clamps once, so the last step is set to the reported rep.
 */
export function repSteps(r: DayReport, cfg: SimConfig = CONFIG): RepStep[] {
  let at = r.repBefore;
  const clamp = (x: number) => Math.min(cfg.run.maxRep, Math.max(cfg.run.minRep, x));
  const steps = r.repItems.map(i => {
    at += i.delta;
    return { label: repLabel(i), delta: i.delta, when: i.when, after: clamp(at) };
  });
  if (steps.length > 0) steps[steps.length - 1].after = r.summary.rep;
  return steps;
}

/**
 * The skimp tea in money (the report itemises its cost clearly): what it saved on tea against standard tea, and the
 * rep it cost in brand value. Null when the day's tea was not skimp.
 */
export function skimpTrade(r: DayReport, cfg: SimConfig = CONFIG): { saved: K; rep: number; brand: K } | null {
  const item = r.repItems.find(i => i.reason === 'tea' && i.delta < 0);
  if (r.summary.tea !== 'skimp' || item === undefined) return null;
  const g = cfg.supplies.teaGrades;
  const saved = (r.summary.bought.teaMl * (g.standard.costPer100Ml - g.skimp.costPer100Ml)) / 100;
  return { saved, rep: item.delta, brand: item.delta * cfg.run.brandPerRep };
}

export type StreetTag = 'soldOut' | 'resting' | 'closed' | 'closedTonight' | 'closedEarly' | 'new';

export interface StreetRow {
  id: ShopId;
  name: string;
  /** The price path, [tick, price], ending at the close tick; empty when it did not sell. */
  trail: (readonly [Tick, K])[];
  open: K | null;
  close: K | null;
  sold: number;
  profit: K | null;
  tags: StreetTag[];
}

export const STREET_TAG_TEXT: Record<StreetTag, string> = {
  soldOut: 'Bán hết', resting: 'Nghỉ bán', closed: 'Đã đóng cửa', closedTonight: 'Đóng cửa hẳn',
  closedEarly: 'Đóng sớm', new: 'Mới mở',
};

/**
 * The street today (§8 "Phố hôm nay"): every shop on the street, the player first, with its price path, cups sold
 * and what happened to it (sold out, rested, closed early, closed for good tonight or before). Shops not open yet
 * are left out. `shops` is the run after the evening (its exits applied).
 */
export function streetRows(r: DayReport, shops: readonly AiShopState[]): StreetRow[] {
  const day = r.summary.day;
  const rows = r.street.filter(s => s.status !== 'notYet').map((s: ShopDayResult): StreetRow => {
    const ai = shops.find(x => x.id === s.id);
    const tags: StreetTag[] = [];
    if (ai !== undefined && ai.history.length > 0 && ai.history[0].day === day && day > 1) tags.push('new');
    if (s.soldOut) tags.push('soldOut');
    if (s.status === 'resting') tags.push('resting');
    if (s.status === 'closedEarly') tags.push('closedEarly');
    if (s.status === 'closed') tags.push('closed');
    else if (ai?.status === 'closed' && ai.closedOn === day) tags.push('closedTonight');
    return {
      id: s.id, name: SHOP_NAMES[s.id], trail: s.trail.map(p => [p[0], p[1]] as const),
      open: s.openPrice, close: s.closePrice, sold: s.sold, profit: s.profit, tags,
    };
  });
  return [...rows.filter(x => x.id === 'player'), ...rows.filter(x => x.id !== 'player')];
}

/** The price scale shared by every line on the street chart, padded to whole steps. */
export function priceScale(rows: readonly StreetRow[]): { lo: K; hi: K } {
  const ps = rows.flatMap(r => r.trail.map(p => p[1]));
  if (ps.length === 0) return { lo: 0, hi: 1 };
  const lo = Math.floor(Math.min(...ps) - 1);
  const hi = Math.ceil(Math.max(...ps) + 1);
  return { lo, hi: hi === lo ? lo + 1 : hi };
}

/** An SVG path of a price trail as a step line over `ticks`, in a w × h box. */
export function trailPath(trail: readonly (readonly [Tick, K])[], scale: { lo: K; hi: K }, w: number, h: number,
  ticks = CONFIG.rush.ticks): string {
  if (trail.length === 0) return '';
  const x = (t: Tick) => (Math.min(ticks, Math.max(0, t)) / ticks) * w;
  const y = (p: K) => h - ((p - scale.lo) / (scale.hi - scale.lo)) * h;
  let d = `M${x(0).toFixed(1)} ${y(trail[0][1]).toFixed(1)}`;
  for (let i = 1; i < trail.length; i++) {
    d += ` H${x(trail[i][0]).toFixed(1)} V${y(trail[i][1]).toFixed(1)}`;
  }
  return `${d} H${w.toFixed(1)}`;
}

/** The money a row shows, signed. */
export const rowMoney = (v: K) => (v > 0 ? `+${fmtMoney(v)}` : fmtMoney(v));
