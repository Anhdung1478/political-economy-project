// Screenshots of the running web app (Task 14): starts a Vite dev server on a free port (or uses a running server with
// `--url`), opens headless Chrome with puppeteer-core, goes to a route, waits, captures PNG frames, prints the page's
// console errors and the page's frame rate, then shuts down what it started.
//
//   npm run shoot -- --route "/dev/scene?day=3&seed=7" [--size 390x844] [--dpr 2] [--wait 2000]
//                    [--frames 1] [--every 1000] [--out .shots/name] [--cpu 4] [--ready SELECTOR] [--full] [--press KEY]
//                    [--click SELECTOR] [--url http://127.0.0.1:3000] [--rush DAY] [--seed N] [--craft] [--measure MS]
//
// The route may leave out its leading slash ("dev/scene?day=3"), which Git Bash would otherwise rewrite into a path.
// Captures start once `--ready` matches (default on /dev/scene: the street's first frame,
// `canvas[data-scene][data-ready="1"]`; on /dev/characters the sheet's; elsewhere none, the load event only), then
// `--wait` ms later. `--full` captures the whole page rather than the viewport. `--press KEY` (a puppeteer key name,
// e.g. `h`, or several separated by commas, `m,d,t,1`) is pressed after that wait, with 700 ms for what it animates,
// before the first capture.
//
// `--url http://host:port` shoots a server that is already running (e.g. the production build, `npm run build &&
// npm start`) instead of starting Vite; the `/dev/*` routes exist only under Vite. `--rush DAY` (1–5) reaches that
// day's lunch rush through the real solo page, which works on any build: it stores a solo run at that day's morning
// on the device before the page loads (days before it played by the `reasonable` bot, run seed `--seed`, default 7),
// then taps "Chơi tiếp", "Mở cửa" and, on day 1, skips the practice cup. The route defaults to /solo.
// `--craft` keeps making cups from the keyboard (M, Đ, T, 1, then hands the ready cup over with Q–R) from then until
// the last capture. `--measure MS` counts frames for MS before the captures, with nothing else going on (crafting
// goes on if asked); without it frames are counted while capturing, which screenshots slow down.
//
// The frame rate is counted in the page with requestAnimationFrame, one figure per second (any build, any page).
//
// Frames go to `<out>.png` (one frame) or `<out>-01.png`, `<out>-02.png`, … under `.shots/` (git-ignored). Chrome comes
// from CHROME_PATH, default C:\Program Files\Google\Chrome\Application\chrome.exe. `--cpu N` slows the page's CPU N
// times (Chrome DevTools throttling). Exit 0 when the page logged no error, 1 when it did, 2 on bad arguments or a
// failure to start.
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import type { ViteDevServer } from 'vite';
import { playRush, STRATEGIES } from '../shared/sim/autoplay';
import { CONFIG } from '../shared/sim/config';
import { morningBrief, openDay, validatePlan } from '../shared/sim/day';
import { chooseCard, endRush, newRun, nextDay } from '../shared/sim/run';
import type { MorningPlan, RunState } from '../shared/sim/types';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.shots');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USAGE = 'usage: npm run shoot -- --route PATH [--size WxH] [--dpr N] [--wait MS] [--frames N] [--every MS] '
  + '[--out .shots/NAME] [--cpu N] [--ready SELECTOR] [--full] [--press KEY] [--click SELECTOR] [--url http://HOST:PORT] '
  + '[--rush DAY] [--seed N] [--craft] [--measure MS]';
/** What a scene route is ready on: the street's first frame (not the Suspense loader before it). */
const SCENE_READY = 'canvas[data-scene][data-ready="1"]';
/** The character sheet's first frame. */
const SHEET_READY = 'canvas[data-sheet][data-ready="1"]';
/** The solo save keys (`web/src/game/runStore.ts` KEYS.solo and its day-title mark). */
const SOLO_KEY = 'pts.solo.run';

