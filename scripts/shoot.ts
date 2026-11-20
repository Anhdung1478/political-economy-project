// Screenshots of the running web app (Task 14): starts a Vite dev server on a free port, opens headless Chrome with
// puppeteer-core, goes to a route, waits, captures PNG frames, prints the page's console errors and the street's
// measured frame rate (`window.__sceneFps`), then shuts everything down.
//
//   npm run shoot -- --route "/dev/scene?day=3&seed=7" [--size 390x844] [--dpr 2] [--wait 2000]
//                    [--frames 1] [--every 1000] [--out .shots/name] [--cpu 4] [--ready SELECTOR]
//
// The route may leave out its leading slash ("dev/scene?day=3"), which Git Bash would otherwise rewrite into a path.
// Captures start once `--ready` matches (default on /dev/scene: the street's first frame,
// `canvas[data-scene][data-ready="1"]`; elsewhere none, the load event only), then `--wait` ms later.
//
// Frames go to `<out>.png` (one frame) or `<out>-01.png`, `<out>-02.png`, … under `.shots/` (git-ignored). Chrome comes
// from CHROME_PATH, default C:\Program Files\Google\Chrome\Application\chrome.exe. `--cpu N` slows the page's CPU N
// times (Chrome DevTools throttling). Exit 0 when the page logged no error, 1 when it did, 2 on bad arguments or a
// failure to start.
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser } from 'puppeteer-core';
import { createServer, type ViteDevServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, '.shots');
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USAGE = 'usage: npm run shoot -- --route PATH [--size WxH] [--dpr N] [--wait MS] [--frames N] [--every MS] '
  + '[--out .shots/NAME] [--cpu N] [--ready SELECTOR]';
/** What a scene route is ready on: the street's first frame (not the Suspense loader before it). */
const SCENE_READY = 'canvas[data-scene][data-ready="1"]';

interface Args {
  route: string; width: number; height: number; dpr: number; wait: number; frames: number; every: number;
  out: string; cpu: number;
  /** A selector to wait for before capturing; '' for none; null until defaulted from the route. */
  ready: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { route: '', width: 390, height: 844, dpr: 2, wait: 2000, frames: 1, every: 1000,
    out: path.join(SHOTS, 'shot'), cpu: 1, ready: null };
  const num = (flag: string, v: string | undefined, min: number) => {
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n) || n < min) throw new Error(`${flag} needs a number >= ${min}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    const v = argv[i + 1];
    i++;
    if (f === '--route') {
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
    else if (f === '--cpu') a.cpu = num(f, v, 1);
    else if (f === '--ready') {
      if (v === undefined) throw new Error('--ready needs a CSS selector (or "" for none)');
      a.ready = v;
    }
    else if (f === '--out') {
      if (v === undefined) throw new Error('--out needs a path');
      a.out = path.resolve(ROOT, v.replace(/\.png$/i, ''));
    } else throw new Error(`unknown argument ${f}`);
  }
  if (a.route === '') throw new Error('--route is required');
  if (a.ready === null) a.ready = a.route.startsWith('/dev/scene') ? SCENE_READY : '';
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
  try {
    const port = await freePort();
    server = await createServer({
      configFile: path.join(ROOT, 'vite.config.ts'),
      root: path.join(ROOT, 'web'),
      server: { port, strictPort: true, host: '127.0.0.1', open: false },
      logLevel: 'warn',
      clearScreen: false,
    });
    await server.listen();
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true,
      args: ['--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check'],
      defaultViewport: { width: args.width, height: args.height, deviceScaleFactor: args.dpr },
    });
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`page error: ${e instanceof Error ? e.message : String(e)}`));
    if (args.cpu > 1) await page.emulateCPUThrottling(args.cpu);
    const url = `http://127.0.0.1:${port}${args.route}`;
    console.log(`→ ${url}  ${args.width}×${args.height} @${args.dpr}x${args.cpu > 1 ? `  cpu ÷${args.cpu}` : ''}`);
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    if (args.ready) await page.waitForSelector(args.ready, { timeout: 60_000 });
    await sleep(args.wait);
    await mkdir(path.dirname(args.out), { recursive: true });
    const fps: number[] = [];
    const readFps = async () => {
      const f = await page.evaluate(() => window.__sceneFps);
      if (typeof f === 'number') fps.push(f);
    };
    for (let i = 0; i < args.frames; i++) {
      if (i > 0) await sleep(args.every);
      await readFps();
      const file = fileOf(args, i);
      await page.screenshot({ path: file as `${string}.png`, type: 'png' });
      console.log(`  ${path.relative(ROOT, file)}`);
    }
    await sleep(Math.min(1000, Math.max(600, args.every)));
    await readFps();
    if (fps.length > 0) {
      console.log(`fps: ${fps.join(', ')} (min ${Math.min(...fps)}, mean ${Math.round(fps.reduce((s, x) => s + x, 0) / fps.length)})`);
    } else {
      console.log('fps: no street on this page');
    }
  } catch (e) {
    console.error(`shoot failed: ${(e as Error).message}`);
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
