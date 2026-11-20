import { describe, expect, it } from 'vitest';
import { bumpFontEpoch, deviceBox, SpriteCache, spriteFits } from './sprites';

describe('sprites on the device grid', () => {
  it('a logical rect covers whole device pixels with a pixel of bleed', () => {
    const b = deviceBox({ x: 10.3, y: 5, w: 20, h: 7.5 }, { k: 2, devX: 3.4, devY: 0 });
    // 10.3·2 + 3.4 = 24 → 23 with bleed; (30.3·2 + 3.4) = 64 → 65.
    expect(b).toEqual({ dx: 23, dy: 9, pw: 42, ph: 17 });
    for (const v of Object.values(b)) expect(Number.isInteger(v)).toBe(true);
  });

  it('a sprite fits only its own grid, signature and rect', () => {
    const cache = new SpriteCache();
    const owner = {};
    const g = { k: 2, devX: 0.5, devY: 0 };
    const r = { x: 0, y: 0, w: 10, h: 10 };
    let painted = 0;
    const s = cache.get(owner, 0, r, g, 1, () => { painted++; });
    expect(spriteFits(s, g, 1, r)).toBe(true);
    expect(spriteFits(s, { ...g, k: 3 }, 1, r)).toBe(false);
    expect(spriteFits(s, { ...g, devX: 0.25 }, 1, r)).toBe(false);
    expect(spriteFits(s, g, 2, r)).toBe(false);
    expect(spriteFits(s, g, 1, { ...r, w: 11 })).toBe(false);
    void painted;
  });

  it('is built once while it fits, again on a state change or a resize; layers and owners are apart', () => {
    const cache = new SpriteCache();
    const a = {};
    const b = {};
    const g = { k: 2, devX: 0, devY: 0 };
    const r = { x: 0, y: 0, w: 10, h: 10 };
    const before = cache.built;
    const s1 = cache.get(a, 0, r, g, 1, () => {});
    expect(cache.get(a, 0, r, g, 1, () => {})).toBe(s1);
    expect(cache.built - before).toBe(1);
    cache.get(a, 0, r, g, 2, () => {});
    cache.get(a, 0, r, { ...g, k: 1.5 }, 2, () => {});
    expect(cache.built - before).toBe(3);
    cache.get(a, 1, r, { ...g, k: 1.5 }, 2, () => {});
    cache.get(b, 1, r, { ...g, k: 1.5 }, 2, () => {});
    expect(cache.built - before).toBe(5);
  });

  it('text baked before the web fonts arrived is painted again once they do', () => {
    const cache = new SpriteCache();
    const owner = {};
    const g = { k: 2, devX: 0, devY: 0 };
    const r = { x: 0, y: 0, w: 10, h: 10 };
    const s = cache.get(owner, 0, r, g, 1, () => {});
    expect(cache.peek(owner, 0, r, g, 1)).toBe(s);
    bumpFontEpoch();
    expect(spriteFits(s, g, 1, r)).toBe(false);
    expect(cache.peek(owner, 0, r, g, 1)).toBeUndefined();
    const again = cache.get(owner, 0, r, g, 1, () => {});
    expect(again).not.toBe(s);
    expect(cache.built).toBe(2);
  });

  it("each scene's cache is its own and is emptied when the scene goes", () => {
    const a = new SpriteCache();
    const b = new SpriteCache();
    const owner = {};
    const g = { k: 1, devX: 0, devY: 0 };
    const r = { x: 0, y: 0, w: 4, h: 4 };
    a.get(owner, 0, r, g, 1, () => {});
    expect(b.peek(owner, 0, r, g, 1)).toBeUndefined();
    a.clear();
    expect(a.peek(owner, 0, r, g, 1)).toBeUndefined();
  });
});
