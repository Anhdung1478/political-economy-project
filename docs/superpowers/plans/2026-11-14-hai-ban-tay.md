# Hai Bàn Tay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Node web app: a 10-minute slide presentation ("bàn tay vô hình vs hữu hình") plus a 6-minute phone-played tea-market game.

**Architecture:** Single TypeScript package. `shared/` holds types and game constants; `server/` is Express + Socket.IO with a pure game engine (`server/game/*`) holding all state in RAM; `web/` is a Vite + React SPA with three routes (`/`, `/host`, `/play`). Server broadcasts full room snapshots; clients render them.

**Tech Stack:** Node 24, TypeScript 5.x, Express 5, Socket.IO 4, React 19, Vite, Framer Motion, `qrcode`, `@fontsource/be-vietnam-pro`, Vitest, esbuild (server bundle), concurrently + tsx (dev).

**Spec:** `docs/superpowers/specs/2026-11-14-hai-ban-tay-design.md`

## Global Constraints

- All user-facing copy in Vietnamese.
- Every control (button, range slider, select/dropdown, input, modal, scrollbar, `::selection`, focus ring) is custom-styled; no browser default look.
- Theme: milk-tea shop — cream background, dark ink text, accents matcha / taro / caramel / strawberry; soft rounded corners; SVG illustrations; no pixel art. Font: Be Vietnam Pro.
- Respect `prefers-reduced-motion`.
- Game constants exactly: cost 15k, capacity 10 cups, customers = 15 × players, budgets evenly spread 15k–60k (`wtp_i = 15 + 45·(i+0.5)/N`), price 10k–50k step 1k, default price 25k, pricing 20 s, 4 rounds (free / ceiling 20k / tax → cost 20k incl. 5k tax / rumor → customers ×0.5).
- Env: `PORT` (default 3000), `HOST_KEY` (default `hai-ban-tay`, warn when default), `PUBLIC_URL` (optional, used for QR).
- No database; one room per server process.

---

## File Structure

```
package.json, tsconfig.json, vite.config.ts, vitest.config.ts, Dockerfile, .dockerignore, .gitignore
shared/config.ts        GAME constants, EMOJIS, ROUNDS (round rules + copy)
shared/types.ts         Phase, RoomSnapshot, socket event maps, Award, results
server/game/random.ts   mulberry32 seeded RNG + shuffle
server/game/market.ts   runMarket(): allocate customers to shops (pure)
server/game/names.ts    makeShopName()
server/game/awards.ts   computeAwards()
server/game/engine.ts   GameRoom state machine
server/app.ts           createApp(): express + socket.io wiring, timers, rate limit
server/index.ts         env → createApp → listen
web/index.html
web/src/main.tsx        path router
web/src/net/socket.ts   socket singleton, useRoom(), server clock offset
web/src/styles/*.css    tokens, base (scrollbar, selection, focus), components
web/src/ui/*            Button, Input, Slider, Select, Modal, Countdown, ConnectionBadge, JoinQR, Logo/hands SVG
web/src/content/*       speakers + slides (all presentation copy)
web/src/pages/Presentation/*, Host/*, Play/*
```

---

### Task 1: Scaffold + shared contracts

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `shared/config.ts`, `shared/types.ts`, `server/game/random.ts`
- Test: `server/game/random.test.ts`

**Interfaces — Produces:** `GAME`, `EMOJIS`, `Emoji`, `ROUNDS`, `RoundRule`, `RoundId` (config); `Phase`, `PollChoice`, `ShopResult`, `RoundResult`, `PublicPlayer`, `Award`, `AwardId`, `RoomSnapshot`, `Ack`, `ClientToServer`, `ServerToClient` (types); `mulberry32(seed): () => number`, `shuffle<T>(arr, random): T[]` (random).

- [ ] **Step 1: package.json**

```json
{
  "name": "political-economy-project",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -n server,web -c yellow,magenta \"tsx watch server/index.ts\" \"vite\"",
    "build": "vite build && esbuild server/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server.js",
    "start": "node dist/server.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Install: `npm i express socket.io` and `npm i -D typescript@5 @types/node @types/express vitest tsx esbuild concurrently vite @vitejs/plugin-react react react-dom @types/react @types/react-dom framer-motion socket.io-client qrcode @types/qrcode @fontsource/be-vietnam-pro`.

- [ ] **Step 2: tsconfig.json / vitest.config.ts / .gitignore**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "jsx": "react-jsx",
    "strict": true, "noUnusedLocals": true, "skipLibCheck": true,
    "esModuleInterop": true, "resolveJsonModule": true, "isolatedModules": true,
    "types": ["node", "vite/client"]
  },
  "include": ["shared", "server", "web/src", "vite.config.ts", "vitest.config.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['server/**/*.test.ts'], environment: 'node' } });
```

`.gitignore`: `node_modules/`, `dist/`, `*.log`.

- [ ] **Step 3: shared/config.ts**

```ts
export const GAME = {
  baseCost: 15, capacity: 10, customersPerPlayer: 15, wtpMin: 15, wtpMax: 60,
  priceMin: 10, priceMax: 50, defaultPrice: 25, pricingSeconds: 20,
  nicknameMax: 20, maxPlayers: 200, emojiPerSecond: 5,
} as const;

export const EMOJIS = ['😂', '🔥', '💸', '🧋', '😭', '🤡'] as const;
export type Emoji = (typeof EMOJIS)[number];

export type RoundId = 'free' | 'ceiling' | 'tax' | 'rumor';
export interface RoundRule {
  id: RoundId; emoji: string; hand: 'invisible' | 'visible' | 'chaos';
  title: string; description: string; lesson: string;
  maxPrice: number; cost: number; tax: number; customerMultiplier: number;
}

export const ROUNDS: readonly RoundRule[] = [
  { id: 'free', emoji: '🫥', hand: 'invisible', title: 'Chợ tự do',
    description: 'Bàn tay vô hình lo hết. Muốn bán giá nào thì bán.',
    lesson: 'Không ai ra lệnh, nhưng cạnh tranh tự kéo giá về một mức mà người mua lẫn người bán đều chịu được.',
    maxPrice: 50, cost: 15, tax: 0, customerMultiplier: 1 },
  { id: 'ceiling', emoji: '✋', hand: 'visible', title: 'Nhà nước áp giá trần 20k',
    description: 'Không quán nào được bán quá 20k/ly. Rẻ cho dân, nhưng…',
    lesson: 'Giá trần thấp hơn giá cân bằng → cầu vượt cung → khách xếp hàng mà không mua được.',
    maxPrice: 20, cost: 15, tax: 0, customerMultiplier: 1 },
  { id: 'tax', emoji: '💸', hand: 'visible', title: 'Thuế trân châu 5k/ly',
    description: 'Vốn mỗi ly tăng từ 15k lên 20k. Tiền thuế chảy vào ngân sách.',
    lesson: 'Thuế làm chi phí tăng, lãi giảm — đổi lại nhà nước có ngân sách làm đường, trường, trạm.',
    maxPrice: 50, cost: 20, tax: 5, customerMultiplier: 1 },
  { id: 'rumor', emoji: '🪱', hand: 'chaos', title: 'Tin đồn: trà sữa nấu từ nước rửa chén',
    description: 'Một nửa số khách sợ quá, bỏ về uống nước lọc.',
    lesson: 'Thông tin bất cân xứng làm thị trường "đơ" — cần nhà nước kiểm định và công bố thông tin.',
    maxPrice: 50, cost: 15, tax: 0, customerMultiplier: 0.5 },
];
```

