// Placeholder art for the street (Task 14): flat rounded shapes in the project's colours, enough to read the
// mechanics — shops with their sign, price board and state, people walking, reading boards, queueing, leaving with a
// cup, stomping off, "+n" for a folded queue, a dot of speech where a bubble will go. Tasks 15 (customers), 16 (shops,
// street, props) and 17 (bubbles) replace these through `registerRenderers`.
import { CONFIG } from '../../../../shared/sim/config';
import type { ShopId } from '../../../../shared/sim/types';
import type { Actor, BubbleTopic, ShopView } from '../director';
import type { Band, ShopSlot } from '../layout';
import type { Palette, Prop, RenderContext, Renderers } from '../Scene';
import { clamp, easeOutBack, progress } from '../tween';

const FONT = '"Be Vietnam Pro", system-ui, sans-serif';

const NAMES: Record<ShopId, string> = {
  batu: 'Bà Tư', giare: 'GiáRẻ', cochap: 'Cố Chấp', luotsong: 'Lướt Sóng', sinhvien: 'Sinh Viên',
  player: 'Quán bạn', tapdoan: 'Tập Đoàn',
};

const accent = (p: Palette, id: ShopId): [string, string] => {
  switch (id) {
    case 'batu': return [p.tea, p.caramelSoft];
    case 'giare': return [p.strawberryDeep, p.strawberrySoft];
    case 'cochap': return [p.caramelDeep, p.caramelSoft];
    case 'luotsong': return [p.matcha, p.matchaSoft];
    case 'sinhvien': return [p.caramel, p.milk];
    case 'player': return [p.strawberry, p.paper];
    case 'tapdoan': return [p.inkSoft, p.milk];
  }
};

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  // Older browsers have no roundRect: square corners will do for placeholders.
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function band(rc: RenderContext, b: Band, fill: string): void {
  const v = rc.view;
  rc.ctx.fillStyle = fill;
  rc.ctx.fillRect(v.x, b.y0, v.w, b.y1 - b.y0);
}

