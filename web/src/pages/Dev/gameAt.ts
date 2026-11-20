// The game at a chosen day and phase, played up to there by a bot (dev only: `/dev/game`). Every day before is played
// as `playRun` plays it (the strategy's plan, the bot's rush on the stream `bot/{day}`, the strategy's card answers),
// through the run store's own intents, so the state handed to the UI is one a player could have reached.
import { playRush, STRATEGIES, storyCombos, type Strategy } from '../../../../shared/sim/autoplay';
import { CONFIG } from '../../../../shared/sim/config';
import { morningBrief } from '../../../../shared/sim/day';
import type { Day } from '../../../../shared/sim/types';
import { startRun, transition, type Intent, type RunStoreState } from '../../game/runStore';
import { botSeedOf } from './replay';

export type DevPhase = 'morning' | 'rush' | 'cards' | 'report' | 'end';
export const DEV_PHASES: readonly DevPhase[] = ['morning', 'rush', 'cards', 'report', 'end'];

const step = (s: RunStoreState, intent: Intent): RunStoreState => {
  const next = transition(s, intent).state;
  if (next === s) throw new Error(`intent ${intent.type} refused in phase ${s.run.phase}`);
  return next;
};

/** Opens the shop with the strategy's plan. */
function open(s: RunStoreState, strategy: Strategy): RunStoreState {
  const plan = strategy.plan(s.run, morningBrief(s.run), CONFIG);
  return step({ ...s, planDraft: plan }, { type: 'open' });
}

/** The bot plays the rush to its end, then the cards are dealt. */
function lunch(s: RunStoreState, strategy: Strategy): RunStoreState {
  if (s.rush === null) throw new Error('no rush');
  const { rush } = playRush(s.rush, strategy.rush, botSeedOf(s.run.seed, s.run.day));
  return step({ ...s, rush }, { type: 'endRush' });
}

function cards(s: RunStoreState, strategy: Strategy): RunStoreState {
  let x = s;
  while (x.run.phase === 'cards') {
    x = step(x, { type: 'chooseCard', choice: strategy.card(x.run.cards[x.run.cardIndex], x.run) });
  }
  return x;
}

/** A play style of §14, or one of `storyCombos(reasonable)` (`reasonable+cartel-keep+shock-A+…`). */
export const strategyOf = (id: string): Strategy | undefined =>
  STRATEGIES[id] ?? (id.includes('+') ? storyCombos(STRATEGIES.reasonable).find(s => s.id === id) : undefined);

/**
 * The store state on `day` at `phase` (`end`: after the last report, or after an evening that lost all trust), the
 * strategy playing everything before; at `cards`, the first `card` cards already answered. The morning hands over
 * the run's own pre-filled plan; the rush opens with the strategy's plan at tick 0. Throws when the run ends before
 * the asked phase (lost trust) or the strategy is unknown.
 */
export function gameAt(seed: number, day: Day, phase: DevPhase, strategyId = 'reasonable', card = 0): RunStoreState {
  const strategy = strategyOf(strategyId);
  if (strategy === undefined) throw new Error(`no strategy ${strategyId}`);
  let s = startRun(seed, `bot-${seed}`);
  const target = phase === 'end' ? CONFIG.run.dayCount : day;
  while (s.run.day < target) {
    s = step(cards(lunch(open(s, strategy), strategy), strategy), { type: 'nextDay' });
    if (s.run.phase === 'end' && phase === 'end') return s;
    if (s.run.phase === 'end') throw new Error(`the run ended on day ${s.run.day} (${s.run.outcome})`);
  }
  if (phase === 'morning') return s;
  s = open(s, strategy);
  if (phase === 'rush') return s;
  s = lunch(s, strategy);
  if (phase === 'cards') {
    for (let i = 0; i < card && s.run.phase === 'cards' && s.run.cardIndex < s.run.cards.length - 1; i++) {
      s = step(s, { type: 'chooseCard', choice: strategy.card(s.run.cards[s.run.cardIndex], s.run) });
    }
    return s;
  }
  s = cards(s, strategy);
  if (phase === 'report') return s;
  return step(s, { type: 'nextDay' });
}