- [ ] **Step 4: shared/types.ts**

```ts
import type { Emoji } from './config';

export type Phase = 'lobby' | 'event' | 'pricing' | 'reveal' | 'awards';
export type PollChoice = 'invisible' | 'visible';

export interface ShopResult { playerId: string; price: number; sold: number; unsold: number; profit: number }
export interface RoundResult {
  roundIndex: number; customers: number; served: number; unserved: number; pricedOut: number;
  taxCollected: number; avgPrice: number; shops: ShopResult[];
}
export interface PublicPlayer {
  id: string; nickname: string; shopName: string; total: number; rank: number;
  connected: boolean; submitted: boolean;
}
export type AwardId = 'tycoon' | 'saint' | 'shark' | 'hoarder';
export interface Award { id: AwardId; emoji: string; title: string; playerId: string; detail: string }

export interface RoomSnapshot {
  phase: Phase; roundIndex: number; totalRounds: number;
  deadline: number | null; serverNow: number;
  players: PublicPlayer[]; poll: Record<PollChoice, number>;
  lastResult: RoundResult | null; awards: Award[];
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServer {
  'player:join': (p: { nickname: string }, ack: (r: Ack<{ playerId: string; token: string }>) => void) => void;
  'player:resume': (p: { token: string }, ack: (r: Ack<{ playerId: string }>) => void) => void;
  'player:vote': (p: { choice: PollChoice }) => void;
  'player:price': (p: { price: number }, ack: (r: Ack) => void) => void;
  'player:emoji': (p: { emoji: Emoji }) => void;
  'host:auth': (p: { key: string }, ack: (r: Ack) => void) => void;
  'host:next': () => void;
  'host:reset': () => void;
}
export interface ServerToClient {
  state: (s: RoomSnapshot) => void;
  emoji: (e: { emoji: Emoji; id: number }) => void;
}
```

- [ ] **Step 5: failing test `server/game/random.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { mulberry32, shuffle } from './random';

describe('random', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 100; i++) { const x = a(); expect(x).toBe(b()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
  it('shuffle keeps elements and does not mutate input', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, mulberry32(1));
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});
```

Run `npx vitest run server/game/random.test.ts` → FAIL (module missing).

- [ ] **Step 6: server/game/random.ts**

```ts
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: readonly T[], random: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

Run tests → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 7: Commit** `chore: scaffold project and shared game contracts`

---

### Task 2: Market allocation

**Files:** Create `server/game/market.ts`; Test `server/game/market.test.ts`

**Interfaces — Consumes:** `shuffle` (Task 1), `ShopResult`. **Produces:**
```ts
customerBudgets(n: number, min: number, max: number): number[]
interface MarketInput { shops: { playerId: string; price: number }[]; customers: number; wtpMin: number; wtpMax: number; capacity: number; cost: number; tax: number }
interface MarketOutput { shops: ShopResult[]; served: number; unserved: number; pricedOut: number; taxCollected: number }
runMarket(input: MarketInput, random?: () => number): MarketOutput
```

Rule: customers arrive in random order; each buys one cup at the cheapest shop that still has capacity and whose price ≤ budget; among equally cheap open shops, the one with fewest cups sold so far. `pricedOut` = no shop affordable; `unserved` = some shop affordable but all affordable shops full (shortage).

- [ ] **Step 1: failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { customerBudgets, runMarket, type MarketInput } from './market';
import { mulberry32 } from './random';

const base = (over: Partial<MarketInput>): MarketInput => ({
  shops: [], customers: 10, wtpMin: 15, wtpMax: 60, capacity: 10, cost: 15, tax: 0, ...over,
});
// budgets for N=10: 17.25, 21.75, 26.25, 30.75, 35.25, 39.75, 44.25, 48.75, 53.25, 57.75

describe('customerBudgets', () => {
  it('spreads budgets evenly at bucket midpoints', () => {
    expect(customerBudgets(3, 15, 60)).toEqual([22.5, 37.5, 52.5]);
  });
});

describe('runMarket', () => {
  it('cheapest shop sells first; unaffordable customers are priced out', () => {
    const out = runMarket(base({ shops: [{ playerId: 'a', price: 20 }, { playerId: 'b', price: 40 }] }), mulberry32(1));
    const a = out.shops.find(s => s.playerId === 'a')!, b = out.shops.find(s => s.playerId === 'b')!;
    expect(a.sold).toBe(9); expect(b.sold).toBe(0);
    expect(out.pricedOut).toBe(1); expect(out.unserved).toBe(0); expect(out.served).toBe(9);
  });

  it('overflow spills to pricier shops and counts are conserved', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const out = runMarket(base({ capacity: 3, shops: [{ playerId: 'a', price: 20 }, { playerId: 'b', price: 40 }] }), mulberry32(seed));
      const [a, b] = out.shops;
      expect(a.sold).toBe(3);
      expect(b.sold).toBeLessThanOrEqual(3);
      expect(out.served + out.unserved + out.pricedOut).toBe(10);
    }
  });

  it('price ceiling style: all full → shortage counted as unserved', () => {
    const out = runMarket(base({ capacity: 2, shops: [{ playerId: 'a', price: 20 }, { playerId: 'b', price: 20 }] }), mulberry32(3));
    expect(out.served).toBe(4); expect(out.unserved).toBe(5); expect(out.pricedOut).toBe(1);
  });

  it('equal prices split customers evenly', () => {
    const out = runMarket(base({ shops: [{ playerId: 'a', price: 20 }, { playerId: 'b', price: 20 }] }), mulberry32(7));
    const [a, b] = out.shops;
    expect(a.sold + b.sold).toBe(9);
    expect(Math.abs(a.sold - b.sold)).toBeLessThanOrEqual(1);
  });

  it('profit = (price - cost) × sold, may be negative; unsold = capacity - sold', () => {
    const out = runMarket(base({ shops: [{ playerId: 'a', price: 10 }] }), mulberry32(1));
    expect(out.shops[0]).toEqual({ playerId: 'a', price: 10, sold: 10, unsold: 0, profit: -50 });
  });

  it('collects tax per cup served', () => {
    const out = runMarket(base({ cost: 20, tax: 5, shops: [{ playerId: 'a', price: 30 }] }), mulberry32(1));
    expect(out.served).toBe(7); // budgets ≥ 30: 30.75 … 57.75
    expect(out.taxCollected).toBe(35);
    expect(out.shops[0].profit).toBe(70);
  });

  it('handles zero customers and zero shops', () => {
    expect(runMarket(base({ customers: 0, shops: [{ playerId: 'a', price: 20 }] })).served).toBe(0);
    expect(runMarket(base({ shops: [] })).pricedOut).toBe(10);
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 2: implement `server/game/market.ts`**

```ts
import type { ShopResult } from '../../shared/types';
import { shuffle } from './random';

