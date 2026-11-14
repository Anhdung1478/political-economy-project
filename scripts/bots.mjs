#!/usr/bin/env node
/*
  Rehearsal bots for the tea-market game.

    node scripts/bots.mjs join 12            add 12 bot shops (random poll votes)
    node scripts/bots.mjs price              every bot submits a random price for the current round
    node scripts/bots.mjs next               advance the game one step (needs HOST_KEY)
    node scripts/bots.mjs reset              reset the game (needs HOST_KEY)
    node scripts/bots.mjs auto 15            15 bots play a whole game, host steps every 3 s

  URL from BOT_URL (default http://localhost:3000), host key from HOST_KEY.
  Bot tokens are kept in .bots.json so later commands act as the same shops.
*/
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { io } from 'socket.io-client';

const URL = process.env.BOT_URL ?? 'http://localhost:3000';
const KEY = process.env.HOST_KEY ?? 'hai-ban-tay';
const FILE = '.bots.json';
const NAMES = ['Tuấn', 'Linh', 'Huy', 'Trang', 'Minh', 'Ngọc', 'Phúc', 'Hà', 'Khoa', 'Vy', 'Bảo', 'My', 'Nam', 'Thảo', 'Đạt', 'Quỳnh', 'Long', 'Chi', 'Sơn', 'An'];
const ROUND_MAX = [50, 20, 50, 50];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const connect = () => new Promise(res => { const s = io(URL, { transports: ['websocket'], forceNew: true }); s.once('connect', () => res(s)); });
const call = (s, ev, payload) => new Promise(res => s.emit(ev, payload, res));
const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []);
const latest = s => new Promise(res => s.once('state', res));

async function join(n) {
  const bots = load();
  for (let i = 0; i < n; i++) {
    const s = await connect();
    const name = `${NAMES[(bots.length) % NAMES.length]}${bots.length >= NAMES.length ? ` ${Math.floor(bots.length / NAMES.length) + 1}` : ''} 🤖`;
    const r = await call(s, 'player:join', { nickname: name });
    if (r.ok) {
      bots.push({ name, token: r.token });
      s.emit('player:vote', { choice: Math.random() < 0.55 ? 'invisible' : 'visible' });
    }
    await sleep(120);
    s.close();
  }
  writeFileSync(FILE, JSON.stringify(bots, null, 1));
  console.log(`${bots.length} bots in the market`);
}

async function price() {
  const bots = load();
  const probe = await connect();
  const st = await latest(probe);
  probe.close();
  const max = ROUND_MAX[st.roundIndex] ?? 50;
  for (const b of bots) {
    const s = await connect();
    await call(s, 'player:resume', { token: b.token });
    const p = Math.min(max, 12 + Math.floor(Math.random() * 34));
    await call(s, 'player:price', { price: p });
    s.close();
    await sleep(60);
  }
  console.log(`${bots.length} prices submitted (max ${max}k)`);
}

async function host(cmd) {
  const s = await connect();
  const st = await latest(s);
  const r = await call(s, 'host:auth', { key: KEY });
  if (!r.ok) { console.error('wrong HOST_KEY'); process.exit(1); }
  s.emit(cmd, { phase: st.phase, roundIndex: st.roundIndex });
  await sleep(200);
  s.close();
}

async function auto(n) {
  writeFileSync(FILE, '[]');
  await join(n);
  await host('host:next');                               // event 1
  for (let r = 0; r < 4; r++) {
    await sleep(3000); await host('host:next');          // pricing
    await sleep(1500); await price();
    await sleep(1500); await host('host:next');          // reveal
    await sleep(3000); await host('host:next');          // next event / awards
  }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'join') await join(Number(arg ?? 10));
else if (cmd === 'price') await price();
else if (cmd === 'next') await host('host:next');
else if (cmd === 'reset') await host('host:reset');
else if (cmd === 'auto') await auto(Number(arg ?? 12));
else { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]); }
process.exit(0);