interface Args {
  route: string; width: number; height: number; dpr: number; wait: number; frames: number; every: number;
  out: string; cpu: number;
  /** Capture the whole page, not just the viewport. */
  full: boolean;
  /** A key to press after the wait, before capturing. */
  press: string;
  /** A selector to click after the wait (and after --press), before capturing. */
  click: string;
  /** A selector to wait for before capturing; '' for none; null until defaulted from the route. */
  ready: string | null;
  /** A running server to shoot (no Vite); '' to start Vite. */
  url: string;
  /** The solo day whose rush to reach (0: none). */
  rush: number;
  seed: number;
  /** Keep making cups. */
  craft: boolean;
  /** Frames counted for this long before the captures (0: during the captures). */
  measure: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { route: '', width: 390, height: 844, dpr: 2, wait: 2000, frames: 1, every: 1000,
    out: path.join(SHOTS, 'shot'), cpu: 1, full: false, press: '', click: '', ready: null, url: '', rush: 0, seed: 7,
    craft: false, measure: 0 };
  const num = (flag: string, v: string | undefined, min: number) => {
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n) || n < min) throw new Error(`${flag} needs a number >= ${min}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    const v = argv[i + 1];
    i++;
    if (f === '--full' || f === '--craft') {
      if (f === '--full') a.full = true;
      else a.craft = true;
      i--;
    } else if (f === '--route') {
      if (v === undefined || v.startsWith('-')) throw new Error('--route needs a path, e.g. /dev/scene?day=3');
      // Git Bash turns a lone "/host" into "C:/Program Files/Git/host"; a route without the slash is left alone.
      if (/^[A-Za-z]:[\\/]/.test(v)) {
        throw new Error('--route became a file path (Git Bash); write it without the leading / or set MSYS_NO_PATHCONV=1');
      }
      a.route = v.startsWith('/') ? v : `/${v}`;
    } else if (f === '--size') {
      const m = /^(\d+)x(\d+)$/.exec(v ?? '');
      if (m === null) throw new Error('--size needs WxH, e.g. 390x844');
      a.width = Number(m[1]);
      a.height = Number(m[2]);
    } else if (f === '--dpr') a.dpr = num(f, v, 0.5);
    else if (f === '--wait') a.wait = num(f, v, 0);
    else if (f === '--frames') a.frames = Math.floor(num(f, v, 1));
    else if (f === '--every') a.every = num(f, v, 0);
    else if (f === '--press') {
      if (v === undefined || v === '') throw new Error('--press needs a key name, e.g. h (or keys: m,d,t,1)');
      a.press = v;
    } else if (f === '--click') {
      if (v === undefined || v === '') throw new Error('--click needs a CSS selector');
      a.click = v;
    } else if (f === '--cpu') a.cpu = num(f, v, 1);
    else if (f === '--ready') {
      if (v === undefined) throw new Error('--ready needs a CSS selector (or "" for none)');
      a.ready = v;
    } else if (f === '--url') {
      if (v === undefined || !/^https?:\/\/[^/\s]+$/.test(v.replace(/\/+$/, ''))) {
        throw new Error('--url needs http://host:port, e.g. http://127.0.0.1:3000');
      }
      a.url = v.replace(/\/+$/, '');
    } else if (f === '--rush') {
      a.rush = num(f, v, 1);
      if (!Number.isInteger(a.rush) || a.rush > CONFIG.run.dayCount) throw new Error(`--rush needs a day 1–${CONFIG.run.dayCount}`);
    } else if (f === '--seed') {
      a.seed = num(f, v, 0);
      if (!Number.isInteger(a.seed)) throw new Error('--seed needs a whole number');
    } else if (f === '--measure') a.measure = num(f, v, 0);
    else if (f === '--out') {
      if (v === undefined) throw new Error('--out needs a path');
      a.out = path.resolve(ROOT, v.replace(/\.png$/i, ''));
    } else throw new Error(`unknown argument ${f}`);
  }
  if (a.route === '' && a.rush > 0) a.route = '/solo';
  if (a.route === '') throw new Error('--route is required (or --rush DAY)');
  if (a.ready === null) {
    a.ready = a.route.startsWith('/dev/scene') ? SCENE_READY : a.route.startsWith('/dev/characters') ? SHEET_READY : '';
  }
  if (!a.out.startsWith(SHOTS + path.sep)) throw new Error('--out must be under .shots/');
  return a;
}

/** A port nobody listens on right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      s.close(() => (typeof addr === 'object' && addr !== null ? resolve(addr.port) : reject(new Error('no port'))));
    });
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fileOf = (a: Args, i: number) => (a.frames === 1 ? `${a.out}.png` : `${a.out}-${String(i + 1).padStart(2, '0')}.png`);

/**
 * A solo run at `day`'s morning, as the game saves it: the days before played by the `reasonable` bot (plan, rush,
 * cards), the draft its plan for the day.
 */
function soloSave(seed: number, day: number): string {
  const bot = STRATEGIES.reasonable;
  let run: RunState = newRun(seed, `shoot-${seed}`);
  while (run.day < day) {
    if (run.phase !== 'morning') throw new Error(`the bot's run ended before day ${day} (seed ${seed})`);
    const opened = openDay(run, bot.plan(run, morningBrief(run), CONFIG));
    run = endRush(opened.run, playRush(opened.rush, bot.rush, seed + run.day).rush);
    while (run.phase === 'cards') run = chooseCard(run, bot.card(run.cards[run.cardIndex], run));
    run = nextDay(run);
  }
  if (run.phase !== 'morning') throw new Error(`the bot's run ended before day ${day} (seed ${seed})`);
  const plan: MorningPlan = bot.plan(run, morningBrief(run), CONFIG);
  if (validatePlan(run, plan).length > 0) throw new Error(`the bot's day-${day} plan cannot open (seed ${seed})`);
  return JSON.stringify({ v: 1, sessionCode: null, run, planDraft: plan });
}

