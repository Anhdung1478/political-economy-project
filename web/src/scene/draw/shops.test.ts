import { describe, expect, it } from 'vitest';
import type { ShopView } from '../director';
import { lightFor, TIMES_OF_DAY } from '../lighting';
import { POSES, newSkeleton, pose, solve } from '../rig';
import { ownerPose, ownerTraits } from './owners';
import {
  BADGE_TICKS, BUSY_QUEUE, FLIP_TICKS, IDLE_TICKS, PRICE_FLASH, SHUTTER_TICKS, shopLook, shopSig,
} from './shops';

const view = (o: Partial<ShopView> = {}): ShopView => ({
  id: 'batu', status: 'open', statusSince: -Infinity, grandOpening: false, price: 30, prevPrice: null,
  priceSince: -Infinity, certified: false, named: false, badgeSince: -Infinity, rumor: false, queue: [], shown: 0,
  overflow: 0, sold: 0, lastSaleAt: -Infinity, busyUntil: -Infinity, ...o,
});

describe('a shop\'s state → what it shows', () => {
  it('open: the building open, the sign says "ĐANG BÁN", a keeper', () => {
    const l = shopLook(view({ queue: [1], lastSaleAt: 90 }), 100, false);
    expect(l).toMatchObject({ base: 'open', shutter: 0, sign: 'ĐANG BÁN', signFlip: 1, owner: 'serve', label: null });
  });

  it('sold out: the sign flips to "HẾT HÀNG" over FLIP_TICKS; at once with reduced motion', () => {
    const v = view({ status: 'soldOut', statusSince: 100 });
    const mid = shopLook(v, 100 + FLIP_TICKS / 2, false);
    expect(mid.sign).toBe('HẾT HÀNG');
    expect(mid.signPrev).toBe('ĐANG BÁN');
    expect(mid.signFlip).toBeCloseTo(0.5);
    expect(shopLook(v, 100 + FLIP_TICKS, false).signFlip).toBe(1);
    expect(shopLook(v, 101, true).signFlip).toBe(1);
    // Sold out from the start (a rebuild): no flip.
    expect(shopLook(view({ status: 'soldOut' }), 5, false).signFlip).toBe(1);
  });

  it('resting: the shutter rolls down over the open front, then the building shows it shut; reduced motion skips it', () => {
    const v = view({ status: 'resting', statusSince: 200 });
    const rolling = shopLook(v, 200 + SHUTTER_TICKS / 2, false);
    expect(rolling.base).toBe('open');
    expect(rolling.shutter).toBeGreaterThan(0.5);
    expect(rolling.shutter).toBeLessThan(1);
    expect(rolling.label).toBe('NGHỈ BÁN');
    expect(rolling.sign).toBeNull();
    const done = shopLook(v, 200 + SHUTTER_TICKS, false);
    expect(done).toMatchObject({ base: 'shut', shutter: 0, owner: null });
    expect(shopLook(v, 201, true)).toMatchObject({ base: 'shut', shutter: 0 });
    expect(shopLook(view({ status: 'resting' }), 0, false).base).toBe('shut');
    expect(shopLook(view({ status: 'closedEarly' }), 0, false).label).toBe('ĐÓNG CỬA');
  });

  it('closed for good, not open yet', () => {
    expect(shopLook(view({ status: 'closed' }), 0, false)).toMatchObject({ base: 'closed', owner: null, sign: null });
    expect(shopLook(view({ status: 'notYet' }), 0, false)).toMatchObject({ base: 'lot', owner: null });
  });

  it('the keeper: wipes their brow in turns when the queue is long, serves while there is one, yawns when idle', () => {
    const busy = view({ queue: Array.from({ length: BUSY_QUEUE }, (_, i) => i) });
    const acts = new Set<string>();
    for (let t = 0; t < 200; t++) acts.add(shopLook(busy, t, false).owner ?? '');
    expect([...acts].sort()).toEqual(['serve', 'sweat']);
    expect(shopLook(busy, 13, true).owner).toBe('sweat');
    expect(shopLook(view({ queue: [1] }), 50, false).owner).toBe('serve');
    // Nobody for a while: yawns now and then.
    const idle = new Set<string>();
    for (let t = IDLE_TICKS + 1; t < IDLE_TICKS + 200; t++) idle.add(shopLook(view({ lastSaleAt: 0 }), t, false).owner ?? '');
    expect([...idle].sort()).toEqual(['idle', 'yawn']);
    // Not before IDLE_TICKS without a sale, and never with reduced motion.
    for (let t = 1; t < IDLE_TICKS; t++) expect(shopLook(view({ lastSaleAt: 0 }), t, false).owner).not.toBe('yawn');
    for (let t = IDLE_TICKS + 1; t < IDLE_TICKS + 200; t++) expect(shopLook(view({ lastSaleAt: 0 }), t, true).owner).toBe('idle');
  });

  it('the price board flips from the old price to the new, and its colour lingers', () => {
    const v = view({ price: 32, prevPrice: 30, priceSince: 300 });
    expect(shopLook(v, 300 + FLIP_TICKS / 2, false).priceFlip).toBeCloseTo(0.5);
    const after = shopLook(v, 300 + FLIP_TICKS + 1, false);
    expect(after.priceFlip).toBe(1);
    expect(after.priceFlash).toBeGreaterThan(0);
    expect(after.priceUp).toBe(true);
    expect(shopLook(v, 300 + PRICE_FLASH, false).priceFlash).toBe(0);
    expect(shopLook(view({ price: 28, prevPrice: 30, priceSince: 300 }), 301, false).priceUp).toBe(false);
    expect(shopLook(v, 301, true).priceFlip).toBe(1);
  });

  it('badges: certified pops on over BADGE_TICKS (shown whole when certified from the start); named; rumor flies', () => {
    expect(shopLook(view({ certified: true, badgeSince: 450 }), 450 + BADGE_TICKS / 2, false).badgePop).toBeCloseTo(0.5);
    expect(shopLook(view({ certified: true }), 0, false)).toMatchObject({ badge: 'certified', badgePop: 1 });
    expect(shopLook(view({ named: true, rumor: true }), 0, false)).toMatchObject({ badge: 'named', rumor: true });
    expect(shopLook(view({ rumor: true, certified: true }), 0, false).rumor).toBe(false);
  });

  it('grand opening only while open; every drawn state has its own sprite signature', () => {
    expect(shopLook(view({ grandOpening: true }), 0, false).grand).toBe(true);
    expect(shopLook(view({ grandOpening: true, status: 'resting' }), 0, false).grand).toBe(false);
    const sigs = new Set([
      shopSig({ base: 'open', grand: false, label: null, empty: false }),
      shopSig({ base: 'open', grand: true, label: null, empty: false }),
      shopSig({ base: 'open', grand: false, label: null, empty: true }),
      shopSig({ base: 'shut', grand: false, label: 'NGHỈ BÁN', empty: false }),
      shopSig({ base: 'shut', grand: false, label: 'ĐÓNG CỬA', empty: false }),
      shopSig({ base: 'closed', grand: false, label: null, empty: false }),
      shopSig({ base: 'lot', grand: false, label: null, empty: false }),
    ]);
    expect(sigs.size).toBe(7);
    // Sold out empties the shelves; nothing else does.
    expect(shopLook(view({ status: 'soldOut' }), 0, false).empty).toBe(true);
    expect(shopLook(view(), 0, false).empty).toBe(false);
  });
});

