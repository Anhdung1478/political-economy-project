// The street on a canvas (spec §9 "Kỹ thuật dựng hình"): sizes the canvas to its box (device pixels capped at 2),
// fits the layout, runs the requestAnimationFrame loop, interpolates between sim ticks (the sim runs 10 ticks a
// second, the picture 60 frames), stops while the tab is hidden, draws back to front by depth (y), honours
// prefers-reduced-motion, and measures frames per second (`window.__sceneFps` in dev).
//
// What is drawn comes from a renderer registry: the street, each shop, each customer, the props, then the named
// overlay layers in order (lighting, particles, bubbles, hud). The customers are draw/characters.ts (Task 15);
// placeholder art fills the rest (draw/placeholder.ts) until Tasks 16–17 plug in theirs with `registerRenderers`. A
// renderer that keeps throwing stops the scene and calls `onFail` (the street then falls back to its list, spec §13).
import type { Actor, BubbleRequest, Cue, Director, ShopView } from './director';
import { drawCustomer } from './draw/characters';
import { placeholderRenderers } from './draw/placeholder';
import { fitLayout, type Fit, type Rect, type ShopSlot, type StreetLayout } from './layout';

/** Device pixels per CSS pixel, at most (spec §9). */
export const MAX_DPR = 2;

/** The project's colours (web/src/styles/tokens.css), read once from the page. */
export interface Palette {
  cream: string; paper: string; milk: string; milkDeep: string;
  ink: string; inkSoft: string; inkFaint: string; boba: string; tea: string;
  matcha: string; matchaDeep: string; matchaSoft: string;
  caramel: string; caramelDeep: string; caramelSoft: string;
  strawberry: string; strawberryDeep: string; strawberrySoft: string;
}

const PALETTE_DEFAULTS: Palette = {
  cream: '#fff6ea', paper: '#fffcf7', milk: '#f6e7d2', milkDeep: '#eed6b6',
  ink: '#2a1d15', inkSoft: '#6e5b4d', inkFaint: '#a08c7e', boba: '#3a271c', tea: '#e9b872',
  matcha: '#5b8f3e', matchaDeep: '#3e6a27', matchaSoft: '#e3efd6',
  caramel: '#c9772a', caramelDeep: '#94531a', caramelSoft: '#f8e2c8',
  strawberry: '#de4f5a', strawberryDeep: '#a8323c', strawberrySoft: '#fbdadc',
};

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const out = { ...PALETTE_DEFAULTS };
  for (const key of Object.keys(out) as (keyof Palette)[]) {
    const v = css.getPropertyValue(`--${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`).trim();
    if (v !== '') out[key] = v;
  }
  return out;
}

/** Things on the street that are neither shops nor customers, depth-sorted with them. Task 16 adds its own. */
export type Prop =
  | { kind: 'overflow'; x: number; y: number; shop: ShopView['id']; n: number }
  | { kind: 'busStop'; x: number; y: number };

/** Everything a renderer gets for one frame. Coordinates are logical units (the layout's). */
export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  /** The street's model, read-only for renderers. */
  director: Director;
  layout: StreetLayout;
  /** The logical rect on screen: the layout and the margin around it. Backgrounds fill all of it. */
  view: Rect;
  /** Sim time shown, in ticks (fractional between ticks). */
  now: number;
  /** Wall clock (ms), for ambient motion that runs on while the sim is paused. */
  wall: number;
  /** Wall time since the previous frame (ms). */
  dt: number;
  /** Device pixels per logical unit (hairlines: 1 / pxPerUnit). */
  pxPerUnit: number;
  /** prefers-reduced-motion: no ambience or particles; state changes still show. */
  reducedMotion: boolean;
  palette: Palette;
  /** Bubble requests and cues that came in since the previous frame (each handed out once). */
  bubbles: readonly BubbleRequest[];
  cues: readonly Cue[];
  /** Per-scene memory for renderers (particles, bubbles on screen); kept across frames, cleared on reset. */
  store: Map<string, unknown>;
}

