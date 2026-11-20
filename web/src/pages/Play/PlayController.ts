// The student's class session, as a plain object (spec §2, §11, §13): it listens to the socket, keeps the phone
// attached to its player (token, `player:resume` on every connect), feeds the report queue and remembers what the
// screens need (the vote, the rank, whether a run is saved). `Play` is a thin React shell over it, and the tests
// drive it headlessly against the real server.
//
// Rules it keeps (Task 24/32 reports, R63):
//  - the queue goes online only once `player:resume` has succeeded, and offline on every disconnect;
//  - `player:progress` is sent again after every resume (it is dropped while disconnected);
//  - the queue's `resync` is built from the run's own reports, so a server that lost days gets them again;
//  - on mount and after every resume, every day of the saved run is queued again (the queue and the server ignore
//    duplicates), so a reload exactly at the day-5 report cannot leave day 5 unsent;
//  - a new session code (host Reset) drops the old run, queue entries, votes and rank.
import type { Progress, SessionSnapshot, VoteChoice } from '../../../../shared/protocol';
import type { Choice, Day, Phase, RunState } from '../../../../shared/sim/types';
import { createOutbox, type Outbox, type QueueItem } from '../../game/reportQueue';
import { KEYS, load } from '../../game/runStore';
import type { KeyValueStore } from '../../game/storage';
import { isNetTimeout, type SessionClient } from '../../net/socket';
import {
  type LocalSession, noteRank, parseLocalSession, parseRankRecord, parseVoteRecord, PLAY_KEYS, type RankNote,
  reportsOf, type Resume, summariesFrom, voteOfReporter,
} from './playLogic';

export interface PlayView {
  resume: Resume;
  playerId: string | null;
  name: string;
  connected: boolean;
  /** The latest `state`; null until one arrives. */
  session: SessionSnapshot | null;
  /** The session this phone last saw, for a reload while offline; used until the first `state`. */
  local: LocalSession | null;
  /** The "before" vote of the current session. */
  vote: VoteChoice | null;
  rank: number | null;
  /** A run of the current session is saved on this phone. */
  hasRun: boolean;
}

export interface PlayOptions {
  /** Wait before asking `player:resume` again after a lost answer. */
  resumeRetryMs?: number;
  /** Wait before the queue resends. */
  retryMs?: number;
}

