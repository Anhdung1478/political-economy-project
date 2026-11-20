import { describe, expect, it } from 'vitest';
import {
  blendPose, CLIPS, clipPose, copyPose, DEFAULT_DIMS, mixPose, newSkeleton, pose, POSE_KEYS, POSES, solve, WALKING,
  type ClipInput, type Pose, type View,
} from './rig';

const input = (o: Partial<ClipInput> = {}): ClipInput =>
  ({ t: 0, loop: 0, phase: 0, pace: 1, side: true, stoop: 0, calm: false, ...o });

const expectPose = (got: Pose, want: Pose) => {
  for (const k of POSE_KEYS) expect(got[k], k).toBeCloseTo(want[k], 12);
};

const lowestFoot = (p: Pose, view: View) => {
  const sk = solve(p, DEFAULT_DIMS, view, newSkeleton());
  return Math.max(sk.foot0.y, sk.foot1.y) + DEFAULT_DIMS.foot;
};

describe('pose blending', () => {
  it('blendPose lerps every channel; 0 and 1 give the ends', () => {
    const a = POSES.stand;
    const b = POSES.cheer;
    const out = pose();
    expectPose(blendPose(out, a, b, 0), a);
    expectPose(blendPose(out, a, b, 1), b);
    blendPose(out, a, b, 0.25);
    for (const k of POSE_KEYS) expect(out[k]).toBeCloseTo(a[k] + (b[k] - a[k]) * 0.25, 12);
  });

  it('mixPose eases and clamps the progress', () => {
    const out = pose();
    expectPose(mixPose(out, POSES.stand, POSES.cheer, -3), POSES.stand);
    expectPose(mixPose(out, POSES.stand, POSES.cheer, 7), POSES.cheer);
    // Smoothstep: slow at the ends, symmetric about the middle.
    mixPose(out, POSES.stand, POSES.cheer, 0.1);
    const early = (out.a0 - POSES.stand.a0) / (POSES.cheer.a0 - POSES.stand.a0);
    expect(early).toBeLessThan(0.1);
    mixPose(out, POSES.stand, POSES.cheer, 0.5);
    expect(out.a0).toBeCloseTo((POSES.stand.a0 + POSES.cheer.a0) / 2, 12);
  });

  it('copyPose copies; blending writes into out without touching its inputs', () => {
    const a = pose({ lean: 0.3 });
    const b = copyPose(pose(), a);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    const snapshot = { ...POSES.cheer };
    blendPose(pose(), POSES.stand, POSES.cheer, 0.4);
    expect(POSES.cheer).toEqual(snapshot);
  });
});

