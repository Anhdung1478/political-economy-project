// The seven shops (spec §9 "7 quán có cá tính riêng", "Trạng thái quán"): Bà Tư's old push cart under a faded beach
// umbrella; Chuỗi GiáRẻ's pink kiosk with its neon SALE; Ông Cố Chấp's wooden shop under a clay-tiled eave; Anh Lướt
// Sóng's counter plastered with charts and a stock ticker; the student's do-it-yourself stall of cardboard boxes;
// Chuỗi Tập Đoàn's glossy glass and marble; and yours, warm and pink with plants and fairy lights. Each shows its price
// on a board of its own style.
//
// States: open; sold out (the hanging sign flips to "HẾT HÀNG"); resting (the roller shutter rolls down, "NGHỈ BÁN");
// closed for good ("SANG NHƯỢNG" taped on the shutter, a tarp over the stall); not open yet (a fenced lot, "SẮP KHAI
// TRƯƠNG"); a grand opening (balloons, flower stands, a red banner); the price board flips its digits on a change; the
// keeper serves, wipes their brow when the queue is long, yawns when nobody comes; the "Đã kiểm định" rosette pops on,
// a "BỊ NÊU TÊN" stamp slams down; shops still under the rumor have a little cloud of flies.
//
// The top row faces us across its counter. The bottom row faces the road, so we stand behind its counter (the art
// rule on `ShopSlot`): a low counter along its top edge, the keeper's back, the floor, the back counter nearest us with
// the name painted on it; nothing rises above counter height along the queue — the double-sided roof sign and the
// balloons stand at the far right edge.
//
// Each shop's building in its state is a pair of sprites (behind the keeper, in front of the keeper), built once per
// grid and state (sprites.ts); per frame only the keeper, the boards, the signs that flip and a few lights are drawn.
import type { ShopId } from '../../../../shared/sim/types';
import type { ShopView } from '../director';
import type { Rect, ShopSlot, StreetLayout } from '../layout';
import type { Palette, RenderContext } from '../Scene';
import { hash01 } from '../schedule';
import { blit } from '../sprites';
import { clamp, easeOutBack, easeOutCubic, progress } from '../tween';
import {
  awning, box, bulbs, disc, DISPLAY, fe, line, oval, plant, poly, rr, shade, shadow, text, type Ctx,
} from './kit';
import { drawOwner, type OwnerAct } from './owners';

// ── What a shop looks like now (pure) ──────────────────────────────────────────────────────────────────────────────

/** The building's state: open (selling or sold out), shutter down, closed for good, an empty lot. */
export type Base = 'open' | 'shut' | 'closed' | 'lot';
const BASES: readonly Base[] = ['open', 'shut', 'closed', 'lot'];

/** Ticks the roller shutter takes to come down. */
export const SHUTTER_TICKS = 14;
/** Ticks a sign or a price takes to flip; the price's colour lingers `PRICE_FLASH` ticks. */
export const FLIP_TICKS = 7;
export const PRICE_FLASH = 30;
/** Ticks the badge takes to pop on. */
export const BADGE_TICKS = 9;
/** A queue this long has the keeper wiping their brow; no sale for this long and they start yawning. */
export const BUSY_QUEUE = 4;
export const IDLE_TICKS = 60;

export interface ShopLook {
  base: Base;
  /** The shutter coming down over an open front, 0..1 (only while it rolls). */
  shutter: number;
  /** What the shutter (or the closed shop) says. */
  label: 'NGHỈ BÁN' | 'ĐÓNG CỬA' | null;
  /** The hanging sign: what it shows, what it showed, how far the flip is (1 done). */
  sign: 'ĐANG BÁN' | 'HẾT HÀNG' | null;
  signPrev: 'ĐANG BÁN' | 'HẾT HÀNG' | null;
  signFlip: number;
  owner: OwnerAct | null;
  /** 0..1 into the current yawn or wipe. */
  ownerK: number;
  grand: boolean;
  /** Sold out: the shelves stand empty. */
  empty: boolean;
  badge: 'certified' | 'named' | null;
  /** The badge popping on, 0..1. */
  badgePop: number;
  rumor: boolean;
  /** The price board: flip progress, colour flash (1 fresh, 0 gone), up or down. */
  priceFlip: number;
  priceFlash: number;
  priceUp: boolean;
}

export const newShopLook = (): ShopLook => ({
  base: 'open', shutter: 0, label: null, sign: null, signPrev: null, signFlip: 1, owner: null, ownerK: 0,
  grand: false, empty: false, badge: null, badgePop: 1, rumor: false, priceFlip: 1, priceFlash: 0, priceUp: false,
});

/** Seconds of the yawn and wipe cycles (the gesture takes the first part). */
const YAWN_CYCLE = 7;
const YAWN_LEN = 2.2;
const WIPE_CYCLE = 5.5;
const WIPE_LEN = 1.6;

/**
 * The look of shop `v` at sim time `now` (ticks), into `out`. `calm` (reduced motion): state changes show at once and
 * the keeper keeps still (a long queue still shows the sweat).
 */
export function shopLook(v: ShopView, now: number, calm: boolean, out: ShopLook = newShopLook()): ShopLook {
  const since = now - v.statusSince;
  const rolling = !calm && Number.isFinite(v.statusSince) && since >= 0 && since < SHUTTER_TICKS;
  out.label = v.status === 'resting' ? 'NGHỈ BÁN' : v.status === 'closedEarly' ? 'ĐÓNG CỬA' : null;
  switch (v.status) {
    case 'open':
    case 'soldOut':
      out.base = 'open';
      out.shutter = 0;
      break;
    case 'resting':
    case 'closedEarly':
    case 'closed':
      out.base = rolling ? 'open' : v.status === 'closed' ? 'closed' : 'shut';
      out.shutter = rolling ? easeOutCubic(since / SHUTTER_TICKS) : 0;
      break;
    case 'notYet':
      out.base = 'lot';
      out.shutter = 0;
      break;
  }
  const selling = v.status === 'open' || v.status === 'soldOut';
  if (selling) {
    out.sign = v.status === 'soldOut' ? 'HẾT HÀNG' : 'ĐANG BÁN';
    out.signPrev = v.status === 'soldOut' ? 'ĐANG BÁN' : 'HẾT HÀNG';
    out.signFlip = calm || !Number.isFinite(v.statusSince) ? 1 : progress(v.statusSince, v.statusSince + FLIP_TICKS, now);
  } else {
    out.sign = null;
    out.signPrev = null;
    out.signFlip = 1;
  }
  // The keeper.
  out.ownerK = 0;
  if (out.base !== 'open' || out.shutter > 0.6) {
    out.owner = null;
  } else {
    const sec = now / 10;
    const queue = v.queue.length;
    if (v.status === 'open' && queue >= BUSY_QUEUE) {
      const k = (sec % WIPE_CYCLE) / WIPE_LEN;
      if (calm) {
        out.owner = 'sweat';
        out.ownerK = 0.5;
      } else if (k < 1) {
        out.owner = 'sweat';
        out.ownerK = k;
      } else {
        out.owner = 'serve';
      }
    } else if (v.status === 'open' && (queue > 0 || now - v.lastSaleAt < 25)) {
      out.owner = 'serve';
    } else {
      const quiet = now - Math.max(v.lastSaleAt, Number.isFinite(v.statusSince) ? v.statusSince : -Infinity);
      const k = ((sec + hash01(v.id.length * 7) * YAWN_CYCLE) % YAWN_CYCLE) / YAWN_LEN;
      out.owner = !calm && quiet > IDLE_TICKS && k < 1 ? 'yawn' : 'idle';
      if (out.owner === 'yawn') out.ownerK = k;
    }
  }
  out.grand = v.grandOpening && out.base === 'open';
  out.empty = v.status === 'soldOut' && out.base === 'open';
  out.badge = v.certified ? 'certified' : v.named ? 'named' : null;
  out.badgePop = calm || !Number.isFinite(v.badgeSince) ? 1 : progress(v.badgeSince, v.badgeSince + BADGE_TICKS, now);
  out.rumor = v.rumor && !v.certified;
  const fresh = v.prevPrice !== null && Number.isFinite(v.priceSince);
  out.priceFlip = !fresh || calm ? 1 : progress(v.priceSince, v.priceSince + FLIP_TICKS, now);
  out.priceFlash = fresh ? 1 - progress(v.priceSince, v.priceSince + PRICE_FLASH, now) : 0;
  out.priceUp = v.prevPrice !== null && v.price > v.prevPrice;
  return out;
}

/** The sprite signature of a state: the base, the grand opening, the label (closed early or resting), empty shelves. */
export function shopSig(l: Pick<ShopLook, 'base' | 'grand' | 'label' | 'empty'>): number {
  return BASES.indexOf(l.base) * 16 + (l.grand ? 8 : 0) + (l.label === 'ĐÓNG CỬA' ? 4 : 0) + (l.empty ? 2 : 0);
}

// ── Geometry ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface Geo {
  id: ShopId; top: boolean;
  x: number; y: number; w: number; h: number; u: number;
  /** Queue head x; the board's centre. */
  cx: number; bx: number; by: number;
  // Top row: the ground line in front, the counter top, the shop front's top (under the awning), the awning, the sign.
  ground: number; counterTop: number; storeTop: number; awnTop: number; signTop: number;
  // Bottom row: the counter (top surface, its face toward us, its base), where the keeper stands, the back counter.
  ctrTop: number; ctrFace: number; ctrBase: number; ownerY: number; backTop: number;
  /** The free span at the right edge, clear of the queue (bottom row's roof sign). */
  zone0: number; zone1: number;
  /** Where the keeper stands. */
  ox: number;
  /** Sprite rects: the building behind and in front of the keeper, the board, the hanging sign, the neon. */
  backRect: Rect; frontRect: Rect; boardRect: Rect; signRect: Rect; neonRect: Rect;
  /** The keeper's feet, and the box their figure and marks (z's, sweat) fit in. */
  ownerFeet: number; ownerRect: Rect;
  /** Where the badge fits (top row: with its words and the "named" stamp); the bottom row's counter-face sticker. */
  badgeRect: Rect; stickerRect: Rect;
}

function geoOf(L: StreetLayout, slot: ShopSlot): Geo {
  const { x, y, w, h } = slot.rect;
  const u = L.actorH;
  const top = slot.row === 'top';
  const ground = y + h;
  const storeTop = ground - u * 1.78;
  const awnTop = storeTop - u * 0.42;
  const counterTop = ground - u * 0.62;
  const ctrBase = y + u * 0.32;
  const bw = boardW(top, w, u);
  const sw = u * 0.95;
  const sx = signX(top, x, w, u);
  const sy = top ? storeTop + u * 0.22 : y - u * 0.18 + u * 0.22;
  const g0 = {
    backRect: top
      ? { x: x - u * 0.25, y: y - u * 0.55, w: w + u * 0.5, h: h + u * 0.6 }
      : { x: x - u * 0.25, y: y - u * 2.6, w: w + u * 0.5, h: h + u * 2.6 },
    frontRect: top
      ? { x: x - u * 0.25, y: counterTop - u * 0.75, w: w + u * 0.5, h: ground - counterTop + u * 0.85 }
      : { x: x - u * 0.25, y: ctrBase, w: w + u * 0.5, h: y + h - ctrBase + u * 0.3 },
    boardRect: { x: slot.board.x - bw / 2 - u * 0.1, y: slot.board.y - u * 0.36, w: bw + u * 0.2, h: u * (top ? 0.72 : 1.1) },
    signRect: { x: sx - sw / 2 - u * 0.05, y: sy - u * 0.62, w: sw + u * 0.1, h: u * 0.85 },
    neonRect: { x, y, w, h: u * 2 },
    badgeRect: { x: 0, y: 0, w: 0, h: 0 },
    stickerRect: { x: x, y: y - u * 0.5, w: u * 1.75, h: u * 0.85 },
    ownerFeet: top ? ground - u * 0.3 : y + u * 0.8,
    ownerRect: {
      x: slot.counter.x + u * (top ? 0.55 : 0.5) - u * 0.8, y: (top ? ground - u * 0.3 : y + u * 0.8) - u * 1.7,
      w: u * 1.6, h: u * 1.85,
    },
  };
  const g: Geo = {
    ...g0,
    id: slot.id, top, x, y, w, h, u, cx: slot.counter.x, bx: slot.board.x, by: slot.board.y,
    ground, counterTop, storeTop, awnTop, signTop: awnTop - u * 0.6,
    ctrTop: y - u * 0.5, ctrFace: y - u * 0.18, ctrBase, ownerY: y + u * 0.8, backTop: y + h - u * 0.8,
    zone0: slot.counter.x + (L.queueSlots - 1) * L.queueGap + u * 0.36, zone1: x + w - u * 0.05,
    ox: slot.counter.x + u * (top ? 0.55 : 0.5),
  };
  const at = badgePos(g);
  g.badgeRect = top
    ? { x: x - u * 0.3, y: Math.min(at.y, g.signTop) - u * 0.45, w: w + u * 0.6,
      h: Math.max(at.y, g.awnTop) - Math.min(at.y, g.signTop) + u * 1.15 }
    : { x: at.x - u * 0.45, y: at.y - u * 0.42, w: u * 0.9, h: u * 1.0 };
  return g;
}

