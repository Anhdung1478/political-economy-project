// What the street's customers say (spec §9 "Bong bóng lời nói"): the words for each situation of the table, 3–4 lines
// each so the street does not repeat itself, picked deterministically; which requests make it on screen (at most 3 at
// once, the player's shop first); and where each bubble goes so none overlaps another or the day's big signs.
//
// Pure: no canvas. The renderer (draw/speech.ts) measures the words and draws; this file decides.
//
// The situations come from the director's requests (director.ts `BubbleRequest`), which carry the sim's real reasons:
// a verdict (too expensive, too crowded, low trust, out of stock, another shop better, a suspicious discount, the
// player chosen, the rumor), why someone left a queue (patience, a price rise, a steep cut, stock out, the shop
// closing), a wrong cup, going home empty-handed on the ceiling day. Two are refined here:
// - `tooExpensive` whose price alone was within the customer's budget (`priceOk`): low reputation pushed the score
//   under zero (Task 3's ruling), so the words are about trust and value, never "đắt quá".
// - `outOfStock` names what ran out when the sim says (`missing`): "Hết trân châu rồi à…".
// A correct cup at the player's counter (a `sale` cue) may add a happy word now and then (`served`).
import { hashSeed } from '../../../shared/sim/rng';
import type { Day, K, ShopId, StockItem } from '../../../shared/sim/types';
import type { BubbleRequest, BubbleTopic } from './director';
import type { Rect } from './layout';

/**
 * A bubble's situation: the director's topics, the trust/value side of "too expensive", "another shop is better"
 * when that shop really was cheaper, and a happy serve.
 */
export type Situation = BubbleTopic | 'valueDoubt' | 'otherCheaper' | 'served' | 'chat';

/** How a bubble is coloured: a good word, a bad one, or plain. */
export type Tone = 'good' | 'bad' | 'plain';

const ITEM: Record<StockItem, string> = { tea: 'trà', pearl: 'trân châu', jelly: 'thạch', pudding: 'pudding' };

/**
 * The lines, after spec §9's table (its example first). `{item}` is what ran out, `{price}` the shop's price in k.
 * Every situation has 3 or 4.
 */
export const LINES: Readonly<Record<Exclude<Situation, 'chat'>, readonly string[]>> = {
  tooExpensive: [
    'Quán này đắt quá, đi quán khác thôi.',
    '{price}k một ly? Quá túi tiền rồi.',
    'Đắt thế, để dành tiền ăn trưa vậy.',
    'Giá này chát quá, mình qua chỗ khác.',
  ],
  valueDoubt: [
    'Giá vậy mà chưa chắc ngon, thôi.',
    'Tiền thì có, mà quán này chưa tin lắm.',
    'Bỏ {price}k cho quán này thì phí.',
    'Giá này thì phải ngon hơn cơ.',
  ],
  tooCrowded: [
    'Đông quá, xếp hàng chắc lâu lắm, mình qua quán khác.',
    'Hàng dài thế này thì chờ tới chiều.',
    'Đông nghẹt, thôi đi quán khác.',
    'Xếp hàng mỏi chân lắm, bỏ qua.',
  ],
  lowTrust: [
    'Quán này nghe nói không ổn lắm, chọn quán khác vậy.',
    'Bạn mình bảo quán này dở lắm.',
    'Không tin quán này lắm…',
    'Review quán này tệ quá, thôi.',
  ],
  outOfStock: [
    'Hết {item} rồi à…',
    'Không có {item} thì uống gì nữa.',
    'Ơ, hết {item} sao?',
    'Thiếu {item} rồi, qua quán khác thôi.',
  ],
  otherBetter: [
    'Quán bên kia được hơn.',
    'Thôi, qua bên kia xem sao.',
    'Bên kia ổn hơn nè.',
  ],
  otherCheaper: [
    'Bên kia rẻ hơn mà.',
    'Qua bên kia cho hời.',
    'Bên kia rẻ hơn, đi thôi.',
  ],
  chosePlayer: [
    'Quán này giá ổn nè.',
    'Làm một ly ở đây thôi!',
    'Quán này nhìn được nè.',
    'Hợp túi tiền, mua thôi.',
  ],
  patience: [
    'Chờ lâu quá, thôi khỏi!',
    'Đứng mãi mỏi chân, đi đây!',
    'Lâu thế, không chờ nữa.',
    'Hết kiên nhẫn rồi nha!',
  ],
  wrongCup: [
    'Ủa, sai món rồi?',
    'Mình đâu có gọi cái này…',
    'Ơ, nhầm ly rồi?',
    'Sao khác món mình gọi vậy?',
  ],
  priceUp: [
    'Ủa tăng giá hả? Thôi.',
    'Đang xếp hàng mà tăng giá à?',
    'Tăng giá ngang xương, không mua nữa.',
  ],
  steepDiscount: [
    'Giảm dữ vậy, có khi trà đểu.',
    'Rẻ bất thường, nghi lắm.',
    'Giảm sốc thế chắc có vấn đề.',
  ],
  shopClosed: [
    'Ơ, đóng cửa rồi à?',
    'Đang chờ mà quán nghỉ luôn…',
    'Quán đóng rồi, tiếc ghê.',
  ],
  emptyHanded: [
    'Quán nào cũng hết sạch…',
    'Rẻ mà chẳng còn gì để mua.',
    'Đi cả phố không mua được ly nào.',
    'Giá trần mà hết hàng thì cũng như không.',
  ],
  rumor: [
    'Nghe đồn nấu bằng nước rửa chén đó.',
    'Thấy bảo uống vào đau bụng lắm.',
    'Chờ kiểm định xong rồi tính.',
    'Đồn ầm lên kìa, thôi khỏi uống.',
  ],
  served: [
    'Ngon nha!',
    'Đúng vị luôn!',
    'Mai mua tiếp!',
  ],
};