/** From the solo title to the rush: resume the stored run, open the shop, skip the day-1 practice cup. */
async function enterRush(page: Page, day: number): Promise<void> {
  await page.locator('button::-p-text(Chơi tiếp)').setTimeout(30_000).click();
  await page.locator('button::-p-text(Mở cửa)').setTimeout(30_000).click();
  await page.waitForSelector('.rush', { timeout: 30_000 });
  if (day === 1) await page.locator('.rcoach__skip').setTimeout(30_000).click();
  // the panel slides in and the street settles
  await sleep(800);
}

/**
 * Keeps making cups until `on.go` turns false: on an empty counter M, Đ, T, 1 (a size, then three steps pressed ahead),
 * and a ready cup handed to the first four customers in turn (Q W E R).
 */
async function craftLoop(page: Page, on: { go: boolean }): Promise<number> {
  let made = 0;
  let slot = 0;
  let sent = false;
  while (on.go) {
    const s = await page.evaluate(() => ({
      ready: document.querySelector('.cstage__cup.is-ready') !== null,
      empty: document.querySelector('.cstage__cup .rcup--empty') !== null,
      open: document.querySelector('.rush--open') !== null,
    })).catch(() => null);
    if (s === null || !s.open) break;
    if (!s.empty) sent = false;
    if (s.ready) {
      await page.keyboard.press('qwer'[slot++ % 4] as 'q');
      made++;
    } else if (s.empty && !sent) {
      for (const k of ['m', 'd', 't', '1'] as const) await page.keyboard.press(k);
      sent = true;
    }
    await sleep(150);
  }
  return made;
}

/** Counts animation frames per second in the page, from the first script on (any build). */
const FRAME_COUNTER = `(() => {
  const s = { counts: [], n: 0, since: 0 };
  window.__shootFrames = s;
  const f = t => {
    if (s.since === 0) s.since = t;
    s.n++;
    if (t - s.since >= 1000) { s.counts.push(Math.round((s.n * 1000) / (t - s.since))); s.n = 0; s.since = t; }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
})();`;

