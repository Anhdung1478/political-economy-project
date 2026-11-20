// Static art drawn once into offscreen canvases (Task 16): the street's ground, each shop's building in its current
// state, the poles and the day's fixed props. A frame then blits them in a few `drawImage` calls and draws only what
// moves (owners, price boards, signs that flip, trees that sway) on top.
//
// A sprite is painted with the very transform the main canvas uses, shifted to a whole device pixel, and blitted
// untransformed at that pixel: it lands on the device grid exactly, as sharp as drawing it live. It is valid for one
// grid (device pixels per unit and the sub-pixel offset of the origin), one signature (the art's state) and one font
// epoch: text baked while the web fonts were still loading is painted again once they arrive (`watchFonts`). A
// resize, a turn of the phone, a change of state or new fonts rebuild it on the next frame it is drawn.
//
// Each Scene owns its cache (`RenderContext.sprites`) and drops it when it is destroyed, so several streets mounted
// at once never share or thrash sprites, and nothing outlives its canvas.
import type { Rect } from './layout';

type Ctx = CanvasRenderingContext2D;

/** Logical → device pixels: X = x · k + devX, Y = y · k + devY. */
export interface Grid { k: number; devX: number; devY: number }

/** The device-pixel box a logical rect covers, grown to whole pixels (plus a pixel of bleed on every side). */
export interface DeviceBox { dx: number; dy: number; pw: number; ph: number }

export function deviceBox(r: Rect, g: Grid): DeviceBox {
  const x0 = Math.floor(r.x * g.k + g.devX) - 1;
  const y0 = Math.floor(r.y * g.k + g.devY) - 1;
  const x1 = Math.ceil((r.x + r.w) * g.k + g.devX) + 1;
  const y1 = Math.ceil((r.y + r.h) * g.k + g.devY) + 1;
  return { dx: x0, dy: y0, pw: Math.max(1, x1 - x0), ph: Math.max(1, y1 - y0) };
}

// ── Fonts ──────────────────────────────────────────────────────────────────────────────────────────────────────────

let epoch = 0;
let watching = false;

/** Bumped each time web fonts finish loading: every sprite baked before then is stale. */
export const fontEpoch = (): number => epoch;

/** Marks every sprite stale (new fonts arrived). Exported for the tests. */
export function bumpFontEpoch(): void {
  epoch++;
}

/**
 * Starts the font watch once (Scene construction): asks for the faces the street's text uses (so they load even
 * before any DOM text needs them) and bumps the epoch when they are ready and whenever more fonts finish loading.
 */
export function watchFonts(): void {
  if (watching || typeof document === 'undefined' || document.fonts === undefined) return;
  watching = true;
  const fonts = document.fonts;
  const sample = 'AẮỐƯ Trà sữa Bà Tư GIÁRẺ 0123456789k';
  for (const face of ['800 16px "Bricolage Grotesque"', '600 16px "Bricolage Grotesque"', '600 16px "Be Vietnam Pro"',
    '700 16px "Be Vietnam Pro"', '800 16px "Be Vietnam Pro"']) {
    fonts.load(face, sample).catch(() => {});
  }
  fonts.ready.then(bumpFontEpoch, () => {});
  fonts.addEventListener?.('loadingdone', bumpFontEpoch);
}

// ── Sprites ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Sprite {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  box: DeviceBox;
  /** What it was painted for. */
  k: number; devX: number; devY: number; sig: number; epoch: number;
  rect: Rect;
}

/** Whether a sprite painted for (grid, sig, rect) still serves, with the fonts there are now. */
export function spriteFits(s: Sprite | undefined, g: Grid, sig: number, r: Rect): boolean {
  return s !== undefined && s.k === g.k && s.devX === g.devX && s.devY === g.devY && s.sig === sig
    && s.epoch === epoch && s.rect.x === r.x && s.rect.y === r.y && s.rect.w === r.w && s.rect.h === r.h;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  return null;
}

/**
 * The layers kept under the layout object, one number space per cache (shops keep theirs under their slot): the
 * ground, the evening glow, the shelter, the building site, the wires, one per pole.
 */
export const LAYER = { street: 0, glow: 1, shelter: 2, site: 3, wires: 4, pole: 16 } as const;

/**
 * Sprites under an owner object (a shop slot, the layout) and a small number (the layer): no strings per frame. Owners
 * are held weakly, so a layout or a dev sheet's slots that go away take their sprites with them.
 */
export class SpriteCache {
  private map = new WeakMap<object, Map<number, Sprite>>();
  /** Sprites painted by this cache (for the tests and the dev sheet). */
  built = 0;

  /** The sprite kept for `owner`/`layer` if it still fits (no painting, no allocation). */
  peek(owner: object, layer: number, rect: Rect, g: Grid, sig: number): Sprite | undefined {
    const kept = this.map.get(owner)?.get(layer);
    return kept !== undefined && spriteFits(kept, g, sig, rect) ? kept : undefined;
  }

  /**
   * The sprite of `owner`/`layer` covering logical `rect`, painted by `paint` (in logical units) unless the one kept
   * still fits the grid, `sig` and the fonts.
   */
  get(owner: object, layer: number, rect: Rect, g: Grid, sig: number, paint: (ctx: Ctx) => void): Sprite {
    let inner = this.map.get(owner);
    if (inner === undefined) {
      inner = new Map();
      this.map.set(owner, inner);
    }
    const kept = inner.get(layer);
    if (kept !== undefined && spriteFits(kept, g, sig, rect)) return kept;
    const box = deviceBox(rect, g);
    // Reuse the old backing store when the size is the same (a state change): no new canvas.
    let canvas = kept !== undefined && kept.box.pw === box.pw && kept.box.ph === box.ph ? kept.canvas : null;
    if (canvas === null) canvas = makeCanvas(box.pw, box.ph);
    const s: Sprite = { canvas, box, k: g.k, devX: g.devX, devY: g.devY, sig, epoch, rect: { ...rect } };
    if (canvas !== null) {
      const c = canvas.getContext('2d') as Ctx | null;
      if (c !== null) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, box.pw, box.ph);
        c.setTransform(g.k, 0, 0, g.k, g.devX - box.dx, g.devY - box.dy);
        paint(c);
      }
    }
    this.built++;
    inner.set(layer, s);
    return s;
  }

  /** Forgets every sprite (the Scene was destroyed). */
  clear(): void {
    this.map = new WeakMap();
  }
}

/** Blits a sprite at its device pixel, then puts the logical transform back. */
export function blit(ctx: Ctx, s: Sprite, g: Grid): void {
  if (s.canvas === null) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(s.canvas as CanvasImageSource, s.box.dx, s.box.dy);
  ctx.setTransform(g.k, 0, 0, g.k, g.devX, g.devY);
}
