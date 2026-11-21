// The morning screen's pure side (spec §5): the bulletin as rows and sentences, the plan's ranges and steps, the
// issue messages, the shelf picture, and the intents that carry a locally edited plan into the run store. No React.
import { CONFIG, type SimConfig } from '../../../../shared/sim/config';
import { validatePlan } from '../../../../shared/sim/day';
import type {
  BriefShopRow, MorningBrief, MorningPlan, PendingEffect, PlanIssue, RunState, ShopId, ToppingId,
} from '../../../../shared/sim/types';
import { fmtMoney, fmtMoneySigned, fmtNumber } from '../../game/format';
import type { Intent } from '../../game/runStore';
import { SHOP_NAMES, TOPPING_NAMES } from './copy';

const TOPPINGS: readonly ToppingId[] = CONFIG.customers.toppingOrder;

// ── Price and stock ranges ──────────────────────────────────────────────────────────────────────────────────────

/** The prices the player may ask today: the config's range, capped by the day's ceiling. */
export function priceRange(ceiling: number | null, cfg: SimConfig = CONFIG): { min: number; max: number; step: number } {
  const p = cfg.pricing;
  return { min: p.min, max: ceiling === null ? p.max : Math.min(p.max, ceiling), step: p.step };
}

/** A price brought onto today's range and step (whole k). */
export function clampPrice(price: number, ceiling: number | null, cfg: SimConfig = CONFIG): number {
  const r = priceRange(ceiling, cfg);
  const stepped = r.min + Math.round((price - r.min) / r.step) * r.step;
  return Math.min(r.max, Math.max(r.min, Number.isFinite(stepped) ? stepped : r.min));
}

/** Tea after `steps` purchase steps up (or down), snapped onto the 250 ml grid, never below 0. */
export function stepTea(ml: number, steps: number, cfg: SimConfig = CONFIG): number {
  const s = cfg.supplies.teaStepMl;
  return Math.max(0, (Math.round(ml / s) + steps) * s);
}

/** A topping count after `steps`, a whole number, never below 0. */
export const stepCount = (n: number, steps: number): number => Math.max(0, Math.round(n) + steps);

/** Tea of an average order (ml), from the size mix (S, M, L shares as customers are generated). */
export function avgOrderMl(cfg: SimConfig = CONFIG): number {
  const s = cfg.customers.size;
  const ml = cfg.supplies.sizeMl;
  return (1 - s.mediumShare - s.largeBase) * ml.S + s.mediumShare * ml.M + s.largeBase * ml.L;
}

/** About how many average cups the tea makes. */
export const cupsFromTea = (teaMl: number, cfg: SimConfig = CONFIG): number => Math.floor(teaMl / avgOrderMl(cfg));

// ── The shelf ───────────────────────────────────────────────────────────────────────────────────────────────────

/** One litre per bottle on the shelf; more than `maxBottles` show as "+n". */
export const BOTTLE_ML = 1000;

export interface Shelf {
  /** Fill of each bottle drawn (1 full, the last one partial). */
  bottles: number[];
  /** Bottles beyond those drawn. */
  moreBottles: number;
  /** Per topping: the portions, and the jar's fill (0..1) against a jar of `jarSize` portions. */
  jars: { id: ToppingId; count: number; fill: number }[];
}

/** The shelf for the plan's stock: bottles of tea, a jar per topping. */
export function shelfOf(plan: Pick<MorningPlan, 'teaMl' | 'toppings'>, maxBottles = 8, jarSize = 20): Shelf {
  const full = Math.floor(plan.teaMl / BOTTLE_ML);
  const part = (plan.teaMl % BOTTLE_ML) / BOTTLE_ML;
  const all = [...Array<number>(full).fill(1), ...(part > 0 ? [part] : [])];
  return {
    bottles: all.slice(0, maxBottles),
    moreBottles: Math.max(0, all.length - maxBottles),
    jars: TOPPINGS.map(id => ({ id, count: plan.toppings[id], fill: Math.min(1, plan.toppings[id] / jarSize) })),
  };
}

// ── The bulletin ────────────────────────────────────────────────────────────────────────────────────────────────

