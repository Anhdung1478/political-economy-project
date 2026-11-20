import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../../../shared/sim/config';
import type { Actor } from '../director';
import type { Clip } from '../rig';
import {
  ARCHETYPES, blinkAt, buildTraits, CROSS_AT, FUME_AT, impatience, onPhone, selectAnim, shade, SKINS, TAP_AT, traitsOf, viewOf,
  type Traits,
} from './characters';

/** Looks spread like the sim's: 32-bit unsigned. */
const looks = (n: number) => Array.from({ length: n }, (_, i) => (Math.imul(i + 1, 2654435761) >>> 0));

const actor = (o: Partial<Actor> = {}): Actor => ({
  id: 1, look: 12345, entry: 'left', x: 0, y: 0, facing: 1, heading: 'right', speed: 0, activity: 'idle', since: 0,
  gaze: null, cause: null, carrying: false, cupWrong: false, scared: false, shop: null, slot: -1, joinedAt: null,
  leaving: false, hidden: false, playerRelated: false, ...o,
});

const plain: Pick<Traits, 'look' | 'phone' | 'archetype' | 'cane'> = { look: 1, phone: 0, archetype: 'office', cane: false };
const P = CONFIG.rush.patienceTicks;

describe('traitsOf: who a look is', () => {
  it('is deterministic: the same look always gives the same character', () => {
    for (const l of looks(50)) {
      expect(traitsOf(l)).toBe(traitsOf(l));          // cached
      expect(buildTraits(l)).toEqual(traitsOf(l));     // and a fresh build agrees
    }
  });

  it('every archetype appears in sensible shares, and so does every skin tone', () => {
    const n = 4000;
    const count = new Map<string, number>();
    const skins = new Map<string, number>();
    for (const l of looks(n)) {
      const t = traitsOf(l);
      count.set(t.archetype, (count.get(t.archetype) ?? 0) + 1);
      skins.set(t.skin, (skins.get(t.skin) ?? 0) + 1);
    }
    for (const a of ARCHETYPES) {
      const share = (count.get(a) ?? 0) / n;
      expect(share, a).toBeGreaterThan(0.08);
      expect(share, a).toBeLessThan(0.3);
    }
    for (const s of SKINS) expect((skins.get(s) ?? 0) / n, s).toBeGreaterThan(0.04);
  });

  it('makes dozens of distinct kinds (archetype × hair × hat × bag × bottoms × glasses)', () => {
    const kinds = new Set<string>();
    for (const l of looks(3000)) {
      const t = traitsOf(l);
      kinds.add([t.archetype, t.hair, t.hat, t.bag, t.bottomStyle, t.glasses, t.cane].join('/'));
    }
    expect(kinds.size).toBeGreaterThan(150);
  });

  it('each archetype wears what makes it readable', () => {
    for (const l of looks(3000)) {
      const t = traitsOf(l);
      switch (t.archetype) {
        case 'student':
          expect(t.top).toBe('#fbf8f2');            // the white school shirt
          expect(t.bag).toBe('backpack');
          break;
        case 'office':
          expect(['tie', 'lanyard', 'collar']).toContain(t.neck);
          break;
        case 'shipper':
          expect(t.hat).toBe('helmet');
          expect(t.longSleeves).toBe(true);
          break;
        case 'elder':
          expect(t.stoop).toBeGreaterThan(0.5);
          break;
        case 'homemaker':
          expect(t.bag).toBe('basket');
          expect(['none', 'conical']).toContain(t.hat);
          break;
        case 'kol':
          expect(t.phone).toBe(1);
          expect(t.bag).toBe('sling');
          break;
      }
      expect(t.height).toBeGreaterThan(0.8);
      expect(t.height).toBeLessThan(1.1);
    }
  });

  it('looks next to each other do not make look-alikes (the director also reads low bits of the look)', () => {
    const kinds = new Set<string>();
    for (let l = 1000; l < 1064; l++) kinds.add(traitsOf(l).archetype + traitsOf(l).skin);
    expect(kinds.size).toBeGreaterThan(20);
  });

  it('shade darkens and lightens a colour', () => {
    expect(shade('#808080', 0.5)).toBe('#404040');
    expect(shade('#808080', 2)).toBe('#ffffff');
    expect(shade('#123456', 1)).toBe('#123456');
  });
});

