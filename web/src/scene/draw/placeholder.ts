// Placeholder speech bubbles (Task 14): short labels where Task 17's bubbles will go, at most three at once with the
// player's first, so the reason pipeline shows on the street. The street, shops and props are Task 16's
// (draw/street.ts, draw/shops.ts, draw/props.ts); Task 17 replaces this overlay through `registerRenderers`.
import type { BubbleTopic } from '../director';
import type { RenderContext } from '../Scene';
import { clamp } from '../tween';

const FONT = '"Be Vietnam Pro", system-ui, sans-serif';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
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

// ── Overlay: where bubbles will go (Task 17 words and draws them) ──────────────────────────────────────────────────

const SHORT: Record<BubbleTopic, string> = {
  tooExpensive: 'Đắt quá', tooCrowded: 'Đông quá', lowTrust: 'Không tin', outOfStock: 'Hết món', otherBetter: 'Bên kia hơn',
  steepDiscount: 'Giảm sốc?', chosePlayer: 'Giá ổn nè', patience: 'Lâu quá!', priceUp: 'Tăng giá?', shopClosed: 'Đóng à?',
  wrongCup: 'Sai món?', emptyHanded: 'Hết sạch…', rumor: 'Nghe đồn…',
};
const BUBBLE_TICKS = 18;
const MAX_BUBBLES = 3;

interface Shown { customer: number; topic: BubbleTopic; until: number; player: boolean }

export function drawBubbles(rc: RenderContext): void {
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
