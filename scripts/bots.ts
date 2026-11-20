/*
  Rehearsal bots for a class session (Task 27).

    npm run bots -- join 12     12 bots join, vote, wait for the market to open, play a whole run on the session's
                                seed (a random play style and story path), send each day after a random delay, then
                                vote "after". They stay connected until the awards (or Ctrl+C) and play again if the
                                host resets the session.
    npm run bots -- open        host: open the market        (needs HOST_KEY)
    npm run bots -- awards      host: hand out the awards    (needs HOST_KEY)
    npm run bots -- reset       host: start a new session    (needs HOST_KEY)

  URL from BOT_URL (default http://localhost:3000), host key from HOST_KEY (default: the dev key), BOT_OFFSET to fix
  the first name (default random, so a second `join` gets other names).
*/
import { io, type Socket } from 'socket.io-client';
import {
  type Ack, type ClientToServer, isDurable, notNextExpected, type ServerToClient, type SessionSnapshot, type VoteChoice,
} from '../shared/protocol';
import { playRun, STRATEGIES, storyCombos, type Strategy } from '../shared/sim/autoplay';
import type { DaySummary } from '../shared/sim/types';

type Sock = Socket<ServerToClient, ClientToServer>;

const NAMES = ['Tuấn', 'Linh', 'Huy', 'Trang', 'Minh', 'Ngọc', 'Phúc', 'Hà', 'Khoa', 'Vy', 'Bảo', 'My', 'Nam', 'Thảo',
  'Đạt', 'Quỳnh', 'Long', 'Chi', 'Sơn', 'An'];

/** The i-th bot's nickname (counting from `offset`): names in turn, a number from the second lap, then the robot marker. */
export function botName(i: number, offset = 0): string {
  const n = i + offset;
  const lap = Math.floor(n / NAMES.length);
  return `${NAMES[n % NAMES.length]}${lap > 0 ? ` ${lap + 1}` : ''} 🤖`;
}

/** The "after" vote follows the reporter card: A is the invisible hand, B the visible one. */
export function afterVote(reporter: 'A' | 'B' | null): VoteChoice {
  return reporter === 'B' ? 'visible' : 'invisible';
}

/** Play styles by weight (R58): `plainS` is a balance probe that always loses on day 1, so only a trickle of it. */
const MIX: [string, number][] = [
  ['reasonable', 20], ['premium', 12], ['delay1', 10], ['delay6', 10], ['half', 10], ['double', 10], ['flat15', 8],
  ['day5cheat', 8], ['skimp', 4], ['flat45', 4], ['plainS', 2],
];

