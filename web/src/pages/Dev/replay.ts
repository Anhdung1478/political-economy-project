// A bot-played lunch rush to replay on the street (dev only: the scene preview and the director tests). The day's
// RushState comes from a run the strategy plays from day 1 up to that morning, exactly as `playRun` would; the rush
// itself is `playRush(..., record = true)`. `stateAt` steps the same bot over the same rush to any tick, for a seek.
import { botStep, playRush, STRATEGIES, type Strategy } from '../../../../shared/sim/autoplay';
import { CONFIG } from '../../../../shared/sim/config';
import { morningBrief, openDay } from '../../../../shared/sim/day';
import { hashSeed } from '../../../../shared/sim/rng';
import { advance, cloneRush } from '../../../../shared/sim/rush';
import { chooseCard, endRush, newRun, nextDay } from '../../../../shared/sim/run';
import type { Day, RushState, SimEvent, Tick } from '../../../../shared/sim/types';
import type { Frame } from '../../../../shared/sim/autoplay';

export interface Replay {
  seed: number; day: Day; strategy: Strategy;
  /** The rush as it opens (tick 0). */
  rush: RushState;
  /** The bot's PRNG seed for the day (the stream `bot/{day}`, as `playRun` uses). */
  botSeed: number;
  /** Every tick's events, in order (ticks without events are left out). */
  frames: Frame[];
}

export const strategyIds = () => Object.keys(STRATEGIES);

/** The bot seed `playRun` uses for a day. */
export const botSeedOf = (seed: number, day: Day) => hashSeed(seed, `bot/${day}`);

/** The rush of `day` as it opens, the strategy having played every earlier day; throws if the run ended before. */
export function rushOfDay(seed: number, day: Day, strategy: Strategy): RushState {
  let run = newRun(seed, `bot-${seed}`);
  while (run.day < day) {
    const opened = openDay(run, strategy.plan(run, morningBrief(run), CONFIG));
    const { rush } = playRush(opened.rush, strategy.rush, botSeedOf(seed, run.day));
    run = endRush(opened.run, rush);
    while (run.phase === 'cards') run = chooseCard(run, strategy.card(run.cards[run.cardIndex], run));
    run = nextDay(run);
    if (run.phase === 'end') throw new Error(`the run ended on day ${run.day} (${run.outcome})`);
  }
  return openDay(run, strategy.plan(run, morningBrief(run), CONFIG)).rush;
}

export function replayOf(seed: number, day: Day, strategyId: string): Replay {
  const strategy = STRATEGIES[strategyId];
  if (strategy === undefined) throw new Error(`no strategy ${strategyId}`);
  const rush = rushOfDay(seed, day, strategy);
  const botSeed = botSeedOf(seed, day);
  const { frames } = playRush(rush, strategy.rush, botSeed, CONFIG, true);
  return { seed, day, strategy, rush, botSeed, frames };
}

/** The rush after every tick before `tick` has run (its `tick` is `tick`), the bot playing as in `playRush`. */
export function stateAt(r: Replay, tick: Tick): RushState {
  const d = cloneRush(r.rush);
  let bot = { cooldown: 0, rng: r.botSeed };
  const events: SimEvent[] = [];
  while (!d.done && d.tick < tick) {
    const s = botStep(d, bot, r.strategy.rush);
    bot = s.bot;
    advance(d, s.actions, CONFIG, events);
    events.length = 0;
  }
  return d;
}

/** Steps the bot over the rush tick by tick: `visit(events, stateAfter)` after each tick (the state is live). */
export function walkRush(r: Replay, visit: (t: Tick, events: readonly SimEvent[], after: RushState) => void): void {
  const d = cloneRush(r.rush);
  let bot = { cooldown: 0, rng: r.botSeed };
  const events: SimEvent[] = [];
  while (!d.done) {
    const t = d.tick;
    const s = botStep(d, bot, r.strategy.rush);
    bot = s.bot;
    advance(d, s.actions, CONFIG, events);
    visit(t, events, d);
    events.length = 0;
  }
}