/** The hanging "ĐANG BÁN" sign's centre x: middle of a narrow front; right of middle on a wide one (room for the
 * badge's words on its left); on the bottom row's counter face, right of the queue head. */
function signX(top: boolean, x: number, w: number, u: number): number {
  return top ? x + w * (w > u * 3 ? 0.62 : 0.5) : x + w * 0.78;
}

// ── Per-shop styles ────────────────────────────────────────────────────────────────────────────────────────────────

interface Style {
  name: string;
  /** The board: background, digits, frame. */
  board: [string, string, string];
  awning: [string, string] | null;
}

const STYLE: Record<ShopId, Style> = {
  batu: { name: 'Trà sữa Bà Tư', board: ['#4a3a2c', '#fff3dc', '#8a5a36'], awning: null },
  giare: { name: 'GiáRẻ', board: ['#fff3c4', '#de4f5a', '#de4f5a'], awning: ['#de4f5a', '#fffcf7'] },
  cochap: { name: 'Cố Chấp', board: ['#2f3a32', '#f6efe0', '#6b4226'], awning: null },
  luotsong: { name: 'Lướt Sóng', board: ['#1f2a24', '#7ee08a', '#3e6a27'], awning: ['#5b8f3e', '#fffcf7'] },
  sinhvien: { name: 'SV Khởi Nghiệp', board: ['#d9b27c', '#2a1d15', '#a8804e'], awning: null },
  player: { name: 'Quán bạn', board: ['#fffcf7', '#a8323c', '#de4f5a'], awning: null },
  tapdoan: { name: 'Chuỗi Tập Đoàn', board: ['#1f2330', '#ffffff', '#9aa6b5'], awning: null },
};

// ── The renderer ───────────────────────────────────────────────────────────────────────────────────────────────────

const looks = new Map<ShopId, ShopLook>();
const geos = new WeakMap<ShopSlot, Geo>();

const BACK = 0;
const FRONT = 1;
const BOARD = 2;
const SIGN = 3;
const NEON = 4;
const OWNER = 5;
const BADGE = 6;
const STICKER = 7;
/** The keeper's sprite is redrawn this often (ms). */
const OWNER_FRAME_MS = 83;
const OWNER_ACTS: readonly OwnerAct[] = ['serve', 'idle', 'yawn', 'sweat'];

/** The price board's width. */
function boardW(top: boolean, w: number, u: number): number {
  return top ? Math.min(u * 0.98, w * 0.4) : u * 0.92;
}

function geoFor(L: StreetLayout, slot: ShopSlot): Geo {
  let g = geos.get(slot);
  if (g === undefined) {
    g = geoOf(L, slot);
    geos.set(slot, g);
  }
  return g;
}

export function drawShop(rc: RenderContext, v: ShopView, slot: ShopSlot): void {
  drawShopWith(rc, v, slot);
}

/** `drawShop`, with a hook to adjust the look before drawing (the dev sheet freezes a yawn, a flip). */
export function drawShopWith(rc: RenderContext, v: ShopView, slot: ShopSlot, tweak?: (l: ShopLook) => void): void {
  const { ctx, palette: p } = rc;
  const L = rc.layout;
  const g = geoFor(L, slot);
  let look = looks.get(v.id);
  if (look === undefined) {
    look = newShopLook();
    looks.set(v.id, look);
  }
  shopLook(v, rc.now, rc.reducedMotion, look);
  tweak?.(look);
  const sig = shopSig(look);
  const u = g.u;
  const l = look;
  const back = rc.sprites.peek(slot, BACK, g.backRect, rc.grid, sig)
    ?? rc.sprites.get(slot, BACK, g.backRect, rc.grid, sig, c => (g.top ? paintTopBack : paintBottomBack)(c, g, l, p));
  blit(ctx, back, rc.grid);

  const sec = rc.wall / 1000;
  if (l.owner !== null) {
    // The keeper, from a sprite redrawn about 12 times a second (staggered shop by shop): a full rig figure every
    // frame for seven keepers costs more than the gentle motion of a shopkeeper needs.
    const step = rc.reducedMotion ? 0 : Math.floor((rc.wall + slot.index * 23) / OWNER_FRAME_MS);
    const osig = step * 8 + OWNER_ACTS.indexOf(l.owner);
    const act = l.owner;
    const ok = l.ownerK;
    const os = rc.sprites.peek(slot, OWNER, g.ownerRect, rc.grid, osig)
      ?? rc.sprites.get(slot, OWNER, g.ownerRect, rc.grid, osig, c => drawOwner(c, v.id, act, g.ox, g.ownerFeet, u * 0.98,
        g.top ? 'front' : 'back', sec, ok, rc.reducedMotion));
    blit(ctx, os, rc.grid);
  }
  const front = rc.sprites.peek(slot, FRONT, g.frontRect, rc.grid, sig)
    ?? rc.sprites.get(slot, FRONT, g.frontRect, rc.grid, sig, c => (g.top ? paintTopFront : paintBottomFront)(c, g, l, p));
  blit(ctx, front, rc.grid);

  drawLive(rc, v, slot, g, l, sec);
}

// ── Live parts (every frame) ───────────────────────────────────────────────────────────────────────────────────────

function drawLive(rc: RenderContext, v: ShopView, slot: ShopSlot, g: Geo, l: ShopLook, sec: number): void {
  const { ctx } = rc;
  const calm = rc.reducedMotion;
  if (l.base === 'open') {
    if (g.id === 'giare' && neonOn(sec, calm)) {
      // The lit tubes, from a sprite (text strokes are costly to draw every frame).
      const s = rc.sprites.peek(slot, NEON, g.neonRect, rc.grid, 1)
        ?? rc.sprites.get(slot, NEON, g.neonRect, rc.grid, 1, c => neon(c, g));
      blit(ctx, s, rc.grid);
    }
    if (g.id === 'luotsong') ticker(ctx, g, sec, calm);
    if (g.id === 'tapdoan') gleam(ctx, g, sec, calm);
  }
  if (l.shutter > 0) shutterOver(ctx, g, l.shutter, l.label ?? 'NGHỈ BÁN');
  if (l.sign !== null) {
    if (l.signFlip >= 1) {
      const sig = l.sign === 'HẾT HÀNG' ? 2 : 1;
      const s = rc.sprites.peek(slot, SIGN, g.signRect, rc.grid, sig)
        ?? rc.sprites.get(slot, SIGN, g.signRect, rc.grid, sig, c => hangingSign(c, g, l));
      blit(ctx, s, rc.grid);
    } else {
      hangingSign(ctx, g, l);
    }
  }
  // The board shows while the shop sells (a shut or closed shop takes it in).
  if (v.price > 0 && l.base === 'open' && l.shutter === 0) {
    if (l.priceFlip >= 1 && l.priceFlash <= 0) {
      // A board at rest: from a sprite of its price.
      const sig = Math.round(v.price * 10);
      const s = rc.sprites.peek(slot, BOARD, g.boardRect, rc.grid, sig)
        ?? rc.sprites.get(slot, BOARD, g.boardRect, rc.grid, sig, c => priceBoard(c, g, v, l));
      blit(ctx, s, rc.grid);
    } else {
      priceBoard(ctx, g, v, l);
    }
  }
  if (l.grand) balloons(ctx, g, sec, calm, rc.palette);
  if (l.badge !== null) {
    if (l.badgePop >= 1) {
      // A badge at rest, from small sprites: the top row's mark with its words; the bottom row's rosette over the
      // sign, and the words (or the stamp) on a sticker on the counter's face.
      const bsig = l.badge === 'certified' ? 1 : 2;
      const b = l.badge;
      if (g.top || b === 'certified') {
        const s = rc.sprites.peek(slot, BADGE, g.badgeRect, rc.grid, bsig)
          ?? rc.sprites.get(slot, BADGE, g.badgeRect, rc.grid, bsig, c => badge(c, g, b, 1, g.top ? 'all' : 'mark'));
        blit(ctx, s, rc.grid);
      }
      if (!g.top) {
        const s = rc.sprites.peek(slot, STICKER, g.stickerRect, rc.grid, bsig)
          ?? rc.sprites.get(slot, STICKER, g.stickerRect, rc.grid, bsig, c => badge(c, g, b, 1, 'words'));
        blit(ctx, s, rc.grid);
      }
    } else {
      badge(ctx, g, l.badge, l.badgePop, 'all');
    }
  }
  else if (l.rumor) flies(ctx, g, sec, calm);
}

/** The split-flap price board: old digits fold down over the new ones; a coloured edge and ▲/▼ after a change. */
function priceBoard(ctx: Ctx, g: Geo, v: ShopView, l: ShopLook): void {
  const u = g.u;
  const [bg, fg, frame] = STYLE[g.id].board;
  const bw = boardW(g.top, g.w, u);
  const bh = u * 0.5;
  const x = g.bx - bw / 2;
  const y = g.by - bh / 2;
  if (!g.top) {
    // An A-frame standing on the floor (readable from both sides).
    line(ctx, x + bw * 0.2, y + bh, x + bw * 0.12, y + bh + u * 0.32, frame, u * 0.05);
    line(ctx, x + bw * 0.8, y + bh, x + bw * 0.88, y + bh + u * 0.32, frame, u * 0.05);
    shadow(ctx, g.bx, y + bh + u * 0.33, bw * 0.45, u * 0.06);
  }
  const flash = l.priceFlash;
  const edgeCol = flash > 0 ? (l.priceUp ? '#de4f5a' : '#5b8f3e') : frame;
  box(ctx, x - u * 0.05, y - u * 0.05, bw + u * 0.1, bh + u * 0.1, u * 0.1, edgeCol, 0);
  box(ctx, x, y, bw, bh, u * 0.07, bg, 0);
  const now = `${v.price}k`;
  const font = DISPLAY;
  const size = u * 0.36;
  const cy = y + bh / 2;
  if (l.priceFlip >= 1 || v.prevPrice === null) {
    text(ctx, now, g.bx, cy + u * 0.01, size, fg, { font, maxW: bw * 0.9 });
  } else {
    // Split flap: the new top half is already there; the old top half folds down over the middle (first half of the
    // flip), then the new bottom half folds down onto the old bottom half (second half).
    const old = `${v.prevPrice}k`;
    const k = l.priceFlip;
    half(ctx, now, g.bx, cy, size, fg, font, bw, bh, x, y, true, 1);
    half(ctx, old, g.bx, cy, size, fg, font, bw, bh, x, y, false, 1);
    if (k < 0.5) half(ctx, old, g.bx, cy, size, fg, font, bw, bh, x, y, true, 1 - k * 2);
    else half(ctx, now, g.bx, cy, size, fg, font, bw, bh, x, y, false, (k - 0.5) * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(x, cy - u * 0.01, bw, u * 0.02);
  }
  if (flash > 0 && v.prevPrice !== null) {
    ctx.globalAlpha = clamp(flash * 2, 0, 1);
    // The old price on a tag: under the board on the top row (over the counter), to its left on the bottom row.
    const tag = `${l.priceUp ? '▲' : '▼'}${v.prevPrice}k`;
    const tx = g.top ? g.bx : x - u * 0.52;
    const ty = g.top ? y + bh + u * 0.22 : cy;
    box(ctx, tx - u * 0.46, ty - u * 0.15, u * 0.92, u * 0.3, u * 0.15, l.priceUp ? '#de4f5a' : '#5b8f3e', 0);
    text(ctx, tag, tx, ty + u * 0.01, u * 0.2, '#fffcf7', { maxW: u * 0.85 });
    ctx.globalAlpha = 1;
  }
}

/** One half of a flap: the top or bottom half of `s`, squashed vertically toward the middle by `k` (1 flat). */
function half(ctx: Ctx, s: string, cx: number, cy: number, size: number, fg: string, font: string, bw: number,
  bh: number, x: number, y: number, top: boolean, k: number): void {
  if (k <= 0.01) return;
  ctx.save();
  ctx.beginPath();
  if (top) ctx.rect(x, y, bw, bh / 2);
  else ctx.rect(x, cy, bw, bh / 2);
  ctx.clip();
  ctx.translate(0, cy);
  ctx.scale(1, k);
  ctx.translate(0, -cy);
  text(ctx, s, cx, cy, size, fg, { font, maxW: bw * 0.9 });
  ctx.restore();
}

/** "ĐANG BÁN" / "HẾT HÀNG" on a little sign that flips over on its string. */
function hangingSign(ctx: Ctx, g: Geo, l: ShopLook): void {
  const u = g.u;
  const w = u * 0.95;
  const h = u * 0.3;
  const cx = signX(g.top, g.x, g.w, u);
  const cy = g.top ? g.storeTop + u * 0.22 : g.ctrFace + u * 0.22;
  if (g.top) {
    line(ctx, cx - w * 0.3, g.storeTop - u * 0.02, cx, cy - h / 2, 'rgba(42,29,21,0.6)', u * 0.02);
    line(ctx, cx + w * 0.3, g.storeTop - u * 0.02, cx, cy - h / 2, 'rgba(42,29,21,0.6)', u * 0.02);
  }
  const k = l.signFlip;
  // Turning over: the old face shrinks to an edge, the new one grows.
  const showNew = k >= 0.5;
  const sy = Math.abs(Math.cos(k * Math.PI));
  const label = showNew ? l.sign : l.signPrev;
  const sold = label === 'HẾT HÀNG';
  const fill = sold ? '#de4f5a' : '#5b8f3e';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, Math.max(0.05, sy));
  box(ctx, -w / 2, -h / 2, w, h, u * 0.07, fill, u * 0.03, shade(fill, 0.7));
  text(ctx, label ?? '', 0, u * 0.01, u * 0.17, '#fffcf7', { maxW: w * 0.88 });
  ctx.restore();
}

