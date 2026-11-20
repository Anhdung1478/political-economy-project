// The light of the hour over the whole street (spec §9 "Không khí phố": "sáng ấm, trưa gắt, chiều vàng, tối lên
// đèn"), drawn as the `lighting` overlay above everything: a warm low sun from the left in the morning, a harsh white
// glare from above at noon (the rush), a golden wash from the right in the afternoon, and at evening a blue dusk with
// the street lamps and the shop fronts glowing. The rush is at noon; Phase 3's morning and evening backgrounds pick
// the others (`Scene.setTimeOfDay`, `StreetCanvas timeOfDay`).
//
// `lightFor` is pure (tested); `drawLighting` paints it with cached gradients and, at evening, a glow sprite.
import type { Rect, StreetLayout } from './layout';
import { backTrees, houseWindows, poleLampY, poleXs, SIDE_CROWN_UP, sideTrees } from './draw/street';
import type { RenderContext } from './Scene';
import { blit, LAYER } from './sprites';

export type TimeOfDay = 'morning' | 'noon' | 'afternoon' | 'evening';
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['morning', 'noon', 'afternoon', 'evening'];

export interface Light {
  /** A wash over everything: colour, alpha and how it is laid on. */
  wash: { color: string; alpha: number; op: GlobalCompositeOperation } | null;
  /** A sunlit gradient from one side ('left', 'right') or from the top, strongest at its edge. */
  sun: { from: 'left' | 'right' | 'top'; color: string; alpha: number; reach: number } | null;
  /** Lamps and shop fronts glowing (0 none). */
  glow: number;
}

export function lightFor(t: TimeOfDay): Light {
  switch (t) {
    case 'morning':
      return {
        wash: { color: '255, 226, 196', alpha: 0.1, op: 'source-over' },
        sun: { from: 'left', color: '255, 200, 150', alpha: 0.26, reach: 0.75 },
        glow: 0,
      };
    case 'noon':
      return { wash: null, sun: { from: 'top', color: '255, 252, 238', alpha: 0.16, reach: 0.45 }, glow: 0 };
    case 'afternoon':
      return {
        wash: { color: '255, 196, 120', alpha: 0.3, op: 'multiply' },
        sun: { from: 'right', color: '255, 170, 80', alpha: 0.3, reach: 0.85 },
        glow: 0,
      };
    case 'evening':
      return { wash: { color: '62, 66, 132', alpha: 0.72, op: 'multiply' }, sun: null, glow: 1 };
  }
}

interface LightMemo { key: string; sun: CanvasGradient | null }