function pill(rc: RenderContext, text: string, x: number, y: number, size: number, bg: string, fg: string): void {
  const { ctx } = rc;
  ctx.font = `700 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + size * 0.9;
  const h = size * 1.45;
  rr(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + size * 0.05);
}

// ── Street ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function drawStreet(rc: RenderContext): void {
  const { ctx, layout: L, view: v, palette: p } = rc;
  ctx.fillStyle = p.cream;
  ctx.fillRect(v.x, v.y, v.w, v.h);
  // Behind the top row: a wall of older houses.
  band(rc, { y0: v.y, y1: L.sidewalkTop.y0 }, p.milk);
  ctx.fillStyle = p.milkDeep;
  for (let x = Math.floor(v.x / 60) * 60; x < v.x + v.w; x += 60) {
    rr(ctx, x + 6, L.back.y0 - L.actorH, 48, L.back.y1 - L.back.y0 + L.actorH * 0.9, 10);
    ctx.fill();
  }
  // Sidewalks with paving joints, curbs, the road with its lanes.
  for (const s of [L.sidewalkTop, L.sidewalkBottom]) {
    band(rc, s, p.milkDeep);
    ctx.strokeStyle = 'rgba(42, 29, 21, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = L.actorH * 0.9;
    for (let x = Math.floor(v.x / step) * step; x < v.x + v.w; x += step) {
      ctx.moveTo(x, s.y0);
      ctx.lineTo(x, s.y1);
    }
    ctx.stroke();
  }
  band(rc, L.road, '#cdbba4');
  const curb = L.actorH * 0.1;
  band(rc, { y0: L.road.y0, y1: L.road.y0 + curb }, p.inkFaint);
  band(rc, { y0: L.road.y1 - curb, y1: L.road.y1 }, p.inkFaint);
  ctx.strokeStyle = p.paper;
  ctx.lineWidth = L.actorH * 0.07;
  ctx.setLineDash([L.actorH * 0.6, L.actorH * 0.5]);
  ctx.beginPath();
  const mid = (L.road.y0 + L.road.y1) / 2;
  ctx.moveTo(v.x, mid);
  ctx.lineTo(v.x + v.w, mid);
  ctx.stroke();
  ctx.setLineDash([]);
  // Below the bottom row: a green verge down to the bottom of the screen.
  band(rc, { y0: L.sidewalkBottom.y1, y1: v.y + v.h }, p.milk);
  band(rc, { y0: L.front.y1 > L.front.y0 ? L.front.y0 : L.height, y1: v.y + v.h }, p.matchaSoft);
}

// ── Shops ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const STATUS_SIGN: Partial<Record<ShopView['status'], string>> = {
  soldOut: 'HẾT HÀNG', resting: 'NGHỈ BÁN', closed: 'SANG NHƯỢNG', closedEarly: 'ĐÓNG CỬA', notYet: 'SẮP MỞ',
};

function drawShop(rc: RenderContext, shop: ShopView, slot: ShopSlot): void {
  const { ctx, layout: L, palette: p, now } = rc;
  const { x, y, w, h } = slot.rect;
  const [main, soft] = accent(p, shop.id);
  const u = L.actorH;
  const down = slot.facing === 'down';
  const gone = shop.status === 'closed' || shop.status === 'notYet';

  // Body.
  rr(ctx, x, y, w, h, u * 0.25);
  ctx.fillStyle = gone ? p.milk : soft;
  ctx.fill();
  ctx.lineWidth = shop.id === 'player' ? u * 0.1 : u * 0.04;
  ctx.strokeStyle = shop.id === 'player' ? p.strawberry : 'rgba(42, 29, 21, 0.18)';
  if (gone) ctx.setLineDash([u * 0.2, u * 0.15]);
  ctx.stroke();
  ctx.setLineDash([]);

  // From the road side in: counter edge, striped awning, the shop window with the vendor in it; the name and the
  // roof on the far side (top row: the name above the window; bottom row, seen from the road: below it).
  const aw = u * 0.42;
  const ay = down ? y + h - aw - u * 0.25 : y + u * 0.14;
  const winTop = down ? y + u * 1.25 : ay + aw + u * 0.12;
  const winBottom = down ? ay - u * 0.08 : y + h * 0.56;
  const nameY = down ? y + u * 0.72 : y + h * 0.74;
  if (!gone) {
    ctx.fillStyle = main;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(x + u * 0.1, down ? y + u * 0.1 : y + h - u * 0.3, w - u * 0.2, u * 0.2);
    ctx.globalAlpha = 1;
    rr(ctx, x + u * 0.2, winTop, w - u * 0.4, Math.max(0, winBottom - winTop), u * 0.12);
    ctx.fillStyle = p.paper;
    ctx.fill();
    ctx.strokeStyle = 'rgba(42, 29, 21, 0.14)';
    ctx.lineWidth = u * 0.04;
    ctx.stroke();
    const stripes = Math.max(4, Math.round(w / (u * 0.45)));
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? main : p.paper;
      ctx.fillRect(x + (w / stripes) * i, ay, w / stripes + 0.5, aw);
    }
  }
  ctx.fillStyle = gone ? p.milkDeep : p.boba;
  ctx.fillRect(x + u * 0.12, down ? y + h - u * 0.25 : y, w - u * 0.24, u * 0.12);

  ctx.font = `800 ${u * 0.36}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = shop.id === 'player' ? p.strawberryDeep : p.ink;
  ctx.fillText(NAMES[shop.id], x + w / 2, gone ? y + h * 0.4 : nameY, w - u * 0.3);

  // The vendor in the window: bobbing while serving, still when idle.
  if (!gone && shop.status !== 'resting' && winBottom - winTop > u * 0.5) {
    const vx = slot.counter.x + u * 0.1;
    const busy = shop.queue.length > 0 && !rc.reducedMotion;
    const vy = winBottom - (busy ? Math.abs(Math.sin(rc.wall / 160)) * u * 0.05 : 0);
    rr(ctx, vx - u * 0.2, vy - u * 0.3, u * 0.4, u * 0.3, u * 0.12);
    ctx.fillStyle = main;
    ctx.fill();
    ctx.fillStyle = SKIN[shop.id.length % SKIN.length];
    ctx.beginPath();
    ctx.arc(vx, vy - u * 0.42, u * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  // Price board, with a flip when the price changed: up red, down green.
  if (shop.price > 0) {
    const since = now - shop.priceSince;
    const flip = shop.prevPrice !== null && since >= 0 && since < 20;
    const pop = flip ? 1 + 0.35 * (1 - easeOutBack(progress(0, 8, since))) : 1;
    const size = u * 0.4 * pop;
    const up = shop.prevPrice !== null && shop.price > shop.prevPrice;
    pill(rc, `${shop.price}k`, slot.board.x, slot.board.y, size,
      flip ? (up ? p.strawberry : p.matcha) : p.boba, p.cream);
    if (flip) {
      ctx.font = `700 ${u * 0.28}px ${FONT}`;
      ctx.fillStyle = up ? p.strawberryDeep : p.matchaDeep;
      ctx.fillText(`${up ? '▲' : '▼'} ${shop.prevPrice}k`, slot.board.x, slot.board.y + (down ? -1 : 1) * u * 0.42);
    }
  }

  // State signs.
  const sign = STATUS_SIGN[shop.status];
  if (sign !== undefined) {
    if (shop.status === 'resting') {
      ctx.fillStyle = 'rgba(110, 91, 77, 0.55)';
      for (let yy = winTop + u * 0.06; yy < winBottom - u * 0.04; yy += u * 0.16) {
        ctx.fillRect(x + u * 0.22, yy, w - u * 0.44, u * 0.08);
      }
    }
    pill(rc, sign, x + w / 2, gone ? y + h * 0.58 : (winTop + winBottom) / 2, u * 0.3,
      shop.status === 'soldOut' || shop.status === 'closedEarly' ? p.strawberry : p.inkSoft, p.paper);
  }
  if (shop.grandOpening) {
    const colours = [p.strawberry, p.tea, p.matcha];
    colours.forEach((c, i) => {
      const bx = x + u * 0.25 + i * u * 0.28;
      const by = (down ? y + u * 0.35 : y + h - u * 0.6) - (rc.reducedMotion ? 0 : Math.sin(rc.wall / 400 + i) * u * 0.05);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(bx, by, u * 0.13, u * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    pill(rc, 'KHAI TRƯƠNG', x + w * 0.42, (winTop + winBottom) / 2, u * 0.26, p.strawberry, p.paper);
  }
  // Badges: certified (green tick), named (red); the rumor's cloud on shops still under it.
  const bx = x + w - u * 0.3;
  const by = down ? y + u * 0.3 : y + h - u * 0.35;
  if (shop.certified || shop.named) {
    const fresh = progress(shop.badgeSince, shop.badgeSince + 8, now);
    const r = u * 0.24 * (shop.badgeSince === -Infinity ? 1 : easeOutBack(fresh));
    ctx.fillStyle = shop.certified ? p.matcha : p.strawberryDeep;
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(0, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.paper;
    ctx.font = `800 ${u * 0.3}px ${FONT}`;
    ctx.fillText(shop.certified ? '✓' : '!', bx, by + u * 0.02);
  } else if (shop.rumor) {
    pill(rc, 'tin đồn', bx - u * 0.2, by, u * 0.22, p.inkFaint, p.paper);
  }
  // A coin pops over the counter on each sale.
  const sale = now - shop.lastSaleAt;
  if (!rc.reducedMotion && sale >= 0 && sale < 8) {
    const t = sale / 8;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = p.tea;
    ctx.beginPath();
    ctx.arc(slot.counter.x, (down ? y + h : y) - u * (0.3 + t * 0.8), u * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ── Customers ───────────────────────────────────────────────────────────────────────────────────────────────────────

const SKIN = ['#f3cfae', '#e0ad84', '#b9835a'];
const HAIR = ['#2a1d15', '#4a3326', '#6e5b4d', '#1b1410'];

function shirtOf(p: Palette, look: number): string {
  const shirts = [p.matcha, p.caramel, p.strawberry, p.tea, p.inkSoft, p.matchaDeep, '#8e6fae', p.caramelDeep];
  return shirts[(look >>> 5) % shirts.length];
}

function drawCustomer(rc: RenderContext, a: Actor): void {
  const { ctx, layout: L, palette: p, now } = rc;
  const H = L.actorH;
  const moving = a.speed > 0;
  const phase = (a.x + a.y) / (H * 0.32);
  const swing = moving ? Math.sin(phase) * H * 0.09 : 0;
  const bob = moving ? Math.abs(Math.cos(phase)) * H * 0.03 : 0;
  const shake = a.activity === 'abandon' && a.cause === 'patience' && !rc.reducedMotion
    ? Math.sin(now * 9) * H * 0.04 : 0;
  const hop = a.activity === 'served' && !rc.reducedMotion ? Math.abs(Math.sin((now - a.since) * 0.6)) * H * 0.08 : 0;
  const x = a.x + shake;
  const y = a.y - bob - hop;

  // Shadow.
  ctx.fillStyle = 'rgba(42, 29, 21, 0.13)';
  ctx.beginPath();
  ctx.ellipse(a.x, a.y, H * 0.2, H * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs.
  const hip = y - H * 0.28;
  ctx.strokeStyle = p.boba;
  ctx.lineWidth = H * 0.08;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - H * 0.06, hip);
  ctx.lineTo(x - H * 0.06 + swing, a.y - H * 0.02);
  ctx.moveTo(x + H * 0.06, hip);
  ctx.lineTo(x + H * 0.06 - swing, a.y - H * 0.02);
  ctx.stroke();

  // Body.
  const bw = H * 0.4;
  const bh = H * 0.42;
  rr(ctx, x - bw / 2, hip - bh, bw, bh, H * 0.12);
  ctx.fillStyle = shirtOf(p, a.look);
  ctx.fill();

  // Head, hair, eyes toward where they face (up at a board while reading it).
  const hr = H * 0.17;
  const hy = hip - bh - hr * 0.85;
  ctx.fillStyle = SKIN[a.look % SKIN.length];
  ctx.beginPath();
  ctx.arc(x, hy, hr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HAIR[(a.look >>> 9) % HAIR.length];
  ctx.beginPath();
  ctx.arc(x, hy - hr * 0.15, hr * 1.02, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  // Eyes by heading: none from behind (up), centred facing us (down), to the side when side-on.
  if (a.heading !== 'up') {
    const side = a.heading === 'down' ? 0 : a.facing * hr * 0.35;
    const look = a.activity === 'lookBoard' ? -hr * 0.3 : 0;
    ctx.fillStyle = p.ink;
    for (const e of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(x + side + e * hr * 0.28, hy + hr * 0.1 + look, hr * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // A cup in hand.
  if (a.carrying) {
    const cx = x + a.facing * bw * 0.62;
    const cy = hip - bh * 0.45;
    rr(ctx, cx - H * 0.07, cy - H * 0.11, H * 0.14, H * 0.2, H * 0.03);
    ctx.fillStyle = p.tea;
    ctx.fill();
    ctx.fillStyle = p.boba;
    ctx.fillRect(cx - H * 0.07, cy - H * 0.13, H * 0.14, H * 0.03);
  }

  // What they are going through.
  const mark = a.activity === 'abandon' ? '!' : a.activity === 'wrongCup' ? '?' : a.activity === 'served' ? '♥' : '';
  if (mark !== '') {
    ctx.font = `800 ${H * 0.36}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = a.activity === 'served' ? p.strawberry : a.activity === 'abandon' ? p.strawberryDeep : p.caramelDeep;
    ctx.fillText(mark, x + hr * 1.4, hy - hr * 1.2);
  }
}

// ── Props ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function props(rc: RenderContext): readonly Prop[] {
  const d = rc.director;
  const out: Prop[] = d.overflowMarkers().map(m => ({ kind: 'overflow', ...m }));
  if (CONFIG.days[d.day].busStop) out.push({ kind: 'busStop', x: rc.layout.busStop.x, y: rc.layout.busStop.y });
  return out;
}

function drawProp(rc: RenderContext, prop: Prop): void {
  const { ctx, layout: L, palette: p } = rc;
  const H = L.actorH;
  switch (prop.kind) {
    case 'overflow':
      pill(rc, `+${prop.n}`, prop.x, prop.y - H * 0.45, H * 0.34, p.boba, p.cream);
      return;
    case 'busStop':
      ctx.fillStyle = p.inkSoft;
      ctx.fillRect(prop.x - H * 0.03, prop.y - H * 1.2, H * 0.06, H * 1.2);
      pill(rc, 'BUÝT', prop.x, prop.y - H * 1.25, H * 0.24, p.matchaDeep, p.paper);
      return;
  }
}

// ── Overlay: where bubbles will go (Task 17 words and draws them) ──────────────────────────────────────────────────

const SHORT: Record<BubbleTopic, string> = {
  tooExpensive: 'Đắt quá', tooCrowded: 'Đông quá', lowTrust: 'Không tin', outOfStock: 'Hết món', otherBetter: 'Bên kia hơn',
  steepDiscount: 'Giảm sốc?', chosePlayer: 'Giá ổn nè', patience: 'Lâu quá!', priceUp: 'Tăng giá?', shopClosed: 'Đóng à?',
  wrongCup: 'Sai món?', emptyHanded: 'Hết sạch…', rumor: 'Nghe đồn…',
};
const BUBBLE_TICKS = 18;
const MAX_BUBBLES = 3;

interface Shown { customer: number; topic: BubbleTopic; until: number; player: boolean }

function drawBubbles(rc: RenderContext): void {
  const shown = (rc.store.get('placeholder.bubbles') as Shown[] | undefined) ?? [];
  const live = shown.filter(b => b.until > rc.now && rc.director.actor(b.customer) !== undefined);
  // The player's first, then the newest; at most three at once.
  for (const b of [...rc.bubbles].sort((x, y) => Number(y.playerRelated) - Number(x.playerRelated))) {
    if (live.some(s => s.customer === b.customer)) continue;
    if (live.length >= MAX_BUBBLES) {
      const i = live.findIndex(s => !s.player);
      if (!b.playerRelated || i < 0) continue;
      live.splice(i, 1);
    }
    live.push({ customer: b.customer, topic: b.topic, until: rc.now + BUBBLE_TICKS, player: b.playerRelated });
  }
  rc.store.set('placeholder.bubbles', live);
  const H = rc.layout.actorH;
  for (const b of live) {
    const a = rc.director.actor(b.customer);
    if (a === undefined || a.hidden) continue;
    const fade = clamp((b.until - rc.now) / 4, 0, 1);
    rc.ctx.globalAlpha = fade;
    pill(rc, SHORT[b.topic], a.x, a.y - H * 1.25, H * 0.3, b.player ? rc.palette.paper : 'rgba(255, 252, 247, 0.85)',
      b.player ? rc.palette.strawberryDeep : rc.palette.ink);
    rc.ctx.globalAlpha = 1;
  }
}

export const placeholderRenderers: Renderers = {
  drawStreet, drawShop, drawCustomer, props, drawProp, overlays: { bubbles: drawBubbles },
};
