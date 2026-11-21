// A top-bar number with an explanation that shows on hover, keyboard focus or a tap (touch has no hover); a second
// tap, Escape or a tap elsewhere closes it. The number is a real button, so it is announced and Enter/Space work. The
// tip is drawn in a portal with fixed positioning so the pill's `overflow: hidden` never clips it, and the pointer may
// move onto it and rest there (WCAG 1.4.13): leaving either only hides it after a short delay.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../ui/cx';

const MAX_W = 280;
const GAP = 8;
/** How long the tip stays after the mouse leaves the number or the tip, so it can cross the gap between them. */
const HIDE_MS = 250;

type Via = 'hover' | 'focus' | 'tap';

export function StatTip({ className, label, tip, children }: {
  className?: string;
  /** The accessible name of the number ("Uy tín 52"). */
  label: string;
  tip: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null);
  const via = useRef<Via | null>(null);
  const timer = useRef(0);
  const id = useId();

  const cancelHide = () => window.clearTimeout(timer.current);
  const show = (how: Via) => {
    cancelHide();
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    via.current = how;
    const width = Math.min(MAX_W, window.innerWidth - 2 * GAP);
    const left = Math.min(Math.max(GAP, r.left + r.width / 2 - width / 2), window.innerWidth - width - GAP);
    setAt({ left, top: r.bottom + GAP, width });
  };
  const hide = () => {
    cancelHide();
    via.current = null;
    setAt(null);
  };
  /** The mouse left the number or the tip: hide unless it comes back in time (or the tip was opened otherwise). */
  const hideSoon = () => {
    if (via.current !== 'hover') return;
    cancelHide();
    timer.current = window.setTimeout(hide, HIDE_MS);
  };

  useEffect(() => cancelHide, []);
  useEffect(() => {
    if (at === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !pop.current?.contains(t)) hide();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [at]);

  return (
    <>
      <button ref={ref} type="button" className={cx(className, 'stat-tip')} aria-label={label}
        aria-describedby={at ? id : undefined} aria-expanded={at !== null}
        onPointerEnter={e => { if (e.pointerType === 'mouse' && via.current !== 'tap') show('hover'); }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') hideSoon(); }}
        // keyboard focus only: a tap or a click focuses the button too, and is handled by the click
        onFocus={e => { if (e.currentTarget.matches(':focus-visible') && at === null) show('focus'); }}
        onBlur={() => { if (via.current === 'focus') hide(); }}
        // a tap (or Enter/Space) toggles; a click on a tip the mouse opened by hovering keeps it
        onClick={() => { if (at !== null && via.current !== 'hover') hide(); else show('tap'); }}>
        {children}
      </button>
      {at && createPortal(
        <span ref={pop} id={id} role="tooltip" className="stat-tip__pop" style={{ left: at.left, top: at.top, width: at.width }}
          onPointerEnter={e => { if (e.pointerType === 'mouse') cancelHide(); }}
          onPointerLeave={e => { if (e.pointerType === 'mouse') hideSoon(); }}>
          {tip}
        </span>,
        document.body,
      )}
    </>
  );
}
