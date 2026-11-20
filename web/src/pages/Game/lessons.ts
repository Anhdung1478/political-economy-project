// The evening lesson card (spec §3 "Bài học", §8) and the end screen's lessons (§8 "Màn kết"): the sentences, filled
// with the run's real numbers. Pure: everything comes from the day report, the run and the config, nothing from the
// screen. The lesson of each day follows spec §3's lesson column; the variants follow the player's choices.
import { CONFIG, type SimConfig } from '../../../../shared/sim/config';
import type {
  AiShopId, AiShopState, Day, DayReport, K, RunState, ShopDayResult, ThemeId,
} from '../../../../shared/sim/types';
import { fmtMoney, fmtNumber } from '../../game/format';
import { SHOP_NAMES } from './copy';

/** Which hand the lesson is about: the market alone, the state stepping in, or information. */
export type Hand = 'invisible' | 'visible';

export interface LessonStat {
  /** Short, e.g. "Giá sáng" */
  label: string;
  /** Already formatted, e.g. "28–34k" */
  value: string;
  tone?: 'good' | 'bad' | 'info';
}

export interface LessonText {
  hand: Hand;
  /** "Bàn tay vô hình" */
  kicker: string;
  title: string;
  /** The day's numbers as chips. */
  stats: LessonStat[];
  /** What happened today, in numbers. */
  story: string[];
  /** The rule behind it, the sentence to remember. */
  moral: string;
}

// ── Day 1: convergence ──────────────────────────────────────────────────────────────────────────────────────────────