describe('selectAnim: the director\'s state to a clip and a face', () => {
  const sel = (o: Partial<Actor>, now = 100, prev: Clip | null = null, tr = plain) => selectAnim(actor(o), now, tr, prev);

  it('walking along, reading the boards, standing about', () => {
    expect(sel({ activity: 'walk', speed: 3 })).toEqual({ clip: 'walk', mood: 'neutral' });
    expect(sel({ activity: 'lookBoard', gaze: 'batu' })).toEqual({ clip: 'lookBoard', mood: 'curious' });
    expect(sel({ activity: 'idle' })).toEqual({ clip: 'idle', mood: 'neutral' });
  });

  it('served: a happy hop; then walking off drinking', () => {
    expect(sel({ activity: 'served', carrying: true })).toEqual({ clip: 'happy', mood: 'happy' });
    expect(sel({ activity: 'walk', speed: 3, carrying: true, leaving: true })).toEqual({ clip: 'walkDrink', mood: 'happy' });
  });

  it('the wrong cup: puzzled, then walking off grumbling with it', () => {
    expect(sel({ activity: 'wrongCup', carrying: true, cupWrong: true })).toEqual({ clip: 'puzzled', mood: 'puzzled' });
    expect(sel({ activity: 'walk', speed: 3, carrying: true, cupWrong: true }).mood).toBe('annoyed');
  });

  it('out of patience or a price rise: a stomp, and the stomp goes on in the walk away', () => {
    for (const cause of ['patience', 'priceUp'] as const) {
      expect(sel({ activity: 'abandon', cause })).toEqual({ clip: 'stomp', mood: 'angry' });
      expect(sel({ activity: 'walk', speed: 3, cause, leaving: true })).toEqual({ clip: 'walkAngry', mood: 'angry' });
      // Still angry on the way to a second shop.
      expect(sel({ activity: 'walk', speed: 3, cause, shop: 'giare', slot: 0, joinedAt: 90 }).clip).toBe('walkAngry');
    }
  });

  it('sold out, closed or a suspicious discount: let down, not a stomp', () => {
    for (const cause of ['stockOut', 'shopClosed', 'steepDiscount'] as const) {
      expect(sel({ activity: 'abandon', cause })).toEqual({ clip: 'shrug', mood: 'annoyed' });
      expect(sel({ activity: 'walk', speed: 3, cause }).mood).toBe('annoyed');
    }
  });

  it('impatience in a queue grows from calm to a foot tap to arms crossed to angry', () => {
    const q = (used: number) => sel({ activity: 'queue', shop: 'batu', slot: 1, joinedAt: 0 }, used * P).clip;
    const m = (used: number) => sel({ activity: 'queue', shop: 'batu', slot: 1, joinedAt: 0 }, used * P).mood;
    expect(q(0.1)).toBe('idle');
    expect(q(TAP_AT + 0.01)).toBe('tap');
    expect(m(TAP_AT + 0.01)).toBe('annoyed');
    expect(q(CROSS_AT + 0.01)).toBe('crossed');
    expect(m(CROSS_AT + 0.01)).toBe('annoyed');
    expect(m(FUME_AT + 0.01)).toBe('angry');
    expect(impatience({ joinedAt: 10 }, 10 + P / 2)).toBeCloseTo(0.5, 12);
    expect(impatience({ joinedAt: null }, 500)).toBe(0);
  });

  it('a walk straight out of a queue clip, still queued, is a shuffle forward', () => {
    const queued = { activity: 'walk' as const, speed: 2, shop: 'batu' as const, slot: 1, joinedAt: 50 };
    expect(sel(queued, 100, 'idle').clip).toBe('shuffle');
    expect(sel(queued, 100, 'tap').clip).toBe('shuffle');
    expect(sel(queued, 100, 'shuffle').clip).toBe('shuffle');
    // Walking in from the street to the place is an ordinary walk.
    expect(sel(queued, 100, 'lookBoard').clip).toBe('walk');
    expect(sel(queued, 100, 'walk').clip).toBe('walk');
  });

  it('phone people check their phone in the queue now and then; a KOL takes selfies', () => {
    const phoney = { ...plain, phone: 1 };
    expect(sel({ activity: 'queue', shop: 'batu', slot: 2, joinedAt: 95 }, 100, null, phoney).clip).toBe('phone');
    const never = { ...plain, phone: 0 };
    expect(sel({ activity: 'queue', shop: 'batu', slot: 2, joinedAt: 95 }, 100, null, never).clip).toBe('idle');
    const kol = { ...plain, archetype: 'kol' as const, phone: 1 };
    expect(sel({ activity: 'queue', shop: 'batu', slot: 2, joinedAt: 95 }, 100, null, kol)).toEqual({ clip: 'selfie', mood: 'happy' });
    // Impatience beats the phone.
    expect(sel({ activity: 'queue', shop: 'batu', slot: 2, joinedAt: 0 }, 0.8 * P, null, kol).clip).toBe('crossed');
  });

  it('a phone habit comes and goes over time, in shares near the trait', () => {
    const tr = { look: 777, phone: 0.4 };
    let on = 0;
    let flips = 0;
    let last = onPhone(tr, 0);
    for (let t = 0; t < 20000; t += 5) {
      const v = onPhone(tr, t);
      if (v) on++;
      if (v !== last) flips++;
      last = v;
    }
    expect(on / 4000).toBeGreaterThan(0.25);
    expect(on / 4000).toBeLessThan(0.55);
    expect(flips).toBeGreaterThan(20);
    // It holds for a while (no flicker frame to frame).
    expect(onPhone(tr, 1000)).toBe(onPhone(tr, 1000.4));
  });

  it('day 5: a scared customer whispers at the boards and hurries away', () => {
    expect(sel({ activity: 'lookBoard', scared: true })).toEqual({ clip: 'whisper', mood: 'scared' });
    expect(sel({ activity: 'walk', speed: 3, scared: true, leaving: true })).toEqual({ clip: 'walkScared', mood: 'scared' });
    expect(sel({ activity: 'walk', speed: 3, scared: true }).mood).toBe('scared');
  });

  it('an old person with a cane walks with it', () => {
    const elder = { ...plain, archetype: 'elder' as const, cane: true };
    expect(sel({ activity: 'walk', speed: 3 }, 100, null, elder).clip).toBe('walkCane');
  });

  it('the view follows the heading', () => {
    expect(viewOf('left')).toBe('side');
    expect(viewOf('right')).toBe('side');
    expect(viewOf('up')).toBe('back');
    expect(viewOf('down')).toBe('front');
  });

  it('blinks briefly and rarely', () => {
    let shut = 0;
    for (let t = 0; t < 60; t += 0.01) shut += blinkAt(t, 1.3);
    expect(shut / 6000).toBeGreaterThan(0.01);
    expect(shut / 6000).toBeLessThan(0.08);
  });
});
