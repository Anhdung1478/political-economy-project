// The game (spec §3, §9, §10): one run driven by `useRun`, the street scene as the full-bleed background, and the
// screen of the phase on top: the day title and the morning, the rush, the afternoon cards, the evening report and
// the end. Used by Solo and, later, by class mode; it never imports the socket (R2): class mode hands in
// `onDayReport` and sends it itself.
//
// Layout (spec §9 "Bố cục"): the frame is the whole screen (100dvh, no page scroll, no overscroll), the street
// behind; each screen lays itself out for a phone held upright (one column), a phone on its side (two columns) and a
// computer (a centred frame from 1100 px). Turning the phone only changes CSS, so no state is lost.
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { morningBrief } from '../../../../shared/sim/day';
import type { Choice, Day, DaySummary, Phase, RunState } from '../../../../shared/sim/types';
import { bestBefore, KEYS, startRun, type Intent, type PersistOpts, type RunStoreState } from '../../game/runStore';
import { storage } from '../../game/storage';
import { resumeOrStart, useRun } from '../../game/useRun';
import type { TimeOfDay } from '../../scene/lighting';
import { StreetCanvas, type StreetCanvasHandle } from '../../scene/StreetCanvas';
import { cx } from '../../ui/cx';
import { PHASE_LABELS, cashTip, hudMoney, repTip } from './copy';
import { DayTitle } from './DayTitle';
import { MorningScreen } from './MorningScreen';
import { ruleLines } from './morning';
import { CardScreen } from './CardScreen';
import { EndScreen } from './EndScreen';
import { ReportScreen } from './ReportScreen';
import { RushScreen } from './RushScreen';
import { StatTip } from './StatTip';
import { afternoonStreet, morningStreet } from './street';
import './game.css';

export interface GameProps {
  mode: 'solo' | 'class';
  seed: number;
  runId: string;
  /** Class mode: the session code; the save is kept under it and dropped when it changes. */
  sessionCode?: string;
  /** Where the run is saved, overriding the mode's key; null saves nothing (previews, the dev route). */
  persistKey?: string | null;
  /** Called once when a day's evening report is reached (class mode sends it to the server). */
  onDayReport?: (summary: DaySummary, run: RunState) => void;
  /** Class mode: the player's rank on the board, shown in the top bar. */
  rank?: number | null;
  /** The state to start from instead of the saved run or a new one (the dev route). */
  initial?: () => RunStoreState;
  /** The day title: plays each morning (`auto`), stays up (`hold`, for screenshots), or is skipped on the first
   *  morning (`skip`). */
  titleMode?: 'auto' | 'hold' | 'skip';
  /** Solo: a section for the end screen (the leaderboard), made from the finished run. */
  endExtra?: (run: RunState) => ReactNode;
  /** Solo: start a new run from the end screen. */
  onNewRun?: () => void;
  /** Class mode: the awards are still to come (the end screen says "chờ trao giải"). */
  awaitingAwards?: boolean;
  /** The reporter card answered on the end screen by a player who lost before day 5 (§7). */
  onReporterVote?: (choice: Choice) => void;
  /** Class mode: the day and phase the run is in, on mount and at every change (progress for the host board). */
  onPhase?: (day: Day, phase: Phase) => void;
  /** Class mode: reports not delivered yet; the end screen's way out to solo waits until they are. */
  unsent?: number;
}

function persistFor(p: GameProps): PersistOpts {
  if (p.persistKey === null) return { key: null };
  if (p.mode === 'class') {
    const code = p.sessionCode ?? '';
    return { key: p.persistKey ?? KEYS.class(code), sessionCode: code };
  }
  return { key: p.persistKey ?? KEYS.solo, bestKey: KEYS.best };
}

/** The light of each phase: morning warm, the rush at noon, the cards in the golden afternoon, the evening lit. */
export function timeOfDayFor(phase: Phase, dawned: boolean): TimeOfDay {
  switch (phase) {
    case 'morning': return dawned ? 'morning' : 'evening';
    case 'rush': return 'noon';
    case 'cards': return 'afternoon';
    default: return 'evening';
  }
}

const screenMotion = {
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] } },
  exit: { opacity: 0, y: -18, transition: { duration: 0.35, ease: [0.4, 0, 1, 1] } },
} as const;