export interface MarketInput {
  shops: { playerId: string; price: number }[];
  customers: number; wtpMin: number; wtpMax: number; capacity: number; cost: number; tax: number;
}
export interface MarketOutput { shops: ShopResult[]; served: number; unserved: number; pricedOut: number; taxCollected: number }

export function customerBudgets(n: number, min: number, max: number): number[] {
  return Array.from({ length: n }, (_, i) => min + ((max - min) * (i + 0.5)) / n);
}

export function runMarket(input: MarketInput, random: () => number = Math.random): MarketOutput {
  const sold = new Map(input.shops.map(s => [s.playerId, 0]));
  // Shuffle first so the stable sort leaves equal-price shops in random order.
  const byPrice = shuffle(input.shops, random).sort((a, b) => a.price - b.price);
  const budgets = shuffle(customerBudgets(input.customers, input.wtpMin, input.wtpMax), random);
  let served = 0, unserved = 0, pricedOut = 0;

  for (const budget of budgets) {
    const affordable = byPrice.filter(s => s.price <= budget);
    if (affordable.length === 0) { pricedOut++; continue; }
    const open = affordable.filter(s => sold.get(s.playerId)! < input.capacity);
    if (open.length === 0) { unserved++; continue; }
    let pick = open[0];
    for (const s of open) {
      if (s.price !== open[0].price) break;
      if (sold.get(s.playerId)! < sold.get(pick.playerId)!) pick = s;
    }
    sold.set(pick.playerId, sold.get(pick.playerId)! + 1);
    served++;
  }

  const shops = input.shops.map(s => {
    const n = sold.get(s.playerId)!;
    return { playerId: s.playerId, price: s.price, sold: n, unsold: input.capacity - n, profit: (s.price - input.cost) * n };
  });
  return { shops, served, unserved, pricedOut, taxCollected: served * input.tax };
}
```

Run → PASS. Commit `feat: market allocation for tea shop game`.

---

### Task 3: Shop names + awards

**Files:** Create `server/game/names.ts`, `server/game/awards.ts`; Test `server/game/names.test.ts`, `server/game/awards.test.ts`

**Interfaces — Produces:**
```ts
makeShopName(nickname: string, random: () => number): string
interface PlayerHistory { playerId: string; total: number; rounds: { price: number; sold: number; unsold: number }[] }
computeAwards(players: PlayerHistory[]): Award[]   // players passed in rank order; ties → first wins
```

- [ ] **Step 1: failing tests**

```ts
// names.test.ts
import { describe, expect, it } from 'vitest';
import { makeShopName } from './names';
import { mulberry32 } from './random';
describe('makeShopName', () => {
  it('always includes the nickname', () => {
    const r = mulberry32(5);
    for (let i = 0; i < 50; i++) expect(makeShopName('Dũng', r)).toContain('Dũng');
  });
});
```

```ts
// awards.test.ts
import { describe, expect, it } from 'vitest';
import { computeAwards, type PlayerHistory } from './awards';

const p = (playerId: string, total: number, rounds: [number, number, number][]): PlayerHistory =>
  ({ playerId, total, rounds: rounds.map(([price, sold, unsold]) => ({ price, sold, unsold })) });

describe('computeAwards', () => {
  const players = [
    p('rich', 300, [[30, 10, 0], [20, 10, 0]]),
    p('cheap', 10, [[12, 10, 0], [11, 10, 0]]),
    p('shark', 40, [[50, 1, 9], [45, 0, 10]]),
  ];
  const byId = Object.fromEntries(computeAwards(players).map(a => [a.id, a]));
  it('tycoon = highest total', () => expect(byId.tycoon.playerId).toBe('rich'));
  it('saint = lowest average price', () => expect(byId.saint.playerId).toBe('cheap'));
  it('shark = highest price that still sold', () => {
    expect(byId.shark.playerId).toBe('shark');
    expect(byId.shark.detail).toContain('50k');
  });
  it('hoarder = most unsold', () => expect(byId.hoarder.playerId).toBe('shark'));
  it('skips awards with no eligible player', () => {
    expect(computeAwards([])).toEqual([]);
    const ids = computeAwards([p('x', 0, [[50, 0, 0]])]).map(a => a.id);
    expect(ids).not.toContain('shark'); expect(ids).not.toContain('hoarder');
  });
});
```

Run → FAIL.

- [ ] **Step 2: implement**

```ts
// names.ts
const TEMPLATES: ((n: string) => string)[] = [
  n => `Trà Sữa Tâm Linh của ${n}`,
  n => `${n} Tea — Uống Là Ghiền, Ghiền Là Nợ`,
  n => `Tiệm Trà Chanh Giải Nghiệp ${n}`,
  n => `${n} Milk Tea & Drama`,
  n => `Trân Châu Đường Đen Đủi của ${n}`,
  n => `${n} — Trà Sữa Không Đường Lui`,
  n => `Quán Nước Mía Đi Lạc của ${n}`,
  n => `${n} Coffee (nhưng bán trà sữa)`,
  n => `Trà Sữa Thất Tình ${n}`,
  n => `Hợp Tác Xã Trân Châu ${n}`,
];
export function makeShopName(nickname: string, random: () => number): string {
  return TEMPLATES[Math.floor(random() * TEMPLATES.length)](nickname);
}
```

```ts
// awards.ts
import type { Award } from '../../shared/types';

export interface PlayerHistory { playerId: string; total: number; rounds: { price: number; sold: number; unsold: number }[] }

function best<T>(items: T[], score: (t: T) => number | null): T | null {
  let pick: T | null = null, top = -Infinity;
  for (const it of items) { const s = score(it); if (s !== null && s > top) { top = s; pick = it; } }
  return pick;
}