/** The roller shutter rolling down over the shop front (k 0..1), its slats and the label. */
function shutterOver(ctx: Ctx, g: Geo, k: number, label: string): void {
  const u = g.u;
  if (g.top) {
    const x = g.x + u * 0.12;
    const w = g.w - u * 0.24;
    const y0 = g.storeTop;
    const y1 = y0 + (g.ground - y0) * k;
    shutterSlats(ctx, x, y0, w, y1 - y0, u, '#c8c2b8');
    if (k > 0.6) labelPaper(ctx, g.x + g.w / 2, y0 + (g.ground - y0) * 0.45, label, u, label === 'ĐÓNG CỬA');
  } else {
    const x = g.x + u * 0.1;
    const w = g.w - u * 0.2;
    const hFull = u * 1.5;
    shutterSlats(ctx, x, g.y - hFull, w, hFull * k, u, '#c8c2b8');
  }
}

function shutterSlats(ctx: Ctx, x: number, y: number, w: number, h: number, u: number, col: string): void {
  if (h <= 0) return;
  box(ctx, x, y, w, h, u * 0.04, col, u * 0.03, '#8f877c');
  ctx.strokeStyle = 'rgba(80, 70, 60, 0.28)';
  ctx.lineWidth = u * 0.025;
  ctx.beginPath();
  for (let yy = y + u * 0.14; yy < y + h - u * 0.02; yy += u * 0.14) {
    ctx.moveTo(x + u * 0.03, yy);
    ctx.lineTo(x + w - u * 0.03, yy);
  }
  ctx.stroke();
  // The bottom bar with its handle.
  box(ctx, x, y + h - u * 0.1, w, u * 0.1, u * 0.03, '#9d968b', 0);
  ctx.fillStyle = '#6e665c';
  ctx.fillRect(x + w / 2 - u * 0.12, y + h - u * 0.07, u * 0.24, u * 0.04);
}

/** A paper notice taped to a shutter. */
function labelPaper(ctx: Ctx, cx: number, cy: number, s: string, u: number, red: boolean): void {
  const w = u * 1.0;
  const h = u * 0.42;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.05);
  box(ctx, -w / 2, -h / 2, w, h, u * 0.03, '#fffcf7', u * 0.025, '#b9aea2');
  text(ctx, s, 0, u * 0.01, u * 0.2, red ? '#a8323c' : '#2a1d15', { maxW: w * 0.88 });
  ctx.fillStyle = 'rgba(233, 184, 114, 0.7)';
  ctx.fillRect(-w * 0.45, -h / 2 - u * 0.04, u * 0.22, u * 0.08);
  ctx.fillRect(w * 0.45 - u * 0.22, -h / 2 - u * 0.04, u * 0.22, u * 0.08);
  ctx.restore();
}

/** Balloon clusters bobbing on their strings (top row: both corners of the front; bottom row: the right post). */
function balloons(ctx: Ctx, g: Geo, sec: number, calm: boolean, p: Palette): void {
  const u = g.u;
  const cols = [p.strawberry, p.tea, '#7fb8e0', p.matcha, '#f07ab4'];
  // Two clusters: the top row's at both corners of its front, leaning outward so the strings stay off the sign; the
  // bottom row's at its left edge (straight up, over nobody's head) and at its right edge, outside the sign or totem.
  for (let c = 0; c < 2; c++) {
    const side = c === 0 ? -1 : 1;
    const ax = g.top ? (c === 0 ? g.x + u * 0.12 : g.x + g.w - u * 0.12) : c === 0 ? g.x + u * 0.08 : g.x + g.w + u * 0.02;
    const ay = g.top ? g.storeTop + u * 0.5 : g.ctrFace;
    const lean = g.top || c === 1 ? 1 : 0.25;
    for (let i = 0; i < 5; i++) {
      const bob = calm ? 0 : Math.sin(sec * 1.6 + i * 1.3 + ax) * u * 0.06;
      const bx = ax + side * lean * (0.06 + (i % 3) * 0.15) * u + (lean < 1 ? (i - 2) * u * 0.05 : 0);
      const by = ay - u * (g.top ? 1.05 : 2.35) - (i % 3) * u * 0.28 - (i > 2 ? u * 0.15 : 0) + bob;
      ctx.strokeStyle = 'rgba(42, 29, 21, 0.4)';
      ctx.lineWidth = u * 0.015;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(ax + (bx - ax) * 0.3, (ay + by) / 2, bx, by + u * 0.2);
      ctx.stroke();
      const c = cols[i];
      ctx.beginPath();
      ctx.ellipse(bx, by, u * 0.16, u * 0.2, 0, 0, Math.PI * 2);
      fe(ctx, c, u * 0.025);
      oval(ctx, bx - u * 0.05, by - u * 0.07, u * 0.04, u * 0.06, 'rgba(255,255,255,0.6)');
    }
  }
}

/** The certified rosette popping on, or the "named" stamp slamming down. */
function badge(ctx: Ctx, g: Geo, kind: 'certified' | 'named', k: number, part: 'all' | 'mark' | 'words'): void {
  const u = g.u;
  const at = badgePos(g);
  if (kind === 'certified') {
    const s = easeOutBack(k);
    if (s <= 0) return;
    if (part !== 'words') rosette(ctx, at.x, at.y, u, s, k);
    if (k < 1 || part === 'mark') return;
    // The words: beside the rosette on the top row; on a sticker on the counter's face on the bottom row (nothing
    // over the queue).
    if (g.top) {
      text(ctx, 'ĐÃ KIỂM ĐỊNH', at.x + u * 0.34, at.y + u * 0.02, u * 0.14, '#3e6a27',
        { stroke: '#fffcf7', strokeW: u * 0.06, maxW: u * 1.0, align: 'left' });
    } else {
      const sx = g.x + u * 0.12;
      box(ctx, sx, g.ctrFace + u * 0.06, u * 1.15, u * 0.26, u * 0.06, '#5b8f3e', u * 0.025, '#3e6a27');
      text(ctx, '✓ ĐÃ KIỂM ĐỊNH', sx + u * 0.575, g.ctrFace + u * 0.195, u * 0.14, '#fffcf7', { maxW: u * 1.05 });
    }
    return;
  }
  if (part === 'mark') return;
  stamp(ctx, g, k);
}

/** The scalloped green rosette with its ribbon tails and a tick, popping on (scale s, progress k). */
function rosette(ctx: Ctx, x: number, y: number, u: number, s: number, k: number): void {
  {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.rotate((1 - k) * -1.2);
    // Ribbon tails, the scalloped rosette, the tick.
    poly(ctx, [-u * 0.16, u * 0.1, -u * 0.26, u * 0.48, -u * 0.13, u * 0.4, -u * 0.04, u * 0.5, 0, u * 0.12]);
    fe(ctx, '#3e6a27', 0);
    poly(ctx, [u * 0.16, u * 0.1, u * 0.26, u * 0.48, u * 0.13, u * 0.4, u * 0.04, u * 0.5, 0, u * 0.12]);
    fe(ctx, '#3e6a27', 0);
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = i % 2 === 0 ? u * 0.3 : u * 0.25;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    fe(ctx, '#5b8f3e', u * 0.03, '#3e6a27');
    disc(ctx, 0, 0, u * 0.2, '#fffcf7', 0);
    ctx.strokeStyle = '#3e6a27';
    ctx.lineWidth = u * 0.07;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-u * 0.09, 0);
    ctx.lineTo(-u * 0.02, u * 0.07);
    ctx.lineTo(u * 0.1, -u * 0.07);
    ctx.stroke();
    ctx.restore();
  }
}

/** The "BỊ NÊU TÊN" stamp slamming down: over the top row's sign; on the bottom row's counter face. */
function stamp(ctx: Ctx, g: Geo, k: number): void {
  const u = g.u;
  {
    // Slams down from big, with a little shake.
    const s = k < 1 ? 2.2 - 1.2 * easeOutCubic(k) : 1;
    ctx.save();
    // Top row: on the awning under the sign, so the name above stays readable; bottom row: on the counter's face.
    if (g.top) ctx.translate(g.x + g.w / 2, g.awnTop + u * 0.24);
    else ctx.translate(g.x + u * 0.75, g.ctrFace + u * 0.2);
    ctx.rotate(g.top ? -0.12 : -0.22);
    ctx.scale(s, s);
    ctx.globalAlpha = clamp(k * 3, 0, 1);
    rr(ctx, -u * 0.62, -u * 0.2, u * 1.24, u * 0.4, u * 0.06);
    ctx.strokeStyle = '#c0323e';
    ctx.lineWidth = u * 0.05;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 252, 247, 0.85)';
    ctx.fill();
    text(ctx, 'BỊ NÊU TÊN', 0, u * 0.01, u * 0.2, '#c0323e', { maxW: u * 1.1 });
    ctx.restore();
  }
}

/** Where a shop's badge sits on the street (the inspection's confetti bursts from there). */
export function badgeSpot(L: StreetLayout, slot: ShopSlot): { x: number; y: number } {
  return badgePos(geoFor(L, slot));
}

/** Where the badge sits. */
function badgePos(g: Geo): { x: number; y: number } {
  const u = g.u;
  if (g.top) {
    // Portrait: on the wall above the sign band; landscape (no wall above): the front's upper left, under the awning.
    return g.signTop - g.y >= u * 1.25 ? { x: g.x + u * 0.36, y: g.signTop - u * 0.36 }
      : { x: g.x + u * 0.38, y: g.storeTop + u * 0.34 };
  }
  // Bottom row: on top of the roof sign (or the totem), clear of its lettering and logo.
  if (g.id === 'tapdoan') {
    const t = totemRect(g);
    return { x: t.x + t.w / 2, y: t.y - u * 0.3 };
  }
  const wide = g.zone1 - g.zone0 > u * 0.9;
  return { x: (g.zone0 + g.zone1) / 2, y: g.y - u * (wide ? 1.9 : 2.1) - u * 0.3 };
}

