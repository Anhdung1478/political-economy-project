// PLACEHOLDER (Task 19) — Task 20 replaces this file with the real rush screen and the craft panel.
// For now: the live street fills the screen (Game draws it), a countdown, and a dev button that ends the lunch so the
// day loop can be played end to end. The rush also ends by itself a moment after the 90 s are up.
import { useEffect } from 'react';
import { CONFIG } from '../../../../shared/sim/config';
import type { RunState, RushState } from '../../../../shared/sim/types';
import { fmtCountdown, secondsLeft } from '../../game/format';
import type { RunHandle } from '../../game/useRun';
import { Button } from '../../ui/Button';

/** Outro after the rush is done, before the afternoon (Task 20 plays its own). */
const OUTRO_MS = 1500;

/**
 * Everything the rush screen gets from Game (Task 20 uses these without rewiring Game): the live rush and the run,
 * the rush as it opened (`opening`, the street's snapshot), `dispatch` (closeEarly, endRush), `act` (craft, deliver,
 * trash, setPrice for the next tick), the clock hold (`setHold`/`held`, e.g. the day-1 trial cup), `hidden` (tab
 * hidden, clock paused), `simTime` and `subscribe` (each tick's events, e.g. for the craft panel's own effects).
 */
export interface RushScreenProps extends Pick<RunHandle,
  'opening' | 'dispatch' | 'act' | 'setHold' | 'held' | 'hidden' | 'simTime' | 'subscribe'> {
  rush: RushState;
  run: RunState;
}

export function RushScreen({ rush, dispatch }: RushScreenProps) {
  useEffect(() => {
    if (!rush.done) return;
    const t = window.setTimeout(() => dispatch({ type: 'endRush' }), OUTRO_MS);
    return () => window.clearTimeout(t);
  }, [rush.done, dispatch]);

  return (
    <div className="rush-ph">
      <div className="rush-ph__clock panel" aria-live="off">
        <span aria-hidden="true">🔥</span> {fmtCountdown(secondsLeft(CONFIG.rush.ticks - rush.tick))}
      </div>
      <div className="rush-ph__note panel">
        <b>Bảng pha chế đang được dựng</b>
        <small>(tạm, Task 20) Phố đang chạy thật; quán bạn chưa pha được ly nào.</small>
        <Button variant="dark" onClick={() => dispatch({ type: 'endRush' })}>Kết thúc trưa</Button>
      </div>
    </div>
  );
}
