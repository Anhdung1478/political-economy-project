// Small controls of the game screens: a stepper (−/value/+) that is one spin button for keyboards and screen readers.
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../ui/cx';

interface StepperProps {
  label: string;
  value: number;
  /** The value after `steps` steps (negative: down); the stepper never goes below `min`. */
  step: (value: number, steps: number) => number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  /** What a screen reader says for the value (default: `format`). */
  valueText?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** Visible label content (icon + name); `label` stays the accessible name. */
  children?: ReactNode;
  invalid?: boolean;
  className?: string;
}

/** −/+ buttons around the value; holding a button repeats, arrows and PageUp/PageDown work on the focused value. */
export function Stepper({ label, value, step, min = 0, max = Infinity, format = String, valueText, onChange, disabled,
  children, invalid, className }: StepperProps) {
  const timer = useRef<number | null>(null);
  const latest = useRef(value);
  latest.current = value;

  const go = (steps: number) => {
    const next = Math.min(max, Math.max(min, step(latest.current, steps)));
    if (next !== latest.current) {
      latest.current = next;
      onChange(next);
    }
  };
  const stopRepeat = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const startRepeat = (steps: number) => {
    stopRepeat();
    go(steps);
    let delay = 380;
    const tick = () => {
      go(steps);
      delay = Math.max(60, delay * 0.8);
      timer.current = window.setTimeout(tick, delay);
    };
    timer.current = window.setTimeout(tick, delay);
  };
  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 4, PageDown: -4 };
    if (e.key in map) {
      e.preventDefault();
      go(map[e.key]);
    } else if (e.key === 'Home' && Number.isFinite(min)) {
      e.preventDefault();
      onChange(min);
    }
  };

  const button = (steps: number, sign: string) => (
    <button type="button" className="stepper__btn" tabIndex={-1} aria-hidden="true" disabled={disabled
      || (steps < 0 ? value <= min : value >= max)}
      onPointerDown={e => { e.preventDefault(); startRepeat(steps); }}
      onPointerUp={stopRepeat} onPointerLeave={stopRepeat} onPointerCancel={stopRepeat}
      onClick={e => { if (e.detail === 0) go(steps); }}>
      {sign}
    </button>
  );

  return (
    <div className={cx('stepper', invalid && 'is-invalid', disabled && 'is-disabled', className)}>
      {children !== undefined && <span className="stepper__label" aria-hidden="true">{children}</span>}
      <div className="stepper__ctl">
        {button(-1, '−')}
        <div className="stepper__value" role="spinbutton" tabIndex={disabled ? -1 : 0} aria-label={label}
          aria-valuenow={value} aria-valuemin={Number.isFinite(min) ? min : undefined}
          aria-valuemax={Number.isFinite(max) ? max : undefined} aria-valuetext={(valueText ?? format)(value)}
          aria-invalid={invalid || undefined} aria-disabled={disabled || undefined} onKeyDown={onKey}>
          {format(value)}
        </div>
        {button(1, '+')}
      </div>
    </div>
  );
}