export function computeAwards(players: PlayerHistory[]): Award[] {
  const played = players.filter(p => p.rounds.length > 0);
  const out: Award[] = [];
  const avg = (p: PlayerHistory) => p.rounds.reduce((s, r) => s + r.price, 0) / p.rounds.length;
  const sharkPrice = (p: PlayerHistory) => { const r = p.rounds.filter(x => x.sold > 0); return r.length ? Math.max(...r.map(x => x.price)) : null; };
  const unsold = (p: PlayerHistory) => p.rounds.reduce((s, r) => s + r.unsold, 0);

  const tycoon = best(played, p => p.total);
  if (tycoon) out.push({ id: 'tycoon', emoji: '🏆', title: 'Đại Gia Trân Châu', playerId: tycoon.playerId, detail: `Lãi ${tycoon.total}k sau cả game` });
  const saint = best(played, p => -avg(p));
  if (saint) out.push({ id: 'saint', emoji: '😇', title: 'Mạnh Thường Quân', playerId: saint.playerId, detail: `Giá trung bình chỉ ${Math.round(avg(saint))}k/ly` });
  const shark = best(played, sharkPrice);
  if (shark) {
    const price = sharkPrice(shark)!; const sold = shark.rounds.find(r => r.price === price && r.sold > 0)!.sold;
    out.push({ id: 'shark', emoji: '🦈', title: 'Tư Bản Hút Máu', playerId: shark.playerId, detail: `Bán ${price}k/ly mà vẫn có ${sold} người mua` });
  }
  const hoarder = best(played, p => (unsold(p) > 0 ? unsold(p) : null));
  if (hoarder) out.push({ id: 'hoarder', emoji: '📦', title: 'Ông Hoàng Tồn Kho', playerId: hoarder.playerId, detail: `Ôm về ${unsold(hoarder)} ly không ai mua` });
  return out;
}
```

Run → PASS. Commit `feat: shop names and end-game awards`.

---

### Task 4: GameRoom engine

**Files:** Create `server/game/engine.ts`; Test `server/game/engine.test.ts`

**Interfaces — Consumes:** `GAME`, `ROUNDS`, `runMarket`, `makeShopName`, `computeAwards`, `mulberry32`. **Produces:**
```ts
class GameRoom {
  constructor(opts?: { now?: () => number; random?: () => number })
  readonly phase: Phase; readonly roundIndex: number; readonly deadline: number | null
  join(nickname: string): Ack<{ playerId: string; token: string }>
  resume(token: string): string | null
  setConnected(playerId: string, connected: boolean): void
  vote(playerId: string, choice: PollChoice): void
  submitPrice(playerId: string, price: number): Ack
  next(): void          // lobby→event(0)→pricing→reveal→event(1)…→reveal(3)→awards
  reset(): void         // back to lobby, keep players + votes, zero scores
  hasPlayer(id: string): boolean
  snapshot(): RoomSnapshot
}
```
Pricing close: every player participates with `pending ?? lastPrice ?? GAME.defaultPrice`, clamped to `[priceMin, round.maxPrice]`; customers = `round(customersPerPlayer × players × multiplier)`.

- [ ] **Step 1: failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { GameRoom } from './engine';
import { mulberry32 } from './random';

const mk = () => { let t = 1000; const room = new GameRoom({ now: () => t, random: mulberry32(9) }); return { room, tick: (ms: number) => (t += ms) }; };
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error('expected ok'); return r as Extract<T, { ok: true }>; };

describe('GameRoom', () => {
  it('validates nicknames and resumes by token', () => {
    const { room } = mk();
    expect(room.join('   ').ok).toBe(false);
    expect(room.join('x'.repeat(21)).ok).toBe(false);
    const j = ok(room.join('  Dũng   Nguyễn '));
    expect(room.snapshot().players[0].nickname).toBe('Dũng Nguyễn');
    expect(room.snapshot().players[0].shopName).toContain('Dũng Nguyễn');
    expect(room.resume(j.token)).toBe(j.playerId);
    expect(room.resume('nope')).toBeNull();
  });

  it('walks through all phases', () => {
    const { room } = mk();
    room.join('A');
    const seen: string[] = [];
    for (let i = 0; i < 13; i++) { seen.push(`${room.phase}:${room.roundIndex}`); room.next(); }
    expect(seen).toEqual([
      'lobby:-1', 'event:0', 'pricing:0', 'reveal:0', 'event:1', 'pricing:1', 'reveal:1',
      'event:2', 'pricing:2', 'reveal:2', 'event:3', 'pricing:3', 'reveal:3',
    ]);
    expect(room.phase).toBe('awards');
    room.next(); expect(room.phase).toBe('awards');
  });

  it('sets a 20s deadline when pricing opens', () => {
    const { room } = mk();
    room.join('A'); room.next(); room.next();
    expect(room.deadline).toBe(1000 + 20_000);
  });

  it('accepts prices only during pricing and within the round cap', () => {
    const { room } = mk();
    const { playerId } = ok(room.join('A'));
    expect(room.submitPrice(playerId, 30).ok).toBe(false);          // lobby
    room.next(); room.next();                                        // pricing round 0
    expect(room.submitPrice(playerId, 9).ok).toBe(false);
    expect(room.submitPrice(playerId, 51).ok).toBe(false);
    expect(room.submitPrice(playerId, 30.5).ok).toBe(false);
    expect(room.submitPrice(playerId, 30).ok).toBe(true);
    expect(room.snapshot().players[0].submitted).toBe(true);
    room.next(); room.next(); room.next();                           // pricing round 1 (ceiling 20)
    expect(room.submitPrice(playerId, 21).ok).toBe(false);
    expect(room.submitPrice(playerId, 20).ok).toBe(true);
  });

  it('scores a lone shop deterministically', () => {
    const { room } = mk();
    const { playerId } = ok(room.join('A'));
    room.next(); room.next(); room.submitPrice(playerId, 30); room.next();
    const r = room.snapshot().lastResult!;
    expect(r.customers).toBe(15);
    expect(r.shops[0]).toMatchObject({ price: 30, sold: 10, profit: 150 }); // 10 of 15 budgets ≥ 30
    expect(room.snapshot().players[0].total).toBe(150);
  });

  it('defaults to 25k, then keeps the last price, clamped by the ceiling', () => {
    const { room } = mk();
    const { playerId } = ok(room.join('A'));
    room.next(); room.next(); room.next();
    expect(room.snapshot().lastResult!.shops[0].price).toBe(25);
    room.next(); room.next(); room.next();                            // round 1 ceiling, no submit
    expect(room.snapshot().lastResult!.shops[0].price).toBe(20);
    room.next(); room.next(); room.submitPrice(playerId, 40); room.next();
    room.next(); room.next(); room.next();                            // round 3, no submit → 40
    expect(room.snapshot().lastResult!.shops[0].price).toBe(40);
    expect(room.snapshot().lastResult!.customers).toBe(8);            // round(15 × 0.5)
  });

  it('counts poll votes and allows changing a vote', () => {
    const { room } = mk();
    const a = ok(room.join('A')).playerId, b = ok(room.join('B')).playerId;
    room.vote(a, 'invisible'); room.vote(b, 'invisible'); room.vote(b, 'visible');
    expect(room.snapshot().poll).toEqual({ invisible: 1, visible: 1 });
  });

  it('ranks by total and builds awards at the end', () => {
    const { room } = mk();
    const a = ok(room.join('A')).playerId, b = ok(room.join('B')).playerId;
    room.next();
    for (let r = 0; r < 4; r++) { room.next(); room.submitPrice(a, 12 + r); room.submitPrice(b, r === 1 ? 20 : 45); room.next(); room.next(); }
    const s = room.snapshot();
    expect(s.phase).toBe('awards');
    expect(s.players[0].rank).toBe(1);
    expect(s.players[0].total).toBeGreaterThanOrEqual(s.players[1].total);
    expect(s.awards.map(x => x.id)).toContain('tycoon');
  });

  it('reset returns to lobby and keeps players and votes', () => {
    const { room } = mk();
    const a = ok(room.join('A')).playerId; room.vote(a, 'visible');
    room.next(); room.next(); room.next();
    room.reset();
    const s = room.snapshot();
    expect(s.phase).toBe('lobby'); expect(s.roundIndex).toBe(-1); expect(s.lastResult).toBeNull();
    expect(s.players[0].total).toBe(0); expect(s.poll.visible).toBe(1);
  });
});
```

