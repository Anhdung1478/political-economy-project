// Afternoon character cards (spec §7): their content, which cards a day deals, and what a choice does.
import { CONFIG, type SimConfig } from './config';
import { shuffle, stream } from './rng';
import type {
  CardId, Choice, Day, PendingEffect, RepItem, RunFlags, RunState, SideCardId,
} from './types';

/** Indicators a card option shows (💰 tiền, ⭐ uy tín, 🧋 hàng, 🏛️ pháp luật) — never the numbers (§7). */
export type Affect = 'cash' | 'rep' | 'stock' | 'law';
export interface CardOption { label: string; affects: Affect[] }
export interface CardDef {
  id: CardId; kind: 'story' | 'side'; speaker: string;
  /** One or two lines of dialogue. */
  lines: string[];
  a: CardOption; b: CardOption;
}

const opt = (label: string, ...affects: Affect[]): CardOption => ({ label, affects });

export const CARDS: Record<CardId, CardDef> = {
  cartel: {
    id: 'cartel', kind: 'story', speaker: 'Đại diện Chuỗi Tập Đoàn',
    lines: [
      `Mai bọn anh khai trương đầu phố. Hay là cả phố cùng bán ${CONFIG.cards.cartel.price}k nhé?`,
      'Không ai phá giá, ai cũng béo. Còn khách thì… khách nào chẳng phải uống.',
    ],
    a: opt('Bắt tay, cả phố cùng giàu', 'cash', 'rep', 'law'),
    b: opt('Thôi, giá ai nấy định', 'rep'),
  },
  shockTopping: {
    id: 'shockTopping', kind: 'story', speaker: 'Nhà cung cấp lạ mặt',
    lines: [
      'Trân châu, thạch, pudding đây, giá sốc tận đáy! Nguồn gốc à? Khỏi hỏi, hỏi là hết vui.',
    ],
    a: opt('Lấy luôn, rẻ là được', 'cash', 'rep', 'stock'),
    b: opt('Thôi, em sợ đau bụng'),
  },
  blackMarket: {
    id: 'blackMarket', kind: 'story', speaker: 'Khách đứng cuối hàng',
    lines: [
      'Xếp hàng mỏi chân quá. Bán cho em giá gấp đôi cũng được, ai mà biết!',
      'Tiền đây, nhét túi lẹ đi chủ quán.',
    ],
    a: opt('Nhận tiền, bán cửa sau', 'cash', 'rep', 'law'),
    b: opt('Đúng giá trần, xếp hàng đi em', 'rep'),
  },
  tax: {
    id: 'tax', kind: 'story', speaker: 'Cán bộ phường',
    lines: [
      'Tờ khai thuế hôm nay đây. Tiền thuế để xây trạm xe buýt cho cả phố nhé.',
      'Bán bao nhiêu ly thì khai bấy nhiêu, phường tin quán mình.',
    ],
    a: opt('Khai đủ, đóng đủ'),
    b: opt('Khai gian, coi như hôm nay ế', 'cash', 'rep', 'law'),
  },
  inspection: {
    id: 'inspection', kind: 'story', speaker: 'Nhân viên trung tâm kiểm định',
    lines: [
      'Trên mạng đang đồn trà sữa phố này pha bằng nước rửa chén. Ghê chưa!',
      'Quán mình kiểm định luôn cho yên tâm không? Làm ăn sạch thì sợ gì, đúng không?',
    ],
    a: opt('Tự trả tiền kiểm định', 'cash', 'rep', 'law'),
    b: opt('Chờ nhà nước kiểm định', 'rep', 'law'),
  },
  reporter: {
    id: 'reporter', kind: 'story', speaker: 'Phóng viên',
    lines: [
      'Một tuần sóng gió trên phố trà sữa. Theo bạn, bàn tay nào cứu phố này?',
    ],
    a: opt('Bàn tay vô hình (thị trường)'),
    b: opt('Bàn tay hữu hình (nhà nước)'),
  },
  kol: {
    id: 'kol', kind: 'side', speaker: 'KOL ẩm thực',
    lines: [
      'Cho em xin vài ly free để review nha. Em có mấy chục nghìn follow, toàn người thật đó!',
    ],
    a: opt('Mời luôn, review có tâm nha', 'cash', 'rep'),
    b: opt('Quán nhỏ, không có ly free', 'rep'),
  },
  tab: {
    id: 'tab', kind: 'side', speaker: 'Khách quen',
    lines: [
      'Chết, chị quên ví ở nhà rồi. Ghi sổ giùm chị nha, mai mốt chị trả, có khi còn dắt bạn tới.',
    ],
    a: opt('Ghi sổ cho chị', 'cash', 'rep'),
    b: opt('Quán không bán chịu đâu chị', 'rep'),
  },
  student: {
    id: 'student', kind: 'side', speaker: 'Bạn sinh viên',
    lines: [
      'Mai cho em phụ quán một hôm nhé, công xá sinh viên thôi. Em pha nhanh lắm, chỉ hơi hay uống thử.',
    ],
    a: opt('Nhận em, mai đi làm sớm', 'cash', 'stock'),
    b: opt('Thôi, quán tự lo được'),
  },
  complaint: {
    id: 'complaint', kind: 'side', speaker: 'Khách khó tính',
    lines: [
      'Ly hôm nay nhạt như nước ốc! Đền đi, không là chị đăng lên nhóm khu phố đấy.',
    ],
    a: opt('Xin lỗi chị, quán xin đền', 'cash', 'rep'),
    b: opt('Trà quán em đậm lắm mà', 'rep'),
  },
  deliveryAd: {
    id: 'deliveryAd', kind: 'side', speaker: 'Nhân viên app giao hàng',
    lines: [
      'Chạy quảng cáo bên em đi anh chị. Mai khách sang lướt app là thấy quán mình đầu tiên!',
    ],
    a: opt('Chạy quảng cáo', 'cash', 'stock'),
    b: opt('Thôi, khách quen là đủ'),
  },
  scholarship: {
    id: 'scholarship', kind: 'side', speaker: 'Bác tổ trưởng dân phố',
    lines: [
      'Phường đang vận động góp quỹ khuyến học cho các cháu. Quán làm ăn được thì góp chút lấy tiếng thơm nhé!',
    ],
    a: opt('Góp quỹ, vì các cháu', 'cash', 'rep'),
    b: opt('Để dịp khác bác ạ'),
  },
};

