// The student's class session, as a plain object (spec §2, §11, §13): it listens to the socket, keeps the phone
// attached to its player (token, `player:resume` on every connect), feeds the report queue and remembers what the
// screens need (the vote, the rank, whether a run is saved). `Play` is a thin React shell over it, and the tests
// drive it headlessly against the real server.
//
// Memory is the truth and storage is only the copy: the token, vote, rank, run id and "a run exists" live in fields,
// read from storage once at construction and rewritten only when something changes. A phone whose storage is blocked
// (spec §13) can therefore still join, resume within the page, and play to the end; it only cannot come back after a
// reload.
//
// Rules it keeps (Task 24/32 reports, R63, R69):
//  - the queue goes online only once `player:resume` has succeeded, and offline on every disconnect;
//  - `player:progress` is sent again after every resume (it is dropped while disconnected);
//  - the queue's `resync` is built from the run's own reports, so a server that lost days gets them again;
//  - on mount and after every resume, every day of the saved run is queued again (the queue and the server ignore
//    duplicates), so a reload exactly at the day-5 report cannot leave day 5 unsent;
//  - the "after" vote of a run is pushed once (kept in `pts.afterVote`), and again only after a resume;
//  - a `state` never makes the phone send anything (each send used to cause the next `state`);
//  - a new session code (host Reset) drops the old run, queue entries, votes and rank.
import type { Progress, SessionSnapshot, Vote, VoteChoice } from '../../../../shared/protocol';
import type { Choice, Day, Phase, RunState } from '../../../../shared/sim/types';
import { createOutbox, type Outbox, type QueueItem } from '../../game/reportQueue';
import { KEYS, load } from '../../game/runStore';
import type { KeyValueStore } from '../../game/storage';
import { isNetTimeout, type SessionClient } from '../../net/socket';
import {
  type LocalSession, noteRank, parseLocalSession, parseRankRecord, parseVoteRecord, PLAY_KEYS, type RankNote,
  readJson, reportsOf, type Resume, summariesFrom, voteOfReporter,
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
  /** A run of the current session is saved on this phone, or its game has been on screen. */
  hasRun: boolean;
  /** Reports not answered yet (the outbox): "Chơi lại (solo)" waits for them to go out (final review Minor 10). */
  unsent: number;
}

export interface PlayOptions {
  /** Wait before asking `player:resume` again after a lost answer. */
  resumeRetryMs?: number;
  /** Wait before the queue resends. */
  retryMs?: number;
}

const newJoinId = () => `j-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
const newRunId = () => `play-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** What was last pushed as the "after" vote, and for which run: the same again is not pushed. */
interface AfterRecord { code: string; runId: string; choice: VoteChoice }

