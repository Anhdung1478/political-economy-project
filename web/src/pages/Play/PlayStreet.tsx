// The ambient street behind the lobby (spec §2 step 1): the first morning of the session's seed, walkers strolling,
// the same street the projector shows. Lazy, so the join form paints first; a calm gradient (CSS) shows while it
// loads or if the canvas cannot start.
import { lazy, Suspense } from 'react';

const StreetCanvas = lazy(() => import('../../scene/StreetCanvas').then(m => ({ default: m.StreetCanvas })));

export function PlayStreet({ seed }: { seed: number }) {
  return (
    <div className="play__street" aria-hidden="true">
      <Suspense fallback={null}>
        <StreetCanvas snapshot={null} mode="ambient" seed={seed} timeOfDay="morning" fallback={null} />
      </Suspense>
    </div>
  );
}
