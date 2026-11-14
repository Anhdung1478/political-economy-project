import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from './cx';

export interface SelectOption<T> { value: T; label: string; meta?: string }

interface Props<T> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (v: T) => void;
  direction?: 'up' | 'down';
}

/** Custom listbox dropdown: button trigger + animated popover, full keyboard support. */
export function Select<T extends string | number>({ label, value, options, onChange, direction = 'down' }: Props<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex(o => o.value === value));
  const [active, setActive] = useState(selectedIndex);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex);
    list.current?.focus();
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
    trigger.current?.focus();
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); setOpen(true); }
  };
  const onListKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); trigger.current?.focus(); }
  };

  return (
    <div className="select" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => setOpen(o => !o)}
        onKeyDown={onTriggerKey}
      >
        <span className="select__label">{label}</span>
        <span className="select__value">{options[selectedIndex]?.label}</span>
        <span className="select__chev" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            ref={list}
            id={`${id}-list`}
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={`${id}-opt-${active}`}
            className={cx('select__menu', `select__menu--${direction}`)}
            onKeyDown={onListKey}
            initial={{ opacity: 0, scale: 0.96, y: direction === 'up' ? 8 : -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: direction === 'up' ? 6 : -6, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          >
            {options.map((o, i) => (
              <li
                key={String(o.value)}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.value === value}
                className={cx('select__option', i === active && 'is-active', o.value === value && 'is-selected')}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {o.meta && <span className="select__option-meta">{o.meta}</span>}
                <span>{o.label}</span>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
