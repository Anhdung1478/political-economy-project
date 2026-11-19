// The run across five days (spec §3): the starting state, the day transitions, the score and the ending.
import { applyChoice, cardsForDay, shuffleSideDeck } from './cards';
import { CONFIG, type SimConfig } from './config';
import { closeDay, quickFill } from './day';
import { summarizeRush } from './rush';
import { STREET } from './shops';
import type {
  AiShopId, AiShopState, Choice, ChoiceLabel, Day, K, RepItem, RunState, RushState, ShopId,
} from './types';

export { score } from './day';

const isAi = (id: ShopId): id is AiShopId => id !== 'player';

/** A fresh run on the morning of day 1, with the day-1 plan pre-filled at the default price and "mid" (§5). */
export function newRun(seed: number, runId: string, cfg: SimConfig = CONFIG): RunState {
  const shops: AiShopState[] = STREET.filter(isAi).map(id => ({
    id,
    status: cfg.aiShops[id].firstDay <= 1 ? 'active' : 'notYet',
    closedOn: null,
    todayPrice: null,
    resting: false,
    // Only Sinh Viên reads its direction; the others keep the neutral +1.
    probeDir: id === 'sinhvien' ? cfg.aiPricing.sinhvienFirstDir : 1,
    history: [],
  }));
  const run: RunState = {
    v: 1, seed, runId, day: 1, phase: 'morning',
    cash: cfg.run.startCash, rep: cfg.run.startRep, upgrades: [], skimpDays: 0,
    flags: {
      cartel: 'none', cartelBroken: false, shockTopping: false, blackMarket: false,
      taxEvaded: false, inspection: 'none', reporter: null,
    },
    pending: [],
    sideDeck: shuffleSideDeck(seed), sideDrawn: [],
    shops,
    plan: {
      price: cfg.morning.defaultPrice, tea: cfg.morning.defaultTea, upgrade: null,
      teaMl: 0, toppings: { pearl: 0, jelly: 0, pudding: 0 },
    },
    morningNews: [], today: null, rushResult: null,
    cards: [], cardIndex: 0, choices: [], cardRep: [],
    reports: [], outcome: null,
  };
  return { ...run, plan: { ...run.plan, ...quickFill(run, 'mid', run.plan, cfg) } };
}

/**
 * The lunch rush is over: keeps the day's result, takes in the takings less the tax (R27, so the afternoon cards
 * see the real cash and a tax refund comes after the tax was paid) and deals the afternoon's cards. The afternoon
 * starts with no choices or card rep; the evening (`closeDay`) records each day's choices in its report.
 */
export function endRush(run: RunState, rush: RushState, cfg: SimConfig = CONFIG): RunState {
  if (run.phase !== 'rush') throw new Error(`cannot end the rush in phase ${run.phase}`);
  if (!rush.done) throw new Error('the rush is still running');
  if (rush.day !== run.day) throw new Error(`rush of day ${rush.day} on day ${run.day}`);
  const rushResult = summarizeRush(rush, cfg);
  const afternoon: RunState = {
    ...run, phase: 'cards', rushResult,
    cash: run.cash + rushResult.player.revenue - rushResult.player.tax,
    cardIndex: 0, choices: [], cardRep: [],
  };
  return { ...afternoon, cards: cardsForDay(afternoon, cfg) };
}

/**
 * The player answers the card in hand (§7): the choice applies (`applyChoice`) and the next card comes up. The cards
 * are the ones dealt at `endRush`, never dealt again (the side deck moves on as cards are drawn). After the last
 * card the evening closes the day (`closeDay`) and the report follows.
 */
export function chooseCard(run: RunState, choice: Choice, cfg: SimConfig = CONFIG): RunState {
  if (run.phase !== 'cards') throw new Error(`cannot choose a card in phase ${run.phase}`);
  if (run.cardIndex >= run.cards.length) throw new Error('no card left to choose');
  const next = { ...applyChoice(run, run.cards[run.cardIndex], choice, cfg), cardIndex: run.cardIndex + 1 };
  return next.cardIndex === next.cards.length ? closeDay(next, cfg) : next;
}

/**
 * After the evening report: the end of the run after day 5 or an evening that lost all trust (`outcome` becomes
 * `finished` unless lost), otherwise the next morning. The morning keeps yesterday's plan with no upgrade, its price
 * brought into the new day's range and ceiling, and starts with no day result, cards or rep items.
 */
export function nextDay(run: RunState, cfg: SimConfig = CONFIG): RunState {
  if (run.phase !== 'report') throw new Error(`cannot move on in phase ${run.phase}`);
  if (run.outcome === 'lostTrust' || run.day >= cfg.run.dayCount) {
    return { ...run, phase: 'end', outcome: run.outcome ?? 'finished' };
  }
  const day = (run.day + 1) as Day;
  const ceiling = cfg.days[day].ceiling;
  const highest = ceiling === null ? cfg.pricing.max : Math.min(cfg.pricing.max, ceiling);
  const price = Math.min(highest, Math.max(cfg.pricing.min, run.plan.price));
  return {
    ...run, day, phase: 'morning',
    plan: { ...run.plan, toppings: { ...run.plan.toppings }, price, upgrade: null },
    today: null, rushResult: null, cards: [], cardIndex: 0, choices: [], cardRep: [], morningNews: [],
  };
}

/** What the end screen tells (§8). */
export interface Ending {
  outcome: 'finished' | 'lostTrust';
  /** AI shops that closed for good, the exits after day 5 included, in street order. */
  closedShops: AiShopId[];
  /** Every item that cost rep, morning and evening, in day order: "những việc đã làm mất uy tín". */
  repLosses: (RepItem & { day: Day })[];
  /** The choice labels earned over the run, each once, in the order first earned. */
  labels: ChoiceLabel[];
  profitByDay: K[];
}

/** The end screen's data (§8), from the run at its end. */
export function ending(run: RunState, cfg: SimConfig = CONFIG): Ending {
  if (run.phase !== 'end') throw new Error(`the run has not ended (phase ${run.phase})`);
  const closed = new Set(run.shops.filter(s => s.status === 'closed').map(s => s.id));
  return {
    outcome: run.outcome === 'lostTrust' ? 'lostTrust' : 'finished',
    closedShops: STREET.filter(isAi).filter(id => closed.has(id)),
    repLosses: run.reports.flatMap(r =>
      r.repItems.filter(i => i.delta < 0).map(i => ({ day: r.summary.day, ...i }))),
    labels: [...new Set(run.reports.flatMap(r => r.summary.labels))],
    profitByDay: run.reports.map(r => r.summary.profit),
  };
}
