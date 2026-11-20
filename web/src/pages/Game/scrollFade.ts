// A scroll affordance for panels that may overflow (report and end-screen columns): the element gets
// `data-fade="top" | "bottom" | "both"` while there is hidden content above or below, which the CSS turns into a
// fading edge and a "còn nữa ↓" hint. No re-render: the attribute is written straight to the element.
import { useCallback, useRef } from 'react';

const EDGE = 4;

function update(el: HTMLElement): void {
  const above = el.scrollTop > EDGE;
  const below = el.scrollTop + el.clientHeight < el.scrollHeight - EDGE;
  const v = above && below ? 'both' : above ? 'top' : below ? 'bottom' : '';
  if (el.dataset.fade !== v) el.dataset.fade = v;
}

/** A ref callback that keeps `data-fade` on the element up to date as it scrolls, resizes or its content grows. */
export function useScrollFade(): (el: HTMLElement | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (el === null) return;
    const on = () => update(el);
    on();
    el.addEventListener('scroll', on, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(on);
    ro?.observe(el);
    for (const c of Array.from(el.children)) ro?.observe(c);
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(on);
    mo?.observe(el, { childList: true, subtree: true });
    // content animating in (count-ups, staggered sections) changes the height for a while
    const t = window.setInterval(on, 400);
    const stop = window.setTimeout(() => window.clearInterval(t), 6000);
    cleanup.current = () => {
      el.removeEventListener('scroll', on);
      ro?.disconnect();
      mo?.disconnect();
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, []);
}