/**
 * Layers drawn above the depth-sorted street, back to front: the light of the hour (Task 16), particles such as coins,
 * hearts and confetti (Task 16), speech bubbles (Task 17), anything on top (hud).
 */
export const OVERLAY_LAYERS = ['lighting', 'particles', 'bubbles', 'hud'] as const;
export type OverlayLayer = (typeof OVERLAY_LAYERS)[number];
export type Overlay = (rc: RenderContext) => void;

export interface Renderers {
  /** The ground: fills the whole view (back, sidewalks, road, front), under everything else. */
  drawStreet(rc: RenderContext): void;
  drawShop(rc: RenderContext, shop: ShopView, slot: ShopSlot): void;
  /** A customer, feet at (actor.x, actor.y). Hidden actors are not drawn. */
  drawCustomer(rc: RenderContext, actor: Actor): void;
  /** The props this frame, each depth-sorted at its y. */
  props(rc: RenderContext): readonly Prop[];
  drawProp(rc: RenderContext, prop: Prop): void;
  /** Above everything, in `OVERLAY_LAYERS` order; a layer left out is skipped. */
  overlays: Partial<Record<OverlayLayer, Overlay>>;
}

/** What a task plugs in: any of the draw functions, and any overlay layers (merged layer by layer). */
export type RendererPatch = Partial<Omit<Renderers, 'overlays'>> & { overlays?: Partial<Record<OverlayLayer, Overlay>> };

/** Placeholder art (Task 14) with the real customers (Task 15); Tasks 16–17 plug in the rest. */
let registry: Renderers = { ...placeholderRenderers, drawCustomer };

/**
 * Plugs renderers in (Tasks 15–17): `registerRenderers({ drawCustomer })` replaces only that one;
 * `registerRenderers({ overlays: { particles } })` only that layer.
 */
export function registerRenderers(r: RendererPatch): void {
  registry = { ...registry, ...r, overlays: { ...registry.overlays, ...r.overlays } };
}

export const getRenderers = (): Renderers => registry;

declare global {
  interface Window { __sceneFps?: number }
}

/** Frames in a row a renderer may throw before the scene gives up (an old browser without `roundRect`, say). */
const MAX_FAILED_FRAMES = 3;

export interface SceneOptions {
  /** The sim time to show now, in ticks (fractional). */
  time: () => number;
  onFps?: (fps: number) => void;
  /** The scene stopped because drawing kept failing; show the fallback. */
  onFail?: (error: unknown) => void;
  /** Forces reduced motion on or off; undefined follows prefers-reduced-motion. */
  reducedMotion?: boolean;
}

interface Item { depth: number; kind: 0 | 1 | 2; i: number }

export class Scene {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly palette: Palette;
  private readonly store = new Map<string, unknown>();
  private readonly media: MediaQueryList | null;
  private fit: Fit;
  private dpr = 1;
  private raf = 0;
  private running = false;
  private wanted = false;
  private lastWall = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private forcedReduced: boolean | undefined;
  private failures = 0;
  private readonly items: Item[] = [];
  private readonly shopsNow: ShopView[] = [];
  private readonly actorsNow: Actor[] = [];

