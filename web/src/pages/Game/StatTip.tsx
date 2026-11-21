// A top-bar number with an explanation that shows on hover, keyboard focus or a tap (touch has no hover). The tip
// is drawn in a portal with fixed positioning so the pill's `overflow: hidden` never clips it.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../ui/cx';

const MAX_W = 280;
const GAP = 8;

export function StatTip({ className, label, tip, children }: {
  className?: string;
  /** The accessible name of the number ("Uy tín 52"). */
  label: string;
  tip: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; width: number } | null>(null);
  const id = useId();

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(MAX_W, window.innerWidth - 2 * GAP);
    const left = Math.min(Math.max(GAP, r.left + r.width / 2 - width / 2), window.innerWidth - width - GAP);
    setAt({ left, top: r.bottom + GAP, width });
  };
  const hide = () => setAt(null);

  useEffect(() => {
    if (at === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) hide(); };
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
      <span ref={ref} className={cx(className, 'stat-tip')} tabIndex={0} aria-label={label}
        aria-describedby={at ? id : undefined}
        onPointerEnter={e => { if (e.pointerType === 'mouse') show(); }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') hide(); }}
        onFocus={show} onBlur={hide}
        onClick={show}>
        {children}
      </span>
      {at && createPortal(
        <span id={id} role="tooltip" className="stat-tip__pop" style={{ left: at.left, top: at.top, width: at.width }}>{tip}</span>,
        document.body,
      )}
    </>
  );
}