/** The day's rules, one sentence each. */
export function ruleLines(brief: MorningBrief, cfg: SimConfig = CONFIG): string[] {
  const r = brief.rules;
  const lines: string[] = [];
  switch (brief.theme) {
    case 'opening':
      lines.push('Chợ tự do: không ai ra lệnh, quán nào muốn bán giá nào thì bán.');
      break;
    case 'newShop':
      lines.push('Phố có thêm quán mới, khách sẽ bị chia.');
      break;
    case 'priceCeiling':
      if (r.ceiling !== null) lines.push(`Không quán nào được bán ly M quá ${fmtMoney(r.ceiling)}, kể cả khi đổi giá giữa trưa.`);
      break;
    case 'tax':
      lines.push(`Mỗi ly bán ra nộp ${fmtMoney(r.taxPerCup)} thuế để xây trạm xe buýt.`);
      break;
    case 'rumor':
      break;
  }
  if (r.rumor) {
    const at = cfg.rumor.inspectionTick / 10;
    lines.push(`Tin đồn "nước rửa chén" lan khắp phố: tới giây ${at} khách chỉ còn một nửa.`);
    lines.push(`Giây ${at} nhà nước công bố kiểm định, khách quay lại.`);
  }
  if (brief.bus !== null) {
    lines.push(`Trạm xe buýt mở: không có trạm ${brief.bus.without} khách, có trạm ${brief.bus.with} khách.`);
  }
  if (r.cartel) lines.push(`Cả phố đã bắt tay bán ${fmtMoney(cfg.cards.cartel.price)}. Phá giá thì… tự chịu.`);
  return lines;
}

export interface NewsLine { text: string; effects: string[] }

/** A delayed card effect landing this morning, as a sentence and its effects ("+30k", "+3 uy tín"). */
export function newsLine(p: PendingEffect): NewsLine {
  const effects: string[] = [];
  if (p.cash !== undefined && p.cash !== 0) effects.push(fmtMoneySigned(p.cash));
  if (p.rep !== undefined && p.rep !== 0) effects.push(`${p.rep > 0 ? '+' : '−'}${Math.abs(p.rep)} uy tín`);
  if (p.tempStaff) effects.push('+1 người phụ hôm nay');
  if (p.adCustomers !== undefined && p.adCustomers > 0) effects.push(`+${p.adCustomers} khách từ app`);
  const text = (() => {
    switch (p.source) {
      case 'kol': return 'Bài review của KOL lên sóng, cả phố đang share.';
      case 'tab': return 'Chị khách quen ghé trả tiền ghi sổ, còn dắt theo bạn.';
      case 'student': return 'Bạn sinh viên tới phụ quán từ sáng sớm.';
      case 'deliveryAd': return 'Quảng cáo trên app giao hàng bắt đầu chạy.';
      case 'blackMarket': return 'Chuyện bán cửa sau hôm qua bị lộ, hàng xóm xì xào.';
      case 'cartelBreak': return 'Cả phố biết bạn phá thoả thuận giá. Mặt ai cũng hầm hầm.';
      default: return 'Chuyện hôm trước còn dư âm sáng nay.';
    }
  })();
  return { text, effects };
}

export type Tone = 'good' | 'bad' | 'warn' | 'info' | 'muted';

export interface BulletinRow {
  id: ShopId;
  name: string;
  you: boolean;
  /** Yesterday's closing price, or "—". */
  price: string;
  /** Cups sold, or "—". */
  sold: string;
  note: { text: string; tone: Tone } | null;
  /** Not trading (closed before yesterday): drawn faded. */
  dim: boolean;
}

/** Yesterday's street table (§5): price, cups, and who sold out, who was left with cups, who is new or gone. */
export function bulletinRows(brief: MorningBrief): BulletinRow[] {
  const yesterday = brief.day - 1;
  return brief.street.filter(r => r.status !== 'notYet').map(r => ({
    id: r.id,
    name: SHOP_NAMES[r.id],
    you: r.id === 'player',
    price: r.closePrice === null ? '—' : fmtMoney(r.closePrice),
    sold: r.closePrice === null ? '—' : `${r.sold} ly`,
    note: rowNote(r, yesterday),
    dim: r.status === 'closed' && r.closedOn !== null && r.closedOn < yesterday,
  }));
}

function rowNote(r: BriefShopRow, yesterday: number): BulletinRow['note'] {
  switch (r.status) {
    case 'new': return { text: 'Mới mở', tone: 'info' };
    case 'rested': return { text: 'Nghỉ bán', tone: 'muted' };
    case 'closed':
      return r.closedOn === yesterday
        ? { text: 'Vừa đóng', tone: 'bad' }
        : { text: 'Đã đóng', tone: 'muted' };
    default:
      if (r.closePrice === null) return null;
      if (r.soldOut) return { text: 'Bán hết', tone: 'good' };
      if (r.unsold !== null && r.unsold > 0) return { text: `Ế ${r.unsold} ly`, tone: 'warn' };
      return null;
  }
}

