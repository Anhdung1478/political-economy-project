// Bots that play the game through its public API (Task 11, rulings R37–R39): a rush policy taken one tick at a time
// (`botStep`), whole rushes (`playRush`, optionally recording the events tick by tick for the scene preview), whole runs
// (`playRun`), the play styles of spec §14 (`STRATEGIES`) and the 48 story-card combinations (`storyCombos`). The
// balance simulator, the scene preview and the class-session bots build on these. Pure and deterministic: the bot's
// randomness is an integer PRNG state in `BotState`, seeded from the stream `bot/{day}`, shared by every strategy (R39).
import { CONFIG, type SimConfig } from './config';
import { morningBrief, openDay, quickFill, validatePlan } from './day';
import { hashSeed, nextState } from './rng';
import { advance, canDeliver, checkInput, cloneRush } from './rush';
import { chooseCard, endRush, newRun, nextDay, score } from './run';
import type {
  Action, CardId, Choice, CraftInput, CraftState, Cup, Day, DayRules, DayReport, K, MorningBrief, MorningPlan, Order,
  RunState, RushShop, RushState, SimEvent, Size, Stock, TeaGrade, Tick, ToppingId,
} from './types';

/** How the bot plays the lunch rush. */
export interface RushPolicy {
  /** Ticks from one input to the next (a human's reaction time); inputs may still queue in the 3-step buffer. */
  delayTicks: number;
  /** Share of cups the bot makes wrong: a wrong size, one extra topping or one missing topping, among those the stock
   *  can make (R42a). */
  mistakeRate: number;
  /** `urgent`: of the first four whose order can be made, the one with the least patience left; `fifo`: the first. */
  serve: 'urgent' | 'fifo';
  /** `plainS`: every customer gets an S cup with no topping. */
  cup: 'asOrdered' | 'plainS';
  /** One price change, at the bot's first free tick from `atTick`, to `to` (brought into the day's range); skipped
   *  when that is the price already on the board. */
  reprice: null | { atTick: Tick; to: (s: RushState, cfg: SimConfig) => K };
  /** Close early once the stock cannot make any order and no cup is left to hand over. */
  closeWhenEmpty: boolean;
}

export interface Strategy {
  id: string;
  plan(run: RunState, brief: MorningBrief, cfg: SimConfig): MorningPlan;
  card(card: CardId, run: RunState): Choice;
  rush: RushPolicy;
}

/**
 * The bot between ticks. `cooldown`: ticks to wait before the next input. `rng`: the PRNG state (`nextState`) that
 * decides the cup being made; it moves on only when that cup leaves the counter (handed over or trashed), so the
 * cup's plan stays the same from tick to tick without being stored.
 */
export interface BotState { cooldown: Tick; rng: number }

const SIZES: readonly Size[] = ['S', 'M', 'L'];
const NO_TOPPINGS: Record<ToppingId, number> = { pearl: 0, jelly: 0, pudding: 0 };

/** What the bot means to hand over: a size and toppings in canonical order. */
interface Target { size: Size; toppings: ToppingId[] }

/** The cup's plan, drawn from the bot's PRNG state: made wrong or not, which wrong cup, and the state for the next cup. */
interface CupDraw { wrong: boolean; pick: number; next: number }

function drawCup(rng: number, policy: RushPolicy): CupDraw {
  const [u1, s1] = nextState(rng);
  const [u2, s2] = nextState(s1);
  return { wrong: u1 < policy.mistakeRate, pick: u2, next: s2 };
}

/**
 * The cup the bot makes for this order (R42a). `plainS` makes an S cup with no topping for everyone. A cup drawn wrong
 * is one of the wrong cups the stock can still make, given the steps already started (`cup`): each other size,
 * each extra topping not ordered, each ordered topping left out, in that order, the draw picking among them. If none
 * can be made, the order is made right, so the bot never waits on a mistake it cannot make.
 */
