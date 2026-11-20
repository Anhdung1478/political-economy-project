// The run as a state machine (spec §3, §10 "Lưu ván"): one pure reducer over every player intent, and saving and
// loading the run on the device. No React, clock or DOM here; `useRun` drives it in real time.
import { CONFIG, type SimConfig } from '../../../shared/sim/config';
import { openDay, quickFill, validatePlan } from '../../../shared/sim/day';
import { finishRush, step } from '../../../shared/sim/rush';
import { chooseCard, endRush, newRun, nextDay, score } from '../../../shared/sim/run';
import type {
  Action, Choice, MorningPlan, RunState, RushState, SimEvent, TeaGrade, ToppingId, UpgradeId,
} from '../../../shared/sim/types';
import type { KeyValueStore } from './storage';

export interface RunStoreState {
  run: RunState;
  /** The rush while `run.phase` is `'rush'`, else null. */
  rush: RushState | null;
  /** The morning plan being edited; `open` opens the shop with it. Equals `run.plan` after each day change. */
  planDraft: MorningPlan;
  /** During the rush: the run as it was that morning, before `openDay` paid the plan (what a save records). */
  beforeOpen: RunState | null;
}

export type Intent =
  | { type: 'setPrice'; price: number }
  | { type: 'setTea'; tea: TeaGrade }
  | { type: 'setTeaMl'; teaMl: number }
  | { type: 'setTopping'; id: ToppingId; count: number }
  | { type: 'setUpgrade'; upgrade: UpgradeId | null }
  | { type: 'quickFill'; level: 'low' | 'mid' | 'high' }
  | { type: 'open' }
  /** One rush tick with the actions queued for it, in order. */
  | { type: 'tick'; actions: readonly Action[] }
  /** Closes the shop after `actions` (queued but not yet stepped), then plays the rest of the street at once. */
  | { type: 'closeEarly'; actions?: readonly Action[] }
  /** Finishes the street if it is still running, then the afternoon cards are dealt. */
  | { type: 'endRush' }
  | { type: 'chooseCard'; choice: Choice }
  | { type: 'nextDay' }
  | { type: 'newRun'; seed: number; runId: string };

export interface Transition {
  /** The same object as the input when the intent was ignored. */
  state: RunStoreState;
  /** What the rush emitted (tick, close early, end rush); empty otherwise. */
  events: SimEvent[];
}

const TEAS: readonly TeaGrade[] = ['skimp', 'standard', 'premium'];
const TOPPINGS: readonly ToppingId[] = ['pearl', 'jelly', 'pudding'];
const UPGRADES: readonly UpgradeId[] = ['staff', 'machine', 'banner'];
const LEVELS = ['low', 'mid', 'high'] as const;

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isCount = (x: unknown): x is number => isNum(x) && x >= 0 && Number.isInteger(x);

/** A fresh run on the morning of day 1, its pre-filled plan as the draft. */
export function startRun(seed: number, runId: string, cfg: SimConfig = CONFIG): RunStoreState {
  const run = newRun(seed, runId, cfg);
  return { run, rush: null, planDraft: run.plan, beforeOpen: null };
}

const atMorning = (run: RunState): RunStoreState => ({ run, rush: null, planDraft: run.plan, beforeOpen: null });

/** Applies one intent. An intent that does not fit the phase or carries bad values is ignored, never thrown. */
export function transition(s: RunStoreState, intent: Intent, cfg: SimConfig = CONFIG): Transition {
  const same: Transition = { state: s, events: [] };
  try {
    return apply(s, intent, cfg) ?? same;
  } catch {
    return same;
  }
}

/** `transition` without the events, on the shared config (two parameters, so `intents.reduce(reduce, s)` works). */
export const reduce = (s: RunStoreState, intent: Intent): RunStoreState => transition(s, intent).state;

function edit(s: RunStoreState, patch: Partial<MorningPlan>): Transition | null {
  if (s.run.phase !== 'morning') return null;
  return { state: { ...s, planDraft: { ...s.planDraft, ...patch } }, events: [] };
}