/**
 * The one-line summary of yesterday's table while it is folded: the range of closing prices and the player's own
 * close and cups ("24k – 32k · quán bạn 30k, 22 ly"); null on day 1.
 */
export function streetSummary(brief: MorningBrief): string | null {
  const prices = brief.street.flatMap(r => (r.closePrice === null ? [] : [r.closePrice]));
  if (prices.length === 0) return null;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const range = lo === hi ? fmtMoney(lo) : `${fmtMoney(lo)} – ${fmtMoney(hi)}`;
  const me = brief.street.find(r => r.id === 'player');
  return me?.closePrice == null ? range : `${range} · quán bạn ${fmtMoney(me.closePrice)}, ${me.sold} ly`;
}

/** Yesterday's average close of the whole street, the player included (§16 row 16), to 0.5k; null on day 1. */
export function streetAverage(brief: MorningBrief): number | null {
  const xs = brief.street.flatMap(r => (r.closePrice === null ? [] : [r.closePrice]));
  return xs.length === 0 ? null : Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 2) / 2;
}

/** A shop opening today and its opening price. */
export interface Entrant { id: ShopId; price: number }

/**
 * The plain note on the day a shop opens (Phase-3 note of the balance review): the shops already there cut to the
 * newcomer's price (all but the config's exempt ones), so the street gets cheaper today. Null on other days and on
 * a cartel day, when the cartel price holds instead.
 */
export function entryNote(brief: MorningBrief, entrants: readonly Entrant[], cfg: SimConfig = CONFIG): string | null {
  if (brief.rules.cartel || entrants.length === 0) return null;
  const e = entrants[0];
  const r = cfg.aiPricing.entryReaction;
  const exempt = r.exempt.filter(id => brief.street.some(row => row.id === id && row.status !== 'closed'));
  const level = r.gap === 0 ? `về bằng ${fmtMoney(e.price)}` : `về tối đa ${fmtMoney(e.price + r.gap)}`;
  const but = exempt.length === 0 ? '' : ` (trừ ${exempt.map(id => SHOP_NAMES[id]).join(', ')})`;
  return `${SHOP_NAMES[e.id]} khai trương với giá ${fmtMoney(e.price)}. Các quán cũ${but} đang hạ giá ${level} để giữ khách.`
    + ' Giá cả phố hôm nay sẽ thấp hơn hôm qua.';
}

/** The hint line from yesterday's usage (§5), or the day-1 line. */
export function hintLine(brief: MorningBrief): string {
  const y = brief.yesterday;
  if (y === null) return 'Ngày đầu tiên: kệ đã điền sẵn mức "vừa". Chỉnh tuỳ ý rồi mở cửa.';
  const tops = TOPPINGS.map(t => `${y.used.toppings[t]} ${TOPPING_NAMES[t].toLowerCase()}`).join(', ');
  return `Hôm qua bạn bán ${y.cups} ly, dùng ${fmtNumber(y.used.teaMl)} ml trà, ${tops}.`;
}

// ── Issues ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where an issue is shown. */
export const ISSUE_FIELD: Record<PlanIssue, 'price' | 'tea' | 'toppings' | 'upgrade' | 'cost'> = {
  price: 'price', ceiling: 'price', teaStep: 'tea', toppingStep: 'toppings', negative: 'toppings',
  upgradeOwned: 'upgrade', credit: 'cost',
};

/** The issue in a sentence (numbers from the config and the day's ceiling). */
export function issueText(issue: PlanIssue, ceiling: number | null, cfg: SimConfig = CONFIG, upgradePicked = true): string {
  const r = priceRange(null, cfg);
  switch (issue) {
    case 'price': return `Giá phải là số nghìn tròn, từ ${fmtMoney(r.min)} tới ${fmtMoney(r.max)}.`;
    case 'ceiling': return `Hôm nay giá trần ${fmtMoney(ceiling ?? r.max)}: không được bán cao hơn.`;
    case 'teaStep': return `Trà nhập theo bước ${fmtNumber(cfg.supplies.teaStepMl)} ml.`;
    case 'toppingStep': return 'Topping nhập theo phần nguyên.';
    case 'negative': return 'Không nhập số âm được đâu.';
    case 'upgradeOwned': return 'Món này quán đã có rồi.';
    case 'credit':
      return `Vượt hạn mức mua chịu (tiền không được xuống dưới ${fmtMoney(cfg.run.creditFloor)}). `
        + (upgradePicked ? 'Bớt hàng hoặc bỏ nâng cấp.' : 'Bớt hàng đi một chút.');
  }
}