function targetFor(order: Order, draw: CupDraw, policy: RushPolicy, cup: Cup | null, stock: Stock,
  cfg: SimConfig): Target {
  if (policy.cup === 'plainS') return { size: 'S', toppings: [] };
  if (!draw.wrong) return order;
  const all = cfg.customers.toppingOrder;
  const options: Target[] = [];
  for (const size of SIZES) if (size !== order.size) options.push({ size, toppings: order.toppings });
  for (const extra of all) {
    if (!order.toppings.includes(extra)) {
      options.push({ size: order.size, toppings: all.filter(t => t === extra || order.toppings.includes(t)) });
    }
  }
  for (const drop of order.toppings) options.push({ size: order.size, toppings: order.toppings.filter(t => t !== drop) });
  const makeable = options.filter(t => stockCovers(cup, t, stock, cfg));
  return makeable.length === 0 ? order : makeable[Math.floor(draw.pick * makeable.length)];
}

/** The cup as it will be once the running step and the buffer are done; null if there is none. */
interface Projected { size: Size; iced: boolean; poured: boolean; toppings: ToppingId[] }

function project(craft: CraftState): Projected | null {
  const c = craft.cup;
  let p: Projected | null = c === null ? null
    : { size: c.size, iced: c.iced, poured: c.teaMl > 0, toppings: [...c.toppings] };
  for (const b of craft.buffer) {
    if (b.k === 'size') p = { size: b.size, iced: false, poured: false, toppings: [] };
    else if (p === null) return null;   // the counter never buffers a step before a size
    else if (b.k === 'ice') p.iced = true;
    else if (b.k === 'tea') p.poured = true;
    else p.toppings.push(b.id);
  }
  return p;
}

/** The cup so far can still become the target: same size, nothing in it the target lacks. */
const fits = (p: Projected | null, t: Target) =>
  p === null || (p.size === t.size && p.toppings.every(x => t.toppings.includes(x)));

/** The stock covers every step of the target not started yet (a buffered step takes its stock when it starts). */
function stockCovers(cup: Cup | null, t: Target, stock: Stock, cfg: SimConfig): boolean {
  if ((cup === null || cup.teaMl === 0) && stock.teaMl < cfg.supplies.sizeMl[t.size]) return false;
  for (const x of t.toppings) if (stock.toppings[x] < 1 && (cup === null || !cup.toppings.includes(x))) return false;
  return true;
}

/** The stock can make some order: tea for an S cup (a plain cup is an order too). */
const anyOrder = (stock: Stock, cfg: SimConfig) => stock.teaMl >= cfg.supplies.sizeMl.S;

/** The next input toward the target, in step order; null when the cup is the target. */
function nextInput(p: Projected | null, t: Target): CraftInput | null {
  if (p === null) return { k: 'size', size: t.size };
  if (!p.iced) return { k: 'ice' };
  if (!p.poured) return { k: 'tea' };
  for (const x of t.toppings) if (!p.toppings.includes(x)) return { k: 'topping', id: x };
  return null;
}

/** A price brought into the player's range, its step and the day's ceiling. */
function dayPrice(price: K, rules: DayRules, cfg: SimConfig): K {
  const { min, max, step } = cfg.pricing;
  const top = rules.ceiling === null ? max : Math.min(max, rules.ceiling);
  const stepped = min + Math.round((price - min) / step) * step;
  return Math.min(top, Math.max(min, stepped));
}

