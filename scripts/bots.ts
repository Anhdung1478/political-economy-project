/*
  Rehearsal bots for a class session (Task 27).

    npm run bots -- join 12     12 bots join, vote, wait for the market to open, play a whole run on the session's
                                seed (random play style), send each day after a random delay, then vote "after"
    npm run bots -- open        host: open the market        (needs HOST_KEY)
    npm run bots -- awards      host: hand out the awards    (needs HOST_KEY)
    npm run bots -- reset       host: start a new session    (needs HOST_KEY)

  URL from BOT_URL (default http://localhost:3000), host key from HOST_KEY (default: the dev key).
  `join` keeps its sockets open until every bot is done (Ctrl+C to stop early). If the host resets the session, the
  bots drop their run and join again under the new session code.
*/
import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServer, ServerToClient, SessionSnapshot, VoteChoice } from '../shared/protocol';
import { playRun, STRATEGIES } from '../shared/sim/autoplay';
import type { DaySummary } from '../shared/sim/types';

type Sock = Socket<ServerToClient, ClientToServer>;

const NAMES = ['Tuấn', 'Linh', 'Huy', 'Trang', 'Minh', 'Ngọc', 'Phúc', 'Hà', 'Khoa', 'Vy', 'Bảo', 'My', 'Nam', 'Thảo',
  'Đạt', 'Quỳnh', 'Long', 'Chi', 'Sơn', 'An'];

/** The i-th bot's nickname: names in turn, a number from the second lap, then the robot marker. */
export function botName(i: number): string {
  const lap = Math.floor(i / NAMES.length);
  return `${NAMES[i % NAMES.length]}${lap > 0 ? ` ${lap + 1}` : ''} 🤖`;
}

/** The "after" vote follows the reporter card: A is the invisible hand, B the visible one. */
export function afterVote(reporter: 'A' | 'B' | null): VoteChoice {
  return reporter === 'B' ? 'visible' : 'invisible';
}

const pick = <T>(xs: readonly T[], rnd: () => number): T => xs[Math.floor(rnd() * xs.length)];
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const emitAck = <T extends object>(fire: (cb: (r: Ack<T>) => void) => void, timeoutMs = 10000) =>
  new Promise<Ack<T>>(res => {
    const t = setTimeout(() => res({ ok: false, error: 'timeout' }), timeoutMs);
    fire(r => { clearTimeout(t); res(r); });
  });

export interface BotOptions {
  url: string;
  name: string;
  /** Delay before each day is sent, in ms. */
  delay: [number, number];
  rnd?: () => number;
  log?: (msg: string) => void;
}
export interface Bot { done: Promise<void>; stop: () => void }

/** One fake student. `done` resolves when it has sent every day and voted after, or after `stop`. */
export function startBot(o: BotOptions): Bot {
  const rnd = o.rnd ?? Math.random;
  const log = o.log ?? (() => {});
  const say = (m: string) => log(`${o.name}: ${m}`);
  const s: Sock = io(o.url, { transports: ['websocket'], forceNew: true });
  let snap: SessionSnapshot | null = null;
  let finish: () => void = () => {};
  const done = new Promise<void>(r => { finish = r; });
  let stopped = false;
  /** Bumped on every (re)join, so a run from an older session stops itself. */
  let epoch = 0;
  let playing = false;
  let joined = false;
  let joining = false;
  let voted = false;

  const stop = () => { stopped = true; s.close(); finish(); };

  async function join() {
    if (joining) return;
    joining = true;
    const r = await emitAck<{ playerId: string; token: string }>(cb => s.emit('player:join', { nickname: o.name }, cb));
    joining = false;
    if (!r.ok) { say(`join refused: ${r.error}`); return; }
    joined = true; voted = false; playing = false;
    epoch++;
    say(`joined (session ${snap?.code})`);
    void maybeStart();
  }

  async function sendVote(choice: VoteChoice, when: 'before' | 'after', code: string): Promise<void> {
    const r = await emitAck(cb => s.emit('player:vote', { choice, when, code }, cb));
    say(r.ok ? `voted ${when}: ${choice}` : `vote ${when} refused: ${r.error}`);
  }

  async function maybeStart() {
    if (!joined || !snap) return;
    if (!voted) {
      voted = true;
      await sendVote(rnd() < 0.55 ? 'invisible' : 'visible', 'before', snap.code);
    }
    if (snap.phase === 'open' && !playing) void play(snap.code, snap.seed);
  }

  async function play(code: string, seed: number) {
    playing = true;
    const mine = epoch;
    const style = pick(Object.keys(STRATEGIES), rnd);
    const { run, reports, total } = playRun(seed, STRATEGIES[style]);
    const runId = `bot-${o.name}-${code}`;
    say(`market open, playing "${style}" (${reports.length} days, score ${total})`);
    const alive = () => !stopped && epoch === mine && snap?.code === code;
    for (const rep of reports) {
      await sleep(o.delay[0] + rnd() * (o.delay[1] - o.delay[0]));
      if (!alive()) { say('session changed, run dropped'); return; }
      s.emit('player:progress', { day: rep.summary.day, phase: 'report' });
      const summary: DaySummary = rep.summary;
      const r = await emitAck<{ rank: number }>(cb => s.emit('player:day', { code, runId, summary }, cb));
      say(r.ok ? `day ${summary.day} sent, rank ${r.rank}` : `day ${summary.day} refused: ${r.error}`);
    }
    if (!alive()) { say('session changed, run dropped'); return; }
    await sendVote(afterVote(run.flags.reporter), 'after', code);
    say('finished');
    finish();
  }

  s.on('state', st => {
    const changedCode = snap !== null && snap.code !== st.code;
    snap = st;
    if (stopped) return;
    if (changedCode) {
      say(`new session ${st.code}, dropping the run and joining again`);
      epoch++; joined = false; playing = false;
      void join();
    } else void maybeStart();
  });
  s.on('connect', () => { if (!joined) void join(); });
  s.on('connect_error', e => say(`connection error: ${e.message}`));

  return { done, stop };
}

/** A host connection: authenticates, runs one command and closes. Resolves with the state after it. */
export async function hostCommand(url: string, key: string, cmd: 'host:open' | 'host:awards' | 'host:reset'):
  Promise<SessionSnapshot> {
  const s: Sock = io(url, { transports: ['websocket'], forceNew: true });
  try {
    const first = await new Promise<SessionSnapshot>(res => s.once('state', res));
    const auth = await emitAck(cb => s.emit('host:auth', { key }, cb));
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
export async function runBots(n: number, o: Omit<BotOptions, 'name'>): Promise<Bot[]> {
  const bots: Bot[] = [];
  for (let i = 0; i < n; i++) {
    bots.push(startBot({ ...o, name: botName(i) }));
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
    const bots = await runBots(n, { url, delay: [1500, 5000], log });
    process.on('SIGINT', () => { bots.forEach(b => b.stop()); });
    await Promise.all(bots.map(b => b.done));
    log(`all ${n} bots done`);
  } else if (cmd === 'open' || cmd === 'awards' || cmd === 'reset') {
    const st = await hostCommand(url, key, `host:${cmd}`);
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
  main().then(() => process.exit(process.exitCode ?? 0), e => { console.error(String(e)); process.exit(1); });
}
