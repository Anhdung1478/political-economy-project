// The shopkeepers (spec §9 "Trạng thái quán": "chủ quán ngáp khi ế và lau mồ hôi khi đông"), on the customers' rig
// (draw/characters.ts) with outfits of their own: Bà Tư in her áo bà ba with a grey bun, a GiáRẻ clerk in the chain's
// red cap, stubborn old Cố Chấp with his arms crossed, Lướt Sóng glued to his phone, the student in a hoodie, you in
// your strawberry cap, a Tập Đoàn employee in black. They serve while there is a queue, wipe their brow when it is long,
// yawn and stretch when nobody comes. The top row faces us across its counter; the bottom row shows us its back.
import type { ShopId } from '../../../../shared/sim/types';
import { clipPose, newSkeleton, pose, POSE_KEYS, solve, type ClipInput, type Pose, type View } from '../rig';
import { blinkAt, buildTraits, drawCharacterAt, shade, type FigureFx, type Traits } from './characters';
import { sweat } from './faces';

export type OwnerAct = 'serve' | 'idle' | 'yawn' | 'sweat';

const E = 0.66;
const t = (c: string) => shade(c, E);

/** Who keeps each shop: a base look plus an outfit. */
const SPECS: Record<ShopId, { seed: number; o: Partial<Traits> }> = {
  batu: { seed: 11, o: {
    archetype: 'elder', fem: true, hair: 'bun', hairColor: '#d8d2ca', top: '#8f5e8a', tunic: true, longSleeves: true,
    bottom: '#3a2f2a', bottomStyle: 'pants', glasses: 'round', stoop: 0.35, hat: 'none', skin: '#e2ad86' } },
  giare: { seed: 22, o: {
    archetype: 'student', fem: true, hair: 'ponytail', hairColor: '#231a15', top: '#de4f5a', hat: 'cap',
    hatColor: '#a8323c', bottom: '#2f3446', bottomStyle: 'pants', glasses: 'none', neck: 'collar', neckColor: '#fffcf7' } },
  cochap: { seed: 33, o: {
    archetype: 'elder', fem: false, hair: 'short', hairColor: '#c9c3bb', top: '#94531a', longSleeves: true,
    bottom: '#3a2f2a', glasses: 'round', stoop: 0.15, hat: 'none', skin: '#cc9066' } },
  luotsong: { seed: 44, o: {
    archetype: 'office', fem: false, hair: 'spiky', hairColor: '#3b2a20', top: '#e3efd6', neck: 'tie',
    neckColor: '#3e6a27', bottom: '#33404f', glasses: 'none', hat: 'none' } },
  sinhvien: { seed: 55, o: {
    archetype: 'student', fem: false, hair: 'side', hairColor: '#231a15', top: '#7fb8e0', longSleeves: true,
    bottom: '#3b4a6b', glasses: 'round', hat: 'none' } },
  player: { seed: 66, o: {
    archetype: 'kol', fem: true, hair: 'bob', hairColor: '#4e3426', top: '#fffcf7', neck: 'scarf',
    neckColor: '#de4f5a', hat: 'cap', hatColor: '#de4f5a', bottom: '#de4f5a', bottomStyle: 'pants', glasses: 'none',
    skin: '#f0c6a2' } },
  tapdoan: { seed: 77, o: {
    archetype: 'office', fem: false, hair: 'short', hairColor: '#231a15', top: '#2f3446', longSleeves: true,
    hat: 'cap', hatColor: '#1f2330', neck: 'collar', neckColor: '#fffcf7', bottom: '#1f2330', glasses: 'none' } },
};

const ORDER: ShopId[] = ['batu', 'giare', 'cochap', 'luotsong', 'sinhvien', 'player', 'tapdoan'];
const traitCache = new Map<ShopId, Traits>();

/** The shopkeeper's traits (looks below zero: never a customer's, so their recordings are their own). */
export function ownerTraits(id: ShopId): Traits {
  const hit = traitCache.get(id);
  if (hit !== undefined) return hit;
  const s = SPECS[id];
  const b = buildTraits(s.seed);
  const o = s.o;
  const tr: Traits = {
    ...b, ...o, look: -(ORDER.indexOf(id) + 1), bag: 'none', cane: false, pattern: 'none', phone: 0,
    hairEdge: t(o.hairColor ?? b.hairColor), topEdge: t(o.top ?? b.top), bottomEdge: t(o.bottom ?? b.bottom),
    hatEdge: t(o.hatColor ?? b.hatColor), skinEdge: t(o.skin ?? b.skin), legColor: o.skin ?? b.skin,
    height: 0.98, width: 1.02,
  };
  traitCache.set(id, tr);
  return tr;
}