/**
 * What walkers say on the ambient street (title, lobby, projector, morning): flavour only. No shop, price, queue or
 * stock (the screen could contradict it), just weather, cravings, school and choosing.
 */
export const AMBIENT_LINES: readonly string[] = [
  'Trời nóng quá, làm ly đá thôi.',
  'Trân châu hôm nay có dai không ta?',
  'Đi học muộn rồi mà vẫn phải ghé.',
  'Hôm nay uống gì ta, phân vân quá.',
  'Thèm trà sữa từ sáng giờ.',
  'Ít đá, ít ngọt, nhớ nha!',
  'Trời mà mưa là hỏng buổi đi chơi.',
  'Mai kiểm tra mà giờ còn la cà.',
  'Uống xong mới có sức học bài.',
  'Gió mát ghê, đi dạo xíu rồi về.',
  'Đi một mình cũng phải uống trà sữa.',
  'Bạn rủ đi mà mình lại đến sớm.',
  'Tuần này uống mấy ly rồi nhỉ…',
  'Mùi trà thơm quá trời.',
  'Thêm thạch được không ta?',
  'Ôi, nắng chang chang.',
  'Cuối tuần là phải đi dạo phố.',
  'Giờ này chưa ăn gì, đói quá.',
  'Một ly thôi, hứa là một ly thôi.',
  'Uống ly trà cho tỉnh ngủ.',
  'Chọn quán nào bây giờ nhỉ?',
  'Ngày đẹp trời, đi dạo thôi.',
  'Hôm nay trà đào hay trà sữa nhỉ?',
  'Mình hợp trân châu hơn.',
  'Chờ bạn mãi chưa thấy tới.',
  'Ước gì được nghỉ học hôm nay.',
];

const linesOf = (s: Situation): readonly string[] => (s === 'chat' ? AMBIENT_LINES : LINES[s]);

/** `outOfStock` when the sim did not say what ran out. */
const OUT_GENERIC = ['Hết hàng rồi à…', 'Ơ, bán hết rồi sao?', 'Hết sạch rồi, tiếc ghê.'] as const;

export const TONE: Readonly<Record<Situation, Tone>> = {
  tooExpensive: 'bad', valueDoubt: 'bad', tooCrowded: 'plain', lowTrust: 'bad', outOfStock: 'plain',
  otherBetter: 'plain', otherCheaper: 'plain', chosePlayer: 'good', patience: 'bad', wrongCup: 'bad', priceUp: 'bad', steepDiscount: 'plain',
  shopClosed: 'plain', emptyHanded: 'plain', rumor: 'bad', served: 'good', chat: 'plain',
};