const SIDE_CARDS: readonly SideCardId[] = ['kol', 'tab', 'student', 'complaint', 'deliveryAd', 'scholarship'];

/** Order of the six side cards for the run (stream `side-deck`). */
export function shuffleSideDeck(seed: number): SideCardId[] {
  return shuffle(SIDE_CARDS, stream(seed, 'side-deck'));
}

const isSide = (card: CardId): card is SideCardId => CARDS[card].kind === 'side';

/** The student card is not dealt to a shop that already has staff (§7). */
const eligible = (run: RunState, card: SideCardId) => !(card === 'student' && run.upgrades.includes('staff'));

/**
 * Cards of the afternoon of `run.day`: on days with a side card, the first card of the shuffled deck that has
 * not been drawn and is eligible, then the day's story cards (§3, §7, §16 row 14).
 */
export function cardsForDay(run: RunState, cfg: SimConfig = CONFIG): CardId[] {
  const sched = cfg.days[run.day];
  const side = sched.sideCard
    ? run.sideDeck.find(c => !run.sideDrawn.includes(c) && eligible(run, c))
    : undefined;
  return side === undefined ? [...sched.storyCards] : [side, ...sched.storyCards];
}

interface Effect {
  cash?: number;
  /** Rep the same evening (cardRep). */
  rep?: number;
  flags?: Partial<RunFlags>;
  /** Effects on the morning `delay` days later. */
  later?: { delay: number } & Omit<PendingEffect, 'day' | 'source'>;
}

