// The run across five days (spec §3): the starting state and the day transitions (Task 10 adds the evening).
import { cardsForDay, shuffleSideDeck } from './cards';
import { CONFIG, type SimConfig } from './config';
import { quickFill } from './day';
import { summarizeRush } from './rush';
import { STREET } from './shops';
import type { AiShopId, AiShopState, RunState, RushState, ShopId } from './types';

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