describe('clips', () => {
  it('every clip gives finite channels in every view, with and without reduced motion', () => {
    const out = pose();
    for (const clip of CLIPS) {
      for (const side of [true, false]) {
        for (const calm of [false, true]) {
          for (const t of [0, 0.13, 0.5, 1.7, 9]) {
            clipPose(out, clip, input({ t, loop: t * 3.1, phase: t * 7, side, calm, stoop: 0.5 }));
            for (const k of POSE_KEYS) expect(Number.isFinite(out[k]), `${clip}.${k}`).toBe(true);
          }
        }
      }
    }
  });

  it('a walk cycle repeats every 2π of phase and its legs swing opposite', () => {
    const a = clipPose(pose(), 'walk', input({ phase: 0.7 }));
    const b = clipPose(pose(), 'walk', input({ phase: 0.7 + Math.PI * 2 }));
    for (const k of POSE_KEYS) expect(b[k]).toBeCloseTo(a[k], 9);
    expect(a.l0).toBeCloseTo(-a.l1, 12);
    expect(Math.sign(a.a0 - 0.05)).toBe(-Math.sign(a.l0));   // the arm swings against its leg
  });

  it('hurrying lengthens the stride', () => {
    const slow = clipPose(pose(), 'walk', input({ phase: Math.PI / 2, pace: 1 }));
    const fast = clipPose(pose(), 'walk', input({ phase: Math.PI / 2, pace: 4 }));
    expect(Math.abs(fast.l0)).toBeGreaterThan(Math.abs(slow.l0));
  });

  it('happy hops, and reduced motion keeps the posture but not the hop', () => {
    const mid = clipPose(pose(), 'happy', input({ t: 0.18 }));
    expect(mid.lift).toBeGreaterThan(0.05);
    const calm = clipPose(pose(), 'happy', input({ t: 0.18, calm: true }));
    expect(calm.lift).toBe(0);
    expect(calm.a0).toBeCloseTo(mid.a0, 9);   // the cup still goes up
  });

  it('reduced motion: no foot tap, no breathing, no bob', () => {
    for (const clip of ['tap', 'crossed', 'idle', 'walk'] as const) {
      const a = clipPose(pose(), clip, input({ loop: 0.1, phase: 1, calm: true }));
      const b = clipPose(pose(), clip, input({ loop: 2.37, phase: 1, calm: true }));
      expect(a.lift).toBe(0);
      expect(a.k0).toBeCloseTo(b.k0, 12);
      expect(a.squash).toBeCloseTo(b.squash, 12);
    }
  });

  it('impatient: the foot taps over time', () => {
    const ks = [0, 0.05, 0.1, 0.15, 0.2, 0.25].map(loop => clipPose(pose(), 'tap', input({ loop })).k0);
    expect(Math.max(...ks) - Math.min(...ks)).toBeGreaterThan(0.2);
  });

  it('an old back bends every clip forward', () => {
    expect(clipPose(pose(), 'idle', input({ stoop: 1, calm: true })).lean).toBeGreaterThan(0.2);
    expect(clipPose(pose(), 'idle', input({ stoop: 0, calm: true })).lean).toBe(0);
  });

  it('the walking clips are the ones that travel', () => {
    expect([...WALKING].every(c => c.startsWith('walk') || c === 'shuffle')).toBe(true);
    expect(WALKING.has('idle')).toBe(false);
  });
});

describe('skeleton', () => {
  it('stands on the ground: the lower foot touches y = 0 in every view and clip', () => {
    for (const clip of CLIPS) {
      for (const view of ['side', 'front', 'back'] as const) {
        const p = clipPose(pose(), clip, input({ t: 1.5, loop: 0.3, phase: 1.1, side: view === 'side', calm: true }));
        expect(lowestFoot(p, view), `${clip} ${view}`).toBeCloseTo(0, 9);
      }
    }
  });

  it('a hop lifts the whole body', () => {
    expect(lowestFoot(pose({ lift: 0.08 }), 'front')).toBeCloseTo(-0.08, 9);
  });

  it('the relaxed stand is about one unit tall, head on top, hands at the hips', () => {
    const sk = solve(POSES.stand, DEFAULT_DIMS, 'front', newSkeleton());
    const top = sk.head.y - DEFAULT_DIMS.headR;
    expect(top).toBeGreaterThan(-1.05);
    expect(top).toBeLessThan(-0.9);
    expect(sk.head.y).toBeLessThan(sk.neck.y);
    expect(Math.abs(sk.hand0.y - sk.hip.y)).toBeLessThan(0.08);
    expect(sk.hand0.x).toBeGreaterThan(0);
    expect(sk.hand1.x).toBeLessThan(0);
  });

  it('side-on, an arm swung forward reaches +x; looking up tips the head back', () => {
    const fwd = solve(pose({ a0: 1.2 }), DEFAULT_DIMS, 'side', newSkeleton());
    expect(fwd.hand0.x).toBeGreaterThan(0.15);
    const up = solve(POSES.lookUp, DEFAULT_DIMS, 'side', newSkeleton());
    expect(up.headAngle).toBeLessThan(0);
  });

  it('arms crossed facing us: the hands cross the middle', () => {
    const sk = solve(POSES.crossed, DEFAULT_DIMS, 'front', newSkeleton());
    expect(sk.hand0.x).toBeLessThan(0.03);
    expect(sk.hand1.x).toBeGreaterThan(-0.03);
  });
});
