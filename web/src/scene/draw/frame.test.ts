// A smoke test of Task 16's art: whole frames of every day (street, shops in every state, props, light, particles)
// drawn onto a stand-in canvas in node, sprites included (a stand-in OffscreenCanvas), at many moments of each rush.
// It catches a renderer that throws; the pictures themselves are checked by eye (npm run shoot).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Day, ShopStatus } from '../../../../shared/sim/types';
import { replayOf, walkRush } from '../../pages/Dev/replay';
import { Director } from '../director';
import { LANDSCAPE, PORTRAIT, fitTo } from '../layout';
import { TIMES_OF_DAY } from '../lighting';
import { getRenderers, OVERLAY_LAYERS, type Palette, type RenderContext } from '../Scene';

/** A context that accepts every call, counting them; gradients and text metrics are stand-ins. */
function stubContext(count: { n: number }): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const target: Record<string, unknown> = {
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    measureText: (s: string) => ({ width: s.length * 5 }), getTransform: () => ({ a: 1 }),
  };
  return new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      return (...args: unknown[]) => {
        count.n++;
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a) && key !== 'arc') throw new Error(`${key}(${String(args)})`);
      };
    },
    set(t, key: string, v) {
      t[key] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const count = { n: 0 };
const g = globalThis as Record<string, unknown>;
let had: unknown;

beforeAll(() => {
  had = g.OffscreenCanvas;
  g.OffscreenCanvas = class {
    constructor(public width: number, public height: number) {}
    getContext() { return stubContext(count); }
  };
});
afterAll(() => { g.OffscreenCanvas = had; });

const PALETTE = {
  cream: '#fff6ea', paper: '#fffcf7', milk: '#f6e7d2', milkDeep: '#eed6b6', ink: '#2a1d15', inkSoft: '#6e5b4d',
  inkFaint: '#a08c7e', boba: '#3a271c', tea: '#e9b872', matcha: '#5b8f3e', matchaDeep: '#3e6a27', matchaSoft: '#e3efd6',
  caramel: '#c9772a', caramelDeep: '#94531a', caramelSoft: '#f8e2c8', strawberry: '#de4f5a', strawberryDeep: '#a8323c',
  strawberrySoft: '#fbdadc',
} satisfies Palette;

function frame(d: Director, store: Map<string, unknown>, wall: number, reduced: boolean, tod = TIMES_OF_DAY[1]): void {
  const fit = fitTo(d.layout, d.layout === PORTRAIT ? 390 : 844, d.layout === PORTRAIT ? 844 : 390);
  const ctx = stubContext(count);
  const rc: RenderContext = {
    ctx, director: d, layout: d.layout, view: fit.view, now: d.now, wall, dt: 16, pxPerUnit: fit.scale * 2,
    grid: { k: fit.scale * 2, devX: fit.ox * 2, devY: fit.oy * 2 }, timeOfDay: tod, reducedMotion: reduced,
    palette: PALETTE, bubbles: d.takeBubbles(), cues: d.takeCues(), store,
  };
  const r = getRenderers();
  r.drawStreet(rc);
  for (const s of d.shops) r.drawShop(rc, s, d.layout.shops.find(x => x.id === s.id) as never);
  for (const a of d.actors) if (!a.hidden) r.drawCustomer(rc, a);
  for (const p of r.props(rc)) r.drawProp(rc, p);
  for (const layer of OVERLAY_LAYERS) r.overlays[layer]?.(rc);
}

describe('whole frames draw without throwing', () => {
  for (const day of [1, 2, 3, 4, 5] as Day[]) {
    it(`day ${day}, both layouts, every 7 ticks of the rush, motion and reduced motion`, () => {
      const r = replayOf(7, day, 'reasonable');
      for (const L of [PORTRAIT, LANDSCAPE]) {
        const d = new Director(L);
        d.reset(r.rush);
        const store = new Map<string, unknown>();
        let wall = 0;
        const before = count.n;
        walkRush(r, (t, events) => {
          d.advanceTo(t);
          d.apply(events);
          wall += 100;
          if (t % 7 === 0 || events.some(e => e.type === 'policy' || e.type === 'shopStatus')) {
            frame(d, store, wall, t % 14 === 0);
          }
        });
        expect(count.n - before).toBeGreaterThan(1000);
      }
    });
  }

  it('every shop status and every light of the day', () => {
    const r = replayOf(7, 2, 'reasonable');
    const d = new Director(PORTRAIT);
    d.reset(r.rush);
    const store = new Map<string, unknown>();
    const statuses: ShopStatus[] = ['open', 'soldOut', 'resting', 'closed', 'notYet', 'closedEarly'];
    for (const st of statuses) {
      for (const s of d.shops) {
        s.status = st;
        s.statusSince = 3;
        s.certified = st === 'open';
        s.named = st === 'soldOut';
        s.badgeSince = 2;
        s.rumor = true;
        s.prevPrice = 20;
        s.priceSince = 4;
      }
      for (const tod of TIMES_OF_DAY) for (const t of [0, 5, 30]) frame(d, store, t * 100, false, tod);
    }
  });
});