/** Shops still under the rumor: a faint grey whiff and two flies buzzing round. */
function flies(ctx: Ctx, g: Geo, sec: number, calm: boolean): void {
  const u = g.u;
  const cx = g.top ? g.x + g.w * 0.62 : g.zone0 + (g.zone1 - g.zone0) / 2;
  const cy = g.top ? g.storeTop - u * 0.15 : g.y - u * 1.0;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#a59e96';
  ctx.beginPath();
  ctx.arc(cx - u * 0.18, cy, u * 0.16, 0, Math.PI * 2);
  ctx.arc(cx + u * 0.05, cy - u * 0.08, u * 0.2, 0, Math.PI * 2);
  ctx.arc(cx + u * 0.25, cy + u * 0.02, u * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  for (let i = 0; i < 2; i++) {
    const a = calm ? i * 2.5 : sec * (3.1 + i) + i * 2;
    const fx = cx + Math.cos(a) * u * 0.42;
    const fy = cy + Math.sin(a * 1.3) * u * 0.2;
    oval(ctx, fx, fy, u * 0.05, u * 0.04, '#2a1d15');
    const flap = calm ? 0.5 : Math.abs(Math.sin(sec * 40 + i));
    oval(ctx, fx - u * 0.03, fy - u * 0.05, u * 0.04, u * 0.025 * (0.4 + flap), 'rgba(200, 220, 235, 0.85)');
    oval(ctx, fx + u * 0.03, fy - u * 0.05, u * 0.04, u * 0.025 * (0.4 + flap), 'rgba(200, 220, 235, 0.85)');
  }
}

/** GiáRẻ's neon is mostly on, with a stutter of a few frames every few seconds. */
function neonOn(sec: number, calm: boolean): boolean {
  const n = Math.floor(sec * 8);
  return calm || !(n % 37 === 0 || n % 37 === 2 || n % 53 === 5);
}

/** GiáRẻ's neon SALE, lit. */
function neon(ctx: Ctx, g: Geo): void {
  const at = neonAt(g);
  ctx.font = `800 ${at.size}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255, 92, 170, 0.35)';
  ctx.lineWidth = at.size * 0.32;
  ctx.strokeText('SALE', at.x, at.y);
  ctx.strokeStyle = '#ff5caa';
  ctx.lineWidth = at.size * 0.12;
  ctx.strokeText('SALE', at.x, at.y);
  ctx.fillStyle = '#ffe3f1';
  ctx.fillText('SALE', at.x, at.y);
}

function neonAt(g: Geo): { x: number; y: number; size: number } {
  const u = g.u;
  const upper = g.signTop - g.y;
  if (upper > u * 0.9) return { x: g.x + g.w * 0.5, y: g.y + upper * 0.52, size: Math.min(u * 0.62, g.w * 0.26) };
  return { x: g.x + g.w * 0.78, y: g.signTop + u * 0.3, size: u * 0.36 };
}

/** Lướt Sóng's stock ticker scrolling along the strip over the awning. */
const TICKER = '▲ TRÀ SỮA +2k   ▼ TRÂN CHÂU −1k   ▲ PHỐ +5%   ▲ MATCHA +3k   ▼ ĐƯỜNG −2%   ';
function ticker(ctx: Ctx, g: Geo, sec: number, calm: boolean): void {
  const u = g.u;
  const x = g.x + u * 0.14;
  const w = g.w - u * 0.28;
  const y = g.awnTop - u * 0.2;
  const h = u * 0.2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.font = `700 ${u * 0.15}px "Be Vietnam Pro", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const span = u * 6.2;
  const off = calm ? 0 : (sec * u * 0.9) % span;
  ctx.fillStyle = '#9ff0a6';
  ctx.fillText(TICKER, x - off, y + h / 2);
  ctx.fillText(TICKER, x - off + span, y + h / 2);
  ctx.restore();
}

/** Tập Đoàn's glass catching the light: a gleam sweeping across the totem every few seconds. */
function gleam(ctx: Ctx, g: Geo, sec: number, calm: boolean): void {
  if (calm) return;
  const u = g.u;
  const k = (sec % 4.5) / 1.2;
  if (k >= 1) return;
  const t = totemRect(g);
  ctx.save();
  ctx.beginPath();
  ctx.rect(t.x, t.y, t.w, t.h);
  ctx.clip();
  const gx = t.x - u * 0.6 + (t.w + u * 1.2) * k;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  poly(ctx, [gx, t.y + t.h, gx + u * 0.18, t.y + t.h, gx + u * 0.68, t.y, gx + u * 0.5, t.y]);
  ctx.fill();
  ctx.restore();
}

function totemRect(g: Geo): { x: number; y: number; w: number; h: number } {
  const u = g.u;
  const w = Math.min(g.zone1 - g.zone0, u * 0.62);
  // Shorter where the zone is narrow (portrait), leaving the bus corner's sky to the building site's board.
  const tall = g.zone1 - g.zone0 > u * 0.9 ? 2.15 : 1.45;
  return { x: g.zone1 - w, y: g.y - u * tall, w, h: u * tall + u * 0.35 };
}

// ── Top row: static art ────────────────────────────────────────────────────────────────────────────────────────────

/** The building behind the keeper: upper floors, sign, awning, the open front (or its shutter), the interior. */
function paintTopBack(c: Ctx, g: Geo, l: ShopLook, p: Palette): void {
  const u = g.u;
  const { x, y, w } = g;
  const id = g.id;
  const faded = l.base === 'closed';
  const wall = wallOf(id);
  // The building block with a soft shadow under it.
  shadow(c, x + w / 2, g.ground + u * 0.05, w * 0.55, u * 0.12, 0.12);
  box(c, x, y, w, g.ground - y, u * 0.1, faded ? shade(wall, 0.9) : wall, u * 0.04);
  upperFloor(c, g, wall, l);
  if (l.base === 'lot') {
    // Not a state the top row meets in the game (only Tập Đoàn opens late): a plain shutter with a notice.
    shutterSlats(c, x + u * 0.12, g.storeTop, w - u * 0.24, g.ground - g.storeTop, u, '#c8c2b8');
    labelPaper(c, x + w / 2, (g.storeTop + g.ground) / 2, 'SẮP MỞ', u, false);
    return;
  }
  signBand(c, g, faded);
  // The shop front's interior.
  const ix = x + u * 0.12;
  const iw = w - u * 0.24;
  if (l.base === 'open') {
    box(c, ix, g.storeTop, iw, g.counterTop - g.storeTop + u * 0.1, u * 0.06, interiorOf(id), 0);
    interior(c, g, ix, iw, l.empty);
    if (l.empty) {
      // Sold out: the shelves bare, the front a little dim.
      c.fillStyle = 'rgba(60, 50, 45, 0.18)';
      c.fillRect(ix, g.storeTop, iw, g.counterTop - g.storeTop + u * 0.1);
    }
  } else {
    shutterSlats(c, ix, g.storeTop, iw, g.ground - g.storeTop, u, faded ? '#b3aca1' : '#c8c2b8');
    if (faded) {
      // Rust streaks and a notice.
      c.fillStyle = 'rgba(148, 83, 26, 0.18)';
      for (let i = 0; i < 4; i++) c.fillRect(ix + iw * (0.15 + i * 0.22), g.storeTop + u * 0.2, u * 0.05, u * 0.9);
      sangNhuong(c, x + w / 2, g.storeTop + (g.ground - g.storeTop) * 0.46, u, Math.min(w * 0.82, u * 1.6));
    } else {
      labelPaper(c, x + w / 2, g.storeTop + (g.ground - g.storeTop) * 0.45, l.label ?? 'NGHỈ BÁN', u,
        l.label === 'ĐÓNG CỬA');
    }
  }
  // The awning over the front (the cart's umbrella for Bà Tư, the eave for Cố Chấp).
  const st = STYLE[id];
  if (st.awning !== null) {
    const [a, b] = faded ? [shade(st.awning[0], 1.25), '#eee8df'] : st.awning;
    awning(c, x - u * 0.06, g.awnTop, w + u * 0.12, u * 0.48, a, b, u);
  } else if (id === 'cochap') {
    eave(c, g, faded);
  } else if (id === 'batu' && l.base === 'open') {
    umbrella(c, g);
  } else if (id === 'batu') {
    awning(c, x - u * 0.06, g.awnTop, w + u * 0.12, u * 0.42, '#d7b48a', '#efe2cc', u);
  }
  if (l.grand) grandTop(c, g, p);
  if (id === 'luotsong' && l.base === 'open') {
    box(c, x + u * 0.1, g.awnTop - u * 0.23, w - u * 0.2, u * 0.26, u * 0.05, '#1f2a24', u * 0.025, '#0f1512');
  }
}

/** The counter (and whatever stands in front of the keeper). */
function paintTopFront(c: Ctx, g: Geo, l: ShopLook, p: Palette): void {
  if (l.base !== 'open') {
    if (l.base === 'closed' || l.base === 'shut') {
      // Leaves and dust gathered at the foot of the shutter.
      const u = g.u;
      for (let i = 0; i < 4; i++) {
        oval(c, g.x + g.w * (0.2 + hash01(i + g.x) * 0.6), g.ground - u * 0.04, u * 0.09, u * 0.04,
          i % 2 === 0 ? '#c9a24a' : '#b5793e');
      }
    }
    return;
  }
  const u = g.u;
  const { x, w } = g;
  const id = g.id;
  const top = g.counterTop;
  const h = g.ground - top;
  switch (id) {
    case 'batu':
      cart(c, g);
      break;
    case 'giare': {
      box(c, x + u * 0.08, top, w - u * 0.16, h, u * 0.08, '#de4f5a', u * 0.04);
      c.fillStyle = '#fffcf7';
      c.fillRect(x + u * 0.08, top + h * 0.3, w - u * 0.16, h * 0.16);
      starburst(c, x + w * 0.28, top + h * 0.6, u * 0.26, '#ffd23f');
      text(c, 'SỐC', x + w * 0.28, top + h * 0.6, u * 0.13, '#a8323c');
      break;
    }
    case 'cochap': {
      box(c, x + u * 0.08, top, w - u * 0.16, h, u * 0.05, '#8a5a36', u * 0.04);
      c.strokeStyle = 'rgba(42, 29, 21, 0.25)';
      c.lineWidth = u * 0.025;
      c.beginPath();
      for (let yy = top + h * 0.33; yy < g.ground - u * 0.02; yy += h * 0.33) {
        c.moveTo(x + u * 0.1, yy);
        c.lineTo(x + w - u * 0.1, yy);
      }
      c.stroke();
      box(c, x + u * 0.04, top - u * 0.06, w - u * 0.08, u * 0.1, u * 0.04, '#6b4226', u * 0.02);
      // A teapot on the counter, at the far left.
      teapot(c, x + u * 0.32, top - u * 0.05, u * 0.3);
      break;
    }
    case 'luotsong': {
      box(c, x + u * 0.08, top, w - u * 0.16, h, u * 0.06, '#f7f8f4', u * 0.04, '#9db58f');
      for (let i = 0; i < 4; i++) {
        const cx = x + u * 0.2 + i * (w - u * 0.5) / 3.3;
        chartPaper(c, cx, top + h * 0.18, u * 0.42, u * 0.32, i % 3 !== 1, (i - 1.5) * 0.06);
      }
      c.fillStyle = '#5b8f3e';
      c.fillRect(x + u * 0.08, g.ground - u * 0.08, w - u * 0.16, u * 0.06);
      break;
    }
    default:
      box(c, x + u * 0.08, top, w - u * 0.16, h, u * 0.06, p.milk, u * 0.04);
  }
}

function wallOf(id: ShopId): string {
  switch (id) {
    case 'batu': return '#ecc982';
    case 'giare': return '#f7c4cf';
    case 'cochap': return '#a0704a';
    case 'luotsong': return '#f4f6ef';
    case 'sinhvien': return '#e8d4b4';
    case 'player': return '#fde4e4';
    case 'tapdoan': return '#e6eaef';
  }
}

function interiorOf(id: ShopId): string {
  switch (id) {
    case 'batu': return '#6e4e36';
    case 'giare': return '#fff1f4';
    case 'cochap': return '#5a3a24';
    case 'luotsong': return '#e9f1e2';
    default: return '#f4e7d6';
  }
}

/** Upper floors above the sign (portrait) or a parapet (landscape), in each shop's way. */
function upperFloor(c: Ctx, g: Geo, wall: string, l: ShopLook): void {
  const u = g.u;
  const { x, y, w, id } = g;
  const h = g.signTop - y;
  if (h < u * 0.3) return;
  // A parapet line on the roof.
  c.fillStyle = shade(wall, 0.88);
  c.fillRect(x, y, w, u * 0.12);
  if (h < u * 0.9) return;
  const wy = y + u * 0.32;
  const wh = Math.min(h - u * 0.55, u * 0.85);
  switch (id) {
    case 'batu': {
      // Peeling lime wash showing bricks, a window with green shutters and a flower box.
      c.fillStyle = 'rgba(181, 82, 62, 0.35)';
      rr(c, x + w * 0.66, wy + wh * 0.5, u * 0.42, u * 0.24, u * 0.06);
      c.fill();
      const ww = w * 0.42;
      const wx = x + (w - ww) / 2;
      box(c, wx, wy, ww, wh, u * 0.05, '#6b8fa3', u * 0.03, '#4d6878');
      box(c, wx - ww * 0.3, wy, ww * 0.3, wh, u * 0.03, '#5f9a6a', u * 0.025);
      box(c, wx + ww, wy, ww * 0.3, wh, u * 0.03, '#5f9a6a', u * 0.025);
      box(c, wx - u * 0.06, wy + wh - u * 0.08, ww + u * 0.12, u * 0.14, u * 0.03, '#8a5a36', u * 0.02);
      for (let i = 0; i < 4; i++) disc(c, wx + ww * (0.12 + i * 0.25), wy + wh - u * 0.1, u * 0.09, i % 2 ? '#e0569a' : '#6aa34c');
      break;
    }
    case 'giare':
      // The neon frame (the tubes light up live).
      box(c, x + u * 0.16, wy - u * 0.05, w - u * 0.32, wh, u * 0.12, '#3a2234', u * 0.04, '#24131f');
      if (l.base !== 'open') text(c, 'SALE', x + w / 2, wy - u * 0.05 + wh / 2, Math.min(u * 0.62, w * 0.26), '#6a4a5e', { font: DISPLAY });
      break;
    case 'cochap': {
      // A wooden lattice window and a bonsai.
      const ww = w * 0.5;
      const wx = x + (w - ww) / 2;
      box(c, wx, wy, ww, wh, u * 0.03, '#6b4226', u * 0.03);
      c.strokeStyle = '#d9b27c';
      c.lineWidth = u * 0.03;
      c.beginPath();
      for (let i = 1; i < 4; i++) {
        c.moveTo(wx + (ww * i) / 4, wy + u * 0.05);
        c.lineTo(wx + (ww * i) / 4, wy + wh - u * 0.05);
        c.moveTo(wx + u * 0.05, wy + (wh * i) / 4);
        c.lineTo(wx + ww - u * 0.05, wy + (wh * i) / 4);
      }
      c.stroke();
      plant(c, x + w * 0.86, wy + wh, u * 0.5, '#4a6b7a', '#4f7f36');
      break;
    }
    case 'luotsong': {
      // A big screen with a chart going up.
      const sx = x + u * 0.16;
      const sw = w - u * 0.32;
      box(c, sx, wy - u * 0.05, sw, wh, u * 0.08, '#1f2a24', u * 0.04, '#0f1512');
      c.strokeStyle = 'rgba(126, 224, 138, 0.25)';
      c.lineWidth = u * 0.015;
      c.beginPath();
      for (let i = 1; i < 4; i++) {
        c.moveTo(sx + u * 0.08, wy - u * 0.05 + (wh * i) / 4);
        c.lineTo(sx + sw - u * 0.08, wy - u * 0.05 + (wh * i) / 4);
      }
      c.stroke();
      c.strokeStyle = '#7ee08a';
      c.lineWidth = u * 0.05;
      c.lineJoin = 'round';
      c.beginPath();
      const n = 8;
      for (let i = 0; i <= n; i++) {
        const px = sx + u * 0.1 + ((sw - u * 0.2) * i) / n;
        const py = wy - u * 0.05 + wh * (0.8 - (i / n) * 0.55 + Math.sin(i * 2.3) * 0.12);
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.stroke();
      break;
    }
    default:
      break;
  }
}

function signBand(c: Ctx, g: Geo, faded: boolean): void {
  const u = g.u;
  const { x, w, id } = g;
  const y = g.signTop;
  const h = g.awnTop - y;
  const name = STYLE[id].name;
  switch (id) {
    case 'batu': {
      box(c, x + u * 0.1, y + u * 0.04, w - u * 0.2, h - u * 0.06, u * 0.05, faded ? '#a08a72' : '#9b6b3e', u * 0.04);
      c.strokeStyle = 'rgba(42, 29, 21, 0.2)';
      c.lineWidth = u * 0.02;
      c.beginPath();
      c.moveTo(x + u * 0.12, y + h * 0.5);
      c.lineTo(x + w - u * 0.12, y + h * 0.5);
      c.stroke();
      text(c, name, x + w / 2, y + h * 0.52, u * 0.26, '#fff3dc', { maxW: w - u * 0.4, font: DISPLAY });
      break;
    }
    case 'giare':
      box(c, x + u * 0.06, y + u * 0.02, w - u * 0.12, h - u * 0.02, u * 0.1, faded ? '#c99096' : '#de4f5a', u * 0.04);
      text(c, 'GIÁRẺ', x + w * (h > u * 0.5 && g.signTop - g.y > u * 0.9 ? 0.5 : 0.36), y + h * 0.52, u * 0.34,
        '#fffcf7', { maxW: w * 0.6, font: DISPLAY });
      if (g.signTop - g.y <= u * 0.9) box(c, x + w * 0.62, y + u * 0.06, w * 0.32, h - u * 0.1, u * 0.08, '#3a2234', 0);
      break;
    case 'cochap':
      box(c, x + w * 0.12, y + u * 0.08, w * 0.76, h - u * 0.1, u * 0.04, '#2a1d15', u * 0.05, '#c9a24a');
      text(c, 'CỐ CHẤP', x + w / 2, y + h * 0.55, u * 0.27, faded ? '#9c8a5a' : '#e9c46a',
        { maxW: w * 0.68, font: DISPLAY });
      break;
    case 'luotsong':
      box(c, x + u * 0.06, y + u * 0.02, w - u * 0.12, h - u * 0.24, u * 0.08, faded ? '#a8bba0' : '#5b8f3e', u * 0.04);
      text(c, name.toUpperCase(), x + w / 2 + u * 0.15, y + (h - u * 0.22) * 0.55, u * 0.27, '#fffcf7',
        { maxW: w - u * 0.8, font: DISPLAY });
      // The logo: an arrow riding a wave.
      line(c, x + u * 0.22, y + h * 0.42, x + u * 0.42, y + h * 0.14, '#fffcf7', u * 0.05);
      line(c, x + u * 0.42, y + h * 0.14, x + u * 0.32, y + h * 0.16, '#fffcf7', u * 0.05);
      break;
    default:
      break;
  }
}

/** Bà Tư's faded striped beach umbrella over her cart. */
function umbrella(c: Ctx, g: Geo): void {
  const u = g.u;
  const cx = g.x + g.w * 0.42;
  const top = g.awnTop - u * 0.12;
  const rw = Math.min(g.w * 0.62, u * 1.6);
  const rh = u * 0.55;
  line(c, cx, top + rh * 0.2, cx + u * 0.05, g.counterTop, '#8a7c6f', u * 0.05);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI + (i / n) * Math.PI;
    const a1 = Math.PI + ((i + 1) / n) * Math.PI;
    c.beginPath();
    c.moveTo(cx, top);
    c.lineTo(cx + Math.cos(a0) * rw, top + rh + Math.sin(a0) * rh * 0.1);
    c.quadraticCurveTo(cx + Math.cos((a0 + a1) / 2) * rw * 0.95, top + rh * 1.15,
      cx + Math.cos(a1) * rw, top + rh + Math.sin(a1) * rh * 0.1);
    c.closePath();
    c.fillStyle = i % 2 === 0 ? '#e57f6e' : '#f6e7d2';
    c.fill();
  }
  c.strokeStyle = 'rgba(148, 83, 26, 0.5)';
  c.lineWidth = u * 0.025;
  c.beginPath();
  c.moveTo(cx - rw, top + rh);
  c.quadraticCurveTo(cx, top - rh * 0.4, cx + rw, top + rh);
  c.stroke();
  disc(c, cx, top - u * 0.04, u * 0.05, '#8a7c6f');
}

/** The old push cart: wooden body, glass case with jars of toppings, spoked wheels, the handlebar. */
function cart(c: Ctx, g: Geo): void {
  const u = g.u;
  const x = g.x + u * 0.12;
  const w = g.w - u * 0.24;
  const top = g.counterTop;
  const bottom = g.ground - u * 0.16;
  // The glass case on top (see-through: the keeper shows behind it).
  c.fillStyle = 'rgba(220, 240, 245, 0.35)';
  rr(c, x + u * 0.1, top - u * 0.36, w * 0.62, u * 0.38, u * 0.04);
  c.fill();
  c.strokeStyle = 'rgba(110, 91, 77, 0.6)';
  c.lineWidth = u * 0.025;
  c.stroke();
  const jars: [string, string][] = [['#3a271c', '#2a1d15'], ['#9dbb6e', '#5b8f3e'], ['#f2c14e', '#c9952a']];
  jars.forEach(([fill, dark], i) => {
    const jx = x + u * 0.22 + i * w * 0.19;
    box(c, jx, top - u * 0.28, u * 0.2, u * 0.26, u * 0.05, 'rgba(255,255,255,0.55)', u * 0.02, '#9b8b7c');
    for (let k = 0; k < 4; k++) disc(c, jx + u * (0.05 + (k % 2) * 0.09), top - u * (0.08 + Math.floor(k / 2) * 0.07), u * 0.035, fill, 0);
  });
  // The cart body: painted wood, a little faded, with a blue stripe.
  box(c, x, top, w, bottom - top, u * 0.06, '#d9a46a', u * 0.04);
  c.fillStyle = '#5a8bb0';
  c.fillRect(x, top + (bottom - top) * 0.32, w, u * 0.08);
  text(c, 'TRÀ SỮA', x + w * 0.42, top + (bottom - top) * 0.68, u * 0.16, '#8a4b1f', { maxW: w * 0.7 });
  // Spoked wheels.
  for (const wx of [x + u * 0.28, x + w - u * 0.3]) {
    disc(c, wx, g.ground - u * 0.18, u * 0.17, '#3a2f2a', u * 0.02);
    disc(c, wx, g.ground - u * 0.18, u * 0.12, '#8a7c6f', 0);
    c.strokeStyle = '#3a2f2a';
    c.lineWidth = u * 0.015;
    c.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      c.moveTo(wx + Math.cos(a) * u * 0.12, g.ground - u * 0.18 + Math.sin(a) * u * 0.12);
      c.lineTo(wx - Math.cos(a) * u * 0.12, g.ground - u * 0.18 - Math.sin(a) * u * 0.12);
    }
    c.stroke();
  }
  // The handlebar.
  line(c, x + w, top + u * 0.1, x + w + u * 0.1, top - u * 0.05, '#6e5b4d', u * 0.04);
  // A red plastic stool.
  const sx = g.x + g.w - u * 0.05;
  box(c, sx - u * 0.18, g.ground - u * 0.26, u * 0.28, u * 0.06, u * 0.03, '#de4f5a', u * 0.02);
  line(c, sx - u * 0.14, g.ground - u * 0.2, sx - u * 0.17, g.ground, '#a8323c', u * 0.04);
  line(c, sx + u * 0.06, g.ground - u * 0.2, sx + u * 0.09, g.ground, '#a8323c', u * 0.04);
}