/** One input, or none: the price change, closing, the trash, the next step of the chosen customer's cup, the hand-over. */
function decide(s: RushState, ps: RushShop, draw: CupDraw, policy: RushPolicy, cfg: SimConfig): Action | null {
  const p = s.player;
  if (policy.reprice !== null && s.tick >= policy.reprice.atTick && !p.priceChanged) {
    const price = dayPrice(policy.reprice.to(s, cfg), s.rules, cfg);
    if (price !== ps.price) return { type: 'setPrice', price };
  }
  const craft = p.craft;
  const projected = project(craft);
  // The first four whose cup the bot can still make from here; the one to serve by the policy.
  let best = -1;
  let bestTarget: Target | null = null;
  let bestLeft = Infinity;
  const n = Math.min(ps.queue.length, cfg.rush.counterSlots);
  for (let i = 0; i < n; i++) {
    const id = ps.queue[i];
    const t = targetFor(s.customers[id].order, draw, policy, craft.cup, p.stock, cfg);
    if (!fits(projected, t) || !stockCovers(craft.cup, t, p.stock, cfg)) continue;
    const left = cfg.rush.patienceTicks - (s.tick - s.rt[id].joinedTick);
    if (policy.serve === 'urgent' ? left < bestLeft : best < 0) {
      best = id;
      bestTarget = t;
      bestLeft = left;
    }
  }
  if (bestTarget === null) {
    if (policy.closeWhenEmpty && !anyOrder(p.stock, cfg)) return { type: 'closeEarly' };
    return craft.cup === null ? null : { type: 'trash' };
  }
  const input = nextInput(projected, bestTarget);
  if (input === null) return canDeliver(craft) ? { type: 'deliver', customer: best } : null;
  return checkInput(craft, input, p.stock, cfg) === null ? { type: 'craft', input } : null;
}

/**
 * The bot's input for the tick `state` is about to run (R37), pure. While cooling down it waits; otherwise it takes at
 * most one input, then waits `delayTicks − 1` ticks. In order: the policy's price change; closing early once the
 * stock is empty (`closeWhenEmpty`); the trash when the cup in progress can no longer be completed for any of the
 * first four (its customer left, or the stock no longer covers it); the next step of the chosen customer's cup, while
 * the buffer has room; the hand-over once the cup is done and the counter idle. The cup is planned from the PRNG state
 * (a share `mistakeRate` of cups made wrong), which moves on when the cup is handed over or trashed.
 */
export function botStep(state: RushState, bot: BotState, policy: RushPolicy, cfg: SimConfig = CONFIG):
  { actions: Action[]; bot: BotState } {
  if (bot.cooldown > 0) return { actions: [], bot: { cooldown: bot.cooldown - 1, rng: bot.rng } };
  const ps = state.shops.find(x => x.id === 'player');
  if (state.done || ps === undefined || ps.status === 'closedEarly') return { actions: [], bot };
  const draw = drawCup(bot.rng, policy);
  const a = decide(state, ps, draw, policy, cfg);
  if (a === null) return { actions: [], bot };
  const rng = a.type === 'deliver' || a.type === 'trash' ? draw.next : bot.rng;
  return { actions: [a], bot: { cooldown: policy.delayTicks - 1, rng } };
}

export interface Frame { t: Tick; events: SimEvent[] }

/**
 * The bot plays the rush to its end: one copy, then `botStep` and the engine's `advance` each tick (plan
 * "Hiệu năng"). `rush` is left untouched. With `record`, `frames` holds the events grouped by their tick, for the
 * ticks that had any (the closing events carry t = 900); otherwise it is empty.
 */
export function playRush(rush: RushState, policy: RushPolicy, botSeed: number, cfg: SimConfig = CONFIG,
  record = false): { rush: RushState; frames: Frame[] } {
  const d = cloneRush(rush);
  let bot: BotState = { cooldown: 0, rng: botSeed };
  const frames: Frame[] = [];
  const events: SimEvent[] = [];
  while (!d.done) {
    const r = botStep(d, bot, policy, cfg);
    bot = r.bot;
    advance(d, r.actions, cfg, events);
    if (record) {
      for (const e of events) {
        const last = frames[frames.length - 1];
        if (last !== undefined && last.t === e.t) last.events.push(e);
        else frames.push({ t: e.t, events: [e] });
      }
    }
    events.length = 0;
  }
  return { rush: d, frames };
}

/**
 * The bot's PRNG seed for a day: the seed of the stream `bot/{day}` (walking it gives that stream). Every strategy
 * shares it (R39, common random numbers), so two strategies on a seed differ only by their choices.
 */
const botSeed = (seed: number, day: number) => hashSeed(seed, `bot/${day}`);

/**
 * A whole run (R37): each morning the strategy's plan, the shop opens, the bot plays the rush, the strategy answers
 * each card, the next day, until the end. The run id is `bot-{seed}`, the same for every strategy, so two strategies
 * that choose alike play the same run (R39). `total` is the final score.
 */
