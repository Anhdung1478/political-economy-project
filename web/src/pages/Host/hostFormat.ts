// Pure display helpers for /host (Task 26): label icons and shares, vote summaries, member sorting, progress text,
// award details and the per-day detail cells. No React, no DOM, so they run in node tests.
import type { Award, BoardMember, HostBoard, VoteChoice } from '../../../../shared/protocol';
import { CHOICE_LABELS } from '../../../../shared/protocol';
import type { CardId, ChoiceLabel, DaySummary, Phase, TeaGrade, UpgradeId } from '../../../../shared/sim/types';
import { fmtMoney, fmtMoneySigned, fmtNumber, fmtPercent } from '../../game/format';

/** Spec §11 "Nhãn lựa chọn". */
export const LABEL_INFO: Record<ChoiceLabel, { icon: string; text: string }> = {
  skimp: { icon: '🥄', text: 'Trà ăn bớt' },
  cartelKept: { icon: '🤝', text: 'Cartel, giữ lời' },
  cartelBroke: { icon: '🗡️', text: 'Cartel, phá lời' },
  shockTopping: { icon: '📦', text: 'Topping giá sốc' },
  blackMarket: { icon: '💵', text: 'Tiền chợ đen' },
  taxEvaded: { icon: '🐀', text: 'Khai gian thuế' },
  inspectPass: { icon: '✅', text: 'Kiểm định đạt' },
  inspectFail: { icon: '❌', text: 'Kiểm định trượt' },
};

export interface LabelShare { label: ChoiceLabel; icon: string; text: string; count: number; share: number }
/** Every label in `CHOICE_LABELS` order with its count and share of the `n` players who sent a day (0 when n = 0). */
export function labelShares(labels: HostBoard['overview']['labels']): LabelShare[] {
  return CHOICE_LABELS.map(label => {
    const count = labels.count[label] ?? 0;
    return { label, ...LABEL_INFO[label], count, share: labels.n > 0 ? count / labels.n : 0 };
  });
}

export const VOTE_TEXT: Record<VoteChoice, string> = { invisible: 'Vô hình', visible: 'Hữu hình' };
export const VOTE_SHORT: Record<VoteChoice, string> = { invisible: 'Vô', visible: 'Hữu' };

export interface VoteRow { choice: VoteChoice; text: string; before: number; after: number; beforeShare: number; afterShare: number }
/** Before → after for each choice, over the `n` players who voted both times. */
export function voteRows(votes: HostBoard['overview']['votes']): VoteRow[] {
  return (['invisible', 'visible'] as const).map(choice => ({
    choice, text: VOTE_TEXT[choice],
    before: votes.before[choice], after: votes.after[choice],
    beforeShare: votes.n > 0 ? votes.before[choice] / votes.n : 0,
    afterShare: votes.n > 0 ? votes.after[choice] / votes.n : 0,
  }));
}

/** One member's vote as `Vô → Hữu`, `Vô → ?`, `? → Hữu` or `—` when neither was sent. */
export function memberVoteText(vote: BoardMember['vote']): string {
  if (!vote.before && !vote.after) return '—';
  const s = (v: VoteChoice | null) => (v ? VOTE_SHORT[v] : '?');
  return `${s(vote.before)} → ${s(vote.after)}`;
}

export const PHASE_TEXT: Record<Phase, string> = { morning: 'Sáng', rush: 'Trưa', cards: 'Thẻ', report: 'Tối', end: 'Kết' };

/** The member's progress cell: lost or finished first, then `Ngày 3 · Trưa`, else not started. */
export function progressText(m: Pick<BoardMember, 'progress' | 'finished' | 'lost' | 'days'>): string {
  if (m.lost) return `Thua sớm · ngày ${m.days.length}`;
  if (m.finished) return 'Đã xong';
  if (m.progress) return `Ngày ${m.progress.day} · ${PHASE_TEXT[m.progress.phase]}`;
  return 'Chưa chơi';
}

export type SortKey = 'score' | 'name' | 'profit' | 'rep' | 'lastPrice' | 'cups' | 'wrong' | 'walkouts' | 'progress';
/** Text keys sort A→Z by default, number keys high→low. */
export const SORT_DEFAULT_DESC: Record<SortKey, boolean> = {
  score: true, name: false, profit: true, rep: true, lastPrice: true, cups: true, wrong: true, walkouts: true, progress: true,
};

/** How far along a member is, for sorting: days sent, plus the phase of the day in progress. */
function progressValue(m: BoardMember): number {
  if (m.finished) return 100 + m.days.length;
  if (!m.progress) return m.days.length * 10;
  const phase = ['morning', 'rush', 'cards', 'report', 'end'].indexOf(m.progress.phase);
  return Math.max(m.days.length * 10, (m.progress.day - 1) * 10 + phase);
}