/** What shows inside each open front, behind the keeper. */
function interior(c: Ctx, g: Geo, ix: number, iw: number, empty: boolean): void {
  const u = g.u;
  const top = g.storeTop;
  const id = g.id;
  // Shelves along the back wall.
  const shelfY = [top + u * 0.42, top + u * 0.8];
  for (const sy of shelfY) {
    c.fillStyle = id === 'cochap' || id === 'batu' ? '#3e2a1c' : 'rgba(42, 29, 21, 0.18)';
    c.fillRect(ix + u * 0.08, sy, iw - u * 0.16, u * 0.05);
    const n = Math.max(2, Math.floor((iw - u * 0.3) / (u * 0.22)));
    for (let i = 0; i < n; i++) {
      const jx = ix + u * 0.16 + i * ((iw - u * 0.32) / n);
      const col = id === 'giare' ? (i % 2 ? '#ffd23f' : '#de4f5a') : id === 'luotsong' ? (i % 2 ? '#9dbb6e' : '#fffcf7')
        : id === 'cochap' ? (i % 2 ? '#c9a24a' : '#e6dccb') : (i % 3 === 0 ? '#e9b872' : i % 3 === 1 ? '#f6e7d2' : '#c8945e');
      if (empty) {
        // Only the outline where a jar stood, and a lone one now and then.
        if (i % 4 === 1) box(c, jx, sy - u * 0.18, u * 0.14, u * 0.18, u * 0.04, '#cfc8c0', u * 0.015);
        else {
          rr(c, jx, sy - u * 0.18, u * 0.14, u * 0.18, u * 0.04);
          c.strokeStyle = 'rgba(42, 29, 21, 0.18)';
          c.lineWidth = u * 0.015;
          c.stroke();
        }
      } else {
        box(c, jx, sy - u * 0.18, u * 0.14, u * 0.18, u * 0.04, col, u * 0.015);
      }
    }
  }
  if (id === 'batu') {
    // The little red altar to the god of wealth, glowing.
    box(c, ix + iw - u * 0.42, top + u * 0.08, u * 0.32, u * 0.24, u * 0.03, '#b5323e', u * 0.02);
    disc(c, ix + iw - u * 0.26, top + u * 0.2, u * 0.05, '#ffd23f', 0);
  }
  if (id === 'giare') {
    // Posters.
    box(c, ix + u * 0.1, top + u * 0.05, u * 0.38, u * 0.26, u * 0.03, '#ffd23f', 0);
    text(c, '1+1', ix + u * 0.29, top + u * 0.18, u * 0.15, '#a8323c');
    // Triangle bunting under the awning.
    for (let i = 0; i < 8; i++) {
      const bx = ix + (iw * i) / 8;
      poly(c, [bx, top + u * 0.02, bx + iw / 8, top + u * 0.02, bx + iw / 16, top + u * 0.2]);
      c.fillStyle = ['#ffd23f', '#5b8f3e', '#7fb8e0', '#de4f5a'][i % 4];
      c.fill();
    }
  }
  if (id === 'luotsong') {
    for (let i = 0; i < 3; i++) chartPaper(c, ix + u * 0.15 + i * iw * 0.3, top + u * 0.06, u * 0.4, u * 0.28, i !== 1, 0.04 * (i - 1));
  }
}

function eave(c: Ctx, g: Geo, faded: boolean): void {
  const u = g.u;
  const x = g.x - u * 0.12;
  const w = g.w + u * 0.24;
  const y = g.awnTop;
  const col = faded ? '#a77a6c' : '#b5523e';
  poly(c, [x, y + u * 0.45, x + u * 0.12, y, x + w - u * 0.12, y, x + w, y + u * 0.45]);
  fe(c, col, u * 0.04);
  // Rows of curved clay tiles.
  c.strokeStyle = shade(col, 0.72);
  c.lineWidth = u * 0.025;
  c.beginPath();
  for (let r = 1; r < 3; r++) {
    const yy = y + r * u * 0.15;
    for (let xx = x + u * 0.1; xx < x + w - u * 0.1; xx += u * 0.22) {
      c.moveTo(xx, yy);
      c.quadraticCurveTo(xx + u * 0.11, yy + u * 0.07, xx + u * 0.22, yy);
    }
  }
  c.stroke();
  // A red lantern under the eave's corner.
  const lx = g.x + g.w - u * 0.3;
  line(c, lx, y + u * 0.45, lx, y + u * 0.58, '#2a1d15', u * 0.02);
  c.beginPath();
  c.ellipse(lx, y + u * 0.78, u * 0.17, u * 0.22, 0, 0, Math.PI * 2);
  fe(c, faded ? '#a77a6c' : '#d6333f', u * 0.025);
  c.fillStyle = '#e9c46a';
  c.fillRect(lx - u * 0.1, y + u * 0.55, u * 0.2, u * 0.04);
  c.fillRect(lx - u * 0.1, y + u * 0.98, u * 0.2, u * 0.04);
}