export function playRun(seed: number, strategy: Strategy, cfg: SimConfig = CONFIG):
  { run: RunState; reports: DayReport[]; total: K } {
  let run = newRun(seed, `bot-${seed}`, cfg);
  while (run.phase !== 'end') {
    const opened = openDay(run, strategy.plan(run, morningBrief(run, cfg), cfg), cfg);
    const { rush } = playRush(opened.rush, strategy.rush, botSeed(seed, run.day), cfg);
    run = endRush(opened.run, rush, cfg);
    while (run.phase === 'cards') run = chooseCard(run, strategy.card(run.cards[run.cardIndex], run), cfg);
    run = nextDay(run, cfg);
  }
  return { run, reports: run.reports, total: score(run, cfg).total };
}

// ── Play styles (spec §14; R37) ─────────────────────────────────────────────────────────────────────────────────────

type Stocking = Pick<MorningPlan, 'teaMl' | 'toppings'>;

/** How a style differs from `reasonable`. */
interface Style {
  price?: (run: RunState, brief: MorningBrief, cfg: SimConfig) => K;
  tea?: (run: RunState, cfg: SimConfig) => TeaGrade;
  stock?: (run: RunState, draft: MorningPlan, cfg: SimConfig) => Stocking;
  cards?: Partial<Record<CardId, Choice>>;
  rush?: Partial<RushPolicy>;
}

/**
 * The street's price (R38): the average of every shop's close, the player's included, on the latest free day before
 * today, to the 1k; day 1 (no free day yet): the default 30k. A free day, as for the AI pricing rules (§16 row 12),
 * has no ceiling and no cartel; on a tax day the AI shops' 3k pass-through is taken back off their closes.
 */
function streetPrice(run: RunState, cfg: SimConfig): K {
  for (let i = run.reports.length - 1; i >= 0; i--) {
    const r = run.reports[i];
    const sched = cfg.days[r.summary.day];
    if (sched.ceiling !== null || (sched.cartelPossible && run.flags.cartel === 'agreed')) continue;
    const back = sched.taxPerCup > 0 ? cfg.aiPricing.taxPassThrough : 0;
    let sum = 0;
    let n = 0;
    for (const row of r.street) {
      if (row.closePrice === null) continue;
      sum += row.id === 'player' ? row.closePrice : row.closePrice - back;
      n++;
    }
    if (n > 0) return Math.round(sum / n);
  }
  return cfg.morning.defaultPrice;
}

/** How far under the street's price `reasonable` opens on the morning a new AI shop opens (R48). */
export const ENTRY_UNDERCUT: K = 3;

/**
 * The price `reasonable` asks (R38, R48): the street's price, and `ENTRY_UNDERCUT` under it on the morning the brief
 * announces a new AI shop, when the shops already there cut their prices too (§4 "Phản ứng khi có quán mới"). Not on
 * a cartel day, when the whole street asks the cartel price.
 */
function usualPrice(run: RunState, brief: MorningBrief, cfg: SimConfig): K {
  const street = streetPrice(run, cfg);
  const entry = !brief.rules.cartel && brief.street.some(row => row.status === 'new');
  return entry ? street - ENTRY_UNDERCUT : street;
}

/** The upgrade `reasonable` reaches for (R42b): the machine any morning until owned, then the staff from day 3. */
function wantedUpgrade(run: RunState): MorningPlan['upgrade'] {
  if (!run.upgrades.includes('machine')) return 'machine';
  if (run.day >= 3 && !run.upgrades.includes('staff')) return 'staff';
  return null;
}

const highStock = (run: RunState, draft: MorningPlan, cfg: SimConfig): Stocking => quickFill(run, 'high', draft, cfg);

const scaled = (s: Stocking, num: number, den: number, cfg: SimConfig): Stocking => {
  const step = cfg.supplies.teaStepMl;
  return {
    teaMl: Math.ceil((s.teaMl * num) / (den * step)) * step,
    toppings: {
      pearl: Math.ceil((s.toppings.pearl * num) / den),
      jelly: Math.ceil((s.toppings.jelly * num) / den),
      pudding: Math.ceil((s.toppings.pudding * num) / den),
    },
  };
};