/** The `lighting` overlay. */
export function drawLighting(rc: RenderContext): void {
  const { ctx, view: v } = rc;
  const light = lightFor(rc.timeOfDay);
  if (light.wash !== null) {
    ctx.globalCompositeOperation = light.wash.op;
    ctx.fillStyle = `rgba(${light.wash.color}, ${light.wash.op === 'multiply' ? 1 : light.wash.alpha})`;
    if (light.wash.op === 'multiply') ctx.globalAlpha = light.wash.alpha;
    ctx.fillRect(v.x, v.y, v.w, v.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  if (light.sun !== null) {
    const key = `${rc.timeOfDay}|${v.x}|${v.y}|${v.w}|${v.h}`;
    let m = rc.store.get('lighting.memo') as LightMemo | undefined;
    if (m === undefined || m.key !== key) {
      const s = light.sun;
      const g = s.from === 'top' ? ctx.createLinearGradient(0, v.y, 0, v.y + v.h * s.reach)
        : s.from === 'left' ? ctx.createLinearGradient(v.x, 0, v.x + v.w * s.reach, 0)
          : ctx.createLinearGradient(v.x + v.w, 0, v.x + v.w * (1 - s.reach), 0);
      g.addColorStop(0, `rgba(${s.color}, ${s.alpha})`);
      g.addColorStop(1, `rgba(${s.color}, 0)`);
      m = { key, sun: g };
      rc.store.set('lighting.memo', m);
    }
    if (m.sun !== null) {
      // Only where the gradient reaches (the rest is transparent anyway).
      const s = light.sun;
      ctx.fillStyle = m.sun;
      if (s.from === 'top') ctx.fillRect(v.x, v.y, v.w, v.h * s.reach);
      else if (s.from === 'left') ctx.fillRect(v.x, v.y, v.w * s.reach, v.h);
      else ctx.fillRect(v.x + v.w * (1 - s.reach), v.y, v.w * s.reach, v.h);
    }
  }
  if (light.glow > 0) {
    const L = rc.layout;
    // Which shops are lit: the ones selling (a shut, closed or empty shop stays dark).
    let lit = 0;
    for (const sh of rc.director.shops) {
      if (sh.status === 'open' || sh.status === 'soldOut') lit |= 1 << (L.shops.findIndex(x => x.id === sh.id) + 1);
    }
    const s = rc.sprites.peek(L, LAYER.glow, v, rc.grid, lit)
      ?? rc.sprites.get(L, LAYER.glow, v, rc.grid, lit, c => paintGlows(c, L, v, lit));
    ctx.globalCompositeOperation = 'lighter';
    blit(ctx, s, rc.grid);
    ctx.globalCompositeOperation = 'source-over';
  }
}

function glowAt(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, a: number): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${color}, ${a})`);
  g.addColorStop(1, `rgba(${color}, 0)`);
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Which of the houses' visible windows are lit at evening (about two in five). */
export function litWindows(L: StreetLayout, v: Rect): Rect[] {
  // Not the ones hidden behind the tree crowns in front of the houses either.
  const u = L.actorH;
  const crowns = [...backTrees(L), ...sideTrees(L).map(([x, y, r]) => [x, y - u * SIDE_CROWN_UP, u * r] as const)];
  const hidden = (w: Rect) => crowns.some(([x, y, r]) =>
    w.x < x + r * 1.5 && w.x + w.w > x - r * 1.5 && w.y < y + r * 1.1 && w.y + w.h > y - r * 1.1);
  return houseWindows(L, v.x - 2, v.x + v.w + 2).filter((w, i) => ((i * 2654435761) >>> 0) % 5 < 2 && !hidden(w));
}

/** Street lamps on the poles, the shops that are selling (bit i + 1 of `lit`) and some windows, as warm light. */
function paintGlows(c: CanvasRenderingContext2D, L: StreetLayout, v: Rect, lit: number): void {
  const u = L.actorH;
  for (const x of poleXs(L)) {
    glowAt(c, x + u * 0.43, poleLampY(L), u * 0.5, '255, 236, 180', 0.95);
    glowAt(c, x + u * 0.43, L.road.y0 + u * 0.5, u * 2.4, '255, 190, 110', 0.42);
  }
  for (const s of L.shops) {
    if ((lit & (1 << (s.index + 1))) === 0) continue;
    const r = s.rect;
    if (s.row === 'top') {
      glowAt(c, r.x + r.w / 2, r.y + r.h - u * 1.1, Math.max(r.w, u * 2) * 0.7, '255, 196, 110', 0.6);
      glowAt(c, r.x + r.w / 2, r.y + r.h + u * 0.6, Math.max(r.w, u * 2) * 0.6, '255, 190, 110', 0.3);
    } else {
      glowAt(c, r.x + r.w / 2, r.y + u * 0.4, Math.max(r.w, u * 2) * 0.65, '255, 196, 110', 0.55);
    }
  }
  // Lit windows in the houses behind: their own panes, warm.
  c.fillStyle = 'rgba(255, 210, 130, 0.55)';
  for (const w of litWindows(L, v)) c.fillRect(w.x + u * 0.03, w.y + u * 0.03, w.w - u * 0.06, w.h - u * 0.06);
}