export interface Convergence {
  /** Shops that sold today, the player included. */
  shops: number;
  /** Of those, how many ended the rush at another price than they opened at. */
  changed: number;
  openMean: K;
  closeMean: K;
  /** Mean absolute distance from the mean price, at open and at close (k, one decimal). */
  openSpread: number;
  closeSpread: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const meanOf = (xs: readonly number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);
const spreadOf = (xs: readonly number[]) => {
  const m = meanOf(xs);
  return meanOf(xs.map(x => Math.abs(x - m)));
};

/** The opening and closing price of a shop that sold, from its trail. */
export function openClose(s: Pick<ShopDayResult, 'trail'>): { open: K; close: K } | null {
  if (s.trail.length === 0) return null;
  return { open: s.trail[0][1], close: s.trail[s.trail.length - 1][1] };
}

/**
 * How far the street's prices drew together during the rush (balance review, day 1): how many shops moved their
 * price, and the mean distance from the street's mean price at open and at close, from every selling shop's trail.
 */
export function convergence(street: readonly Pick<ShopDayResult, 'trail'>[]): Convergence {
  const rows = street.map(openClose).filter((x): x is { open: K; close: K } => x !== null);
  const open = rows.map(r => r.open);
  const close = rows.map(r => r.close);
  return {
    shops: rows.length,
    changed: rows.filter(r => r.open !== r.close).length,
    openMean: round1(meanOf(open)),
    closeMean: round1(meanOf(close)),
    openSpread: round1(spreadOf(open)),
    closeSpread: round1(spreadOf(close)),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const k = (n: number) => fmtMoney(n);
const range = (lo: number, hi: number) => (lo === hi ? `${fmtNumber(lo)}k` : `${fmtNumber(lo)}–${fmtNumber(hi)}k`);
const pct = (part: number, whole: number) => (whole <= 0 ? 0 : Math.round((part / whole) * 100));
const num = (data: Record<string, number>, key: string) => data[key] ?? 0;
const inspectionSecond = (cfg: SimConfig) => Math.round(cfg.rumor.inspectionTick * cfg.rush.tickMs / 1000);

const INVISIBLE = 'Bàn tay vô hình';
const VISIBLE = 'Bàn tay hữu hình';

// ── The lesson card ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The evening's lesson card: `report.lesson` (id and numbers from the sim), plus what the report and the run add
 * (the trails for the day-1 convergence, the day's choices, the ceiling and tax rules).
 */
export function lessonText(report: DayReport, run: Pick<RunState, 'flags'>, cfg: SimConfig = CONFIG): LessonText {
  const { id, data } = report.lesson;
  const day = report.summary.day;
  const rules = cfg.days[day];
  const labels = report.summary.labels;
  switch (id) {
    case 'freeMarket': {
      const c = convergence(report.street);
      const tighter = c.closeSpread < c.openSpread;
      const story = [
        `Sáng nay giá trên phố từ ${range(num(data, 'openMin'), num(data, 'openMax'))}. `
          + `Đến cuối trưa còn ${range(num(data, 'closeMin'), num(data, 'closeMax'))}.`,
        c.changed === 0
          ? 'Trưa nay chưa quán nào đổi giá: mai các quán sẽ nhìn bảng giá của nhau mà chỉnh.'
          : tighter
            ? `${c.changed}/${c.shops} quán tự đổi giá giữa trưa. Giá mỗi quán cách mức trung bình `
              + `±${fmtNumber(c.openSpread)}k lúc mở cửa, còn ±${fmtNumber(c.closeSpread)}k lúc đóng cửa: giá đang chụm lại.`
            : `${c.changed}/${c.shops} quán tự đổi giá giữa trưa, độ lệch so với giá trung bình `
              + `±${fmtNumber(c.openSpread)}k → ±${fmtNumber(c.closeSpread)}k. Chưa chụm hẳn, nhưng ai cũng đang dò giá của nhau.`,
      ];
      return {
        hand: 'invisible', kicker: INVISIBLE, title: 'Không ai ra lệnh, giá vẫn tự tìm về một mức',
        stats: [
          { label: 'Giá lúc mở', value: range(num(data, 'openMin'), num(data, 'openMax')) },
          { label: 'Giá lúc đóng', value: range(num(data, 'closeMin'), num(data, 'closeMax')), tone: 'info' },
          { label: 'Quán đổi giá', value: `${c.changed}/${c.shops}` },
          { label: 'Độ lệch giá', value: `±${fmtNumber(c.openSpread)}k → ±${fmtNumber(c.closeSpread)}k`, tone: tighter ? 'good' : undefined },
        ],
        story,
        moral: 'Mỗi quán chỉ lo cho mình: đắt quá thì ế, rẻ quá thì lỗ. Nhìn nhau chỉnh giá, '
          + 'cả phố tự kéo về một mức chung. Đó là bàn tay vô hình của thị trường.',
      };
    }
    case 'entryRefused': {
      const a1 = num(data, 'avgClose1');
      const a2 = num(data, 'avgClose2');
      const fell = a2 < a1;
      return {
        hand: 'invisible', kicker: INVISIBLE, title: 'Lãi cao hút người mới, giá bị kéo xuống',
        stats: [
          { label: 'Giá TB hôm qua', value: k(a1) },
          { label: 'Giá TB hôm nay', value: k(a2), tone: fell ? 'good' : undefined },
          { label: 'Quán mới', value: SHOP_NAMES.tapdoan },
        ],
        story: [
          `Thấy phố bán lãi, Chuỗi Tập Đoàn mở quán và bán rẻ để giành khách. Giá đóng cửa trung bình `
            + (fell ? `từ ${k(a1)} hôm qua xuống ${k(a2)} hôm nay.` : `hôm qua ${k(a1)}, hôm nay ${k(a2)}.`),
          'Bảng giá sáng nay giống nhau không phải vì các quán hẹn nhau: các quán giảm giá theo quán mới để giữ khách. '
            + 'Bạn đã từ chối bắt tay, nên giá vẫn do từng quán tự định.',
        ],
        moral: 'Đó là cạnh tranh: quán mới vào chia khách, ai cũng phải hạ giá, người mua được lợi. '
          + 'Không cần ai ra lệnh.',
      };
    }
    case 'cartelKept': {
      const a1 = num(data, 'avgClose1');
      const a2 = num(data, 'avgClose2');
      const fine = num(data, 'fine');
      return {
        hand: 'visible', kicker: VISIBLE, title: 'Bắt tay nâng giá là khuyết tật của thị trường',
        stats: [
          { label: 'Giá TB hôm qua', value: k(a1) },
          { label: 'Giá TB hôm nay', value: k(a2), tone: 'bad' },
          { label: 'Tiền phạt', value: k(fine), tone: 'bad' },
        ],
        story: [
          `Hôm qua giá đóng cửa trung bình ${k(a1)}. Hôm nay cả phố cùng giữ giá cao ${k(cfg.cards.cartel.price)}, `
            + `trung bình ${k(a2)}. Quán mới vào mà giá không giảm: khách hết đường chọn.`,
          `Đây không phải cạnh tranh mà là thông đồng: các quán hẹn nhau cùng giữ giá cao. `
            + `Cục Cạnh tranh phạt bạn ${k(fine)}.`,
        ],
        moral: 'Khi người bán bắt tay nhau, bàn tay vô hình bị trói: giá không còn tự giảm. '
          + 'Nhà nước phải phạt để giữ cạnh tranh.',
      };
    }
    case 'cartelBroke': {
      const a1 = num(data, 'avgClose1');
      const a2 = num(data, 'avgClose2');
      const fine = num(data, 'fine');
      return {
        hand: 'visible', kicker: VISIBLE, title: 'Thoả thuận giữ giá luôn có kẻ phá',
        stats: [
          { label: 'Giá hẹn', value: k(cfg.cards.cartel.price) },
          { label: 'Giá TB hôm nay', value: k(a2) },
          { label: 'Tiền phạt', value: k(fine), tone: 'bad' },
        ],
        story: [
          `Cả phố hẹn nhau cùng giữ giá cao ${k(cfg.cards.cartel.price)}, còn bạn lén bán rẻ hơn và hốt khách của cả phố. `
            + `Giá đóng cửa trung bình hôm qua ${k(a1)}, hôm nay ${k(a2)}.`,
          `Ai phá trước thì lời, nên thoả thuận kiểu này khó giữ. Nhưng đã ký là đã thông đồng: phạt ${k(fine)}, `
            + 'và sáng mai cả phố nói xấu bạn.',
        ],
        moral: 'Bắt tay nâng giá là khuyết tật thị trường, dù có giữ lời hay không. '
          + 'Nhà nước phạt để các quán quay về cạnh tranh.',
      };
    }
    case 'ceiling': {
      const empty = num(data, 'emptyHanded');
      const eligible = num(data, 'eligible');
      const resting = num(data, 'resting');
      const ceiling = rules.ceiling ?? 0;
      const black = labels.includes('blackMarket');
      return {
        hand: 'visible', kicker: VISIBLE, title: 'Giá trần thấp: người mua tăng, người bán rút lui',
        stats: [
          { label: 'Trần', value: k(ceiling) },
          { label: 'Về tay không', value: `${empty}/${eligible} khách`, tone: 'bad' },
          { label: 'Quán nghỉ bán', value: String(resting), tone: resting > 0 ? 'bad' : undefined },
        ],
        story: [
          `Hôm nay ${eligible} khách đủ tiền mua một ly, nhưng ${empty} người (${pct(empty, eligible)}%) xếp hàng rồi về tay không.`,
          resting > 0
            ? `${resting} quán nghỉ bán: bán dưới ${k(ceiling)} không đủ bù giá vốn. Giá rẻ hơn, mà trà lại ít đi.`
            : `Quán nào cũng bán ở trần ${k(ceiling)} và hết hàng sớm: giá rẻ hơn, mà trà vẫn không đủ.`,
          black
            ? 'Có người dúi thêm tiền để mua vượt trần, và quán bạn đã bán cửa sau: chợ đen sinh ra như thế.'
            : 'Có người dúi thêm tiền để mua vượt trần: chợ đen sinh ra như thế. Bạn đã từ chối.',
        ],
        moral: 'Giá trần thấp hơn giá cân bằng thì người mua tăng, người bán rút lui, '
          + 'khách xếp hàng mà không mua được. Bàn tay hữu hình đặt sai mức cũng gây hại.',
      };
    }
    case 'tax': {
      const fund = num(data, 'taxFund');
      const tax = num(data, 'tax');
      const evaded = num(data, 'evaded') === 1 || run.flags.taxEvaded;
      return {
        hand: 'visible', kicker: VISIBLE, title: evaded ? 'Trốn thuế mà vẫn được hưởng: người ăn theo' : 'Thuế làm lãi mỏng đi, nhưng xây được trạm xe buýt',
        stats: [
          { label: 'Quỹ thuế cả phố', value: k(fund), tone: 'info' },
          { label: evaded ? 'Bạn khai gian' : 'Phần của bạn', value: k(tax), tone: evaded ? 'bad' : undefined },
          { label: 'Mỗi ly', value: k(rules.taxPerCup) },
        ],
        story: evaded
          ? [
            `Cả phố nộp ${k(fund)} thuế để phường xây trạm xe buýt. Bạn khai gian và lấy lại ${k(tax)}.`,
            'Vậy mà trạm vẫn được xây, và ngày mai xe buýt vẫn chở khách tới quán bạn. '
              + 'Hưởng mà không góp: đó là bài toán người ăn theo. Nếu quán nào cũng như bạn, phố chẳng có trạm nào.',
          ]
          : [
            `Mỗi ly bán ra nộp ${k(rules.taxPerCup)}. Cả phố nộp ${k(fund)}, phần của bạn ${tax > 0 ? k(tax) : 'là 0k vì không bán được ly nào'}.`,
            'Lãi mỗi ly mỏng đi, nhưng phường đủ tiền xây trạm xe buýt: ngày mai phố có thêm khách, quán nào cũng hưởng.',
          ],
        moral: 'Thuế làm lãi giảm nhưng xây được thứ cả phố cùng hưởng, thứ không quán nào tự xây. '
          + 'Ai trốn thuế vẫn được hưởng, nên nhà nước phải thu đủ của mọi người.',
      };
    }
    case 'rumor': {
      const scared = num(data, 'scared');
      const certified = num(data, 'certified');
      const named = num(data, 'named');
      const without = num(data, 'without');
      const withBus = num(data, 'with');
      return {
        hand: 'visible', kicker: VISIBLE, title: 'Thị trường không tự sửa được tin đồn',
        stats: [
          { label: 'Khách sợ bỏ đi', value: String(scared), tone: 'bad' },
          { label: 'Quán đạt kiểm định', value: String(certified), tone: 'good' },
          { label: 'Bị nêu tên', value: String(named), tone: named > 0 ? 'bad' : undefined },
          { label: 'Khách nhờ trạm xe buýt', value: `${without} → ${withBus}`, tone: 'info' },
        ],
        story: [
          `Tin đồn nước rửa chén làm ${scared} khách sợ, bỏ cả phố mà đi. Người mua không biết quán nào sạch, nên tẩy chay hết.`,
          `Giây ${inspectionSecond(cfg)} nhà nước công bố kiểm định: ${certified} quán đạt`
            + (named > 0 ? `, ${named} quán bị nêu tên.` : ', không quán nào bị nêu tên.') + ' Khách quay lại.',
          `Trạm xe buýt xây bằng tiền thuế hôm qua đưa phố từ ${without} lên ${withBus} khách.`,
        ],
        moral: 'Thông tin là thứ thị trường không tự sửa được: nhà nước kiểm định và công bố thì người mua mới tin lại.',
      };
    }
  }
}

// ── The end screen ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface ChoiceLesson {
  key: 'cartel' | 'shockTopping' | 'blackMarket' | 'tax' | 'inspection';
  /** "Cartel" */
  topic: string;
  /** What the player did. */
  did: string;
  /** The lesson that goes with it. */
  lesson: string;
  tone: 'good' | 'bad' | 'neutral';
}

/**
 * The player's story choices over the run and their lessons (§8 "Tóm tắt lựa chọn"): cartel, shock toppings, black
 * market, tax, inspection. Only the ones the run reached (a run lost on day 2 has no tax line).
 */
export function choiceLessons(run: Pick<RunState, 'flags' | 'reports'>, cfg: SimConfig = CONFIG): ChoiceLesson[] {
  const answered = new Set(run.reports.flatMap(r => r.summary.cards.map(c => c.id)));
  const labels = new Set(run.reports.flatMap(r => r.summary.labels));
  const f = run.flags;
  const out: ChoiceLesson[] = [];
  if (answered.has('cartel')) {
    if (f.cartel === 'refused') {
      out.push({ key: 'cartel', topic: 'Bắt tay giữ giá', did: 'Bạn từ chối.', tone: 'good',
        lesson: 'Giá vẫn do từng quán tự định và phải giành khách bằng giá: cạnh tranh có lợi cho người mua.' });
    } else if (labels.has('cartelBroke') || f.cartelBroken) {
      out.push({ key: 'cartel', topic: 'Bắt tay giữ giá', did: 'Bạn đồng ý rồi lén phá giá.', tone: 'bad',
        lesson: `Thoả thuận giữ giá luôn có kẻ phá, nhưng ký rồi vẫn bị phạt ${k(cfg.cards.cartel.fine)}: thông đồng là khuyết tật thị trường.` });
    } else if (labels.has('cartelKept')) {
      out.push({ key: 'cartel', topic: 'Bắt tay giữ giá', did: `Bạn đồng ý và giữ ${k(cfg.cards.cartel.price)}.`, tone: 'bad',
        lesson: `Cả phố cùng giữ giá cao thì khách hết đường chọn; nhà nước phạt ${k(cfg.cards.cartel.fine)} để giữ cạnh tranh.` });
    } else {
      out.push({ key: 'cartel', topic: 'Bắt tay giữ giá', did: 'Bạn đồng ý.', tone: 'bad',
        lesson: 'Bắt tay nâng giá là khuyết tật thị trường, nhà nước phải phạt.' });
    }
  }
  if (answered.has('shockTopping')) {
    out.push(f.shockTopping
      ? { key: 'shockTopping', topic: 'Topping giá sốc', did: 'Bạn nhập hàng không rõ nguồn gốc.', tone: 'bad',
        lesson: 'Rẻ hôm nay, mất uy tín mỗi tối, và trượt kiểm định nếu tin đồn tới: người mua không thấy được chất lượng, người bán dễ ăn gian.' }
      : { key: 'shockTopping', topic: 'Topping giá sốc', did: 'Bạn không nhập.', tone: 'good',
        lesson: 'Giữ hàng sạch thì không sợ kiểm định: uy tín là tài sản của quán.' });
  }
  if (answered.has('blackMarket')) {
    out.push(f.blackMarket
      ? { key: 'blackMarket', topic: 'Chợ đen ngày giá trần', did: 'Bạn bán cửa sau.', tone: 'bad',
        lesson: 'Giá trần thấp hơn giá cân bằng sinh ra chợ đen; bị bóc phốt thì mất uy tín.' }
      : { key: 'blackMarket', topic: 'Chợ đen ngày giá trần', did: 'Bạn bán đúng giá trần.', tone: 'good',
        lesson: 'Giá trần làm khách xếp hàng mà không mua được; bán đúng luật thì giữ được uy tín.' });
  }
  if (answered.has('tax')) {
    out.push(f.taxEvaded
      ? { key: 'tax', topic: 'Thuế xây trạm xe buýt', did: 'Bạn khai gian · ăn theo.', tone: 'bad',
        lesson: 'Không góp mà vẫn hưởng trạm xe buýt: bài toán người ăn theo. Ai cũng thế thì chẳng có trạm nào.' }
      : { key: 'tax', topic: 'Thuế xây trạm xe buýt', did: 'Bạn khai đủ.', tone: 'good',
        lesson: 'Thuế làm lãi giảm nhưng xây được thứ cả phố cùng hưởng.' });
  }
  if (answered.has('inspection')) {
    const by: Record<RunState['flags']['inspection'], [string, string, ChoiceLesson['tone']]> = {
      pass: ['Bạn tự trả tiền kiểm định và đạt.', 'Quán sạch tự chứng minh được thì khách tin ngay từ sáng.', 'good'],
      fail: ['Bạn tự trả tiền kiểm định và trượt.', 'Ăn bớt thì kiểm định sẽ lộ: thông tin thật làm người ăn gian mất khách.', 'bad'],
      wait: ['Bạn chờ nhà nước kiểm định.', 'Nhà nước kiểm định và công bố cho cả phố: thông tin là hàng hoá công.', 'neutral'],
      none: ['Bạn chưa chọn.', 'Nhà nước kiểm định và công bố thì người mua mới tin lại.', 'neutral'],
    };
    const [did, lesson, tone] = by[f.inspection];
    out.push({ key: 'inspection', topic: 'Kiểm định tin đồn', did, lesson, tone });
  }
  return out;
}

export interface ShopExit {
  id: AiShopId;
  name: string;
  closedOn: Day;
  /** Why, in one sentence, from its losing days. */
  why: string;
}

const DAY_SQUEEZE: Record<ThemeId, string> = {
  opening: 'ngày khai trương bán ế',
  newShop: 'Chuỗi Tập Đoàn vào phố kéo giá xuống',
  priceCeiling: 'giá trần không đủ bù giá vốn',
  tax: 'thuế mỗi ly ăn vào lãi',
  rumor: 'tin đồn làm khách sợ',
};

/**
 * The AI shops that did not survive (§8 "quán nào không trụ được"), in street order, each with the losing days that
 * closed it. Explains the day-4 exit cluster: the entrant, the ceiling and the tax all squeeze the high-cost shops.
 */
export function shopExits(shops: readonly AiShopState[], cfg: SimConfig = CONFIG): ShopExit[] {
  return shops.filter(s => s.status === 'closed' && s.closedOn !== null).map(s => {
    const closedOn = s.closedOn as Day;
    const losing = s.history.filter(h => h.day <= closedOn && h.day > closedOn - cfg.aiPricing.exitLossDays && h.profit < 0);
    const reasons = [...new Set(losing.map(h => (h.rested ? `ngày ${h.day} ${DAY_SQUEEZE[cfg.days[h.day].theme]} nên phải nghỉ bán, mà vẫn trả tiền mặt bằng` : DAY_SQUEEZE[cfg.days[h.day].theme])))];
    const cost = cfg.aiShops[s.id].cost;
    const days = losing.map(h => h.day).join(' và ');
    return {
      id: s.id, name: SHOP_NAMES[s.id], closedOn,
      why: `Giá vốn ${k(cost)}/ly, lỗ ngày ${days}: ${reasons.join('; ')}.`,
    };
  });
}

/** The line under the exit list: why so many shops close around day 4. */
export function exitMoral(exits: readonly ShopExit[]): string | null {
  if (exits.length === 0) return null;
  return 'Quán mới, giá trần rồi thuế dồn dập trong ba ngày: quán nào giá vốn cao, lãi mỏng thì không trụ nổi. '
    + 'Thị trường đào thải người bán kém hiệu quả, còn chính sách thì làm việc đào thải ấy nhanh hơn.';
}

/**
 * The end screen's epilogue (§8 "Đoạn kết"): the street recovering after the inspection, or "Mất hết lòng tin" when
 * rep reached 0; the player's shop, the shops that did not survive, the free rider.
 */
export function epilogue(run: Pick<RunState, 'outcome' | 'rep' | 'flags' | 'reports' | 'shops'>, cfg: SimConfig = CONFIG):
  { title: string; lines: string[] } {
  const closed = run.shops.filter(s => s.status === 'closed');
  const lastDay = run.reports.length === 0 ? 1 : run.reports[run.reports.length - 1].summary.day;
  if (run.outcome === 'lostTrust') {
    return {
      title: 'Mất hết lòng tin',
      lines: [
        `Tối ngày ${lastDay}, uy tín của quán về 0. Khách đi ngang không ai ghé nữa, bạn đành kéo cửa cuốn xuống.`,
        'Uy tín mất thì dễ, lấy lại thì khó: khách chỉ ghé quán mà họ tin.',
      ],
    };
  }
  const lines = [
    `Giây ${inspectionSecond(cfg)} ngày cuối, xe loa phường đọc kết quả kiểm định. Tin đồn tan, khách quay lại phố, trạm xe buýt chật người.`,
    run.rep >= cfg.run.startRep
      ? `Quán bạn khép ván với ${run.rep} uy tín: khách quen đã thuộc đường tới quán.`
      : `Quán bạn còn ${run.rep} uy tín: vẫn mở cửa, nhưng khách nhìn bảng hiệu hơi ngập ngừng.`,
    closed.length === 0
      ? 'Cả phố đều trụ lại được.'
      : `${closed.length} quán không trụ được: ${closed.map(s => SHOP_NAMES[s.id]).join(', ')}.`,
  ];
  if (run.flags.taxEvaded) lines.push('Trạm xe buýt có tiền của mọi quán, trừ quán bạn. Xe vẫn dừng trước cửa quán bạn.');
  return { title: 'Phố hồi phục', lines };
}