/**
 * How much a situation matters to the player reading the street (higher first, after "about the player's shop"):
 * what they did wrong at the counter, then why they lost someone, then the street's mood.
 */
export const WEIGHT: Readonly<Record<Situation, number>> = {
  wrongCup: 9, patience: 8, priceUp: 8, emptyHanded: 7, outOfStock: 7, rumor: 6, tooExpensive: 6, valueDoubt: 6,
  lowTrust: 6, tooCrowded: 5, steepDiscount: 5, shopClosed: 5, otherBetter: 4, otherCheaper: 4, chosePlayer: 3,
  served: 2, chat: 1,
};

/** Situation names in a fixed order, for hashing. */
const SITUATIONS = [...Object.keys(LINES), 'chat'] as Situation[];

/**
 * The situation of a request: "too expensive" whose price alone was affordable is about trust and value; "another
 * shop is better" says "cheaper" only when the chosen shop was cheaper (`cheaper`); the rest as they come.
 */
export function situationOf(r: Pick<BubbleRequest, 'topic' | 'priceOk' | 'cheaper'>): Situation {
  if (r.topic === 'tooExpensive' && r.priceOk === true) return 'valueDoubt';
  if (r.topic === 'otherBetter' && r.cheaper === true) return 'otherCheaper';
  return r.topic;
}

/** The street's theme of the day (the ceiling day's empty hands, day 5's rumor): ranked with the player's words. */
const THEME: ReadonlySet<Situation> = new Set<Situation>(['emptyHanded', 'rumor']);

/** How much a word deserves the board: about the player's shop (or the day's theme) first, then its weight. */
export function rankOf(x: { player: boolean; situation: Situation }): number {
  return (x.player || THEME.has(x.situation) ? 100 : 0) + WEIGHT[x.situation];
}

/** The seed of the day's lines: the `scene/{day}` stream of the run's seed. */
export const daySeed = (seed: number, day: Day): number => hashSeed(seed, `scene/${day}`);

/**
 * Which of a situation's lines customer `customer` says, from the day's seed: the same customer in the same situation
 * always says the same thing (so a rebuilt street, a replay or a turned phone agree), different customers vary.
 */