declare global {
  interface Window { __shootFrames?: { counts: number[]; n: number; since: number } }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s.length % 2 === 1 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  let server: ViteDevServer | null = null;
  let browser: Browser | null = null;
  const errors: string[] = [];
  const crafting = { go: false };
  let crafter: Promise<number> | null = null;
  try {
    let base = args.url;
    if (base === '') {
      const port = await freePort();
      const { createServer } = await import('vite');
      server = await createServer({
        configFile: path.join(ROOT, 'vite.config.ts'),
        root: path.join(ROOT, 'web'),
        server: { port, strictPort: true, host: '127.0.0.1', open: false },
        logLevel: 'warn',
        clearScreen: false,
      });
      await server.listen();
      base = `http://127.0.0.1:${port}`;
    }
    const save = args.rush > 0 ? soloSave(args.seed, args.rush) : null;
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check'],
      defaultViewport: { width: args.width, height: args.height, deviceScaleFactor: args.dpr },
    });
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`page error: ${e instanceof Error ? e.message : String(e)}`));
    await page.evaluateOnNewDocument(FRAME_COUNTER);
    if (save !== null) {
      // once per tab: a reload must not put the morning back
      await page.evaluateOnNewDocument((key: string, rec: string) => {
        if (sessionStorage.getItem('shoot.seeded') !== null) return;
        sessionStorage.setItem('shoot.seeded', '1');
        const run = (JSON.parse(rec) as { run: { runId: string; day: number } }).run;
        localStorage.setItem(key, rec);
        localStorage.setItem(`${key}.title`, `${run.runId}:${run.day}`);
      }, SOLO_KEY, save);
    }
    if (args.cpu > 1) await page.emulateCPUThrottling(args.cpu);
    const url = `${base}${args.route}`;
    console.log(`→ ${url}  ${args.width}×${args.height} @${args.dpr}x${args.cpu > 1 ? `  cpu ÷${args.cpu}` : ''}`
      + `${args.rush > 0 ? `  rush day ${args.rush} (seed ${args.seed})` : ''}${args.craft ? '  crafting' : ''}`);
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    if (args.ready) await page.waitForSelector(args.ready, { timeout: 60_000 });
    if (args.rush > 0) await enterRush(page, args.rush);
    await sleep(args.wait);
    if (args.press !== '') {
      for (const k of args.press.split(',')) await page.keyboard.press(k as Parameters<typeof page.keyboard.press>[0]);
      await sleep(700);
    }
    if (args.click !== '') {
      await page.click(args.click);
      await sleep(700);
    }
    if (args.craft) {
      crafting.go = true;
      crafter = craftLoop(page, crafting);
      await sleep(1500);
    }
    await mkdir(path.dirname(args.out), { recursive: true });
    const resetCount = () => page.evaluate(() => {
      const s = window.__shootFrames;
      if (s !== undefined) Object.assign(s, { counts: [], n: 0, since: 0 });
    });
    const readCounts = async () => (await page.evaluate(() => window.__shootFrames?.counts ?? [])) as number[];
    let fps: number[] = [];
    if (args.measure > 0) {
      await resetCount();
      await sleep(args.measure + 100);
      fps = await readCounts();
    } else await resetCount();
    for (let i = 0; i < args.frames; i++) {
      if (i > 0) await sleep(args.every);
      const file = fileOf(args, i);
      await page.screenshot({ path: file as `${string}.png`, type: 'png', fullPage: args.full });
      console.log(`  ${path.relative(ROOT, file)}`);
    }
    if (args.measure === 0) {
      await sleep(Math.min(1000, Math.max(600, args.every)));
      fps = await readCounts();
    }
    crafting.go = false;
    const made = crafter === null ? null : await crafter;
    if (made !== null) console.log(`cups handed over: ${made}`);
    if (fps.length > 0) {
      console.log(`fps: median ${median(fps)} (min ${Math.min(...fps)}, max ${Math.max(...fps)}, mean `
        + `${Math.round(fps.reduce((s, x) => s + x, 0) / fps.length)}) over ${fps.length} s`
        + `${args.measure > 0 ? '' : ', while capturing'}: ${fps.join(' ')}`);
    } else {
      console.log('fps: not enough time counted (use --measure MS)');
    }
  } catch (e) {
    console.error(`shoot failed: ${(e as Error).message}`);
    crafting.go = false;
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    return 2;
  }
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  for (const e of errors) console.error(e);
  if (errors.length > 0) console.error(`${errors.length} error(s) on the page`);
  return errors.length > 0 ? 1 : 0;
}

main().then(code => process.exit(code), e => {
  console.error(e);
  process.exit(2);
});
