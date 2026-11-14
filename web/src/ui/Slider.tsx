import type { CSSProperties } from 'react';

interface Props {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}

const THUMB = 34;

/** Native range input, fully restyled, with a value bubble that follows the thumb. */
export function Slider({ label, min, max, step = 1, value, onChange, format = String, disabled }: Props) {
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100;
  return (
    <div className="slider" style={{ '--fill': `${pct}%` } as CSSProperties}>
      <div className="slider__bubble" aria-hidden="true" style={{ left: `calc(${pct}% + ${(0.5 - pct / 100) * THUMB}px)` }}>
        {format(value)}
      </div>
      <input
        type="range"
        className="slider__input"
        aria-label={label}
        aria-valuetext={format(value)}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={e => onChange(Number(e.target.value))}
      />
      <div className="slider__scale" aria-hidden="true">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