export function lineIndex(daySeedV: number, customer: number, s: Situation, n: number): number {
  let h = Math.imul(daySeedV ^ Math.imul(customer + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (SITUATIONS.indexOf(s) + 1) * 0x27d4eb2d, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % n;
}

/** The words: the chosen line with what ran out and the price filled in; `avoid` skips a line already on screen. */
export function wordsFor(s: Situation, index: number, o: { missing?: StockItem; price?: K | null },
  avoid?: (text: string) => boolean): string {
  const list = s === 'outOfStock' && o.missing === undefined ? OUT_GENERIC : linesOf(s);
  const fill = (i: number) => {
    let t = list[i % list.length];
    if (t.includes('{item}')) t = t.replace('{item}', ITEM[o.missing ?? 'tea']);
    if (t.includes('{price}')) {
      // No price to say: the next line that does not need one.
      if (o.price == null || !(o.price > 0)) return null;
      t = t.replace('{price}', String(o.price));
    }
    return t;
  };
  for (let k = 0; k < list.length; k++) {
    const t = fill(index + k);
    if (t !== null && (avoid === undefined || !avoid(t))) return t;
  }
  return fill(index) ?? list.find(x => !x.includes('{price}')) ?? list[0];
}

// ── Who speaks ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Most bubbles on screen at once (spec §9). */
export const MAX_BUBBLES = 3;
/** Pop-in and pop-out, in ticks. */
export const POP_IN = 2.5;
export const POP_OUT = 3;
/** Every so many correct serves at the player's counter, one says something (deterministic per customer). */
const SERVED_ONE_IN = 3;

/** How long a bubble stays (ticks): long enough to read, longer for longer words. */
export function lifeOf(text: string): number {
  return Math.max(22, Math.min(40, 14 + text.length * 0.55));
}

export interface Shown {
  customer: number;
  situation: Situation;
  text: string;
  tone: Tone;
  /** About the player's shop or said by someone who queued there. */
  player: boolean;
  shop: ShopId | null;
  born: number;
  /** Starts popping out at `until`; gone at `until + POP_OUT`. */
  until: number;
  /** The placement option it had last frame (layout hysteresis); −1 before the first. */
  opt: number;
  /** Measured by the renderer: the wrapped lines and the box size (units), for this unit size and font epoch. */
  lines: string[] | null;
  w: number;
  h: number;
  unit: number;
  epoch: number;
  /** Where it was last drawn (an outgoing bubble keeps its spot). */
  lastX: number;
  lastY: number;
  /** The renderer's painted body (opaque here). */
  art: unknown;
}

/** A candidate to speak: a request from the director, or a happy serve. */
export interface Candidate {
  customer: number;
  situation: Situation;
  player: boolean;
  shop: ShopId | null;
  missing?: StockItem;
  t: number;
}

/** The candidates of this frame: the director's requests, and now and then a happy word at the player's counter. */
export function candidates(reqs: readonly BubbleRequest[],
  sales: readonly { shop: ShopId; customer: number; correct: boolean; t: number }[], daySeedV: number): Candidate[] {
  const out: Candidate[] = [];
  for (const r of reqs) {
    const c: Candidate = { customer: r.customer, situation: situationOf(r), player: r.playerRelated, shop: r.shop, t: r.t };
    if (r.missing !== undefined) c.missing = r.missing;
    out.push(c);
  }
  for (const s of sales) {
    if (s.shop !== 'player' || !s.correct) continue;
    if (lineIndex(daySeedV ^ 0x5bd1e995, s.customer, 'served', SERVED_ONE_IN) !== 0) continue;
    out.push({ customer: s.customer, situation: 'served', player: true, shop: 'player', t: s.t });
  }
  return out;
}

/** Ordering of candidates: the higher rank (the player's or the day's theme, then the weight), then the earlier. */
export function byPriority(a: Candidate, b: Candidate): number {
  return rankOf(b) - rankOf(a) || a.t - b.t;
}

/** A bubble stays at least this long (ticks) before a weightier word may push it out (no flicker). */
export const MIN_SHOW = 10;
/** A word that finds the board full waits this long (ticks) for room, then is dropped. */
export const WAIT_TICKS = 15;
/** At most this many words wait. */
const MAX_WAITING = 6;

export interface AdmitContext {
  now: number;
  daySeed: number;
  /** Whether the customer is on screen to speak (on the street, not folded into "+n", not fading). */
  canSpeak(customer: number): boolean;
  /** Whether a new word may start now: the speaker is far enough inside the view to be read (default: `canSpeak`). */
  canStart?(customer: number): boolean;
  /** The price on a shop's board now (for "{price}k"). */
  priceOf(shop: ShopId | null): K | null;
}

/**
 * The bubbles on screen after this frame's candidates, and the words still waiting for room.
 * - Gone bubbles are dropped (time up after the pop-out, or the speaker left: then it pops out).
 * - New and waiting words go by rank (`rankOf`: the player's shop and the day's theme first, then the weight), the
 *   earlier first on a tie.
 * - One bubble per customer and one per situation: a word of higher rank replaces the one there, else it waits.
 * - At most MAX_BUBBLES live. On a full board a word replaces the live bubble of lowest rank (the oldest on a tie)
 *   that has shown MIN_SHOW ticks, if that rank is strictly lower than its own; else it waits up to WAIT_TICKS.
 * Returns the bubbles, the words waiting, and the bubbles pushed out (to pop out).
 */
export function admit(shown: readonly Shown[], cands: readonly Candidate[], c: AdmitContext,
  waiting: readonly Candidate[] = []): { shown: Shown[]; out: Shown[]; waiting: Candidate[] } {
  const next: Shown[] = [];
  const out: Shown[] = [];
  for (const b of shown) {
    if (b.until + POP_OUT <= c.now) continue;
    if (!c.canSpeak(b.customer)) {
      if (b.until > c.now) out.push({ ...b, until: c.now });
      continue;
    }
    next.push(b);
  }
  const pushOut = (b: Shown) => {
    next.splice(next.indexOf(b), 1);
    if (b.until > c.now) out.push({ ...b, until: c.now });
  };
  const wait: Candidate[] = [];
  const pool = [...waiting.filter(k => k.t + WAIT_TICKS >= c.now), ...cands].sort(byPriority);
  const seen = new Set<number>();
  for (const k of pool) {
    if (seen.has(k.customer) || !c.canSpeak(k.customer) || (c.canStart !== undefined && !c.canStart(k.customer))) continue;
    seen.add(k.customer);
    const r = rankOf(k);
    const live = next.filter(b => b.until > c.now);
    const mine = live.find(b => b.customer === k.customer);
    if (mine !== undefined) {
      if (rankOf(mine) >= r) continue;
      // A bubble is read for MIN_SHOW before anything pushes it out (only its speaker leaving cuts it short).
      if (c.now - mine.born < MIN_SHOW) {
        wait.push(k);
        continue;
      }
      pushOut(mine);
    }
    // Ambient chatter is not one-per-situation: the cap of 3 and one per speaker are its limits.
    const same = k.situation === 'chat' ? undefined : live.find(b => b !== mine && b.situation === k.situation);
    if (same !== undefined) {
      if (rankOf(same) >= r || c.now - same.born < MIN_SHOW) {
        wait.push(k);
        continue;
      }
      pushOut(same);
    }
    const active = next.filter(b => b.until > c.now);
    if (active.length >= MAX_BUBBLES) {
      let low: Shown | null = null;
      for (const b of active) {
        if (c.now - b.born < MIN_SHOW) continue;
        if (low === null || rankOf(b) < rankOf(low) || (rankOf(b) === rankOf(low) && b.born < low.born)) low = b;
      }
      if (low === null || rankOf(low) >= r) {
        wait.push(k);
        continue;
      }
      pushOut(low);
    }
    const n = k.situation === 'outOfStock' && k.missing === undefined ? OUT_GENERIC.length : linesOf(k.situation).length;
    const text = wordsFor(k.situation, lineIndex(c.daySeed, k.customer, k.situation, n),
      { missing: k.missing, price: c.priceOf(k.shop) }, t => next.some(b => b.text === t));
    next.push({
      customer: k.customer, situation: k.situation, text, tone: TONE[k.situation], player: k.player, shop: k.shop,
      born: c.now, until: c.now + lifeOf(text), opt: -1, lines: null, w: 0, h: 0, unit: 0, epoch: -1, lastX: NaN,
      lastY: NaN, art: null,
    });
  }
  return { shown: next, out, waiting: wait.slice(0, MAX_WAITING) };
}

/** How far into its life a bubble is: its scale for the pop (overshooting in, shrinking out) and its opacity. */
export function popOf(b: Pick<Shown, 'born' | 'until'>, now: number, calm: boolean): { scale: number; alpha: number } {
  if (now >= b.until) {
    const k = Math.min(1, (now - b.until) / POP_OUT);
    return calm ? { scale: 1, alpha: 1 - k } : { scale: 1 - 0.25 * k, alpha: 1 - k };
  }
  if (calm) return { scale: 1, alpha: 1 };
  const u = Math.min(1, Math.max(0, (now - b.born) / POP_IN));
  // Back-out: 0 → overshoot → 1.
  const s = 1.70158;
  const v = u - 1;
  return { scale: 1 + (s + 1) * v * v * v + s * v * v, alpha: Math.min(1, u * 2) };
}

// ── Where they go ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface Placing {
  /** The speaker's head top (the tail points there) and their feet (a bubble can go below them). */
  ax: number; ay: number; footY: number;
  w: number; h: number;
  /** The option it had last frame (−1: none). */
  prev: number;
}

/**
 * Where a bubble went: its box, the option, and where its tail leaves it (`rootX`, `rootY` on its edge: the bottom
 * above the speaker, the top below them, a side edge beside them).
 */
export interface Placed { x: number; y: number; opt: number; rootX: number; rootY: number; edge: 'bottom' | 'top' | 'left' | 'right' }

type Option = { dx: number; row: number; at: 'above' | 'below' | 'left' | 'right' };

/**
 * Options tried, in order: above the head (centred, nudged left, nudged right), beside the head (right, left), one row
 * higher, below the feet, two rows higher.
 */
const OPTIONS: readonly Option[] = [
  { dx: 0, row: 0, at: 'above' }, { dx: -0.38, row: 0, at: 'above' }, { dx: 0.38, row: 0, at: 'above' },
  { dx: 0, row: 0, at: 'right' }, { dx: 0, row: 0, at: 'left' },
  { dx: 0, row: 1, at: 'above' }, { dx: -0.4, row: 1, at: 'above' }, { dx: 0.4, row: 1, at: 'above' },
  { dx: 0, row: 0, at: 'below' },
  { dx: 0, row: 2, at: 'above' }, { dx: -0.42, row: 2, at: 'above' }, { dx: 0.42, row: 2, at: 'above' },
];

const overlap = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** Something to keep clear of, and how much covering it costs (3 by default: the van's banner, the ceiling sign). */
export type AvoidRect = Rect & { weight?: number };

/**
 * Places the bubbles in order (the first gets the best spot): each tries the options above its speaker, kept inside
 * the view, and takes the first that overlaps neither a bubble already placed nor an `avoid` rect (the inspection
 * van's banner, the ceiling sign); if none is clear, the least covered. The option it had last frame is tried first,
 * so a bubble does not hop about. `tail` is the gap between the bubble and the head.
 */
export function placeBubbles(items: readonly Placing[], view: Rect, avoid: readonly AvoidRect[], tail: number,
  pad: number): Placed[] {
  const placed: Placed[] = [];
  const boxes: Rect[] = [];
  for (const it of items) {
    let best: Placed | null = null;
    let bestCost = Infinity;
    const order = it.prev >= 0 && it.prev < OPTIONS.length ? [it.prev, ...OPTIONS.keys()] : [...OPTIONS.keys()];
    for (const i of order) {
      const o = OPTIONS[i];
      let x: number;
      let y: number;
      if (o.at === 'left' || o.at === 'right') {
        x = o.at === 'right' ? it.ax + tail * 1.6 : it.ax - tail * 1.6 - it.w;
        y = it.ay - it.h * 0.35;
      } else {
        x = it.ax - it.w / 2 + o.dx * it.w;
        y = o.at === 'below' ? it.footY + tail : it.ay - tail - it.h - o.row * (it.h + tail * 0.6);
      }
      x = Math.min(view.x + view.w - pad - it.w, Math.max(view.x + pad, x));
      y = Math.min(view.y + view.h - pad - it.h, Math.max(view.y + pad, y));
      const r = { x, y, w: it.w, h: it.h };
      let cost = 0;
      for (const b of boxes) cost += overlap(r, b) * 4;
      for (const a of avoid) cost += overlap(r, a) * (a.weight ?? 3);
      // Away from the speaker costs a little (rows up, beside, below), so the nearest clear spot wins.
      const away = o.at === 'above' ? o.row * 0.02 + Math.abs(o.dx) * 0.01 : o.at === 'below' ? 0.04 : 0.012;
      cost += away * it.w * it.h;
      // A box clamped away from its speaker (the view's edge) reads worse: the distance costs a little too.
      const cx = Math.min(x + it.w, Math.max(x, it.ax));
      cost += Math.abs(cx - it.ax) * it.h * 0.05;
      if (i === it.prev) cost -= 0.015 * it.w * it.h;
      if (cost < bestCost) {
        bestCost = cost;
        best = rootOf(o.at, x, y, it, tail, i);
      }
    }
    const p = best as Placed;
    placed.push(p);
    boxes.push({ x: p.x, y: p.y, w: it.w, h: it.h });
  }
  return placed;
}

function rootOf(at: Option['at'], x: number, y: number, it: Placing, tail: number, opt: number): Placed {
  const clampX = Math.min(x + it.w - tail, Math.max(x + tail, it.ax));
  const clampY = Math.min(y + it.h - tail * 0.8, Math.max(y + tail * 0.8, it.ay));
  // Which edge faces the speaker after clamping into the view.
  if (at === 'below' || y >= it.footY) return { x, y, opt, rootX: clampX, rootY: y, edge: 'top' };
  if (y + it.h <= it.ay + tail * 0.5) return { x, y, opt, rootX: clampX, rootY: y + it.h, edge: 'bottom' };
  if (x >= it.ax) return { x, y, opt, rootX: x, rootY: clampY, edge: 'left' };
  if (x + it.w <= it.ax) return { x, y, opt, rootX: x + it.w, rootY: clampY, edge: 'right' };
  return { x, y, opt, rootX: clampX, rootY: y + it.h, edge: 'bottom' };
}

/**
 * The tail's tip: from its root toward the speaker's head, at most `max` long (a bubble pushed further off points the
 * way without a long spike across the street).
 */
export function tailTip(root: { x: number; y: number }, head: { x: number; y: number }, max: number):
  { x: number; y: number } {
  const dx = head.x - root.x;
  const dy = head.y - root.y;
  const d = Math.hypot(dx, dy);
  if (d <= max || d === 0) return { x: head.x, y: head.y };
  return { x: root.x + (dx / d) * max, y: root.y + (dy / d) * max };
}

// ── Ambient chatter ────────────────────────────────────────────────────────────────────────────────────────────────

/** Ticks between ambient words with `AMBIENT_FEW` walkers in view, jittered between ×0.75 and ×1.25 (4 s). */
export const AMBIENT_GAP = 40;
/** The walkers in view for which the gap is as given; fewer talk less, more talk more (within the bounds below). */
export const AMBIENT_FEW = 3;
/** The gap never goes under this (ticks, 1.5 s) nor over AMBIENT_GAP_MAX (10 s), whatever the crowd. */
export const AMBIENT_GAP_MIN = 15;
export const AMBIENT_GAP_MAX = 100;

/**
 * Who says something on the ambient street, and when: a calm rhythm (about one new word every AMBIENT_GAP ticks with
 * AMBIENT_FEW walkers in view, scaled by how many are, never under AMBIENT_GAP_MIN), from the day's seed alone: the
 * same seed and the same walkers give the same words, never the sim. `pick` returns a candidate or null.
 */
export class AmbientVoice {
  private nextAt = NaN;
  private count = 0;
  /** Walkers who have spoken: each says one thing on its way. */
  private readonly spoken = new Set<number>();

  constructor(private readonly daySeedV: number) {}

  private hash(salt: number): number {
    let h = Math.imul(this.daySeedV ^ Math.imul(this.count + 1, 0x9e3779b1) ^ salt, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  private gap(visible: number): number {
    const jitter = 0.75 + (this.hash(0x1234567) / 4294967296) * 0.5;
    const scale = AMBIENT_FEW / Math.max(1, visible);
    return Math.min(AMBIENT_GAP_MAX, Math.max(AMBIENT_GAP_MIN, AMBIENT_GAP * jitter * scale));
  }

  /**
   * `now` in ticks, the walkers who may speak (in a fixed order, none of them with a bubble), how many walkers are in
   * view, and how many bubbles are live. A word is due after the gap; it waits for a free place and a speaker.
   */
  pick(now: number, eligible: readonly number[], visible: number, live: number): Candidate | null {
    if (Number.isNaN(this.nextAt)) this.nextAt = now + this.gap(visible) * 0.5;
    if (now < this.nextAt || live >= MAX_BUBBLES) return null;
    const fresh = eligible.filter(id => !this.spoken.has(id));
    if (fresh.length === 0) return null;
    const customer = fresh[this.hash(0x7f4a7c15) % fresh.length];
    this.spoken.add(customer);
    this.count++;
    this.nextAt = now + this.gap(visible);
    return { customer, situation: 'chat', player: false, shop: null, t: now };
  }
}

/**
 * Directors whose street is ambient (no rush running): the speech layer ignores the director's requests there and lets
 * `AmbientVoice` talk instead. StreetCanvas adds and removes its director as its mode changes.
 */
export const AMBIENT_DIRECTORS = new WeakSet<object>();