Run → FAIL.

- [ ] **Step 2: implement `server/game/engine.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { GAME, ROUNDS } from '../../shared/config';
import type { Ack, Award, Phase, PollChoice, RoomSnapshot, RoundResult } from '../../shared/types';
import { computeAwards } from './awards';
import { runMarket } from './market';
import { makeShopName } from './names';

interface Player {
  id: string; token: string; nickname: string; shopName: string; joinOrder: number;
  total: number; connected: boolean; vote: PollChoice | null;
  pendingPrice: number | null; lastPrice: number | null;
  history: { price: number; sold: number; unsold: number }[];
}

export class GameRoom {
  phase: Phase = 'lobby';
  roundIndex = -1;
  deadline: number | null = null;
  private lastResult: RoundResult | null = null;
  private awards: Award[] = [];
  private players = new Map<string, Player>();
  private byToken = new Map<string, string>();
  private seq = 0;
  private now: () => number;
  private random: () => number;

  constructor(opts: { now?: () => number; random?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  join(raw: string): Ack<{ playerId: string; token: string }> {
    const nickname = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!nickname || nickname.length > GAME.nicknameMax) return { ok: false, error: `Tên phải từ 1 đến ${GAME.nicknameMax} ký tự` };
    if (this.players.size >= GAME.maxPlayers) return { ok: false, error: 'Chợ đông quá, hết chỗ rồi 😭' };
    const id = `p${++this.seq}`, token = randomUUID();
    this.players.set(id, {
      id, token, nickname, shopName: makeShopName(nickname, this.random), joinOrder: this.seq,
      total: 0, connected: true, vote: null, pendingPrice: null, lastPrice: null, history: [],
    });
    this.byToken.set(token, id);
    return { ok: true, playerId: id, token };
  }

  resume(token: string): string | null { return this.byToken.get(String(token)) ?? null; }
  hasPlayer(id: string): boolean { return this.players.has(id); }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id); if (p) p.connected = connected;
  }

  vote(id: string, choice: PollChoice): void {
    const p = this.players.get(id);
    if (p && (choice === 'invisible' || choice === 'visible')) p.vote = choice;
  }

  submitPrice(id: string, price: number): Ack {
    const p = this.players.get(id);
    const round = ROUNDS[this.roundIndex];
    if (!p || this.phase !== 'pricing' || !round) return { ok: false, error: 'Chưa tới lúc chọn giá' };
    if (!Number.isInteger(price) || price < GAME.priceMin || price > round.maxPrice)
      return { ok: false, error: `Giá phải từ ${GAME.priceMin}k đến ${round.maxPrice}k` };
    p.pendingPrice = price;
    return { ok: true };
  }

  next(): void {
    switch (this.phase) {
      case 'lobby': this.roundIndex = 0; this.phase = 'event'; break;
      case 'event':
        for (const p of this.players.values()) p.pendingPrice = null;
        this.phase = 'pricing'; this.deadline = this.now() + GAME.pricingSeconds * 1000; break;
      case 'pricing': this.closePricing(); break;
      case 'reveal':
        if (this.roundIndex < ROUNDS.length - 1) { this.roundIndex++; this.phase = 'event'; }
        else { this.phase = 'awards'; this.awards = computeAwards(this.ranked().map(p => ({ playerId: p.id, total: p.total, rounds: p.history }))); }
        break;
      case 'awards': break;
    }
  }

  reset(): void {
    this.phase = 'lobby'; this.roundIndex = -1; this.deadline = null; this.lastResult = null; this.awards = [];
    for (const p of this.players.values()) { p.total = 0; p.history = []; p.pendingPrice = null; p.lastPrice = null; }
  }

  private closePricing(): void {
    const round = ROUNDS[this.roundIndex];
    const list = [...this.players.values()];
    const shops = list.map(p => ({
      playerId: p.id,
      price: Math.min(round.maxPrice, Math.max(GAME.priceMin, p.pendingPrice ?? p.lastPrice ?? GAME.defaultPrice)),
    }));
    const customers = Math.round(GAME.customersPerPlayer * list.length * round.customerMultiplier);
    const out = runMarket({ shops, customers, wtpMin: GAME.wtpMin, wtpMax: GAME.wtpMax, capacity: GAME.capacity, cost: round.cost, tax: round.tax }, this.random);
    for (const s of out.shops) {
      const p = this.players.get(s.playerId)!;
      p.total += s.profit; p.lastPrice = s.price; p.pendingPrice = null;
      p.history.push({ price: s.price, sold: s.sold, unsold: s.unsold });
    }
    this.lastResult = {
      roundIndex: this.roundIndex, customers, served: out.served, unserved: out.unserved, pricedOut: out.pricedOut,
      taxCollected: out.taxCollected, shops: out.shops,
      avgPrice: shops.length ? Math.round((shops.reduce((s, x) => s + x.price, 0) / shops.length) * 10) / 10 : 0,
    };
    this.phase = 'reveal'; this.deadline = null;
  }

  private ranked(): Player[] {
    return [...this.players.values()].sort((a, b) => b.total - a.total || a.joinOrder - b.joinOrder);
  }

  snapshot(): RoomSnapshot {
    const poll = { invisible: 0, visible: 0 };
    for (const p of this.players.values()) if (p.vote) poll[p.vote]++;
    return {
      phase: this.phase, roundIndex: this.roundIndex, totalRounds: ROUNDS.length,
      deadline: this.deadline, serverNow: this.now(),
      players: this.ranked().map((p, i) => ({
        id: p.id, nickname: p.nickname, shopName: p.shopName, total: p.total, rank: i + 1,
        connected: p.connected, submitted: p.pendingPrice !== null,
      })),
      poll, lastResult: this.lastResult, awards: this.awards,
    };
  }
}
```