  constructor(private readonly canvas: HTMLCanvasElement, private readonly director: Director,
    private readonly opts: SceneOptions) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('no 2d context');
    this.ctx = ctx;
    this.palette = readPalette();
    this.forcedReduced = opts.reducedMotion;
    this.media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.fit = fitLayout(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get reducedMotion(): boolean { return this.forcedReduced ?? this.media?.matches ?? false; }
  setReducedMotion(v: boolean | undefined): void { this.forcedReduced = v; }

  /** The canvas box is `w × h` CSS pixels: backing store at up to 2 device pixels each, the layout refitted. */
  resize(w: number, h: number): void {
    w = Math.max(1, w);
    h = Math.max(1, h);
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const bw = Math.round(w * this.dpr);
    const bh = Math.round(h * this.dpr);
    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;
    const fit = fitLayout(w, h);
    if (fit.layout !== this.director.layout) this.director.setLayout(fit.layout, fit.view);
    else this.director.setView(fit.view);
    this.fit = fit;
    if (this.running) this.frame(performance.now());
  }

  /** Forget renderer memory (particles, bubbles) after the model was rebuilt. */
  clearStore(): void { this.store.clear(); }

  start(): void {
    this.wanted = true;
    if (this.running || document.visibilityState === 'hidden') return;
    this.running = true;
    this.lastWall = performance.now();
    this.fpsSince = this.lastWall;
    this.fpsFrames = 0;
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.wanted = false;
    this.halt();
  }

  destroy(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.store.clear();
  }

  private halt(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') this.halt();
    else if (this.wanted) this.start();
  };

  private readonly loop = (wall: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    this.frame(wall);
    this.countFrame(wall);
  };

  /** One frame; MAX_FAILED_FRAMES failures in a row stop the scene and report it. */
  private frame(wall: number): void {
    try {
      this.draw(wall);
      this.failures = 0;
    } catch (e) {
      if (++this.failures < MAX_FAILED_FRAMES) return;
      this.stop();
      this.opts.onFail?.(e);
    }
  }

  private countFrame(wall: number): void {
    this.fpsFrames++;
    const span = wall - this.fpsSince;
    if (span < 500) return;
    const fps = Math.round((this.fpsFrames * 1000) / span);
    this.fpsFrames = 0;
    this.fpsSince = wall;
    this.opts.onFps?.(fps);
    if (import.meta.env.DEV) window.__sceneFps = fps;
  }

  private draw(wall: number): void {
    const d = this.director;
    d.advanceTo(this.opts.time());
    const r = registry;
    const { ctx, fit } = this;
    const k = fit.scale * this.dpr;
    ctx.setTransform(k, 0, 0, k, fit.ox * this.dpr, fit.oy * this.dpr);
    const rc: RenderContext = {
      ctx, director: d, layout: d.layout, view: fit.view, now: d.now, wall, dt: wall - this.lastWall, pxPerUnit: k,
      reducedMotion: this.reducedMotion, palette: this.palette, bubbles: d.takeBubbles(), cues: d.takeCues(),
      store: this.store,
    };
    this.lastWall = wall;
    r.drawStreet(rc);

    // Back to front: shops at their depth, customers at their feet, props at their y.
    const items = this.items;
    const shops = this.shopsNow;
    const actors = this.actorsNow;
    items.length = 0;
    shops.length = 0;
    actors.length = 0;
    for (const s of d.shops) {
      items.push({ depth: d.layout.shops.find(x => x.id === s.id)?.depth ?? 0, kind: 0, i: shops.length });
      shops.push(s);
    }
    for (const a of d.actors) {
      if (a.hidden) continue;
      items.push({ depth: a.y, kind: 1, i: actors.length });
      actors.push(a);
    }
    const props = r.props(rc);
    props.forEach((p, i) => items.push({ depth: p.y, kind: 2, i }));
    items.sort((a, b) => a.depth - b.depth || a.kind - b.kind);
    for (const it of items) {
      if (it.kind === 0) {
        const s = shops[it.i];
        const slot = d.layout.shops.find(x => x.id === s.id);
        if (slot !== undefined) r.drawShop(rc, s, slot);
      } else if (it.kind === 1) {
        r.drawCustomer(rc, actors[it.i]);
      } else {
        r.drawProp(rc, props[it.i]);
      }
    }
    for (const layer of OVERLAY_LAYERS) r.overlays[layer]?.(rc);
    if (this.canvas.dataset.ready !== '1') this.canvas.dataset.ready = '1';
  }
}