/**
 * The largest stock up to `target` the shop may open with on `draft` (R42b): the tea steps down 250 ml at a time,
 * each topping in proportion (rounded down), to no stock at all; null if not even that is allowed (an upgrade the
 * credit cannot pay for).
 */
function stepDown(run: RunState, draft: MorningPlan, target: Stocking, cfg: SimConfig): MorningPlan | null {
  const steps = target.teaMl / cfg.supplies.teaStepMl;
  const at = (k: number): Stocking => (k === steps ? target : {
    teaMl: k * cfg.supplies.teaStepMl,
    toppings: {
      pearl: Math.floor((target.toppings.pearl * k) / steps),
      jelly: Math.floor((target.toppings.jelly * k) / steps),
      pudding: Math.floor((target.toppings.pudding * k) / steps),
    },
  });
  for (let k = steps; k >= 0; k--) {
    const plan = { ...draft, ...at(k) };
    if (validatePlan(run, plan, cfg).length === 0) return plan;
  }
  return null;
}

/**
 * The morning plan of a style: its price brought into the day's range and ceiling, its tea, and (R42b) the wanted
 * upgrade with as much of the style's stock as the credit allows; only if not even the upgrade alone is allowed, no
 * upgrade and as much of the style's stock as allowed (no stock at all always is).
 */
function planOf(run: RunState, brief: MorningBrief, style: Style, cfg: SimConfig): MorningPlan {
  const price = dayPrice((style.price ?? usualPrice)(run, brief, cfg), brief.rules, cfg);
  const tea = style.tea === undefined ? 'standard' : style.tea(run, cfg);
  const stockOf = style.stock ?? highStock;
  const base: MorningPlan = { ...run.plan, price, tea, upgrade: null };
  const upgrade = wantedUpgrade(run);
  if (upgrade !== null) {
    const draft = { ...base, upgrade };
    const plan = stepDown(run, draft, stockOf(run, draft, cfg), cfg);
    if (plan !== null) return plan;
  }
  return stepDown(run, base, stockOf(run, base, cfg), cfg) ?? { ...base, teaMl: 0, toppings: { ...NO_TOPPINGS } };
}

/**
 * The card choices of `reasonable`: refuse the cartel, pass on the shock toppings, refuse the black market, declare
 * the tax, wait for the state's inspection, the invisible hand; every side card accepted (each pays back more than it
 * costs in score: rep is worth `run.brandPerRep` a point, and the helper, the ad customers and the repaid tab bring
 * cash).
 */
const REASONABLE_CARDS: Record<CardId, Choice> = {
  cartel: 'B', shockTopping: 'B', blackMarket: 'B', tax: 'A', inspection: 'B', reporter: 'A',
  kol: 'A', tab: 'A', student: 'A', complaint: 'A', deliveryAd: 'A', scholarship: 'A',
};

const REASONABLE_RUSH: RushPolicy = {
  delayTicks: 3, mistakeRate: 0.03, serve: 'urgent', cup: 'asOrdered', reprice: null, closeWhenEmpty: true,
};

function styled(id: string, style: Style = {}): Strategy {
  const cards = { ...REASONABLE_CARDS, ...style.cards };
  return {
    id,
    plan: (run, brief, cfg) => planOf(run, brief, style, cfg),
    card: card => cards[card],
    rush: style.rush === undefined ? REASONABLE_RUSH : { ...REASONABLE_RUSH, ...style.rush },
  };
}

/**
 * The smallest price above `morning` that is gouging (§6, R42): a rise of more than `gougePercent`, in whole price
 * steps, counted in integers as the engine does.
 */
function gougeFrom(morning: K, cfg: SimConfig): K {
  const step = cfg.pricing.step;
  return morning + (Math.floor((cfg.priceChange.gougePercent * morning) / (100 * step)) + 1) * step;
}