function teapot(c: Ctx, x: number, y: number, s: number): void {
  c.beginPath();
  c.ellipse(x, y - s * 0.35, s * 0.42, s * 0.33, 0, 0, Math.PI * 2);
  fe(c, '#e6dccb', s * 0.06, '#8a7c6f');
  line(c, x + s * 0.38, y - s * 0.4, x + s * 0.65, y - s * 0.6, '#8a7c6f', s * 0.1);
  disc(c, x, y - s * 0.7, s * 0.08, '#8a7c6f');
}

function chartPaper(c: Ctx, x: number, y: number, w: number, h: number, up: boolean, tilt: number): void {
  c.save();
  c.translate(x + w / 2, y + h / 2);
  c.rotate(tilt);
  box(c, -w / 2, -h / 2, w, h, w * 0.04, '#fffcf7', w * 0.03, '#b9aea2');
  c.strokeStyle = up ? '#5b8f3e' : '#de4f5a';
  c.lineWidth = w * 0.07;
  c.lineJoin = 'round';
  c.beginPath();
  for (let i = 0; i <= 4; i++) {
    const px = -w * 0.38 + (w * 0.76 * i) / 4;
    const py = (up ? 1 : -1) * (h * 0.28 - (h * 0.56 * i) / 4) + (i % 2 ? -1 : 1) * h * 0.08;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.stroke();
  c.fillStyle = 'rgba(233, 184, 114, 0.8)';
  c.fillRect(-w * 0.12, -h / 2 - w * 0.05, w * 0.24, w * 0.1);
  c.restore();
}

function starburst(c: Ctx, x: number, y: number, r: number, fill: string): void {
  c.beginPath();
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const rr2 = i % 2 === 0 ? r : r * 0.72;
    if (i === 0) c.moveTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
    else c.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2);
  }
  c.closePath();
  fe(c, fill, r * 0.08);
}

/** The "SANG NHƯỢNG" notice with a phone number, the classic red-on-white. */
function sangNhuong(c: Ctx, cx: number, cy: number, u: number, w: number): void {
  const h = u * 0.62;
  c.save();
  c.translate(cx, cy);
  c.rotate(0.04);
  box(c, -w / 2, -h / 2, w, h, u * 0.04, '#fffcf7', u * 0.03, '#c0323e');
  text(c, 'SANG NHƯỢNG', 0, -h * 0.14, u * 0.2, '#c0323e', { maxW: w * 0.9 });
  text(c, 'LH: 09xx xxx', 0, h * 0.24, u * 0.13, '#2a1d15', { weight: 600, maxW: w * 0.9 });
  c.restore();
}

/** A grand opening on a top-row shop: the red banner over the sign, two flower stands. */
function grandTop(c: Ctx, g: Geo, p: Palette): void {
  const u = g.u;
  // Over the sign where there is a wall above it (portrait), else along the awning.
  const y = g.signTop - g.y >= u * 0.5 ? g.signTop - u * 0.38 : g.awnTop + u * 0.06;
  box(c, g.x + u * 0.04, y, g.w - u * 0.08, u * 0.32, u * 0.04, '#c0323e', u * 0.03);
  text(c, 'KHAI TRƯƠNG', g.x + g.w / 2, y + u * 0.17, u * 0.2, '#ffd23f', { maxW: g.w * 0.85 });
  wreath(c, g.x + u * 0.15, g.ground, u * 1.1, p);
  wreath(c, g.x + g.w - u * 0.15, g.ground, u * 1.1, p);
}

/** A tall flower stand (kệ hoa khai trương). */
function wreath(c: Ctx, x: number, y: number, s: number, p: Palette): void {
  line(c, x - s * 0.12, y, x, y - s * 0.55, '#8a7c6f', s * 0.03);
  line(c, x + s * 0.12, y, x, y - s * 0.55, '#8a7c6f', s * 0.03);
  disc(c, x, y - s * 0.75, s * 0.24, '#5b8f3e', s * 0.02);
  const cols = [p.strawberry, '#ffd23f', '#f07ab4', '#fffcf7'];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    disc(c, x + Math.cos(a) * s * 0.17, y - s * 0.75 + Math.sin(a) * s * 0.17, s * 0.06, cols[i % 4], 0);
  }
  disc(c, x, y - s * 0.75, s * 0.08, '#ffd23f', 0);
  box(c, x - s * 0.05, y - s * 0.62, s * 0.1, s * 0.3, s * 0.02, '#c0323e', 0);
}

// ── Bottom row: static art ─────────────────────────────────────────────────────────────────────────────────────────

/** Floor, the front counter (seen from behind), the right edge's post and roof sign; or the shutter, the lot. */
function paintBottomBack(c: Ctx, g: Geo, l: ShopLook, p: Palette): void {
  const u = g.u;
  const { x, y, w, h, id } = g;
  if (l.base === 'lot') {
    lotBottom(c, g);
    return;
  }
  // The floor (dim behind a shutter: the lights are off).
  floor(c, g);
  if (l.base === 'shut') {
    c.fillStyle = 'rgba(42, 29, 21, 0.24)';
    c.fillRect(x, g.ctrBase, w, h - (g.ctrBase - y));
  }
  // Side walls, low: just a rim at the left and right edges.
  c.fillStyle = shade(wallOf(id), 0.9);
  c.fillRect(x, g.ctrBase, u * 0.08, h - (g.ctrBase - y));
  c.fillRect(x + w - u * 0.08, g.ctrBase, u * 0.08, h - (g.ctrBase - y));
  // The front counter: its top, and its face toward us (the staff side, with shelves).
  const cx0 = x + u * 0.05;
  const cw = w - u * 0.1;
  const closed = l.base === 'closed';
  const [topCol, faceCol] = counterCols(id);
  if (l.base === 'shut') {
    shutterSlats(c, x + u * 0.1, y - u * 1.5, w - u * 0.2, u * 1.5, u, '#c8c2b8');
    labelPaper(c, x + w * 0.42, y - u * 0.75, l.label ?? 'NGHỈ BÁN', u, l.label === 'ĐÓNG CỬA');
  }
  box(c, cx0, g.ctrTop, cw, g.ctrFace - g.ctrTop + u * 0.04, u * 0.06, topCol, u * 0.035);
  box(c, cx0, g.ctrFace, cw, g.ctrBase - g.ctrFace, u * 0.04, faceCol, u * 0.035);
  counterDetails(c, g, l, p);
  if (closed) {
    // A blue tarp thrown over the counter, roped down.
    c.fillStyle = '#4f86b8';
    poly(c, [cx0 - u * 0.04, g.ctrTop - u * 0.02, cx0 + cw + u * 0.04, g.ctrTop - u * 0.02, cx0 + cw + u * 0.08,
      g.ctrBase + u * 0.06, cx0 + cw * 0.6, g.ctrBase - u * 0.02, cx0 + cw * 0.3, g.ctrBase + u * 0.08, cx0 - u * 0.08,
      g.ctrBase]);
    fe(c, '#4f86b8', u * 0.03, '#2f5f8a');
    line(c, cx0 + cw * 0.25, g.ctrTop, cx0 + cw * 0.25, g.ctrBase, '#e9d9b6', u * 0.025);
    line(c, cx0 + cw * 0.7, g.ctrTop, cx0 + cw * 0.7, g.ctrBase, '#e9d9b6', u * 0.025);
  }
  roofSign(c, g, l, p);
  if (l.grand) {
    // A festive valance along the counter top: red with gold scallops and the words, no higher than the counter.
    const vw = g.zone0 - cx0 - u * 0.2;
    box(c, cx0, g.ctrTop - u * 0.02, vw, u * 0.2, u * 0.04, '#c0323e', u * 0.02, '#8a2028');
    c.fillStyle = '#ffd23f';
    for (let sx = cx0 + u * 0.1; sx < cx0 + vw - u * 0.05; sx += u * 0.2) {
      c.beginPath();
      c.arc(sx, g.ctrTop + u * 0.18, u * 0.05, 0, Math.PI);
      c.fill();
    }
    text(c, 'KHAI TRƯƠNG', cx0 + vw / 2, g.ctrTop + u * 0.08, u * 0.13, '#ffd23f', { maxW: vw - u * 0.2 });
  }
}

/** Nearest us: the back counter with the machines and the shop's name, the bits on the floor in front of the keeper. */
function paintBottomFront(c: Ctx, g: Geo, l: ShopLook, p: Palette): void {
  const u = g.u;
  const { x, y, w, h, id } = g;
  if (l.base === 'lot') return;
  const bt = g.backTop;
  const faceTop = bt + u * 0.26;
  const bottom = y + h;
  const [topCol, faceCol] = backCols(id);
  const closed = l.base === 'closed';
  // In a deep shop (portrait), things on the floor between the keeper and the back counter.
  if (bt - g.ownerY > u * 1.6) floorProps(c, g, l, p);
  // A grand opening's flower stand at the floor's left, clear of the price board and the keeper.
  if (l.grand) wreath(c, x + u * 0.35, bt + u * 0.04, Math.min(u * 1.1, bt - g.ctrBase - u * 0.05), p);
  // Things standing on the back counter (behind its face): machines, cups, a laptop, plants.
  backCounterTop(c, g, l);
  box(c, x + u * 0.04, bt, w - u * 0.08, faceTop - bt + u * 0.04, u * 0.05, topCol, u * 0.03);
  if (l.grand) {
    // The red banner strung along the back counter, gold letters, ribbons at its ends.
    const by = bt - u * 0.36;
    line(c, x + u * 0.1, by - u * 0.04, x + w - u * 0.1, by - u * 0.04, '#8a7c6f', u * 0.02);
    box(c, x + u * 0.2, by, w - u * 0.4, u * 0.32, u * 0.04, '#c0323e', u * 0.025);
    text(c, 'KHAI TRƯƠNG', x + w / 2, by + u * 0.17, u * 0.21, '#ffd23f', { maxW: w - u * 0.6, font: DISPLAY });
    disc(c, x + u * 0.2, by + u * 0.16, u * 0.1, '#ffd23f', u * 0.02);
    disc(c, x + w - u * 0.2, by + u * 0.16, u * 0.1, '#ffd23f', u * 0.02);
  }
  box(c, x + u * 0.04, faceTop, w - u * 0.08, bottom - faceTop + u * 0.2, u * 0.05, closed ? shade(faceCol, 0.9) : faceCol, u * 0.035);
  nameOnBack(c, g, closed, p);
}