Run → PASS. Commit `feat: game room state machine`.

---

### Task 5: Server (Express + Socket.IO) + deploy files

**Files:** Create `server/app.ts`, `server/index.ts`, `Dockerfile`, `.dockerignore`; Test `server/app.test.ts`

**Interfaces — Consumes:** `GameRoom`, socket event maps, `EMOJIS`, `GAME`. **Produces:** `createApp(opts: { hostKey: string; staticDir?: string; publicUrl?: string }): { http: http.Server; io; room: GameRoom; close(): Promise<void> }`; HTTP `GET /api/config → { publicUrl: string | null }`, `GET /healthz → "ok"`; SPA fallback for `/`, `/host`, `/play`.

Behaviour:
- On connect: emit `state` to that socket.
- Every mutation → coalesced broadcast (`setTimeout` 50 ms) of `state` to everyone.
- `host:auth` with correct key → `socket.data.isHost = true`, join room `hosts`. Host-only events ignored otherwise.
- When phase becomes `pricing`, arm a timer for `deadline`; on fire, if still the same round's pricing → `room.next()` + broadcast. `host:reset` clears the timer.
- `player:emoji`: only whitelisted emojis, token bucket `GAME.emojiPerSecond`/s per socket, forwarded to `hosts` as `{ emoji, id }` (id = increasing counter).
- All acks guarded with `typeof ack === 'function'`.

- [ ] **Step 1: failing integration test `server/app.test.ts`**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import type { RoomSnapshot } from '../shared/types';
import { createApp } from './app';

let app: ReturnType<typeof createApp>; let url = '';
const clients: Socket[] = [];

beforeAll(async () => {
  app = createApp({ hostKey: 'secret' });
  await new Promise<void>(r => app.http.listen(0, r));
  url = `http://localhost:${(app.http.address() as AddressInfo).port}`;
});
afterAll(async () => { clients.forEach(c => c.close()); await app.close(); });

function client() {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  let last: RoomSnapshot | null = null;
  s.on('state', st => (last = st));
  clients.push(s);
  const until = (pred: (st: RoomSnapshot) => boolean) => new Promise<RoomSnapshot>((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 3000);
    const check = () => { if (last && pred(last)) { clearTimeout(t); s.off('state', check); res(last); } };
    s.on('state', check); check();
  });
  const emit = <T>(ev: string, payload?: unknown) => new Promise<T>(res => s.emit(ev as never, payload as never, res as never));
  return { s, until, emit };
}

describe('server', () => {
  it('serves health + config', async () => {
    expect(await (await fetch(`${url}/healthz`)).text()).toBe('ok');
    expect(await (await fetch(`${url}/api/config`)).json()).toEqual({ publicUrl: null });
  });

  it('rejects a wrong host key and ignores host commands from non-hosts', async () => {
    const c = client();
    expect(await c.emit<{ ok: boolean }>('host:auth', { key: 'nope' })).toEqual({ ok: false, error: expect.any(String) });
    c.s.emit('host:next');
    await new Promise(r => setTimeout(r, 150));
    expect(app.room.phase).toBe('lobby');
  });

  it('plays a full game with two phones', async () => {
    const host = client(), a = client(), b = client();
    expect((await host.emit<{ ok: boolean }>('host:auth', { key: 'secret' })).ok).toBe(true);
    const ja = await a.emit<{ ok: true; token: string; playerId: string }>('player:join', { nickname: 'An' });
    await b.emit('player:join', { nickname: 'Bình' });
    a.s.emit('player:vote', { choice: 'visible' });
    await host.until(s => s.players.length >= 2 && s.poll.visible === 1);

    host.s.emit('host:next'); await host.until(s => s.phase === 'event');
    host.s.emit('host:next'); await host.until(s => s.phase === 'pricing');
    expect((await a.emit<{ ok: boolean }>('player:price', { price: 22 })).ok).toBe(true);
    await host.until(s => s.players.some(p => p.submitted));
    host.s.emit('host:next');
    const rev = await host.until(s => s.phase === 'reveal');
    expect(rev.lastResult!.shops.find(x => x.playerId === ja.playerId)!.price).toBe(22);

    for (let r = 1; r < 4; r++) { host.s.emit('host:next'); host.s.emit('host:next'); host.s.emit('host:next'); await host.until(s => s.phase === 'reveal' && s.roundIndex === r); }
    host.s.emit('host:next');
    const end = await host.until(s => s.phase === 'awards');
    expect(end.awards.length).toBeGreaterThan(0);

    const resumed = client();
    expect(await resumed.emit('player:resume', { token: ja.token })).toEqual({ ok: true, playerId: ja.playerId });

    host.s.emit('host:reset'); await host.until(s => s.phase === 'lobby');
  });

  it('forwards whitelisted emoji to hosts only', async () => {
    const host = client(), p = client();
    await host.emit('host:auth', { key: 'secret' });
    await p.emit('player:join', { nickname: 'Emo' });
    const got = new Promise(res => host.s.once('emoji', res));
    p.s.emit('player:emoji', { emoji: '🧋' });
    expect(await got).toMatchObject({ emoji: '🧋' });
  });
});
```

Run → FAIL.

- [ ] **Step 2: implement `server/app.ts`**

```ts
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { EMOJIS, GAME, type Emoji } from '../shared/config';
import type { ClientToServer, ServerToClient } from '../shared/types';
import { GameRoom } from './game/engine';

interface SocketData { playerId?: string; isHost?: boolean; tokens: number; refill: number }