/**
 * Sorts a copy of the members. Missing values (no day sent yet) always go last whatever the direction; ties keep
 * the board's order (score, then profit, then join order), so `score` desc is the server's order unchanged.
 */
export function sortMembers(members: readonly BoardMember[], key: SortKey, desc = SORT_DEFAULT_DESC[key]): BoardMember[] {
  const order = new Map(members.map((m, i) => [m.id, i]));
  const val = (m: BoardMember): number | string | null =>
    key === 'name' ? m.name : key === 'progress' ? progressValue(m) : m[key];
  return [...members].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1;
    } else if (va !== vb) {
      const c = typeof va === 'string' ? va.localeCompare(vb as string, 'vi') : (va as number) - (vb as number);
      if (c !== 0) return desc ? -c : c;
    }
    return order.get(a.id)! - order.get(b.id)!;
  });
}

/** The award's "what won it" line. */
export function awardDetail(a: Pick<Award, 'id' | 'value'>): string {
  switch (a.id) {
    case 'tycoon': return `Điểm ${fmtMoney(a.value)}`;
    case 'beloved': return `Uy tín cuối ${fmtNumber(a.value, 0)}`;
    case 'hoarder': return `Bỏ đi ${fmtMoney(a.value)} nguyên liệu`;
    case 'goldenHand': return `Chỉ ${fmtPercent(a.value, 1)} ly giao sai`;
  }
}

export const TEA_TEXT: Record<TeaGrade, string> = { skimp: 'Ăn bớt', standard: 'Thường', premium: 'Thượng hạng' };
export const UPGRADE_TEXT: Record<UpgradeId, string> = { staff: 'Nhân viên', machine: 'Máy pha', banner: 'Băng rôn' };
export const CARD_TEXT: Record<CardId, string> = {
  cartel: 'Cartel', shockTopping: 'Topping sốc', blackMarket: 'Chợ đen', tax: 'Thuế', inspection: 'Kiểm định',
  reporter: 'Phóng viên', kol: 'KOL', tab: 'Ghi nợ', student: 'Sinh viên', complaint: 'Phàn nàn',
  deliveryAd: 'App giao hàng', scholarship: 'Khuyến học',
};

/** The class average price for one day: `28k → 31k` (open → close), `—` when nobody sent that day. */
export function avgPriceText(p: { open: number | null; close: number | null }): string {
  if (p.open === null || p.close === null) return '—';
  return `${fmtMoney(p.open)} → ${fmtMoney(p.close)}`;
}

const ml = (n: number) => `${fmtNumber(n / 1000, 1)}L`;
const toppings = (t: DaySummary['bought']['toppings']) => `${t.pearl}/${t.jelly}/${t.pudding}`;

/** One row of the per-day detail table, every cell already a string, in `DAY_COLUMNS` order. */
export const DAY_COLUMNS = ['Ngày', 'Giá', 'Trà', 'Trà mua/dùng', 'Topping mua/dùng', 'Bỏ đi', 'Ly', 'Sai', 'Bỏ về',
  'Doanh thu', 'Chi phí', 'Thuế', 'Phạt', 'Lãi', 'Tiền', 'Uy tín', 'Điểm', 'Nâng cấp', 'Thẻ', 'Nhãn'] as const;
export function dayCells(d: DaySummary): string[] {
  return [
    `${d.day}${d.lost ? ' ☠' : ''}`,
    d.openPrice === d.closePrice ? fmtMoney(d.openPrice) : `${fmtMoney(d.openPrice)} → ${fmtMoney(d.closePrice)}`,
    TEA_TEXT[d.tea],
    `${ml(d.bought.teaMl)} / ${ml(d.used.teaMl)}`,
    `${toppings(d.bought.toppings)} / ${toppings(d.used.toppings)}`,
    fmtMoney(d.wasteValue),
    String(d.cups), String(d.wrong), String(d.walkouts),
    fmtMoney(d.revenue), fmtMoney(d.cost), fmtMoney(d.tax), fmtMoney(d.fines),
    fmtMoneySigned(d.profit), fmtMoney(d.cash), fmtNumber(d.rep, 0), fmtMoney(d.score),
    d.upgrade ? UPGRADE_TEXT[d.upgrade] : '—',
    d.cards.length ? d.cards.map(c => `${CARD_TEXT[c.id]} ${c.choice}`).join(', ') : '—',
    d.labels.length ? d.labels.map(l => LABEL_INFO[l].icon).join(' ') : '—',
  ];
}

/** `null` → `—`, else the formatter's text. */
export const orDash = <T>(v: T | null, f: (v: T) => string) => (v === null ? '—' : f(v));