/** The middle of a deep shop's floor: supplies, a sleeping cat, the student's plans, the chain's polished logo. */
function floorProps(c: Ctx, g: Geo, l: ShopLook, p: Palette): void {
  const u = g.u;
  const { x, w, id } = g;
  const y0 = g.ownerY + u * 0.35;
  const y1 = g.backTop - u * 0.1;
  const mid = (y0 + y1) / 2;
  if (l.base === 'closed') {
    // Boxes left behind, a broom.
    box(c, x + w * 0.2, mid, u * 0.5, u * 0.4, u * 0.03, '#c8995e', u * 0.025);
    box(c, x + w * 0.3, mid - u * 0.3, u * 0.4, u * 0.32, u * 0.03, '#b98a52', u * 0.025);
    line(c, x + w * 0.7, mid + u * 0.5, x + w * 0.62, mid - u * 0.4, '#8a5a36', u * 0.04);
    return;
  }
  switch (id) {
    case 'player': {
      // Sacks of tea and tapioca, a crate of cups, the cat asleep on a cushion, a welcome chalkboard.
      for (let i = 0; i < 2; i++) {
        const sx = x + u * 0.35 + i * u * 0.42;
        c.beginPath();
        c.moveTo(sx - u * 0.18, mid + u * 0.45);
        c.quadraticCurveTo(sx - u * 0.24, mid, sx - u * 0.1, mid - u * 0.2);
        c.lineTo(sx + u * 0.1, mid - u * 0.2);
        c.quadraticCurveTo(sx + u * 0.24, mid, sx + u * 0.18, mid + u * 0.45);
        c.closePath();
        fe(c, i === 0 ? '#e9d3a8' : '#d9c29a', u * 0.03);
        text(c, i === 0 ? 'TRÀ' : 'TC', sx, mid + u * 0.15, u * 0.13, '#8a5a36');
      }
      box(c, x + u * 0.25, mid + u * 0.5, u * 0.7, u * 0.32, u * 0.04, '#f3a6ad', u * 0.025);
      for (let k = 0; k < 4; k++) disc(c, x + u * 0.38 + k * u * 0.15, mid + u * 0.55, u * 0.06, '#fffcf7', u * 0.015, '#c9b8a6');
      // Cushion and cat.
      const cx = x + w - u * 0.75;
      const cy = mid + u * 0.55;
      oval(c, cx, cy, u * 0.38, u * 0.16, '#f07ab4');
      oval(c, cx, cy - u * 0.04, u * 0.3, u * 0.12, '#f7a3cc');
      c.beginPath();
      c.ellipse(cx, cy - u * 0.12, u * 0.22, u * 0.13, 0, 0, Math.PI * 2);
      fe(c, '#e9a15a', u * 0.025, '#b9733a');
      disc(c, cx + u * 0.15, cy - u * 0.16, u * 0.09, '#e9a15a', u * 0.02, '#b9733a');
      poly(c, [cx + u * 0.1, cy - u * 0.22, cx + u * 0.12, cy - u * 0.3, cx + u * 0.16, cy - u * 0.24]);
      fe(c, '#e9a15a', u * 0.015, '#b9733a');
      line(c, cx + u * 0.12, cy - u * 0.15, cx + u * 0.18, cy - u * 0.15, '#7a4a2a', u * 0.015);
      c.strokeStyle = '#b9733a';
      c.lineWidth = u * 0.05;
      c.beginPath();
      c.arc(cx - u * 0.05, cy - u * 0.05, u * 0.2, Math.PI * 0.5, Math.PI * 1.1);
      c.stroke();
      text(c, 'z', cx + u * 0.3, cy - u * 0.4, u * 0.14, 'rgba(110, 91, 77, 0.8)');
      // A chalkboard leaning on the side wall.
      box(c, x + w - u * 0.6, mid - u * 0.45, u * 0.5, u * 0.55, u * 0.04, '#2f3a32', u * 0.04, '#8a5a36');
      text(c, 'Chào', x + w - u * 0.35, mid - u * 0.28, u * 0.12, '#fffcf7', { weight: 600 });
      text(c, 'bạn!', x + w - u * 0.35, mid - u * 0.12, u * 0.12, '#f7a3cc', { weight: 600 });
      break;
    }
    case 'sinhvien': {
      // A whiteboard of big plans on an easel, a guitar, a stack of instant-noodle boxes, a beanbag.
      const bx = x + u * 0.3;
      line(c, bx + u * 0.1, mid + u * 0.6, bx + u * 0.3, mid - u * 0.4, '#8a7c6f', u * 0.03);
      line(c, bx + u * 0.8, mid + u * 0.6, bx + u * 0.6, mid - u * 0.4, '#8a7c6f', u * 0.03);
      box(c, bx, mid - u * 0.55, u * 0.9, u * 0.62, u * 0.03, '#fffcf7', u * 0.03, '#9aa6b5');
      text(c, 'KẾ HOẠCH', bx + u * 0.45, mid - u * 0.43, u * 0.1, '#2f6fb3');
      line(c, bx + u * 0.12, mid - u * 0.05, bx + u * 0.38, mid - u * 0.2, '#de4f5a', u * 0.03);
      line(c, bx + u * 0.38, mid - u * 0.2, bx + u * 0.52, mid - u * 0.12, '#de4f5a', u * 0.03);
      line(c, bx + u * 0.52, mid - u * 0.12, bx + u * 0.8, mid - u * 0.33, '#de4f5a', u * 0.03);
      text(c, '???', bx + u * 0.5, mid - u * 0.02, u * 0.1, '#2a1d15', { weight: 700 });
      oval(c, x + w - u * 0.7, mid + u * 0.55, u * 0.42, u * 0.24, '#f08a3a');
      oval(c, x + w - u * 0.7, mid + u * 0.48, u * 0.3, u * 0.14, '#f6a464');
      for (let i = 0; i < 3; i++) box(c, x + w - u * 0.95 + (i % 2) * u * 0.06, mid - u * 0.05 - i * u * 0.2, u * 0.5, u * 0.2, u * 0.02, i % 2 ? '#ffd23f' : '#de4f5a', u * 0.02);
      break;
    }
    case 'tapdoan': {
      // The chain's logo inlaid in the floor, and two sleek planters.
      const cx = x + w / 2;
      poly(c, [cx, mid - u * 0.35, cx + u * 0.6, mid, cx, mid + u * 0.35, cx - u * 0.6, mid]);
      fe(c, 'rgba(47, 52, 70, 0.14)', u * 0.03, 'rgba(47, 52, 70, 0.3)');
      for (const px of [x + u * 0.4, x + w - u * 0.4]) {
        box(c, px - u * 0.15, mid + u * 0.2, u * 0.3, u * 0.42, u * 0.06, '#2f3446', u * 0.02);
        c.beginPath();
        c.ellipse(px, mid - u * 0.15, u * 0.18, u * 0.42, 0, 0, Math.PI * 2);
        fe(c, '#4f7f36', u * 0.025);
      }
      break;
    }
    default:
      break;
  }
}

function counterCols(id: ShopId): [string, string] {
  switch (id) {
    case 'sinhvien': return ['#d2a86f', '#c8995e'];
    case 'player': return ['#f6e7d2', '#f3a6ad'];
    case 'tapdoan': return ['#f4f6f9', '#d9dee6'];
    default: return ['#f6e7d2', '#e8cfa8'];
  }
}

function backCols(id: ShopId): [string, string] {
  switch (id) {
    case 'sinhvien': return ['#d2a86f', '#c8995e'];
    case 'player': return ['#fffcf7', '#de4f5a'];
    case 'tapdoan': return ['#eef1f5', '#2f3446'];
    default: return ['#f6e7d2', '#e8cfa8'];
  }
}

function floor(c: Ctx, g: Geo): void {
  const u = g.u;
  const { x, y, w, h, id } = g;
  const y0 = g.ctrBase - u * 0.02;
  const fh = y + h - y0;
  if (id === 'player') {
    // Cream and pink checks.
    c.fillStyle = '#fff4ec';
    c.fillRect(x, y0, w, fh);
    const t = u * 0.4;
    c.fillStyle = '#f9d5d8';
    for (let r = 0; r * t < fh; r++) {
      for (let k = r % 2; k * t < w; k += 2) c.fillRect(x + k * t, y0 + r * t, Math.min(t, w - k * t), Math.min(t, fh - r * t));
    }
  } else if (id === 'tapdoan') {
    // White marble with grey veins and a glossy sheen.
    c.fillStyle = '#f2f3f5';
    c.fillRect(x, y0, w, fh);
    c.strokeStyle = 'rgba(140, 150, 165, 0.35)';
    c.lineWidth = u * 0.02;
    c.beginPath();
    for (let i = 0; i < 5; i++) {
      const vx = x + w * hash01(i + 900);
      c.moveTo(vx, y0);
      c.quadraticCurveTo(vx + u * 0.4, y0 + fh * 0.5, vx - u * 0.2, y0 + fh);
    }
    c.stroke();
    c.strokeStyle = 'rgba(160, 170, 185, 0.4)';
    c.beginPath();
    for (let xx = x; xx < x + w; xx += u * 0.8) {
      c.moveTo(xx, y0);
      c.lineTo(xx, y0 + fh);
    }
    c.stroke();
    c.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 0; i < 3; i++) {
      const sx = x + w * (0.2 + i * 0.3);
      poly(c, [sx, y0 + fh, sx + u * 0.15, y0 + fh, sx + u * 0.55, y0, sx + u * 0.4, y0]);
      c.fill();
    }
  } else if (id === 'sinhvien') {
    // Bare concrete with a crack and a rug.
    c.fillStyle = '#d6cbbb';
    c.fillRect(x, y0, w, fh);
    line(c, x + w * 0.2, y0 + fh * 0.3, x + w * 0.32, y0 + fh * 0.55, 'rgba(90, 80, 70, 0.3)', u * 0.02);
    line(c, x + w * 0.32, y0 + fh * 0.55, x + w * 0.28, y0 + fh * 0.7, 'rgba(90, 80, 70, 0.3)', u * 0.02);
    box(c, x + w * 0.12, y0 + fh * 0.22, w * 0.42, u * 0.5, u * 0.08, '#7fb8e0', 0);
    c.strokeStyle = '#fffcf7';
    c.lineWidth = u * 0.03;
    c.setLineDash([u * 0.08, u * 0.06]);
    c.strokeRect(x + w * 0.12 + u * 0.06, y0 + fh * 0.22 + u * 0.06, w * 0.42 - u * 0.12, u * 0.38);
    c.setLineDash([]);
  } else {
    c.fillStyle = '#ead9c0';
    c.fillRect(x, y0, w, fh);
  }
  // The counter's shadow on the floor.
  c.fillStyle = 'rgba(42, 29, 21, 0.1)';
  c.fillRect(x, y0, w, u * 0.18);
}

/** What sits on and against the front counter: register, cups, sealer — kept low (below counter top) along the queue. */
function counterDetails(c: Ctx, g: Geo, l: ShopLook, p: Palette): void {
  const u = g.u;
  const id = g.id;
  const face = g.ctrFace;
  // Shelves on the staff side: cup stacks and bottles, under the counter top (bare when sold out).
  if (l.empty) {
    c.fillStyle = 'rgba(60, 50, 45, 0.2)';
    c.fillRect(g.x + u * 0.05, face, g.w - u * 0.1, g.ctrBase - face);
    return;
  }
  const n = Math.max(2, Math.floor((g.zone0 - g.x) / (u * 0.4)));
  for (let i = 0; i < n; i++) {
    const sx = g.x + u * 0.22 + i * u * 0.4;
    if (sx > g.x + g.w - u * 0.3) break;
    if (id === 'sinhvien') {
      // Taped boxes.
      box(c, sx - u * 0.05, face + u * 0.05, u * 0.34, u * 0.36, u * 0.02, '#b98a52', u * 0.02);
      line(c, sx - u * 0.05, face + u * 0.05, sx + u * 0.29, face + u * 0.41, 'rgba(240, 220, 170, 0.8)', u * 0.04);
      if (i % 2 === 0) box(c, sx + u * 0.05, face + u * 0.1, u * 0.14, u * 0.12, u * 0.01, i % 4 ? '#ffd23f' : '#f07ab4', 0);
    } else if (id === 'tapdoan') {
      box(c, sx - u * 0.04, face + u * 0.08, u * 0.3, u * 0.3, u * 0.03, '#c6ccd6', u * 0.015, '#9aa6b5');
    } else {
      // Stacks of cups.
      for (let k = 0; k < 3; k++) box(c, sx + k * u * 0.09, face + u * 0.1, u * 0.08, u * 0.26, u * 0.02, '#fffcf7', u * 0.012, '#c9b8a6');
    }
  }
  if (id === 'player' && l.base === 'open') {
    // A strawberry stripe along the counter top, and a little heart sticker.
    c.fillStyle = p.strawberry;
    c.fillRect(g.x + u * 0.05, g.ctrFace - u * 0.03, g.w - u * 0.1, u * 0.05);
  }
  if (id === 'tapdoan') {
    // The glass display along the counter top and its LED strip.
    c.fillStyle = 'rgba(180, 220, 240, 0.55)';
    c.fillRect(g.x + u * 0.05, g.ctrTop + u * 0.03, g.w - u * 0.1, u * 0.12);
    c.fillStyle = '#7fd3ff';
    c.fillRect(g.x + u * 0.05, g.ctrFace - u * 0.02, g.w - u * 0.1, u * 0.03);
  }
}

