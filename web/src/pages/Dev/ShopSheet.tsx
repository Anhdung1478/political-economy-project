// /dev/scene?sheet=shops (dev builds only): every shop in every state side by side, at the street's own geometry, with
// ghost silhouettes where its queue stands (to check the bottom row's art rule: nothing over the queue). Rows are the
// states, columns the seven shops.
//   /dev/scene?sheet=shops&layout=portrait|landscape&zoom=1.6&states=open,busy,idle&t=MS&reduced=1
// `t` freezes the wall clock (for shots); `states` picks rows (default all).
import { useEffect, useRef } from 'react';
import { STREET } from '../../../../shared/sim/shops';
import type { ShopId, ShopStatus } from '../../../../shared/sim/types';
import type { Director, ShopView } from '../../scene/director';
import { drawShopWith, type ShopLook } from '../../scene/draw/shops';
import { LANDSCAPE, PORTRAIT, queuePoint, type ShopSlot, type StreetLayout } from '../../scene/layout';
import { readPalette, type RenderContext } from '../../scene/Scene';
import { SpriteCache, watchFonts } from '../../scene/sprites';

interface StateRow {
  id: string;
  label: string;
  view: Partial<ShopView>;
  queue: number;
  tweak?: (l: ShopLook) => void;
  /** Only for these shops. */
  only?: ShopId[];
}

const NOW = 500;

const ROWS: StateRow[] = [
  { id: 'open', label: 'Đang mở', view: { lastSaleAt: NOW - 4 }, queue: 2 },
  { id: 'busy', label: 'Đông — lau mồ hôi', view: {}, queue: 5, tweak: l => { l.owner = 'sweat'; l.ownerK = 0.45; } },
  { id: 'idle', label: 'Ế — ngáp', view: {}, queue: 0, tweak: l => { l.owner = 'yawn'; l.ownerK = 0.5; } },
  { id: 'soldOut', label: 'Hết hàng', view: { status: 'soldOut', statusSince: NOW - 40 }, queue: 0 },
  { id: 'flip', label: 'Lật biển (giữa chừng)', view: { status: 'soldOut', statusSince: NOW - 2.5 }, queue: 0 },
  { id: 'price', label: 'Bảng giá lật số', view: { prevPrice: 25, priceSince: NOW - 2 }, queue: 1 },
  { id: 'priceDone', label: 'Vừa đổi giá', view: { prevPrice: 31, priceSince: NOW - 10 }, queue: 1 },
  { id: 'rolling', label: 'Kéo cửa cuốn', view: { status: 'resting', statusSince: NOW - 6 }, queue: 0 },
  { id: 'resting', label: 'Nghỉ bán', view: { status: 'resting' }, queue: 0 },
  { id: 'closedEarly', label: 'Đóng cửa sớm', view: { status: 'closedEarly' }, queue: 0 },
  { id: 'closed', label: 'Sang nhượng', view: { status: 'closed' }, queue: 0 },
  { id: 'grand', label: 'Khai trương', view: { grandOpening: true }, queue: 3 },
  { id: 'certified', label: 'Đã kiểm định', view: { certified: true }, queue: 2 },
  { id: 'pop', label: 'Huy hiệu bật lên', view: { certified: true, badgeSince: NOW - 4 }, queue: 1 },
  { id: 'named', label: 'Bị nêu tên', view: { named: true, rumor: true }, queue: 0 },
  { id: 'rumor', label: 'Tin đồn', view: { rumor: true }, queue: 1 },
  { id: 'notYet', label: 'Chưa mở', view: { status: 'notYet' as ShopStatus, price: 0 }, queue: 0 },
];

const PRICES: Record<ShopId, number> = { batu: 30, giare: 28, cochap: 28, luotsong: 32, sinhvien: 34, player: 29, tapdoan: 24 };

function viewFor(id: ShopId, row: StateRow): ShopView {
  return {
    id, status: 'open', statusSince: -Infinity, grandOpening: false, price: PRICES[id], prevPrice: null,
    priceSince: -Infinity, certified: false, named: false, badgeSince: -Infinity, rumor: false,
    queue: Array.from({ length: row.queue }, (_, i) => i), shown: row.queue, overflow: 0, sold: 3,
    lastSaleAt: -Infinity, busyUntil: -Infinity, ...row.view,
  };
}

interface Cell { slot: ShopSlot; v: ShopView; row: StateRow; x: number; y: number }