const newRunId = () => `play-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class PlayController {
  private view: PlayView;
  private listeners = new Set<() => void>();
  private outbox: Outbox;
  private runRef: RunState | null = null;
  private rankNote: RankNote | null = null;
  private lastProgress: Progress | null = null;
  /** The socket is attached to its player (resume succeeded since the last connect). */
  private attached = false;
  private resumeGen = 0;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private client: SessionClient, private store: KeyValueStore, private opts: PlayOptions = {}) {
    const token = store.get(PLAY_KEYS.token);
    const local = parseLocalSession(store.get(PLAY_KEYS.session));
    const saved = local ? this.savedRun(local.code) : null;
    this.runRef = saved;
    this.outbox = createOutbox({
      store,
      send: (item: QueueItem) => item.kind === 'day'
        ? this.client.day({ code: item.code, ...item.payload })
        : this.client.vote({ code: item.code, ...item.payload }),
      isTimeout: isNetTimeout,
      onReply: (item, reply) => {
        const rank = (reply as { rank?: unknown }).rank;
        if (item.kind === 'day' && reply.ok && typeof rank === 'number') this.setRank(item.payload.summary.day, rank);
      },
      resync: (runId, from) => summariesFrom(this.runRef ?? this.currentSaved(), runId, from),
      retryMs: opts.retryMs,
    });
    this.rankNote = local ? parseRankRecord(store.get(PLAY_KEYS.rank), local.code) : null;
    this.view = {
      // A saved run of a known session: the game goes on at once, even offline, until the server says otherwise.
      resume: token === null ? 'anon' : saved !== null ? 'in' : 'checking',
      playerId: null, name: store.get(PLAY_KEYS.name) ?? '',
      connected: false, session: null, local,
      vote: local ? parseVoteRecord(store.get(PLAY_KEYS.vote), local.code) : null,
      rank: this.rankNote?.rank ?? null,
      hasRun: saved !== null,
    };
    if (local) this.outbox.setCode(local.code);
  }

  // ---- the store the React shell subscribes to -------------------------------------------------------------------

  getView = (): PlayView => this.view;
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  };
  private set(patch: Partial<PlayView>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach(l => l());
  }

  /** The session code now (the latest `state`, else the one remembered). */
  code(): string | null { return this.view.session?.code ?? this.view.local?.code ?? null; }
  seed(): number | null { return this.view.session?.seed ?? this.view.local?.seed ?? null; }

  // ---- connection ------------------------------------------------------------------------------------------------

  /** Starts listening; returns the stop function. */
  attach(): () => void {
    const { socket } = this.client;
    const onState = (s: SessionSnapshot) => this.onState(s);
    const onConnect = () => { this.set({ connected: true }); this.resume(); };
    const onDisconnect = () => { this.attached = false; this.outbox.online(false); this.set({ connected: false }); };
    socket.on('state', onState);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('state', onState);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      this.resumeGen++;
      if (this.resumeTimer !== null) { clearTimeout(this.resumeTimer); this.resumeTimer = null; }
      this.attached = false;
      this.outbox.online(false);
    };
  }

  /** Re-attaches this phone to its player (token); the queue goes online only when that worked. */
  resume(): void {
    const token = this.store.get(PLAY_KEYS.token);
    if (token === null) {
      this.attached = false;
      this.outbox.online(false);
      this.set({ resume: 'anon', playerId: null });
      return;
    }
    const gen = ++this.resumeGen;
    void this.client.resume(token).then(r => {
      if (gen !== this.resumeGen || !this.view.connected) return; // a newer attempt, or the line dropped meanwhile
      if (r.ok) {
        this.attached = true;
        this.store.set(PLAY_KEYS.name, r.name);
        this.set({ resume: 'in', playerId: r.playerId, name: r.name });
        this.outbox.online(true);
        this.enqueueSaved();
        this.sendProgress();
      } else if (isNetTimeout(r)) {
        this.resumeTimer = setTimeout(() => {
          this.resumeTimer = null;
          if (gen === this.resumeGen && this.view.connected) this.resume();
        }, this.opts.resumeRetryMs ?? 1500); // keep the player; try again
      } else {
        this.store.set(PLAY_KEYS.token, null);
        this.attached = false;
        this.outbox.online(false);
        this.set({ resume: 'anon', playerId: null });
      }
    });
  }

  /** The join form: on success the token is kept and the phone resumes as that player. */
  async join(name: string) {
    const r = await this.client.join(name);
    if (r.ok) {
      this.store.set(PLAY_KEYS.token, r.token);
      this.set({ resume: 'checking', playerId: r.playerId });
      this.resume();
    }
    return r;
  }

  // ---- the session -----------------------------------------------------------------------------------------------

  private onState(s: SessionSnapshot) {
    const before = parseLocalSession(this.store.get(PLAY_KEYS.session));
    if (before !== null && before.code !== s.code) this.forget(before.code);
    this.store.set(PLAY_KEYS.session, JSON.stringify({ code: s.code, seed: s.seed }));
    this.outbox.setCode(s.code);
    this.rankNote = parseRankRecord(this.store.get(PLAY_KEYS.rank), s.code);
    this.set({
      session: s, local: { code: s.code, seed: s.seed },
      vote: parseVoteRecord(this.store.get(PLAY_KEYS.vote), s.code),
      rank: this.rankNote?.rank ?? null,
      hasRun: this.savedRun(s.code) !== null,
    });
    if (this.attached) this.enqueueSaved();
  }

  /** The host reset the session: the old run, votes and rank are of no use. (The queue belongs to its code.) */
  private forget(code: string) {
    this.store.set(KEYS.class(code), null);
    this.store.set(`${KEYS.class(code)}.title`, null);
    this.store.set(PLAY_KEYS.runId(code), null);
    this.store.set(PLAY_KEYS.vote, null);
    this.store.set(PLAY_KEYS.rank, null);
    this.runRef = null;
    this.rankNote = null;
    this.lastProgress = null;
  }

  /** The run id of this session, made once and kept: a reload goes on with the same run. */
  runId(): string {
    const code = this.code() ?? '';
    const known = this.store.get(PLAY_KEYS.runId(code)) ?? this.savedRun(code)?.runId ?? null;
    if (known !== null) {
      this.store.set(PLAY_KEYS.runId(code), known);
      return known;
    }
    const id = newRunId();
    this.store.set(PLAY_KEYS.runId(code), id);
    return id;
  }

  private savedRun(code: string): RunState | null {
    return load(this.store, KEYS.class(code), { sessionCode: code })?.run ?? null;
  }
  private currentSaved(): RunState | null {
    const code = this.code();
    return code === null ? null : this.savedRun(code);
  }

  // ---- what the screens report -----------------------------------------------------------------------------------

  /** The "before" vote: kept for the session and queued. */
  vote(choice: VoteChoice) {
    const code = this.code();
    if (code === null) return;
    this.store.set(PLAY_KEYS.vote, JSON.stringify({ code, choice }));
    this.set({ vote: choice });
    this.outbox.push('vote', { when: 'before', choice });
  }

  /** The game reached an evening report: queue every day of the run (see R63 above) and its "after" vote. */
  reportDay(run: RunState) {
    this.runRef = run;
    this.enqueue(run);
    if (!this.view.hasRun) this.set({ hasRun: true });
  }

  /** The reporter card answered on the end screen by someone who lost early. */
  reporterVote(choice: Choice) {
    this.outbox.push('vote', { when: 'after', choice: voteOfReporter(choice) });
  }

  /** On mount and after a resume: whatever the saved run holds that the server may not have. */
  enqueueSaved() {
    const run = this.currentSaved();
    if (run === null) return;
    this.runRef = run;
    this.enqueue(run);
    if (!this.view.hasRun) this.set({ hasRun: true });
  }

  private enqueue(run: RunState) {
    const { days, vote } = reportsOf(run);
    for (const d of days) this.outbox.push('day', d);
    if (vote) this.outbox.push('vote', vote);
  }

  /** The game moved to `phase` (the day comes from the saved run). Sent now, and again after every resume. */
  reportProgress(phase: Phase) {
    const run = this.currentSaved() ?? this.runRef;
    const day = (run?.day ?? 1) as Day;
    this.lastProgress = { day, phase };
    if (!this.view.hasRun) this.set({ hasRun: true }); // the game is on screen
    this.sendProgress();
  }
  private sendProgress() {
    if (this.attached && this.lastProgress !== null) this.client.progress(this.lastProgress);
  }

  private setRank(day: number, rank: number) {
    const code = this.code();
    this.rankNote = noteRank(this.rankNote, day, rank);
    if (code !== null) this.store.set(PLAY_KEYS.rank, JSON.stringify({ code, ...this.rankNote }));
    this.set({ rank: this.rankNote.rank });
  }

  /** Reports not answered yet. */
  pending(): number { return this.outbox.pending(); }
}