/** The double-sided sign at the right edge, on its post (bottom row): name, logo; or "SANG NHƯỢNG". */
function roofSign(c: Ctx, g: Geo, l: ShopLook, p: Palette): void {
  const u = g.u;
  const id = g.id;
  const x0 = g.zone0;
  const x1 = g.zone1;
  const wide = x1 - x0 > u * 0.9;
  const cx = (x0 + x1) / 2;
  const top = g.y - u * (wide ? 1.9 : 2.1);
  const bottom = g.y - u * (wide ? 1.05 : 0.8);
  if (id === 'tapdoan' && l.base !== 'closed') {
    const t = totemRect(g);
    box(c, t.x, t.y, t.w, t.h, u * 0.04, '#cfd8e2', u * 0.03, '#8f9aa8');
    c.fillStyle = 'rgba(255, 255, 255, 0.45)';
    c.fillRect(t.x + u * 0.05, t.y + u * 0.05, t.w * 0.18, t.h - u * 0.1);
    // The logo: a faceted diamond.
    const lx = t.x + t.w / 2;
    const ly = t.y + u * 0.4;
    poly(c, [lx, ly - u * 0.24, lx + u * 0.2, ly, lx, ly + u * 0.24, lx - u * 0.2, ly]);
    fe(c, '#2f3446', 0);
    poly(c, [lx, ly - u * 0.24, lx + u * 0.2, ly, lx, ly]);
    fe(c, '#56607a', 0);
    if (t.w > u * 0.55) text(c, 'TẬP ĐOÀN', lx, ly + u * 0.48, u * 0.14, '#2f3446', { maxW: t.w * 0.9 });
    else {
      text(c, 'TẬP', lx, ly + u * 0.48, u * 0.13, '#2f3446', { maxW: t.w * 0.9 });
      text(c, 'ĐOÀN', lx, ly + u * 0.66, u * 0.13, '#2f3446', { maxW: t.w * 0.9 });
    }
    return;
  }
  // Posts.
  const postCol = id === 'sinhvien' ? '#c9b26a' : '#8a7c6f';
  if (wide) {
    line(c, x0 + u * 0.15, bottom, x0 + u * 0.15, g.ctrBase + u * 0.1, postCol, u * 0.07);
    line(c, x1 - u * 0.15, bottom, x1 - u * 0.15, g.ctrBase + u * 0.1, postCol, u * 0.07);
  } else {
    line(c, cx, bottom, cx, g.ctrBase + u * 0.1, postCol, u * 0.07);
  }
  if (id === 'sinhvien') {
    // Bamboo joints.
    for (let yy = bottom + u * 0.3; yy < g.ctrBase; yy += u * 0.35) line(c, (wide ? x0 + u * 0.15 : cx) - u * 0.05, yy, (wide ? x0 + u * 0.15 : cx) + u * 0.05, yy, '#8f7a3a', u * 0.03);
  }
  const sw = x1 - x0;
  const sh = bottom - top;
  if (l.base === 'closed') {
    sangNhuong(c, cx, (top + bottom) / 2, u * (wide ? 1 : 0.8), Math.max(sw, u * 0.9));
    return;
  }
  if (id === 'sinhvien') {
    // A hand-cut cardboard sign, a little crooked, marker letters.
    c.save();
    c.translate(cx, (top + bottom) / 2);
    c.rotate(-0.06);
    poly(c, [-sw / 2, -sh / 2 + u * 0.04, sw / 2 - u * 0.03, -sh / 2, sw / 2, sh / 2 - u * 0.05, -sw / 2 + u * 0.05, sh / 2]);
    fe(c, '#d9b27c', u * 0.03, '#a8804e');
    if (wide) {
      text(c, 'TRÀ SỮA SV', 0, -sh * 0.12, u * 0.24, '#2a1d15', { maxW: sw * 0.85, weight: 800 });
      text(c, 'mới mở nè!', 0, sh * 0.22, u * 0.15, '#c0323e', { maxW: sw * 0.85, weight: 600 });
    } else {
      text(c, 'SV', 0, -sh * 0.1, u * 0.26, '#2a1d15', { maxW: sw * 0.85 });
      text(c, '!!', 0, sh * 0.22, u * 0.2, '#c0323e', { maxW: sw * 0.85 });
    }
    c.restore();
    return;
  }
  // The player: a cream sign framed in strawberry, a boba cup and a heart.
  box(c, x0, top, sw, sh, u * 0.12, '#fffcf7', u * 0.06, p.strawberry);
  if (wide) {
    cupIcon(c, x0 + u * 0.35, top + sh * 0.55, u * 0.42, p);
    text(c, 'Quán bạn', x0 + u * 0.62 + (sw - u * 0.62) / 2, top + sh * 0.5, u * 0.28, p.strawberryDeep,
      { maxW: sw - u * 0.8, font: DISPLAY });
  } else {
    cupIcon(c, cx, top + sh * 0.38, u * 0.4, p);
    heartShape(c, cx, top + sh * 0.78, u * 0.22, p.strawberry);
  }
}

function cupIcon(c: Ctx, x: number, y: number, s: number, p: Palette): void {
  poly(c, [x - s * 0.3, y - s * 0.32, x + s * 0.3, y - s * 0.32, x + s * 0.22, y + s * 0.42, x - s * 0.22, y + s * 0.42]);
  fe(c, p.tea, s * 0.06, p.caramelDeep);
  for (let i = 0; i < 3; i++) disc(c, x - s * 0.12 + i * s * 0.12, y + s * 0.28, s * 0.06, p.boba, 0);
  box(c, x - s * 0.34, y - s * 0.42, s * 0.68, s * 0.12, s * 0.04, '#fffcf7', s * 0.04, '#c9b8a6');
  line(c, x + s * 0.06, y - s * 0.42, x + s * 0.16, y - s * 0.72, p.strawberry, s * 0.08);
}

function heartShape(c: Ctx, x: number, y: number, s: number, col: string): void {
  c.beginPath();
  c.moveTo(x, y + s * 0.42);
  c.bezierCurveTo(x - s * 0.62, y - s * 0.02, x - s * 0.42, y - s * 0.62, x, y - s * 0.24);
  c.bezierCurveTo(x + s * 0.42, y - s * 0.62, x + s * 0.62, y - s * 0.02, x, y + s * 0.42);
  fe(c, col, s * 0.08);
}

/** On the back counter: each shop's machines and odds and ends. */
function backCounterTop(c: Ctx, g: Geo, l: ShopLook): void {
  const u = g.u;
  const { x, w, id } = g;
  const bt = g.backTop + u * 0.12;
  if (l.base === 'closed') {
    // Stools stacked upside down.
    for (let i = 0; i < 2; i++) {
      const sx = x + w * (0.25 + i * 0.4);
      box(c, sx - u * 0.18, bt - u * 0.42, u * 0.36, u * 0.08, u * 0.03, '#de4f5a', u * 0.02);
      line(c, sx - u * 0.14, bt - u * 0.36, sx - u * 0.17, bt - u * 0.1, '#a8323c', u * 0.04);
      line(c, sx + u * 0.14, bt - u * 0.36, sx + u * 0.17, bt - u * 0.1, '#a8323c', u * 0.04);
    }
    return;
  }
  if (l.base === 'shut') return;
  switch (id) {
    case 'player': {
      // Three tea urns, a sealer, a cup stack, a plant at each end, fairy lights along the front.
      for (let i = 0; i < 3; i++) {
        const ux = x + w * 0.3 + i * u * 0.36;
        box(c, ux, bt - u * 0.45, u * 0.28, u * 0.46, u * 0.08, '#dfe4e8', u * 0.025, '#8f9aa3');
        disc(c, ux + u * 0.14, bt - u * 0.2, u * 0.05, ['#c8945e', '#9dbb6e', '#b49ad1'][i], 0);
      }
      box(c, x + w * 0.3 + u * 1.12, bt - u * 0.32, u * 0.3, u * 0.33, u * 0.05, '#f3a6ad', u * 0.025);
      plant(c, x + u * 0.32, bt, u * 0.6, '#de4f5a', '#5b8f3e');
      plant(c, x + w - u * 0.32, bt, u * 0.55, '#fffcf7', '#66a046');
      bulbs(c, x + u * 0.1, g.backTop + u * 0.2, x + w - u * 0.1, g.backTop + u * 0.2, u * 0.08, 9, u,
        ['#ffd23f', '#f07ab4', '#7fb8e0', '#9ff0a6']);
      break;
    }
    case 'sinhvien': {
      // A laptop with stickers, a plastic crate, a speaker.
      box(c, x + w * 0.22, bt - u * 0.34, u * 0.52, u * 0.34, u * 0.04, '#b8bec6', u * 0.025, '#7d848c');
      disc(c, x + w * 0.22 + u * 0.16, bt - u * 0.2, u * 0.05, '#f07ab4', 0);
      disc(c, x + w * 0.22 + u * 0.34, bt - u * 0.12, u * 0.04, '#ffd23f', 0);
      box(c, x + w * 0.62, bt - u * 0.36, u * 0.5, u * 0.36, u * 0.04, '#3e8fd0', u * 0.025);
      c.strokeStyle = 'rgba(255,255,255,0.5)';
      c.lineWidth = u * 0.025;
      c.beginPath();
      for (let k = 1; k < 4; k++) {
        c.moveTo(x + w * 0.62 + k * u * 0.125, bt - u * 0.32);
        c.lineTo(x + w * 0.62 + k * u * 0.125, bt - u * 0.04);
      }
      c.stroke();
      box(c, x + u * 0.2, bt - u * 0.3, u * 0.22, u * 0.3, u * 0.04, '#2a2f3a', u * 0.02);
      disc(c, x + u * 0.31, bt - u * 0.17, u * 0.07, '#6e7480', 0);
      break;
    }
    case 'tapdoan': {
      // A row of identical machines and a menu screen.
      const n = Math.max(3, Math.floor((w - u * 0.6) / (u * 0.45)));
      for (let i = 0; i < n; i++) {
        const mx = x + u * 0.3 + i * u * 0.45;
        box(c, mx, bt - u * 0.42, u * 0.34, u * 0.42, u * 0.05, '#e9edf2', u * 0.02, '#9aa6b5');
        c.fillStyle = '#7fd3ff';
        c.fillRect(mx + u * 0.08, bt - u * 0.34, u * 0.18, u * 0.05);
      }
      break;
    }
    default:
      break;
  }
}

function nameOnBack(c: Ctx, g: Geo, closed: boolean, p: Palette): void {
  const u = g.u;
  const { x, w, id } = g;
  const cy = (g.backTop + u * 0.26 + g.y + g.h) / 2;
  const size = Math.min(u * 0.34, (g.y + g.h - g.backTop) * 0.4);
  switch (id) {
    case 'player':
      heartShape(c, x + w / 2 - Math.min(w * 0.36, u * 1.4), cy, size * 0.8, '#fffcf7');
      heartShape(c, x + w / 2 + Math.min(w * 0.36, u * 1.4), cy, size * 0.8, '#fffcf7');
      text(c, 'QUÁN BẠN', x + w / 2, cy, size, '#fffcf7', { maxW: w * 0.6, font: DISPLAY });
      break;
    case 'sinhvien':
      text(c, 'SINH VIÊN KHỞI NGHIỆP', x + w / 2, cy, size * 0.62, closed ? '#8a7360' : '#4a3a2c',
        { maxW: w * 0.88, weight: 800 });
      break;
    case 'tapdoan':
      text(c, 'CHUỖI TẬP ĐOÀN', x + w / 2, cy, size * 0.66, '#eef1f5', { maxW: w * 0.85, weight: 700 });
      c.fillStyle = '#7fd3ff';
      c.fillRect(x + u * 0.04, g.backTop + u * 0.26, w - u * 0.08, u * 0.03);
      break;
    default:
      text(c, STYLE[id].name, x + w / 2, cy, size * 0.66, '#4a3a2c', { maxW: w * 0.85 });
  }
}

/** Tập Đoàn before it opens (day 1): a fenced lot with the big "SẮP KHAI TRƯƠNG" hoarding. */
function lotBottom(c: Ctx, g: Geo): void {
  const u = g.u;
  const { x, y, w, h } = g;
  // Bare earth with tyre tracks and a sand pile.
  c.fillStyle = '#d8c3a0';
  c.fillRect(x, y, w, h);
  c.strokeStyle = 'rgba(122, 88, 60, 0.18)';
  c.lineWidth = u * 0.06;
  c.setLineDash([u * 0.1, u * 0.08]);
  c.beginPath();
  c.moveTo(x + w * 0.2, y + h);
  c.quadraticCurveTo(x + w * 0.35, y + h * 0.5, x + w * 0.3, y + u * 0.2);
  c.moveTo(x + w * 0.35, y + h);
  c.quadraticCurveTo(x + w * 0.5, y + h * 0.5, x + w * 0.45, y + u * 0.2);
  c.stroke();
  c.setLineDash([]);
  c.beginPath();
  c.ellipse(x + w * 0.7, y + h * 0.55, u * 0.6, u * 0.32, 0, Math.PI, 0);
  c.closePath();
  fe(c, '#e6c98f', u * 0.03);
  // Low tape and cones along the street edge (no taller than a counter).
  for (let k = 0; k < 3; k++) {
    const cx = x + u * 0.3 + k * (w - u * 0.6) / 2;
    poly(c, [cx - u * 0.12, y, cx + u * 0.12, y, cx + u * 0.03, y - u * 0.4, cx - u * 0.03, y - u * 0.4]);
    fe(c, '#f08a3a', u * 0.02);
    c.fillStyle = '#fffcf7';
    c.fillRect(cx - u * 0.08, y - u * 0.22, u * 0.16, u * 0.06);
  }
  line(c, x + u * 0.3, y - u * 0.3, x + w - u * 0.3, y - u * 0.3, '#ffd23f', u * 0.04);
  // The hoarding nearest us, along the bottom: "SẮP KHAI TRƯƠNG".
  const hy = y + h - u * 0.9;
  box(c, x + u * 0.06, hy, w - u * 0.12, u * 0.9, u * 0.05, '#2f3446', u * 0.03);
  text(c, 'SẮP KHAI TRƯƠNG', x + w / 2, hy + u * 0.3, u * 0.26, '#ffd23f', { maxW: w * 0.85, font: DISPLAY });
  text(c, 'CHUỖI TẬP ĐOÀN', x + w / 2, hy + u * 0.64, u * 0.17, '#eef1f5', { maxW: w * 0.85 });
  // A tall billboard at the right edge.
  const bx = g.zone0;
  const bw = g.zone1 - bx;
  line(c, bx + bw / 2, y - u * 0.9, bx + bw / 2, y + u * 0.3, '#6e665c', u * 0.07);
  box(c, bx, y - u * 2.0, bw, u * 1.1, u * 0.05, '#ffd23f', u * 0.035, '#c9952a');
  text(c, 'SẮP', bx + bw / 2, y - u * 1.65, u * 0.24, '#2f3446', { maxW: bw * 0.9, font: DISPLAY });
  text(c, 'MỞ', bx + bw / 2, y - u * 1.25, u * 0.24, '#2f3446', { maxW: bw * 0.9, font: DISPLAY });
}