function cellsFor(L: StreetLayout, rows: StateRow[]): { cells: Cell[]; w: number; h: number; cw: number; ch: number } {
  const u = L.actorH;
  const cw = (L.kind === 'portrait' ? 124 : 214) + u * 0.4;
  const ch = L.kind === 'portrait' ? 330 : 240;
  const cells: Cell[] = [];
  rows.forEach((row, r) => {
    STREET.forEach((id, c) => {
      const base = L.shops.find(s => s.id === id) as ShopSlot;
      const x = c * cw;
      const y = r * ch + 18;
      const top = base.row === 'top';
      const rect = { x: x + (cw - base.rect.w) / 2, y: top ? y + u * 0.7 : y + u * 2.8, w: base.rect.w, h: base.rect.h };
      const dx = rect.x - base.rect.x;
      const dy = rect.y - base.rect.y;
      const slot: ShopSlot = {
        ...base, rect, counter: { x: base.counter.x + dx, y: base.counter.y + dy },
        board: { x: base.board.x + dx, y: base.board.y + dy }, depth: base.depth + dy,
      };
      const v = viewFor(id, row);
      if (row.only !== undefined && !row.only.includes(id)) return;
      cells.push({ slot, v, row, x, y });
    });
  });
  return { cells, w: STREET.length * cw, h: rows.length * ch + 18, cw, ch };
}

/** A grey ghost of a person standing at queue place i (feet at p), to see what covers whom. */
function ghost(ctx: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  ctx.fillStyle = 'rgba(70, 90, 120, 0.28)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x - u * 0.17, y - u, u * 0.34, u, u * 0.15);
  else ctx.rect(x - u * 0.17, y - u, u * 0.34, u);
  ctx.fill();
}

export default function ShopSheet() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const L = q.get('layout') === 'landscape' ? LANDSCAPE : PORTRAIT;
    const zoom = Math.min(4, Math.max(0.5, Number(q.get('zoom') ?? 1.6) || 1.6));
    const pick = q.get('states')?.split(',');
    const rows = pick === undefined ? ROWS : ROWS.filter(r => pick.includes(r.id));
    const frozen = q.has('t') ? Number(q.get('t')) : null;
    const reduced = q.get('reduced') === '1';
    const el = canvas.current;
    if (el === null) return;
    const { cells, w, h } = cellsFor(L, rows);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = Math.round(w * zoom * dpr);
    el.height = Math.round(h * zoom * dpr);
    el.style.width = `${w * zoom}px`;
    el.style.height = `${h * zoom}px`;
    const ctx = el.getContext('2d');
    if (ctx === null) return;
    const k = zoom * dpr;
    const store = new Map<string, unknown>();
    const sprites = new SpriteCache();
    watchFonts();
    const palette = readPalette();
    let raf = 0;
    let last = performance.now();
    const u = L.actorH;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const wall = frozen ?? now;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.fillStyle = '#f3e6d3';
      ctx.fillRect(0, 0, w, h);
      const rc: RenderContext = {
        ctx, director: null as unknown as Director, layout: L, view: { x: 0, y: 0, w, h }, now: NOW, wall, sprites,
        dt: now - last, pxPerUnit: k, grid: { k, devX: 0, devY: 0 }, timeOfDay: 'noon', reducedMotion: reduced,
        palette, seed: 0, speech: false, bubbles: [], cues: [], store,
      };
      last = now;
      let lastRow: StateRow | null = null;
      for (const c of cells) {
        if (c.row !== lastRow) {
          lastRow = c.row;
          ctx.fillStyle = '#2a1d15';
          ctx.font = `700 ${11}px "Be Vietnam Pro", system-ui, sans-serif`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(c.row.label, 4, c.y - 15);
        }
        // The sidewalk the queue stands on.
        const s = c.slot;
        const top = s.row === 'top';
        ctx.fillStyle = '#ecd6b8';
        ctx.fillRect(c.x + 2, top ? s.rect.y + s.rect.h : s.rect.y - u * 1.6, s.rect.w + u * 0.4, u * 1.6);
        const places = Array.from({ length: Math.max(c.v.queue.length, top ? 0 : 5) }, (_, i) => queuePoint(L, s, i));
        if (!top) for (const p of places) ghost(ctx, p.x, p.y, u);
        drawShopWith(rc, c.v, s, c.row.tweak);
        if (top) for (const p of places) ghost(ctx, p.x, p.y, u);
      }
    };
    raf = requestAnimationFrame(frame);
    el.dataset.ready = '1';
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ background: '#f3e6d3', minHeight: '100vh', overflow: 'auto' }}>
      <canvas ref={canvas} data-scene="" data-sheet="shops" style={{ display: 'block' }} />
    </div>
  );
}
