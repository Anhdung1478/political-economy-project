// The speech overlay on a stand-in canvas: a live rush word near the view's edge is said and kept inside the view;
// the ambient street talks only when it is not muted (a screen covers it).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { replayOf } from '../../pages/Dev/replay';
import { AMBIENT_DIRECTORS, AMBIENT_MUTED, type Shown } from '../bubbles';
import { Director } from '../director';
import { fitTo, PORTRAIT } from '../layout';
import type { Palette, RenderContext } from '../Scene';
import { SpriteCache } from '../sprites';
import { drawSpeech } from './speech';

const stub = (): CanvasRenderingContext2D => {
  const gradient = { addColorStop: () => {} };
  const target: Record<string, unknown> = {
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    measureText: (s: string) => ({ width: s.length * 5 }), getTransform: () => ({ a: 1 }),
  };
  return new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : () => {}),
    set: (t, key: string, v) => { t[key] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
};
const g = globalThis as Record<string, unknown>;
let had: unknown;
beforeAll(() => {
  had = g.OffscreenCanvas;
  g.OffscreenCanvas = class {
    constructor(public width: number, public height: number) {}
    getContext() { return stub(); }
  };
});
afterAll(() => { g.OffscreenCanvas = had; });

const PALETTE = {
  cream: '#fff6ea', paper: '#fffcf7', milk: '#f6e7d2', milkDeep: '#eed6b6', ink: '#2a1d15', inkSoft: '#6e5b4d',
  inkFaint: '#a08c7e', boba: '#3a271c', tea: '#e9b872', matcha: '#5b8f3e', matchaDeep: '#3e6a27', matchaSoft: '#e3efd6',
  caramel: '#c9772a', caramelDeep: '#94531a', caramelSoft: '#f8e2c8', strawberry: '#de4f5a', strawberryDeep: '#a8323c',
  strawberrySoft: '#fbdadc',
} satisfies Palette;
const sprites = new SpriteCache();

function setup() {
  const r = replayOf(7, 3, 'reasonable');
  const d = new Director(PORTRAIT);
  d.reset(r.rush);
  const fit = fitTo(PORTRAIT, 390, 844);
  const store = new Map<string, unknown>();
  const rc = (now: number, bubbles: RenderContext['bubbles']): RenderContext => ({
    ctx: stub(), director: d, layout: PORTRAIT, view: fit.view, now, wall: now * 100, dt: 16, pxPerUnit: fit.scale * 2,
    cssPerUnit: fit.scale, grid: { k: fit.scale * 2, devX: fit.ox * 2, devY: fit.oy * 2 }, timeOfDay: 'noon', sprites,
    reducedMotion: false, palette: PALETTE, seed: 7, speech: true, bubbles, cues: [], store,
  });
  const shown = (): Shown[] => {
    for (const v of store.values()) if (v !== null && typeof v === 'object' && 'shown' in v) return (v as { shown: Shown[] }).shown;
    return [];
  };
  return { d, fit, rc, shown };
}

describe('speech near the view\'s edge', () => {
  it('a live rush word from a speaker at 3% of the width is said, and kept inside the view', () => {
    const { d, fit, rc, shown } = setup();
    d.advanceTo(40);
    const a = [...d.actors].find(x => !x.hidden);
    expect(a).toBeDefined();
    if (a === undefined) return;
    a.x = fit.view.x + fit.view.w * 0.03;
    d.apply([]);
    drawSpeech(rc(d.now, [{ customer: a.id, t: d.now, topic: 'tooCrowded', shop: 'player', playerRelated: true }]));
    const s = shown();
    expect(s.map(b => b.customer)).toEqual([a.id]);
    expect(s[0].lastX).toBeGreaterThanOrEqual(fit.view.x);
    expect(s[0].lastX + s[0].w).toBeLessThanOrEqual(fit.view.x + fit.view.w);
  });

  it('the ambient street still holds a new word back from the edge, and says nothing when muted', () => {
    for (const muted of [false, true]) {
      const { d, rc, shown } = setup();
      AMBIENT_DIRECTORS.add(d);
      if (muted) AMBIENT_MUTED.add(d);
      d.advanceTo(40);
      for (let f = 0; f < 3000; f++) drawSpeech(rc(40 + f / 3, []));
      if (muted) expect(shown()).toEqual([]);
    }
  });
});