/** A random style from the mix, wrapped in a random story-card path (`storyCombos`) so the card choices vary. */
export function chooseStrategy(rnd: () => number): Strategy {
  let r = rnd() * MIX.reduce((a, [, w]) => a + w, 0);
  let id = MIX[0][0];
  for (const [k, w] of MIX) { id = k; if ((r -= w) < 0) break; }
  const combos = storyCombos(STRATEGIES[id]);
  return combos[Math.floor(rnd() * combos.length)];
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** A day the server asks for again more often than this is given up (as in the phone's report queue). */
const MAX_RESYNCS = 3;
/**
 * An ack-ed emit; `timeout` when no answer comes in time or the connection drops first (a killed server never
 * answers). Never sent while disconnected: socket.io would flush it before `player:resume` after the reconnect.
 */
const emitAck = <T extends object>(s: Sock, fire: (cb: (r: Ack<T>) => void) => void, timeoutMs = 10000) =>
  new Promise<Ack<T>>(res => {
    const timedOut = { ok: false, error: 'timeout' } as const;
    if (!s.connected) { res(timedOut); return; }
    const done = (r: Ack<T>) => { clearTimeout(t); s.off('disconnect', lost); res(r); };
    const lost = () => done(timedOut);
    const t = setTimeout(lost, timeoutMs);
    s.once('disconnect', lost);
    fire(done);
  });

export interface BotOptions {
  url: string;
  name: string;
  /** Delay before each day is sent, in ms. */
  delay: [number, number];
  rnd?: () => number;
  /** Fixed play style (tests); otherwise `chooseStrategy`. */
  strategy?: Strategy;
  /** Consecutive failed connections before the bot gives up. */
  maxConnectErrors?: number;
  log?: (msg: string) => void;
}
export interface Bot {
  /** Resolves when the bot has sent all its days and voted after in the CURRENT session code. */
  whenDone: () => Promise<void>;
  /** Resolves with the first state (after now) that `pred` accepts. */
  nextState: (pred: (s: SessionSnapshot) => boolean) => Promise<SessionSnapshot>;
  state: () => SessionSnapshot | null;
  /** Resolves with a message if the bot gave up (server unreachable). */
  failed: Promise<string>;
  stats: () => { accepted: number; refused: number };
  stop: () => void;
}

/**
 * One fake student. It keeps its token and resumes after a reconnect or a server restart, resends a day whose ack
 * timed out, was refused as `unknownPlayer` or `notOpen`, or came back `durable: false`, goes back to the day the
 * server expects when a `notNext` names an earlier one (a restarted server lost days), and on a session reset keeps
 * its identity, votes again and plays the new seed.
 */
export function startBot(o: BotOptions): Bot {
  const rnd = o.rnd ?? Math.random;
  const log = o.log ?? (() => {});
  const say = (m: string) => log(`${o.name}: ${m}`);
  const maxErrors = o.maxConnectErrors ?? 20;
  const s: Sock = io(o.url, { transports: ['websocket'], forceNew: true });
  let snap: SessionSnapshot | null = null;
  const listeners = new Set<(st: SessionSnapshot) => void>();
  const doneWaiters: (() => void)[] = [];
  let token: string | null = null;
  let identified = false;
  let identifying = false;
  let stopped = false;
  /** Bumped on every session change, so a run from an older session stops itself. */
  let epoch = 0;
  let playing = false;
  let voted = false;
  let finishedCode: string | null = null;
  let accepted = 0;
  let refused = 0;
  let errors = 0;
  let fail: (m: string) => void = () => {};
  const failed = new Promise<string>(r => { fail = r; });

  const stop = () => { stopped = true; s.close(); };
  const isDone = () => finishedCode !== null && finishedCode === snap?.code;
  const flushDone = () => { if (isDone()) doneWaiters.splice(0).forEach(r => r()); };

  /** Resume with the token, or join (first time, or after the server forgot us); the awards phase refuses a join. */
  async function identify() {
    if (identifying || stopped || !s.connected) return;
    identifying = true;
    try {
      if (token !== null) {
        const r = await emitAck<{ playerId: string; name: string }>(s, cb => s.emit('player:resume', { token: token as string }, cb));
        if (r.ok) { identified = true; say('resumed'); void maybeStart(); return; }
        if (r.error === 'timeout') return;
        token = null;
      }
      const r = await emitAck<{ playerId: string; token: string }>(s, cb => s.emit('player:join', { nickname: o.name }, cb));
      if (r.ok) {
        token = r.token; identified = true;
        say(`joined (session ${snap?.code})`);
        void maybeStart();
      } else say(`join refused: ${r.error} - waiting for reset`);
    } finally { identifying = false; }
  }

  async function sendVote(choice: VoteChoice, when: 'before' | 'after', code: string): Promise<boolean> {
    const r = await emitAck(s, cb => s.emit('player:vote', { choice, when, code }, cb));
    if (!isDurable(r)) { say(`vote ${when} not saved by the server, will resend`); return false; }
    say(r.ok ? `voted ${when}: ${choice}` : `vote ${when} refused: ${r.error}`);
    return r.ok || (r.error !== 'timeout' && r.error !== 'unknownPlayer');
  }

  async function maybeStart() {
    if (!identified || !snap || stopped) return;
    const mine = epoch;
    if (!voted) {
      voted = true;
      const ok = await sendVote(rnd() < 0.55 ? 'invisible' : 'visible', 'before', snap.code);
      if (epoch !== mine) return;
      if (!ok) voted = false;
    }
    if (snap.phase === 'open' && !playing && finishedCode !== snap.code) void play(snap.code, snap.seed);
  }

  async function play(code: string, seed: number) {
    playing = true;
    const mine = epoch;
    accepted = 0; refused = 0;
    const strategy = o.strategy ?? chooseStrategy(rnd);
    const { run, reports, total } = playRun(seed, strategy);
    const runId = `bot-${o.name}-${code}`;
    say(`market open, playing "${strategy.id}" (${reports.length} days, score ${total})`);
    const alive = () => !stopped && epoch === mine;
    const dropped = () => { say('session changed, run dropped'); };
    /** The day to send next is `reports[i]`; it steps back when the server lost days (`notNext`, lower `expected`). */
    let i = 0;
    let resent = false;
    /** Days refused for good (never resent: that would loop) and how often the server asked for each day again. */
    const refusedDays = new Set<number>();
    const resyncs = new Map<number, number>();
    while (i < reports.length) {
      if (!resent) await sleep(o.delay[0] + rnd() * (o.delay[1] - o.delay[0]));
      resent = false;
      const summary: DaySummary = reports[i].summary;
      for (;;) {
        if (!alive()) return dropped();
        if (!identified) { void identify(); await sleep(300); continue; }
        s.emit('player:progress', { day: summary.day, phase: 'report' });
        const r = await emitAck<{ rank: number }>(s, cb => s.emit('player:day', { code, runId, summary }, cb));
        if (r.ok && isDurable(r)) { accepted++; say(`day ${summary.day} sent, rank ${r.rank}`); i++; break; }
        // `notOpen` is transient (a server restarted in the lobby phase): resend, never a final refusal.
        if (r.ok || r.error === 'timeout' || r.error === 'unknownPlayer' || r.error === 'notOpen') {
          if (!r.ok && r.error === 'unknownPlayer') identified = false;
          say(`day ${summary.day}: ${r.ok ? 'not saved by the server' : r.error}, will resend`);
          await sleep(500);
          continue;
        }
        const expected = notNextExpected(r);
        if (expected === undefined) refusedDays.add(summary.day);
        const back = expected == null ? -1 : reports.findIndex(x => x.summary.day === expected);
        const tries = expected == null ? 0 : resyncs.get(expected) ?? 0;
        if (expected != null && expected < summary.day && back >= 0 && !refusedDays.has(expected)
          && tries < MAX_RESYNCS) {
          say(`day ${summary.day}: the server lost days, resending from day ${expected}`);
          resyncs.set(expected, tries + 1);
          accepted -= i - back;
          i = back; resent = tries === 0; // a day asked for again waits the normal delay
          break;
        }
        refused++; say(`day ${summary.day} refused: ${r.error}`);
        // After a day refused for good, the later days can only be refused `notNext`: stop sending this run.
        i = refusedDays.size > 0 ? reports.length : i + 1;
        break;
      }
    }
    if (!alive()) return dropped();
    while (!(await sendVote(afterVote(run.flags.reporter), 'after', code))) {
      if (!alive()) return dropped();
      await sleep(500);
    }
    finishedCode = code;
    say(`finished: ${accepted} days accepted, ${refused} refused`);
    flushDone();
  }

  const whenDone = () => new Promise<void>(res => { doneWaiters.push(res); flushDone(); });
  const nextState = (pred: (st: SessionSnapshot) => boolean) => new Promise<SessionSnapshot>(res => {
    const l = (st: SessionSnapshot) => { if (pred(st)) { listeners.delete(l); res(st); } };
    listeners.add(l);
  });

  s.on('state', st => {
    const changedCode = snap !== null && snap.code !== st.code;
    snap = st;
    if (stopped) return;
    if (changedCode) {
      say(`new session ${st.code}: keeping my shop, voting again`);
      epoch++; playing = false; voted = false;
    }
    for (const l of [...listeners]) l(st);
    if (!identified) void identify(); else void maybeStart();
  });
  s.on('connect', () => { errors = 0; identified = false; void identify(); });
  s.on('disconnect', () => { identified = false; });
  s.on('connect_error', e => {
    errors++;
    if (errors === 1 || errors % 10 === 0) say(`connection error: ${e.message} (try ${errors})`);
    if (errors >= maxErrors) { fail(`cannot reach ${o.url} after ${errors} tries`); stop(); }
  });

  return { whenDone, nextState, state: () => snap, failed, stats: () => ({ accepted, refused }), stop };
}

/** A host connection: authenticates, runs one command and closes. Resolves with the state after it. */
export async function hostCommand(url: string, key: string, cmd: 'host:open' | 'host:awards' | 'host:reset'):
  Promise<SessionSnapshot> {
  const s: Sock = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  try {
    const first = await new Promise<SessionSnapshot>((res, rej) => {
      const t = setTimeout(() => rej(new Error(`cannot reach ${url}`)), 5000);
      s.once('state', st => { clearTimeout(t); res(st); });
      s.once('connect_error', () => { clearTimeout(t); rej(new Error(`cannot reach ${url}`)); });
    });
    const auth = await emitAck(s, cb => s.emit('host:auth', { key }, cb), 5000);
    if (!auth.ok) throw new Error(`host:auth refused: ${auth.error}`);
    const want = cmd === 'host:open' ? 'open' : cmd === 'host:awards' ? 'awards' : null;
    const changed = new Promise<SessionSnapshot>(res => {
      s.on('state', st => { if (want === null ? st.code !== first.code : st.phase === want) res(st); });
      setTimeout(() => res(first), 3000);
    });
    s.emit(cmd);
    return await changed;
  } finally { s.close(); }
}

/** Starts `n` bots, a little apart. */
export async function runBots(n: number, o: Omit<BotOptions, 'name'> & { offset?: number }): Promise<Bot[]> {
  const bots: Bot[] = [];
  for (let i = 0; i < n; i++) {
    bots.push(startBot({ ...o, name: botName(i, o.offset ?? 0) }));
    await sleep(60);
  }
  return bots;
}

async function main() {
  const url = process.env.BOT_URL ?? 'http://localhost:3000';
  const key = process.env.HOST_KEY ?? 'hai-ban-tay';
  const [cmd, arg] = process.argv.slice(2);
  const log = (m: string) => console.log(m);
  if (cmd === 'join') {
    const n = Number(arg ?? 10);
    if (!Number.isInteger(n) || n < 1 || n > 200) throw new Error('N must be a whole number from 1 to 200');
    const offset = Number(process.env.BOT_OFFSET ?? Math.floor(Math.random() * 400));
    const bots = await runBots(n, { url, delay: [1500, 5000], offset, log });
    process.on('SIGINT', () => { bots.forEach(b => b.stop()); process.exit(0); });
    const run = async () => {
      for (;;) {
        await Promise.all(bots.map(b => b.whenDone()));
        const code = bots[0].state()?.code;
        const st = bots.map(b => b.stats());
        log(`all ${n} bots done in session ${code}: ${st.reduce((a, x) => a + x.accepted, 0)} days accepted, `
          + `${st.reduce((a, x) => a + x.refused, 0)} refused. Waiting for awards or a reset (Ctrl+C to quit).`);
        const next = await bots[0].nextState(x => x.phase === 'awards' || x.code !== code);
        if (next.phase === 'awards' && next.code === code) return;
        log(`session reset (${next.code}), playing again`);
      }
    };
    const msg = await Promise.race([run().then(() => null), ...bots.map(b => b.failed)]);
    bots.forEach(b => b.stop());
    if (msg) throw new Error(msg);
    log('awards are out, bots done');
  } else if (cmd === 'open' || cmd === 'awards' || cmd === 'reset') {
    const st = await hostCommand(url, key, `host:${cmd}`);
    const effect = cmd === 'open' ? st.phase === 'open' : cmd === 'awards' ? st.phase === 'awards' : true;
    if (!effect) { console.error(`${cmd}: no effect (phase is ${st.phase})`); process.exitCode = 1; return; }
    log(`${cmd}: phase ${st.phase}, session ${st.code}, joined ${st.counts.joined}, playing ${st.counts.playing}, finished ${st.counts.finished}`);
    if (cmd === 'awards') {
      for (const a of st.awards?.awards ?? []) log(`${a.emoji} ${a.title}: ${a.name} (${a.value})`);
      for (const t of st.awards?.top ?? []) log(`#${t.rank} ${t.name} ${t.score}`);
    }
  } else {
    console.log('usage: npm run bots -- join N | open | awards | reset');
    process.exitCode = 1;
  }
}

if (process.argv[1] && /bots\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) {
  main().then(() => process.exit(process.exitCode ?? 0), e => { console.error(String(e instanceof Error ? e.message : e)); process.exit(1); });
}