export class PlayController {
  private view: PlayView;
  private listeners = new Set<() => void>();
  private outbox: Outbox;
  private token: string | null;
  /** The key of the join attempt in progress (memory first, storage as a copy); null when none. */
  private joinId: string | null;
  private runRef: RunState | null = null;
  private rankNote: RankNote | null = null;
  private lastProgress: Progress | null = null;
  private runIds = new Map<string, string>();
  private afterPushed: AfterRecord | null = null;
  /** The socket is attached to its player (resume succeeded since the last connect). */
  private attached = false;
  private resumeGen = 0;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private client: SessionClient, private store: KeyValueStore, private opts: PlayOptions = {}) {
    this.token = store.get(PLAY_KEYS.token);
    this.joinId = store.get(PLAY_KEYS.joinId);
    const local = parseLocalSession(store.get(PLAY_KEYS.session));
    const saved = local ? this.savedRun(local.code) : null;
    this.runRef = saved;
    const box = createOutbox({
      store,
      send: (item: QueueItem) => item.kind === 'day'
        ? this.client.day({ code: item.code, ...item.payload })
        : this.client.vote({ code: item.code, ...item.payload }),
      isTimeout: isNetTimeout,
      onReply: (item, reply) => {
        const rank = (reply as { rank?: unknown }).rank;
        if (item.kind === 'day' && reply.ok && typeof rank === 'number') this.setRank(item.payload.summary.day, rank);
        this.syncUnsent();
      },
      resync: (runId, from) => summariesFrom(this.currentRun(), runId, from),
      retryMs: opts.retryMs,
    });
    // Every change to the queue's length passes here or through `onReply` (an answered report), so `unsent` follows.
    this.outbox = {
      setCode: code => { box.setCode(code); this.syncUnsent(); },
      push: (kind, payload) => { box.push(kind, payload); this.syncUnsent(); },
      online: on => { box.online(on); this.syncUnsent(); },
      pending: () => box.pending(),
    };
    this.rankNote = local ? parseRankRecord(store.get(PLAY_KEYS.rank), local.code) : null;
    const after = readJson(store.get(PLAY_KEYS.afterVote));
    if (after && typeof after.code === 'string' && typeof after.runId === 'string'
      && (after.choice === 'invisible' || after.choice === 'visible')) {
      this.afterPushed = { code: after.code, runId: after.runId, choice: after.choice };
    }
    this.view = {
      // A saved run of a known session: the game goes on at once, even offline, until the server says otherwise.
      resume: this.token === null ? 'anon' : saved !== null ? 'in' : 'checking',
      playerId: null, name: store.get(PLAY_KEYS.name) ?? '',
      connected: client.socket.connected, session: null, local,
      vote: local ? parseVoteRecord(store.get(PLAY_KEYS.vote), local.code) : null,
      rank: this.rankNote?.rank ?? null,
      hasRun: saved !== null,
      unsent: 0,
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

  // ---- connection ------------------------------------------------------------------------------------------------

  /**
   * Starts listening; returns the stop function. The server sends one `state` as the socket connects, which may have
   * arrived before this runs: the client keeps the last one and it is replayed here.
   */
  attach(): () => void {
    const { socket } = this.client;
    const onState = (s: SessionSnapshot) => this.onState(s);
    const onConnect = () => { this.set({ connected: true }); this.resume(); };
    const onDisconnect = () => { this.attached = false; this.outbox.online(false); this.set({ connected: false }); };
    socket.on('state', onState);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    const last = this.client.lastState();
    if (last !== null && this.view.session === null) this.onState(last);
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
    const token = this.token;
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
        this.enqueueSaved(true);
        this.sendProgress();
      } else if (isNetTimeout(r)) {
        this.resumeTimer = setTimeout(() => {
          this.resumeTimer = null;
          if (gen === this.resumeGen && this.view.connected) this.resume();
        }, this.opts.resumeRetryMs ?? 1500); // keep the player; try again
      } else {
        this.token = null;
        this.store.set(PLAY_KEYS.token, null);
        this.attached = false;
        this.outbox.online(false);
        this.set({ resume: 'anon', playerId: null });
      }
    });
  }

  /** The join form: on success the token is kept (in memory first) and the phone resumes as that player. */
  async join(name: string) {
    // One key per attempt: a lost ack (a timeout) keeps it, so the retry, even on a new socket, gets the same player.
    const joinId = this.joinId ?? newJoinId();
    this.joinId = joinId;
    this.store.set(PLAY_KEYS.joinId, joinId);
    const r = await this.client.join(name, joinId);
    if (r.ok || !isNetTimeout(r)) {
      this.joinId = null;
      this.store.set(PLAY_KEYS.joinId, null);
    }
    if (r.ok) {
      this.token = r.token;
      this.store.set(PLAY_KEYS.token, r.token);
      this.set({ resume: 'checking', playerId: r.playerId });
      this.resume();
    }
    return r;
  }

  // ---- the session -----------------------------------------------------------------------------------------------

  private onState(s: SessionSnapshot) {
    const known = this.view.local;
    let patch: Partial<PlayView> = { session: s, local: { code: s.code, seed: s.seed } };
    if (known !== null && known.code !== s.code) {
      // The host reset the session: the old run, votes and rank are of no use. While a token is still to be checked
      // (every connect asks `player:resume`, which always answers: in, refused, or retried) the phone does not claim
      // to be in. With no token nothing will answer, so it is the join form (`anon`), never the loading dots.
      this.forget(known.code);
      patch = { ...patch, vote: null, rank: null, hasRun: false, ...(this.token === null ? { resume: 'anon' as const } : this.attached ? {} : { resume: 'checking' as const }) };
    } else if (known === null) {
      // The first session this page hears of: what storage holds for it, once.
      this.rankNote = parseRankRecord(this.store.get(PLAY_KEYS.rank), s.code);
      patch = { ...patch, vote: parseVoteRecord(this.store.get(PLAY_KEYS.vote), s.code), rank: this.rankNote?.rank ?? null,
        hasRun: this.view.hasRun || this.savedRun(s.code) !== null };
    }
    this.store.set(PLAY_KEYS.session, JSON.stringify({ code: s.code, seed: s.seed }));
    this.outbox.setCode(s.code);
    this.set(patch);
    // Nothing is sent here: a `state` follows every change on the server, including the ones our own sends cause.
  }

  private forget(code: string) {
    this.store.set(KEYS.class(code), null);
    this.store.set(`${KEYS.class(code)}.title`, null);
    this.store.set(PLAY_KEYS.runId(code), null);
    this.store.set(PLAY_KEYS.vote, null);
    this.store.set(PLAY_KEYS.rank, null);
    this.store.set(PLAY_KEYS.afterVote, null);
    this.runIds.delete(code);
    this.runRef = null;
    this.rankNote = null;
    this.lastProgress = null;
    this.afterPushed = null;
  }

  /** The run id of this session, made once and kept (in memory and in storage): a reload goes on with the same run. */
  runId(): string {
    const code = this.code() ?? '';
    const known = this.runIds.get(code) ?? this.store.get(PLAY_KEYS.runId(code)) ?? this.savedRun(code)?.runId ?? null;
    const id = known ?? newRunId();
    this.runIds.set(code, id);
    this.store.set(PLAY_KEYS.runId(code), id);
    return id;
  }

  private savedRun(code: string): RunState | null {
    return load(this.store, KEYS.class(code), { sessionCode: code })?.run ?? null;
  }
  /** The run to report from: the saved one, else the latest the game handed in (storage may be unavailable). */
  private currentRun(): RunState | null {
    const code = this.code();
    const saved = code === null ? null : this.savedRun(code);
    if (saved === null) return this.runRef;
    // Both are of this session; the one with more days is the newer.
    return this.runRef !== null && this.runRef.runId === saved.runId && this.runRef.reports.length > saved.reports.length
      ? this.runRef : saved;
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
    this.enqueue(run, false);
    if (!this.view.hasRun) this.set({ hasRun: true });
  }

  /** The reporter card answered on the end screen by someone who lost early. */
  reporterVote(choice: Choice) {
    this.pushAfter({ when: 'after', choice: voteOfReporter(choice) }, this.runRef?.runId ?? '', true);
  }

  /** On mount and after a resume: whatever the run holds that the server may not have (`again`: the after vote too). */
  enqueueSaved(again = false) {
    const run = this.currentRun();
    if (run === null) return;
    this.runRef = run;
    this.enqueue(run, again);
    if (!this.view.hasRun) this.set({ hasRun: true });
  }

  private enqueue(run: RunState, again: boolean) {
    const { days, vote } = reportsOf(run);
    for (const d of days) this.outbox.push('day', d);
    if (vote) this.pushAfter(vote, run.runId, again);
  }

  /** The after vote, once per run and choice; `again` (after a resume) sends it once more. */
  private pushAfter(vote: Vote, runId: string, again: boolean) {
    const code = this.code();
    if (code === null) return;
    const last = this.afterPushed;
    if (!again && last !== null && last.code === code && last.runId === runId && last.choice === vote.choice) return;
    this.afterPushed = { code, runId, choice: vote.choice };
    this.store.set(PLAY_KEYS.afterVote, JSON.stringify(this.afterPushed));
    this.outbox.push('vote', vote);
  }

  /** The game is in `phase` of `day`. Sent now, and again after every resume. */
  reportProgress(day: Day, phase: Phase) {
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

  private syncUnsent() {
    // the outbox is made before the view
    if (this.view === undefined) return;
    const n = this.outbox.pending();
    if (n !== this.view.unsent) this.set({ unsent: n });
  }
}