export function createApp(opts: { hostKey: string; staticDir?: string; publicUrl?: string }) {
  const app = express();
  const http = createServer(app);
  const io = new Server<ClientToServer, ServerToClient, object, SocketData>(http);
  const room = new GameRoom();

  app.get('/healthz', (_req, res) => { res.type('text').send('ok'); });
  app.get('/api/config', (_req, res) => { res.json({ publicUrl: opts.publicUrl ?? null }); });
  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get(['/', '/host', '/play'], (_req, res) => { res.sendFile(path.join(dir, 'index.html')); });
  }

  let queued = false;
  const broadcast = () => {
    if (queued) return; queued = true;
    setTimeout(() => { queued = false; io.emit('state', room.snapshot()); }, 50);
  };

  let timer: NodeJS.Timeout | undefined;
  const armTimer = () => {
    clearTimeout(timer);
    if (room.phase !== 'pricing' || room.deadline === null) return;
    const round = room.roundIndex;
    timer = setTimeout(() => {
      if (room.phase === 'pricing' && room.roundIndex === round) { room.next(); broadcast(); }
    }, Math.max(0, room.deadline - Date.now()));
  };

  let emojiSeq = 0;
  io.on('connection', socket => {
    socket.data.tokens = GAME.emojiPerSecond; socket.data.refill = Date.now();
    socket.emit('state', room.snapshot());
    const reply = (ack: unknown, value: unknown) => { if (typeof ack === 'function') ack(value); };
    const attach = (playerId: string) => {
      socket.data.playerId = playerId; room.setConnected(playerId, true); broadcast();
    };

    socket.on('player:join', (p, ack) => {
      const r = room.join(String(p?.nickname ?? ''));
      if (r.ok) attach(r.playerId);
      reply(ack, r);
    });
    socket.on('player:resume', (p, ack) => {
      const id = room.resume(String(p?.token ?? ''));
      if (id) { attach(id); reply(ack, { ok: true, playerId: id }); }
      else reply(ack, { ok: false, error: 'Không tìm thấy quán của bạn' });
    });
    socket.on('player:vote', p => {
      if (!socket.data.playerId) return;
      room.vote(socket.data.playerId, p?.choice); broadcast();
    });
    socket.on('player:price', (p, ack) => {
      if (!socket.data.playerId) return reply(ack, { ok: false, error: 'Bạn chưa vào chợ' });
      const r = room.submitPrice(socket.data.playerId, Number(p?.price));
      reply(ack, r); if (r.ok) broadcast();
    });
    socket.on('player:emoji', p => {
      if (!socket.data.playerId || !EMOJIS.includes(p?.emoji as Emoji)) return;
      const now = Date.now();
      socket.data.tokens = Math.min(GAME.emojiPerSecond, socket.data.tokens + ((now - socket.data.refill) / 1000) * GAME.emojiPerSecond);
      socket.data.refill = now;
      if (socket.data.tokens < 1) return;
      socket.data.tokens -= 1;
      io.to('hosts').emit('emoji', { emoji: p.emoji, id: ++emojiSeq });
    });

    socket.on('host:auth', (p, ack) => {
      if (String(p?.key ?? '') !== opts.hostKey) return reply(ack, { ok: false, error: 'Sai mã host' });
      socket.data.isHost = true; socket.join('hosts'); reply(ack, { ok: true });
    });
    socket.on('host:next', () => { if (!socket.data.isHost) return; room.next(); armTimer(); broadcast(); });
    socket.on('host:reset', () => { if (!socket.data.isHost) return; clearTimeout(timer); room.reset(); broadcast(); });

    socket.on('disconnect', () => {
      const id = socket.data.playerId;
      if (id && ![...io.sockets.sockets.values()].some(s => s.id !== socket.id && s.data.playerId === id)) {
        room.setConnected(id, false); broadcast();
      }
    });
  });

  const close = () => new Promise<void>(res => { clearTimeout(timer); io.close(() => res()); });
  return { app, http, io, room, close };
}
```

- [ ] **Step 3: `server/index.ts`**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const hostKey = process.env.HOST_KEY ?? 'hai-ban-tay';
if (!process.env.HOST_KEY) console.warn('⚠️  HOST_KEY chưa được đặt — đang dùng mặc định "hai-ban-tay".');

const { http } = createApp({
  hostKey,
  staticDir: process.env.STATIC_DIR ?? path.resolve(here, 'web'),
  publicUrl: process.env.PUBLIC_URL || undefined,
});
http.listen(port, () => {
  console.log(`🧋 Hai Bàn Tay chạy ở http://localhost:${port}`);
  console.log(`   Màn host: /host?key=${hostKey}`);
});
```

- [ ] **Step 4: Dockerfile + .dockerignore**

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

`.dockerignore`: `node_modules`, `dist`, `.git`, `.claude`, `docs`.

- [ ] **Step 5:** `npx vitest run` → all PASS; `npx tsc --noEmit` clean. Commit `feat: socket server, host auth, pricing timer, docker`.

---

### Task 6: Web foundation — styles, socket hook, UI kit

**Files:** Create `vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/net/socket.ts`, `web/src/styles/{tokens,base,ui}.css`, `web/src/ui/{Button,Input,Slider,Select,Modal,Countdown,ConnectionBadge,JoinQR,Hands}.tsx`

**Interfaces — Produces:**
```ts
// net/socket.ts
socket: Socket<ServerToClient, ClientToServer>
useRoom(): { state: RoomSnapshot | null; connected: boolean; serverOffset: number } // offset = serverNow - Date.now() at receipt
emitAck<R>(event, payload): Promise<R>
// ui
<Button variant="primary"|"ghost"|"danger" size="md"|"lg" .../>
<Input label? .../>
<Slider min max step value onChange format(v)=>string marks?/>     // styled native range + floating value bubble
<Select<T> value options={{value,label}[]} onChange/>              // custom listbox: button + animated popover, keyboard ↑↓ Enter Esc
<Modal open title onClose actions/>                                 // focus trap-lite, Esc closes, backdrop blur
<Countdown deadline serverOffset total/>                             // SVG ring, colour shifts at ≤5s
<ConnectionBadge connected/>                                         // fixed pill "Mất kết nối…" when false
<JoinQR size/>                                                       // QR of `${publicUrl ?? origin}/play` + short URL text
<InvisibleHand/> <VisibleHand/>                                      // SVG illustrations (dashed outline vs solid glove)
```

Requirements:
- `vite.config.ts`: `root: 'web'`, `build.outDir: '../dist/web'`, `emptyOutDir: true`, react plugin, dev proxy `/socket.io` (ws) and `/api` → `http://localhost:3000`.
- `main.tsx`: pathname router: `/host` → Host, `/play` → Play, else Presentation (lazy-loaded with `React.lazy`). Imports `@fontsource/be-vietnam-pro/{400,500,700,800}.css`.
- `tokens.css`: CSS variables — `--cream #FFF7EC`, `--paper #FFFDF8`, `--ink #2A1E17`, `--ink-soft #6B5A4E`, `--matcha #6E9F4B`, `--taro #8E6CCF`, `--caramel #D7893A`, `--strawberry #E8616B`, `--boba #3B2A20`, `--line rgba(42,30,23,.12)`; radii 10/16/24/999; shadow scale with warm tint; easing `--ease-out cubic-bezier(.2,.8,.2,1)`, `--ease-spring`.
- `base.css`: body background cream with subtle radial blobs, `::selection` taro tint, custom scrollbar (`scrollbar-color` + `::-webkit-scrollbar*` rounded caramel thumb), `:focus-visible` 3px taro ring offset, reduced-motion kill-switch.
- `ui.css`: button (press scale .97, shadow lift on hover, disabled desaturated), input (filled paper, inset border, focus ring), range (`appearance:none`, 14px rounded track with filled portion via `--fill` gradient, 30px boba-pearl thumb), select popover (paper card, animated with Framer Motion), modal.