/** The pose for an act at time `sec` (seconds, free-running). Pure. */
export function ownerPose(out: Pose, id: ShopId, act: OwnerAct, sec: number, calm: boolean, input: ClipInput): Pose {
  input.t = sec;
  input.loop = sec;
  input.phase = 0;
  input.pace = 0;
  input.side = false;
  input.stoop = SPECS[id].o.stoop ?? 0;
  input.calm = calm;
  if (act === 'idle') {
    // Each has their way of standing about.
    clipPose(out, id === 'cochap' ? 'crossed' : id === 'luotsong' || id === 'sinhvien' ? 'phone' : 'idle', input);
    return out;
  }
  clipPose(out, 'idle', input);
  if (act === 'serve') {
    // Hands busy at the counter: shaking, pouring, sealing.
    const w = calm ? 0 : Math.sin(sec * 9);
    out.a0 = 0.95 + w * 0.25;
    out.e0 = 1.25 + w * 0.2;
    out.x0 = 0.2;
    out.a1 = 0.9 - w * 0.25;
    out.e1 = 1.2 - w * 0.2;
    out.x1 = 0.2;
    out.nod = 0.15;
    out.lookY = 0.5;
  } else if (act === 'yawn') {
    // Arms up for a long stretch, head back.
    out.a0 = 3.0;
    out.e0 = 0.15;
    out.x0 = 0.38;
    out.a1 = 3.0;
    out.e1 = 0.15;
    out.x1 = 0.38;
    out.nod = -0.25;
    out.squash = 1.04;
  } else {
    // A forearm across the brow, wiping it.
    const w = calm ? 0 : Math.sin(sec * 7);
    out.a1 = 2.35;
    out.e1 = 2.1;
    out.x1 = 0.1 + w * 0.12;
    out.tilt = -0.12;
    out.a0 = 0.9;
    out.e0 = 1.2;
    out.x0 = 0.2;
  }
  return out;
}

interface Memo { pose: Pose; base: Pose; sk: ReturnType<typeof newSkeleton>; input: ClipInput; fx: FigureFx }
const memo: Memo = {
  pose: pose(), base: pose(), sk: newSkeleton(),
  input: { t: 0, loop: 0, phase: 0, pace: 0, side: false, stoop: 0, calm: false },
  fx: { mood: 'neutral', blink: 0, cup: false, phone: false },
};

/**
 * Draws a shop's keeper at (x, y) (feet), `s` tall, facing us (`front`) or from behind (`back`). `sec` is the
 * free-running clock in seconds; `act` what they do; `k` (0..1) how far into a yawn or a wipe they are, for blending in.
 */
export function drawOwner(ctx: CanvasRenderingContext2D, id: ShopId, act: OwnerAct, x: number, y: number, s: number,
  view: View, sec: number, k: number, calm: boolean): void {
  const tr = ownerTraits(id);
  const m = memo;
  ownerPose(m.pose, id, act, sec, calm, m.input);
  if (act === 'yawn' || act === 'sweat') {
    // Ease in and out of the gesture.
    const w = Math.sin(Math.PI * Math.min(1, Math.max(0, k)));
    const base = clipPose(m.base, 'idle', m.input);
    for (const key of POSE_KEYS) m.pose[key] = base[key] + (m.pose[key] - base[key]) * w;
  }
  const sk = solve(m.pose, tr.dims, view, m.sk);
  const fx = m.fx;
  fx.mood = act === 'yawn' ? 'happy' : act === 'sweat' ? 'focus' : act === 'serve' ? 'happy' : 'neutral';
  fx.blink = act === 'yawn' ? 1 : blinkAt(sec, tr.phaseOffset);
  fx.phone = act === 'idle' && (id === 'luotsong' || id === 'sinhvien');
  fx.cup = false;
  drawCharacterAt(ctx, tr, x, y, s * tr.height, 1, view, m.pose, sk, fx, null);
  const hx = x + sk.head.x * s;
  const hy = y + sk.head.y * s;
  const r = tr.dims.headR * s;
  if (act === 'yawn' && view === 'front' && k > 0.2 && k < 0.85) {
    // The yawn itself: a round open mouth.
    ctx.fillStyle = '#5a2a2a';
    ctx.beginPath();
    ctx.ellipse(hx, hy + r * 0.42, r * 0.17, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (act === 'yawn' && k > 0.3) {
    ctx.fillStyle = 'rgba(110, 91, 77, 0.85)';
    ctx.font = `800 ${r * 0.9}px "Be Vietnam Pro", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rise = calm ? 0 : k * r;
    ctx.fillText('z', hx + r * 1.2, hy - r * 0.9 - rise);
    ctx.font = `800 ${r * 0.65}px "Be Vietnam Pro", system-ui, sans-serif`;
    ctx.fillText('z', hx + r * 1.75, hy - r * 1.6 - rise);
  }
  if (act === 'sweat') {
    const fall = calm ? 0 : ((sec * 1.1) % 1) * r * 0.6;
    sweat(ctx, hx - r * 1.05, hy - r * 0.2 + fall, r * 0.55);
    sweat(ctx, hx + r * 1.1, hy - r * 0.5 + fall * 0.7, r * 0.42);
  }
}