/** What one option does to the run, from the config. */
function effectOf(run: RunState, card: CardId, choice: Choice, cfg: SimConfig): Effect {
  const c = cfg.cards;
  const a = choice === 'A';
  switch (card) {
    case 'cartel':
      // Fines and the break penalty are settled on the evening of day 2 from the flags (Task 10).
      return a ? { flags: { cartel: 'agreed' } } : { flags: { cartel: 'refused' }, rep: c.cartel.refuseRep };
    case 'shockTopping':
      // The cheap toppings, skimp days and evening rep of days 3–4 come from the flag (Tasks 9–10).
      return a ? { flags: { shockTopping: true } } : {};
    case 'blackMarket':
      return a
        ? { cash: c.blackMarket.cash, flags: { blackMarket: true },
          later: { delay: c.blackMarket.exposeDelayDays, rep: c.blackMarket.exposeRep } }
        : { rep: c.blackMarket.refuseRep };
    case 'tax': {
      if (a) return {};
      if (run.rushResult === null) throw new Error('tax card needs the day result');
      return { cash: run.rushResult.player.tax, flags: { taxEvaded: true }, rep: c.tax.evadeRep };
    }
    case 'inspection': {
      if (!a) return { flags: { inspection: 'wait' } };
      const pass = run.skimpDays < cfg.rumor.failSkimpDays;
      return pass
        ? { cash: -c.inspection.cost, flags: { inspection: 'pass' } }
        : { cash: -c.inspection.cost, flags: { inspection: 'fail' }, rep: c.inspection.failRep };
    }
    case 'reporter':
      return { flags: { reporter: choice } };
    case 'kol':
      return a
        ? { cash: c.kol.acceptCash, later: { delay: c.kol.acceptDelayDays, rep: c.kol.acceptRep } }
        : { rep: c.kol.declineRep };
    case 'tab':
      return a
        ? { cash: c.tab.acceptCash, later: { delay: c.tab.repayDelayDays, cash: c.tab.repayCash, rep: c.tab.repayRep } }
        : { rep: c.tab.declineRep };
    case 'student':
      return a ? { cash: c.student.acceptCash, later: { delay: c.student.staffDelayDays, tempStaff: true } } : {};
    case 'complaint':
      return a ? { cash: c.complaint.acceptCash, rep: c.complaint.acceptRep } : { rep: c.complaint.declineRep };
    case 'deliveryAd':
      return a
        ? { cash: c.deliveryAd.acceptCash, later: { delay: c.deliveryAd.delayDays, adCustomers: c.deliveryAd.customers } }
        : {};
    case 'scholarship':
      return a ? { cash: c.scholarship.acceptCash, rep: c.scholarship.acceptRep } : {};
  }
}

/**
 * The player picks `choice` on `card` (R23). Cash moves now, even below the credit floor (§16 row 14); rep of the
 * day goes to `cardRep` for the evening; later effects go to `pending` for that morning. Records the choice and,
 * for a side card, the draw. Does not move `cardIndex` (chooseCard does).
 */
export function applyChoice(run: RunState, card: CardId, choice: Choice, cfg: SimConfig = CONFIG): RunState {
  const e = effectOf(run, card, choice, cfg);
  const cardRep: RepItem[] = e.rep === undefined
    ? run.cardRep
    : [...run.cardRep, { reason: card, delta: e.rep, when: 'evening' }];
  let pending = run.pending;
  if (e.later !== undefined) {
    const { delay, ...rest } = e.later;
    const day = run.day + delay;
    if (day > cfg.run.dayCount) throw new Error(`${card} lands after the last day`);
    pending = [...pending, { day: day as Day, source: card, ...rest }];
  }
  return {
    ...run,
    cash: run.cash + (e.cash ?? 0),
    flags: e.flags === undefined ? run.flags : { ...run.flags, ...e.flags },
    cardRep,
    pending,
    choices: [...run.choices, { id: card, choice }],
    sideDrawn: isSide(card) ? [...run.sideDrawn, card] : run.sideDrawn,
  };
}
