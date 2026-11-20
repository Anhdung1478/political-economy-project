// Watches which phase the game is in (its root carries `data-phase`), so `Play` can send `player:progress` and place its
// banners without the game knowing about the socket (R2: the game never imports it). Calls `cb` with the phase when it
// changes, and once at the start if the game is already on screen; null when the game is gone.
import { isGamePhase, type GamePhase } from './playLogic';

export function watchGamePhase(cb: (phase: GamePhase | null) => void, root: Document = document): () => void {
  let last: GamePhase | null | undefined;
  const check = () => {
    const raw = root.querySelector<HTMLElement>('[data-game]')?.dataset.phase;
    const phase = isGamePhase(raw) ? raw : null;
    if (phase !== last) { last = phase; cb(phase); }
  };
  const obs = new MutationObserver(check);
  obs.observe(root.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] });
  check();
  return () => obs.disconnect();
}