/**
 * "Mua vừa đủ tiền": the plan with its stock scaled down, in whole percent steps, to the most the cash and the credit
 * allow (`validatePlan` decides, so no money rule is repeated here). The upgrade stays unless even an empty shelf does
 * not fit with it; the plan itself when it already fits.
 */
export function affordablePlan(run: RunState, plan: MorningPlan, cfg: SimConfig = CONFIG): MorningPlan {
  const fits = (p: MorningPlan) => !validatePlan(run, p, cfg).includes('credit');
  if (fits(plan)) return plan;
  const step = cfg.supplies.teaStepMl;
  const scaled = (p: MorningPlan, pct: number): MorningPlan => ({
    ...p,
    teaMl: Math.floor((p.teaMl * pct) / 100 / step) * step,
    toppings: Object.fromEntries(TOPPINGS.map(t => [t, Math.floor((p.toppings[t] * pct) / 100)])) as MorningPlan['toppings'],
  });
  for (const base of [plan, { ...plan, upgrade: null }]) {
    for (let pct = 99; pct >= 0; pct--) {
      const p = scaled(base, pct);
      if (fits(p)) return p;
    }
  }
  return scaled({ ...plan, upgrade: null }, 0);
}

/**
 * The street-average line of the price block: yesterday's, or after a ceiling day (R76) the latest free day's, which
 * is the price the plan starts from. Null on day 1.
 */
export function averageHint(brief: MorningBrief): { text: string; average: number } | null {
  const bc = brief.beforeCeiling;
  if (bc !== null) {
    const when = bc.day === brief.day - 2 ? 'Hôm kia' : `Ngày ${bc.day}`;
    return { text: `${when}, trước giá trần, cả phố trung bình`, average: bc.average };
  }
  const average = streetAverage(brief);
  return average === null ? null : { text: 'Hôm qua cả phố (gồm quán bạn) trung bình', average };
}

// ── Carrying local edits into the store ─────────────────────────────────────────────────────────────────────────

/** The intents that turn the store's draft `from` into `to` (only the fields that differ). */
export function planIntents(from: MorningPlan, to: MorningPlan): Intent[] {
  const out: Intent[] = [];
  if (from.price !== to.price) out.push({ type: 'setPlanPrice', price: to.price });
  if (from.tea !== to.tea) out.push({ type: 'setTea', tea: to.tea });
  if (from.teaMl !== to.teaMl) out.push({ type: 'setTeaMl', teaMl: to.teaMl });
  for (const id of TOPPINGS) {
    if (from.toppings[id] !== to.toppings[id]) out.push({ type: 'setTopping', id, count: to.toppings[id] });
  }
  if (from.upgrade !== to.upgrade) out.push({ type: 'setUpgrade', upgrade: to.upgrade });
  return out;
}

/** Two plans with the same values. */
export const samePlan = (a: MorningPlan, b: MorningPlan): boolean => planIntents(a, b).length === 0;

// ── "Xem phố": hiding the plan to see the whole street ──────────────────────────────────────────────────────────

/** A key press as the plan's visibility cares about it. */
export interface PeekKeyEvent {
  key: string;
  ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean;
  defaultPrevented?: boolean;
  /** The element the key went to: typing in a field is never a shortcut. */
  target?: { tagName?: string; isContentEditable?: boolean; role?: string | null } | null;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** What a key asks of the plan: flip it (H), or bring it back (Esc, only while it is hidden). */
export function peekKeyAction(e: PeekKeyEvent, peek: boolean): 'toggle' | 'show' | null {
  if (e.defaultPrevented === true || e.repeat === true || e.ctrlKey === true || e.metaKey === true || e.altKey === true) return null;
  if (e.key === 'Escape') return peek ? 'show' : null;
  const t = e.target;
  const typing = t != null && (TYPING_TAGS.has((t.tagName ?? '').toUpperCase()) || t.isContentEditable === true
    || t.role === 'textbox');
  if (typing || e.shiftKey === true) return null;
  return e.key === 'h' || e.key === 'H' ? 'toggle' : null;
}
