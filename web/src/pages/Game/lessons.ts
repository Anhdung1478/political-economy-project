// The evening lesson card (spec §3 "Bài học", §8) and the end screen's lessons (§8 "Màn kết"): the sentences, filled
// with the run's real numbers. Pure: everything comes from the day report, the run and the config, nothing from the
// screen. The lesson of each day follows spec §3's lesson column; the variants follow the player's choices.
import { CONFIG, type SimConfig } from '../../../../shared/sim/config';
import type {
  AiShopId, Day, DayReport, K, RunState, ShopDayResult, ShopId,
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

/** The spread must shrink by at least this much (k) and this share to read as "chụm lại". */
export const CONVERGE_MIN_K = 0.3;
export const CONVERGE_MIN_SHARE = 0.15;

/** True when the street's prices really drew together (not a rounding wobble). */
export const converged = (c: Pick<Convergence, 'openSpread' | 'closeSpread'>): boolean =>
  c.openSpread - c.closeSpread >= CONVERGE_MIN_K - 1e-9 && c.closeSpread <= c.openSpread * (1 - CONVERGE_MIN_SHARE);

export interface PriceMove { id: ShopId; open: K; close: K; soldOut: boolean }

/** The shops that moved their price during the rush, from their trails. */
export function priceMoves(street: readonly Pick<ShopDayResult, 'id' | 'trail' | 'soldOut'>[]): PriceMove[] {
  return street.flatMap(s => {
    const oc = openClose(s);
    return oc === null || oc.open === oc.close ? [] : [{ id: s.id, ...oc, soldOut: s.soldOut }];
  });
}

/** What the movers did, plainly: who raised (busy) and who cut (empty), nobody ordering it. */
export function movesSentence(moves: readonly PriceMove[]): string {
  const up = moves.filter(m => m.close > m.open);
  const down = moves.filter(m => m.close < m.open);
  const say = (m: PriceMove) => {
    const name = SHOP_NAMES[m.id];
    if (m.close > m.open) {
      return `${name} ${m.soldOut ? 'đông khách nên ' : ''}tăng từ ${fmtNumber(m.open)}k lên ${fmtNumber(m.close)}k`;
    }
    return `${name} ${m.soldOut ? '' : 'vắng khách nên '}hạ từ ${fmtNumber(m.open)}k xuống ${fmtNumber(m.close)}k`;
  };
  const parts = [...up.slice(0, 2), ...down.slice(0, 2)].map(say);
  const list = parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} và ${parts[parts.length - 1]}`;
  return `${list}. Không ai ra lệnh: mỗi quán tự nhìn khách của mình mà chỉnh giá.`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const k = (n: number) => fmtMoney(n);
const range = (lo: number, hi: number) => (lo === hi ? `${fmtNumber(lo)}k` : `${fmtNumber(lo)}–${fmtNumber(hi)}k`);
/** "từ 28k đến 34k", or "đều 30k". */
const rangeWords = (lo: number, hi: number) => (lo === hi ? `đều ${fmtNumber(lo)}k` : `từ ${fmtNumber(lo)}k đến ${fmtNumber(hi)}k`);
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
      const oMin = num(data, 'openMin');
      const oMax = num(data, 'openMax');
      const cMin = num(data, 'closeMin');
      const cMax = num(data, 'closeMax');
      const tighter = converged(c);
      const narrowed = cMax - cMin < oMax - oMin;
      const first = `Sáng nay giá trên phố ${rangeWords(oMin, oMax)}. `
        + (narrowed ? `Đến cuối trưa còn ${rangeWords(cMin, cMax)}.`
          : cMin === oMin && cMax === oMax ? `Đến cuối trưa vẫn ${rangeWords(cMin, cMax)}.`
            : `Đến cuối trưa ${rangeWords(cMin, cMax)}.`);
      let second: string;
      if (c.changed === 0) second = 'Trưa nay chưa quán nào đổi giá: mai các quán sẽ nhìn bảng giá của nhau mà chỉnh.';
      else if (tighter) {
        second = `${c.changed}/${c.shops} quán tự đổi giá giữa trưa. Giá mỗi quán cách mức trung bình `
          + `±${fmtNumber(c.openSpread)}k lúc mở cửa, còn ±${fmtNumber(c.closeSpread)}k lúc đóng cửa: giá đang chụm lại.`;
      } else second = movesSentence(priceMoves(report.street));
      return {
        hand: 'invisible', kicker: INVISIBLE,
        title: tighter ? 'Không ai ra lệnh, giá vẫn tự tìm về một mức' : 'Không ai ra lệnh, giá tự phản ứng theo khách',
        stats: [
          { label: 'Giá lúc mở', value: range(oMin, oMax) },
          { label: 'Giá lúc đóng', value: range(cMin, cMax), tone: 'info' },
          { label: 'Quán đổi giá', value: `${c.changed}/${c.shops}` },
          { label: 'Độ lệch giá', value: `±${fmtNumber(c.openSpread)}k → ±${fmtNumber(c.closeSpread)}k`, tone: tighter ? 'good' : undefined },
        ],
        story: [first, second],
        moral: tighter
          ? 'Mỗi quán chỉ lo cho mình: đắt quá thì ế, rẻ quá thì lỗ. Nhìn nhau chỉnh giá, '
            + 'cả phố tự kéo về một mức chung. Đó là bàn tay vô hình của thị trường.'
          : 'Không ai ra lệnh, vậy mà giá vẫn phản ứng theo khách: quán đông thì dám tăng, quán vắng thì phải giảm. '
            + 'Một buổi trưa chưa đủ để giá chụm lại, nhưng tín hiệu giá đã chạy. Đó là bàn tay vô hình của thị trường.',
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
          `Hôm qua giá đóng cửa trung bình ${k(a1)}. Hôm nay cả phố cùng giữ giá cao ${k(cfg.cards.cartel.price)}`
            + (a2 === cfg.cards.cartel.price ? '. ' : ` (trung bình ${k(a2)}). `)
            + 'Quán mới vào mà giá không giảm: khách hết đường chọn.',
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
            ? `${resting} quán nghỉ bán: dưới ${k(ceiling)}, lãi mỗi ly sau giá vốn quá mỏng để trả tiền mặt bằng. Giá rẻ hơn, mà trà lại ít đi.`
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
  /** Why, from what happened on its losing days. */
  why: string;
  /** What squeezed it, for the moral. */
  factors: ExitFactor[];
}

export type ExitFactor = 'slow' | 'entrant' | 'cartel' | 'ceiling' | 'tax' | 'rumor' | 'named';

/** Day 5: an AI shop the inspection names (it skimps and is not certified), by the config. */
const namedByInspection = (id: AiShopId, cfg: SimConfig) =>
  !cfg.aiShops[id].selfCertified && cfg.aiShops[id].rumorSkimpDays >= cfg.rumor.failSkimpDays;

const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/**
 * The AI shops that did not survive (§8 "quán nào không trụ được"), in street order. Each reason comes from what
 * happened on its losing days: that day's rules (entrant, cartel, ceiling, tax, rumor and the inspection naming it),
 * its price, its cups against its stock, and its loss.
 */
export function shopExits(run: Pick<RunState, 'shops' | 'reports'>, cfg: SimConfig = CONFIG): ShopExit[] {
  return run.shops.filter(s => s.status === 'closed' && s.closedOn !== null).map(s => {
    const closedOn = s.closedOn as Day;
    const losing = s.history.filter(h => h.day <= closedOn && h.day > closedOn - cfg.aiPricing.exitLossDays && h.profit < 0);
    const cost = cfg.aiShops[s.id].cost;
    const factors = new Set<ExitFactor>();
    const reasons = losing.map(h => {
      const rep = run.reports.find(r => r.summary.day === h.day);
      const row = rep?.street.find(x => x.id === s.id);
      const cap = row?.capacity ?? 0;
      const sales = `bán ${h.sold}/${cap} ly${h.closePrice === null ? '' : ` giá ${k(h.closePrice)}`}`;
      const sched = cfg.days[h.day];
      const lessonId = rep?.lesson.id;
      const loss = `lỗ ${k(-h.profit)}`;
      if (h.rested) {
        factors.add('ceiling');
        return `ngày ${h.day} nghỉ bán: dưới trần ${k(sched.ceiling ?? 0)}, lãi mỗi ly sau giá vốn quá mỏng, `
          + `mà vẫn mất ${k(cfg.aiPricing.rent)} tiền mặt bằng`;
      }
      if (lessonId === 'cartelKept' || lessonId === 'cartelBroke') {
        factors.add('cartel');
        return lessonId === 'cartelBroke'
          ? `ngày ${h.day} cả phố hẹn giữ ${k(cfg.cards.cartel.price)} nhưng quán bạn phá giá hốt khách, nó chỉ ${sales}, ${loss}`
          : `ngày ${h.day} cả phố cùng giữ ${k(cfg.cards.cartel.price)}, khách chia đều cho các quán, nó chỉ ${sales}, ${loss}`;
      }
      switch (sched.theme) {
        case 'newShop':
          factors.add('entrant');
          return `ngày ${h.day} Chuỗi Tập Đoàn vào phố chia khách: ${sales}, ${loss}`;
        case 'priceCeiling':
          factors.add('ceiling');
          return `ngày ${h.day} trần ${k(sched.ceiling ?? 0)}: ${sales}, lãi mỗi ly sau giá vốn quá mỏng để trả tiền mặt bằng, ${loss}`;
        case 'tax':
          factors.add('tax');
          return `ngày ${h.day} thuế ${k(sched.taxPerCup)}/ly ăn vào lãi: ${sales}, ${loss}`;
        case 'rumor':
          if (namedByInspection(s.id, cfg)) {
            factors.add('named');
            return `ngày ${h.day} kiểm định nêu tên quán vì ăn bớt; khách quay lại phố nhưng tránh nó: ${sales}, ${loss}`;
          }
          factors.add('rumor');
          return `ngày ${h.day} tin đồn làm khách sợ: ${sales}, ${loss}`;
        default:
          factors.add('slow');
          return `ngày ${h.day} ế khách: ${sales}, ${loss}`;
      }
    });
    return {
      id: s.id, name: SHOP_NAMES[s.id], closedOn, factors: [...factors],
      why: `Giá vốn ${k(cost)}/ly, lỗ ${losing.length} ngày liền. ${reasons.map(capital).join('. ')}.`,
    };
  });
}

const FACTOR_WORDS: Record<ExitFactor, string> = {
  slow: 'ế khách ngày khai trương', entrant: 'quán mới vào chia khách', cartel: 'thoả thuận giữ giá chia đều khách',
  ceiling: 'giá trần', tax: 'thuế', rumor: 'tin đồn', named: 'kiểm định công bố quán ăn bớt',
};
const FACTOR_ORDER: readonly ExitFactor[] = ['slow', 'entrant', 'cartel', 'ceiling', 'tax', 'rumor', 'named'];

/** The line under the exit list, built from what actually closed the shops in this run. */
export function exitMoral(exits: readonly ShopExit[]): string | null {
  if (exits.length === 0) return null;
  const all = new Set(exits.flatMap(e => e.factors));
  const words = FACTOR_ORDER.filter(f => all.has(f) && f !== 'named').map(f => FACTOR_WORDS[f]);
  const lines: string[] = [];
  if (words.length > 0) {
    const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} rồi ${words[words.length - 1]}`;
    lines.push(`${capital(list)}: quán nào lãi mỗi ly mỏng thì lỗ trước, lỗ hai ngày liền là phải sang nhượng.`);
  }
  if (all.has('named')) {
    lines.push('Quán bị kiểm định nêu tên không thua vì giá: thông tin thật được công bố thì khách bỏ người ăn gian.');
  }
  lines.push('Thị trường đào thải quán lỗ kéo dài; chính sách và thông tin làm việc ấy nhanh hay chậm hơn.');
  return lines.join(' ');
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