/** The highest price allowed on the last day. */
const lastDayTop = (cfg: SimConfig): K => {
  const ceiling = cfg.days[cfg.run.dayCount as Day].ceiling;
  return ceiling === null ? cfg.pricing.max : Math.min(cfg.pricing.max, ceiling);
};

/**
 * `day5cheat`'s price: `reasonable`'s, except on the last day no higher than the highest morning price that still
 * leaves room for a gouging rise under the top price (so the mid-rush rise always gouges).
 */
function cheatPrice(run: RunState, brief: MorningBrief, cfg: SimConfig): K {
  const street = usualPrice(run, brief, cfg);
  if (run.day !== cfg.run.dayCount) return street;
  const top = lastDayTop(cfg);
  let m = Math.min(street, top);
  while (m > cfg.pricing.min && gougeFrom(m, cfg) > top) m -= cfg.pricing.step;
  return m;
}

/** `day5cheat`'s mid-rush price: on the last day the smallest gouging rise; on other days the price on the board. */
const gougeLastDay = (s: RushState, cfg: SimConfig): K =>
  (s.day === cfg.run.dayCount ? gougeFrom(s.player.morningPrice, cfg)
    : s.shops.find(x => x.id === 'player')?.price ?? s.player.morningPrice);

/** The play styles of spec §14, each a variation of `reasonable`. */
export const STRATEGIES: Record<string, Strategy> = {
  reasonable: styled('reasonable'),
  flat15: styled('flat15', { price: () => 15 }),
  flat45: styled('flat45', { price: () => 45 }),
  skimp: styled('skimp', { tea: () => 'skimp' }),
  premium: styled('premium', { tea: () => 'premium' }),
  double: styled('double', { stock: (run, draft, cfg) => scaled(highStock(run, draft, cfg), 2, 1, cfg) }),
  half: styled('half', { stock: (run, draft, cfg) => scaled(highStock(run, draft, cfg), 1, 2, cfg) }),
  plainS: styled('plainS', { rush: { cup: 'plainS' } }),
  day5cheat: styled('day5cheat', {
    price: cheatPrice,
    tea: (run, cfg) => (run.day === cfg.run.dayCount ? 'skimp' : 'standard'),
    cards: { inspection: 'A' },
    rush: { reprice: { atTick: 450, to: gougeLastDay } },
  }),
  delay1: styled('delay1', { rush: { delayTicks: 1 } }),
  delay6: styled('delay6', { rush: { delayTicks: 6 } }),
};

type CartelOutcome = 'refuse' | 'keep' | 'break';

/**
 * Every story-card path on top of `base` (R37): the cartel refused, agreed and kept (day 2 at the cartel price or
 * more all day) or agreed and broken (day 2 below it), times A or B on the shock toppings, the black market, the tax
 * and the inspection: 48 strategies, ids `{base}+cartel-…+shock-…+black-…+tax-…+inspect-…`. Everything else is
 * `base`'s.
 */
export function storyCombos(base: Strategy): Strategy[] {
  const out: Strategy[] = [];
  for (const cartel of ['refuse', 'keep', 'break'] as CartelOutcome[]) {
    for (let mask = 0; mask < 16; mask++) {
      const pick = (bit: number): Choice => ((mask >> bit) & 1 ? 'A' : 'B');
      const story: Partial<Record<CardId, Choice>> = {
        cartel: cartel === 'refuse' ? 'B' : 'A',
        shockTopping: pick(3), blackMarket: pick(2), tax: pick(1), inspection: pick(0),
      };
      const id = `${base.id}+cartel-${cartel}+shock-${story.shockTopping}+black-${story.blackMarket}`
        + `+tax-${story.tax}+inspect-${story.inspection}`;
      out.push({
        id,
        plan: (run, brief, cfg) => {
          const plan = base.plan(run, brief, cfg);
          if (run.day !== 2 || cartel === 'refuse') return plan;
          const c = cfg.cards.cartel.price;
          return { ...plan, price: cartel === 'keep' ? Math.max(plan.price, c) : Math.min(plan.price, c - cfg.pricing.step) };
        },
        card: (card, run) => story[card] ?? base.card(card, run),
        rush: base.rush,
      });
    }
  }
  return out;
}