describe('the keepers', () => {
  it('each has its own look, never a customer\'s (looks below zero), stable', () => {
    const ids = ['batu', 'giare', 'cochap', 'luotsong', 'sinhvien', 'player', 'tapdoan'] as const;
    const looks = ids.map(id => ownerTraits(id).look);
    expect(new Set(looks).size).toBe(7);
    for (const l of looks) expect(l).toBeLessThan(0);
    expect(ownerTraits('batu')).toBe(ownerTraits('batu'));
    expect(ownerTraits('batu').hair).toBe('bun');
    expect(ownerTraits('player').hat).toBe('cap');
  });

  it('a yawn raises both arms over the head; a wipe brings a forearm to the brow', () => {
    const input = { t: 0, loop: 0, phase: 0, pace: 0, side: false, stoop: 0, calm: false };
    const tr = ownerTraits('giare');
    const sk = newSkeleton();
    solve(ownerPose(pose(), 'giare', 'yawn', 1, false, input), tr.dims, 'front', sk);
    expect(sk.hand0.y).toBeLessThan(sk.head.y);
    expect(sk.hand1.y).toBeLessThan(sk.head.y);
    solve(ownerPose(pose(), 'giare', 'sweat', 1, false, input), tr.dims, 'front', sk);
    expect(Math.abs(sk.hand1.y - sk.head.y)).toBeLessThan(tr.dims.headR * 1.5);
    // Cố Chấp stands about with his arms crossed.
    const idle = ownerPose(pose(), 'cochap', 'idle', 1, true, input);
    expect(idle.e0).toBeCloseTo(POSES.crossed.e0, 1);
  });
});

describe('the light of the hour', () => {
  it('warm low sun in the morning, white glare from above at noon, golden from the right, lamps at evening', () => {
    expect(TIMES_OF_DAY).toEqual(['morning', 'noon', 'afternoon', 'evening']);
    expect(lightFor('morning').sun?.from).toBe('left');
    expect(lightFor('noon').sun?.from).toBe('top');
    expect(lightFor('noon').wash).toBeNull();
    expect(lightFor('afternoon').sun?.from).toBe('right');
    expect(lightFor('evening').glow).toBeGreaterThan(0);
    expect(lightFor('evening').wash?.op).toBe('multiply');
    for (const t of ['morning', 'noon', 'afternoon'] as const) expect(lightFor(t).glow).toBe(0);
  });
});