export default function Game(props: GameProps) {
  const [persist] = useState(() => persistFor(props));
  const r = useRun({
    initial: props.initial ?? (() => resumeOrStart(storage, persist, () => startRun(props.seed, props.runId))),
    persist,
  });
  // `r` changes only when the run, the draft or the clock's flags do: rush ticks do not re-render the game (the rush
  // screen reads the live rush itself).
  const { run, planDraft } = r;
  const { phase, day } = run;

  // The street: live during the rush, otherwise the day's street at rest.
  const canvas = useRef<StreetCanvasHandle>(null);
  const { subscribe, subscribeView, getRush } = r;
  const rushSource = useMemo(() => ({ subscribeView, getRush }), [subscribeView, getRush]);
  useEffect(() => subscribe({
    push: (e, t) => canvas.current?.push(e, t),
    reset: s => canvas.current?.reset(s),
  }), [subscribe]);
  const group = phase === 'morning' ? 'morning' : phase === 'rush' ? 'rush' : 'after';
  const streetKey = `${run.runId}:${day}:${group}`;
  const runRef = useRef(run);
  runRef.current = run;
  const draftPrice = useRef(planDraft.price);
  draftPrice.current = planDraft.price;
  /** The price on the player's board as the street was last built or told. */
  const board = useRef<number | null>(null);
  const street = useMemo(() => {
    const at = runRef.current;
    board.current = null;
    if (group === 'morning') {
      const v = morningStreet(at, draftPrice.current);
      board.current = v?.snapshot.shops.find(x => x.id === 'player')?.price ?? null;
      return v;
    }
    return { snapshot: group === 'after' ? afternoonStreet(at) : null, entrants: [] };
    // Rebuilt per day and phase group only: card choices and draft edits do not reset the street.
  }, [streetKey, group]);
  const snapshot = r.opening ?? street?.snapshot ?? null;
  // The player's board on the morning street follows the draft price (saved edits, so not on every keystroke).
  useEffect(() => {
    if (phase !== 'morning' || board.current === null || board.current === planDraft.price) return;
    canvas.current?.push([{ t: 0, type: 'shopPrice', shop: 'player', from: board.current, to: planDraft.price }], 0);
    board.current = planDraft.price;
  }, [phase, planDraft.price, street]);

  // The day title, once per morning (remembered with the save, so a reload mid-morning does not replay it); the light
  // turns to morning while it plays.
  const titleKey = persist.key === null ? null : `${persist.key}.title`;
  const [firstDay] = useState(() => {
    if (props.titleMode === 'skip') return day;
    try {
      return titleKey !== null && storage.get(titleKey) === `${run.runId}:${day}` ? day : 0;
    } catch {
      return 0;
    }
  });
  const [titled, setTitled] = useState(firstDay);
  const [dawned, setDawned] = useState(firstDay);
  const [justTitled, setJustTitled] = useState(false);
  const showTitle = phase === 'morning' && titled !== day;
  const runId = run.runId;
  const onTitleDone = useCallback(() => {
    setTitled(day);
    setDawned(day);
    setJustTitled(true);
    try {
      if (titleKey !== null) storage.set(titleKey, `${runId}:${day}`);
    } catch { /* storage unavailable */ }
  }, [day, runId, titleKey]);
  const onDawn = useCallback(() => setDawned(day), [day]);
  const tod = timeOfDayFor(phase, dawned === day);

  // The evening report reached in this session goes out once (class mode).
  const onDayReport = useRef(props.onDayReport);
  onDayReport.current = props.onDayReport;
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current === 'cards' && run.phase === 'report') {
      const rep = run.reports.find(x => x.summary.day === run.day);
      if (rep !== undefined) onDayReport.current?.(rep.summary, run);
    }
    prevPhase.current = run.phase;
  }, [run]);

  const onPhase = useRef(props.onPhase);
  onPhase.current = props.onPhase;
  useEffect(() => { onPhase.current?.(day, phase); }, [day, phase]);

  // No page scroll or pull-to-refresh behind the game.
  useEffect(() => {
    document.documentElement.classList.add('game-lock');
    return () => document.documentElement.classList.remove('game-lock');
  }, []);

  const brief = useMemo(() => (phase === 'morning' ? morningBrief(run) : null), [phase, run]);
  const cash = brief?.cash ?? run.cash;
  const rep = brief?.rep ?? run.rep;
  const { dispatch, openHeld } = r;
  // "Mở cửa" opens with the clock held; the rush screen lets it go once it is on screen (the morning's exit takes
  // ~0.35 s, which would otherwise cost the first ticks of the rush, and the day-1 practice cup would start late).
  const morningDispatch = useCallback((i: Intent) => (i.type === 'open' ? openHeld() : dispatch(i)), [dispatch, openHeld]);
  const newRun = props.onNewRun ?? (props.mode === 'solo'
    ? () => dispatch({ type: 'newRun', seed: Math.floor(Math.random() * 2 ** 31), runId: `solo-${Date.now().toString(36)}` })
    : undefined);

  let screen: ReactNode = null;
  if (showTitle && brief !== null) {
    screen = (
      <DayTitle key={`title-${run.runId}-${day}`} theme={brief.theme} rules={brief.rules} line={ruleLines(brief)[0]}
        onDone={onTitleDone} onDawn={onDawn} hold={props.titleMode === 'hold'} />
    );
  } else if (phase === 'morning') {
    screen = (
      <motion.div key={`morning-${run.runId}-${day}`} className="game__screen" {...screenMotion}>
        <MorningScreen run={run} planDraft={planDraft} dispatch={morningDispatch} entrants={street?.entrants ?? []}
          focusPrice={justTitled} />
      </motion.div>
    );
  } else if (phase === 'rush' && r.rushOn) {
    screen = (
      <motion.div key={`rush-${run.runId}-${day}`} className="game__screen" {...screenMotion}>
        <RushScreen source={rushSource} run={run} opening={r.opening} dispatch={dispatch} act={r.act}
          setHold={r.setHold} held={r.held} hidden={r.hidden} simTime={r.simTime} subscribe={r.subscribe} />
      </motion.div>
    );
  } else if (phase === 'cards') {
    screen = (
      <motion.div key={`cards-${run.runId}-${day}-${run.cardIndex}`} className="game__screen" {...screenMotion}>
        <CardScreen run={run} dispatch={dispatch} />
      </motion.div>
    );
  } else if (phase === 'report') {
    screen = (
      <motion.div key={`report-${run.runId}-${day}`} className="game__screen" {...screenMotion}>
        <ReportScreen run={run} dispatch={dispatch}
          rank={props.mode === 'class' && props.rank != null ? { rank: props.rank } : null} />
      </motion.div>
    );
  } else if (phase === 'end') {
    screen = (
      <motion.div key={`end-${run.runId}`} className="game__screen" {...screenMotion}>
        <EndScreen run={run} mode={props.mode} onNewRun={newRun} rank={props.rank} extra={props.endExtra?.(run)}
          best={persist.bestKey ? bestBefore(storage, persist.bestKey, run.runId) : null}
          awaitingAwards={props.awaitingAwards} onReporterVote={props.onReporterVote} unsent={props.unsent} />
      </motion.div>
    );
  }

  return (
    <div className={cx('game', `game--${phase}`)} data-game="" data-phase={phase} data-tod={tod}>
      <div className="game__street" aria-hidden={phase !== 'rush'}>
        <StreetCanvas ref={canvas} snapshot={snapshot} mode={r.opening ? 'live' : 'ambient'} simTime={r.simTime}
          timeOfDay={tod} seed={run.seed}
          chatter={phase !== 'cards' && phase !== 'report' && phase !== 'end'} />
      </div>
      {phase !== 'rush' && !showTitle && (
        <header className="hud" aria-label="Tình hình quán">
          <div className="hud__day">
            <b>Ngày {day}</b>
            <span className="hud__pips" aria-hidden="true">
              {[1, 2, 3, 4, 5].map(d => <i key={d} className={d < day ? 'is-past' : d === day ? 'is-now' : ''} />)}
            </span>
            <span className="hud__phase">{PHASE_LABELS[phase]}</span>
          </div>
          <div className="hud__stats">
            <StatTip className="hud__stat" label={`Tiền ${hudMoney(cash)}`} tip={cashTip()}>
              <span aria-hidden="true">💰</span> <b className={cash < 0 ? 'fx--bad' : ''}>{hudMoney(cash)}</b>
            </StatTip>
            <StatTip className="hud__stat" label={`Uy tín ${rep}`} tip={repTip()}>
              <span aria-hidden="true">⭐</span> <b>{rep}</b>
            </StatTip>
            {props.mode === 'class' && props.rank != null && (
              <span className="hud__stat" aria-label={`Hạng ${props.rank}`}><span aria-hidden="true">🏆</span> <b>#{props.rank}</b></span>
            )}
          </div>
        </header>
      )}
      <AnimatePresence mode="wait">{screen}</AnimatePresence>
      {r.hidden && phase === 'rush' && <div className="game__paused" role="status">Tạm dừng</div>}
    </div>
  );
}