- [ ] Steps: write files → `npm run build` succeeds → commit `feat: web foundation and custom UI kit`.

---

### Task 7: Presentation (`/`)

**Files:** Create `web/src/content/speakers.ts`, `web/src/content/slides.tsx`, `web/src/pages/Presentation/{Presentation.tsx,SpeakerHud.tsx,NotesPanel.tsx,SupplyDemandChart.tsx,PollBars.tsx,presentation.css}`

**Interfaces — Produces:**
```ts
interface Speaker { name: string; role: string; color: string; initials: string }
export const SPEAKERS: [Speaker, Speaker, Speaker]  // default names "Người 1/2/3"
export const SECTION_SECONDS = 200
interface Slide { id: string; speaker: 0 | 1 | 2; kicker: string; title: string; body: () => JSX.Element; notes: string }
export const SLIDES: Slide[]   // 13 slides per spec §3
```

Behaviour:
- Keys: →/Space/PageDown next, ←/PageUp prev, `N` notes, `F` fullscreen, Home/End. Buttons prev/next + **Select** "Nhảy tới slide" listing all slides (this is the styled dropdown).
- Slide transitions: Framer `AnimatePresence`, direction-aware slide + fade; inner elements stagger.
- `SpeakerHud`: avatar (initials on speaker colour), name, role, section timer (starts when the first slide of that speaker is shown, counts up; `≥170s` caramel, `>200s` strawberry), overall progress bar of 10:00.
- `SupplyDemandChart` (SVG): props `mode: 'free' | 'ceiling'`; animates demand/supply lines drawing in, equilibrium dot pulsing; ceiling mode draws the 20k line and a shaded "thiếu hụt" gap.
- `PollBars`: live `state.poll` from `useRoom()`, two animated bars (invisible = taro, visible = caramel) with counts.
- Slides 1 and 13 show `<JoinQR/>`; slide 12 shows `PollBars` with commentary comparing majority vs conclusion.
- Content per spec §3 (Vietnamese, concise bullets, speaker notes ≈ what to say).

- [ ] Steps: write files → `npm run build` → manual check in browser at 1920×1080 → commit `feat: presentation slides`.

---

### Task 8: Phone (`/play`)

**Files:** Create `web/src/pages/Play/{Play.tsx,JoinScreen.tsx,LobbyScreen.tsx,PricingScreen.tsx,RevealScreen.tsx,AwardsScreen.tsx,play.css}`, `web/src/game/format.ts` (`fmtK(n) → "25k"`, signed `fmtProfit`).

Behaviour:
- Token in `localStorage` (`hbt.token`, try/catch). On mount: if token → `player:resume`; on fail drop token → Join.
- Join: nickname Input + "Vào chợ" Button; on success shows shop name reveal card (spring pop).
- Lobby: poll two big cards (InvisibleHand / VisibleHand illustrations), selected one highlighted; remembers vote in localStorage; "Đang nghe thuyết trình, cất điện thoại đi 🙏" wobble animation; rules card.
- Event phase: flipped event card (emoji, title, description).
- Pricing: Countdown ring, Slider (min 10, max round.maxPrice, default last chosen or 25), live preview "Lãi mỗi ly: +Xk" (price − cost, red when negative), "Chốt giá" button → ack → "Đã chốt X k, ngồi chờ…" with option to change until deadline.
- Reveal: my sold cups as 10 cup icons filling, profit this round, total + rank, lesson, emoji buttons row (6 emojis, bounce on tap).
- Awards: my rank + any awards I won, confetti burst if rank 1.
- `ConnectionBadge` always mounted. Layout 360–430px wide, safe-area padding.

- [ ] Steps: write files → build → check at 390×844 viewport → commit `feat: phone player screens`.

---

### Task 9: Host game screen (`/host`)

**Files:** Create `web/src/pages/Host/{Host.tsx,HostControls.tsx,LobbyView.tsx,EventView.tsx,PricingView.tsx,RevealView.tsx,AwardsView.tsx,Leaderboard.tsx,EmojiRain.tsx,commentary.ts,host.css}`

**Interfaces — Produces:** `commentary(result: RoundResult, players: PublicPlayer[], round: RoundRule): string[]` — 2–3 MC-style lines (best seller, a zero-seller "đang ngồi khóc", shortage line when `unserved>0`, tax line when `taxCollected>0`).

Behaviour:
- Reads `key` from query, emits `host:auth`; wrong key → Input to re-enter key.
- HostControls (bottom bar): contextual primary Button (`Bắt đầu game` / `Mở chọn giá` / `Chốt giá ngay` / `Vòng tiếp` / `Trao giải`), `Reset` → Modal confirm; round pips 1–4.
- LobbyView: big JoinQR, player-name chips popping in, player count, rules summary.
- EventView: big card flip-in with hand illustration matching `round.hand`.
- PricingView: Countdown, "x/y quán đã chốt giá", grid of shop tiles flipping to ✅ when submitted (no prices revealed).
- RevealView: market strip — customer dots animate into shops sorted by price (top 12 shops shown, rest summarised), each shop card shows price, cups sold bar, profit; stats chips (avg price, unserved "khách xếp hàng mà không mua được", tax collected, priced-out); lesson banner; commentary ticker; Leaderboard top 8 with layout animation.
- AwardsView: four award cards dealt in with stagger + leaderboard top 5.
- EmojiRain: listens to `emoji` events, floats emoji upward from random x with slight sway, max 60 on screen.

- [ ] Steps: write files → build → play a full game with host + 2 phone tabs → commit `feat: host game screen`.

---

### Task 10: Verification + README

- [ ] `npm test`, `npm run typecheck`, `npm run build` all clean.
- [ ] `npm start`, browser walkthrough: all 13 slides (1920×1080), host full game with 3 phone tabs (390×844), confirm no console errors, every control custom-styled, reduced-motion works.
- [ ] README: what it is, `npm run dev`, deploy (`npm ci && npm run build && HOST_KEY=… PUBLIC_URL=… npm start` or Docker), URLs, how to edit `web/src/content/*`, run-of-show (10' slides → 6' game).
- [ ] Commit `docs: README and run-of-show`, push.