function apply(s: RunStoreState, i: Intent, cfg: SimConfig): Transition | null {
  const { run, rush } = s;
  const live = run.phase === 'rush' && rush !== null;
  switch (i.type) {
    case 'setPrice':
      return isNum(i.price) && i.price >= 0 ? edit(s, { price: i.price }) : null;
    case 'setTea':
      return TEAS.includes(i.tea) ? edit(s, { tea: i.tea }) : null;
    case 'setTeaMl':
      return isNum(i.teaMl) && i.teaMl >= 0 ? edit(s, { teaMl: i.teaMl }) : null;
    case 'setTopping':
      if (!TOPPINGS.includes(i.id) || !isCount(i.count)) return null;
      return edit(s, { toppings: { ...s.planDraft.toppings, [i.id]: i.count } });
    case 'setUpgrade':
      if (i.upgrade !== null && (!UPGRADES.includes(i.upgrade) || run.upgrades.includes(i.upgrade))) return null;
      return edit(s, { upgrade: i.upgrade });
    case 'quickFill': {
      if (!LEVELS.includes(i.level) || run.phase !== 'morning') return null;
      const fill = quickFill(run, i.level, s.planDraft, cfg);
      return edit(s, { teaMl: fill.teaMl, toppings: { ...fill.toppings } });
    }
    case 'open': {
      if (run.phase !== 'morning' || validatePlan(run, s.planDraft, cfg).length > 0) return null;
      const o = openDay(run, s.planDraft, cfg);
      return { state: { run: o.run, rush: o.rush, planDraft: s.planDraft, beforeOpen: run }, events: o.events };
    }
    case 'tick': {
      if (!live || rush.done || !Array.isArray(i.actions)) return null;
      const r = step(rush, i.actions, cfg);
      return { state: { ...s, rush: r.state }, events: r.events };
    }
    case 'closeEarly': {
      if (!live || rush.done) return null;
      const first = step(rush, [...(i.actions ?? []), { type: 'closeEarly' }], cfg);
      const rest = finishRush(first.state, cfg);
      return { state: { ...s, rush: rest.state }, events: [...first.events, ...rest.events] };
    }
    case 'endRush': {
      if (!live) return null;
      const fin = rush.done ? { state: rush, events: [] } : finishRush(rush, cfg);
      const next = endRush(run, fin.state, cfg);
      return { state: { run: next, rush: null, planDraft: s.planDraft, beforeOpen: null }, events: fin.events };
    }
    case 'chooseCard':
      if (run.phase !== 'cards' || (i.choice !== 'A' && i.choice !== 'B')) return null;
      return { state: { ...s, run: chooseCard(run, i.choice, cfg) }, events: [] };
    case 'nextDay': {
      if (run.phase !== 'report') return null;
      const next = nextDay(run, cfg);
      return { state: next.phase === 'morning' ? atMorning(next) : { ...s, run: next }, events: [] };
    }
    case 'newRun':
      if (!Number.isInteger(i.seed) || typeof i.runId !== 'string' || i.runId === '') return null;
      return { state: startRun(i.seed, i.runId, cfg), events: [] };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Saving

/** Storage keys: solo and class runs apart, a class run tied to its session code. */
export const KEYS = {
  solo: 'pts.solo.run',
  class: (code: string) => `pts.class.${code}.run`,
  /** Best total score, solo. */
  best: 'pts.solo.best',
} as const;

/** Version of the saved record; a record of another version is dropped. */
export const SAVE_VERSION = 1;

interface Saved { v: number; sessionCode: string | null; run: RunState; planDraft: MorningPlan }

export interface SaveOpts { sessionCode?: string }

/**
 * Saves the run. During the rush it records the morning before opening, with the plan as the draft, so a reload
 * returns to that morning with the plan filled in and nothing paid. Storage failures are swallowed.
 */
export function save(store: KeyValueStore, key: string, s: RunStoreState, opts: SaveOpts = {}): void {
  const rushing = s.run.phase === 'rush';
  const run = rushing ? s.beforeOpen : s.run;
  if (run === null) return;
  const rec: Saved = { v: SAVE_VERSION, sessionCode: opts.sessionCode ?? null, run, planDraft: s.planDraft };
  try {
    store.set(key, JSON.stringify(rec));
  } catch { /* storage unavailable: the game plays on without resuming */ }
}

const isStock = (x: unknown): boolean => {
  const o = x as { teaMl?: unknown; toppings?: Record<string, unknown> } | null;
  return typeof o === 'object' && o !== null && isNum(o.teaMl) && typeof o.toppings === 'object' && o.toppings !== null
    && TOPPINGS.every(t => isNum(o.toppings![t]));
};

function isPlan(x: unknown): x is MorningPlan {
  const p = x as Partial<MorningPlan> | null;
  return typeof p === 'object' && p !== null && isNum(p.price) && TEAS.includes(p.tea as TeaGrade)
    && isStock({ teaMl: p.teaMl, toppings: p.toppings })
    && (p.upgrade === null || UPGRADES.includes(p.upgrade as UpgradeId));
}

const SAVED_PHASES: readonly RunState['phase'][] = ['morning', 'cards', 'report', 'end'];

/** A structural check of the fields the game reads first; deep corruption beyond this is not expected. */
function isRun(x: unknown): x is RunState {
  const r = x as Partial<RunState> | null;
  if (typeof r !== 'object' || r === null) return false;
  return r.v === 1 && isNum(r.seed) && typeof r.runId === 'string' && [1, 2, 3, 4, 5].includes(r.day as number)
    && SAVED_PHASES.includes(r.phase as RunState['phase']) && isNum(r.cash) && isNum(r.rep) && isCount(r.skimpDays)
    && isNum(r.cardIndex) && typeof r.flags === 'object' && r.flags !== null && isPlan(r.plan)
    && [r.upgrades, r.pending, r.sideDeck, r.sideDrawn, r.shops, r.morningNews, r.cards, r.choices, r.cardRep, r.reports]
      .every(Array.isArray);
}

/**
 * The saved run as a fresh store state (no rush), or null: nothing saved, unreadable, another version, or a run saved
 * under another session code (`sessionCode` absent = solo). A dropped record is removed.
 */
export function load(store: KeyValueStore, key: string, opts: SaveOpts = {}): RunStoreState | null {
  let raw: string | null;
  try { raw = store.get(key); } catch { return null; }
  if (raw === null) return null;
  const drop = () => {
    try { store.set(key, null); } catch { /* ignore */ }
    return null;
  };
  let rec: Partial<Saved> | null;
  try { rec = JSON.parse(raw) as Partial<Saved> | null; } catch { return drop(); }
  if (typeof rec !== 'object' || rec === null || Array.isArray(rec)) return drop();
  if (rec.v !== SAVE_VERSION || !isRun(rec.run) || !isPlan(rec.planDraft)) return drop();
  if ((rec.sessionCode ?? null) !== (opts.sessionCode ?? null)) return drop();
  return { run: rec.run, rush: null, planDraft: rec.planDraft, beforeOpen: null };
}

/** The best solo total, or null when none (or unreadable). */
export function loadBest(store: KeyValueStore, key: string): number | null {
  try {
    const raw = store.get(key);
    if (raw === null) return null;
    const n = Number(raw);
    return raw.trim() !== '' && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Keeps `total` if it beats the stored best; returns the best after. */
export function recordBest(store: KeyValueStore, key: string, total: number): number {
  const best = loadBest(store, key);
  if (best !== null && best >= total) return best;
  try { store.set(key, String(total)); } catch { /* ignore */ }
  return total;
}

export interface PersistOpts {
  /** Where the run is saved; null saves nothing (previews). */
  key: string | null;
  sessionCode?: string;
  /** Solo: where the best total is kept when a run reaches its end. */
  bestKey?: string | null;
}

/**
 * Persistence after an intent: saves whenever the run changed (every phase change, opening the shop, each card
 * choice, a new run; rush ticks and draft edits leave the run alone), and records the best score as the run ends.
 */
export function afterTransition(store: KeyValueStore, p: PersistOpts, prev: RunStoreState, next: RunStoreState,
  cfg: SimConfig = CONFIG): void {
  if (prev.run === next.run) return;
  if (p.key !== null) save(store, p.key, next, { sessionCode: p.sessionCode });
  if (p.bestKey && next.run.phase === 'end' && prev.run.phase !== 'end') {
    recordBest(store, p.bestKey, score(next.run, cfg).total);
  }
}
