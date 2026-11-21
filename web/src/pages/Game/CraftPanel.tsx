// The craft panel (spec §6 "Pha một ly", "Quầy", §9 "Bảng pha chế"): the counter with the first four customers, the
// cup on the counter, the bin, the staff's side counter, the buffered steps and the craft buttons, lit from the
// engine's own `checkInput`. A ready cup is dragged onto a customer with Pointer Events (pointer capture, no page
// scroll, the cup tilting with the drag's inertia), or tapped and then the customer tapped. On the day-1 practice
// cup the next button is highlighted.
import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { CONFIG } from '../../../../shared/sim/config';
import { canDeliver, orderPrice } from '../../../../shared/sim/rush';
import type { CraftState, K, Size, Stock, TeaGrade, ToppingId } from '../../../../shared/sim/types';
import { cx } from '../../ui/cx';
import { TOPPING_NAMES } from './copy';
import { Cup } from './Cup';
import {
  CounterCustomer, Portrait, SizeIcon, staffLook, ToppingIcon, type PortraitState,
} from './CounterCustomer';
import {
  bufferLabels, buttonStates, dropTarget, fmtMl, stockView, type ButtonState, type CounterItem,
  type CraftButtonId,
} from './rush';

export type PracticeHint = CraftButtonId | 'deliver' | 'wait' | 'trash' | null;

export interface CraftPanelProps {
  craft: CraftState;
  /** null: the practice cup (no stock used). */
  stock: Stock | null;
  closed: boolean;
  machine: boolean;
  tea: TeaGrade;
  price: K;
  time: () => number;
  reduced: boolean;
  counter: CounterItem[];
  rest: number;
  lookOf: (customer: number) => number;
  staff: { progress: number } | null;
  /** When the staff last served (ms), for the hop. */
  staffServedAt: number;
  practice: PracticeHint;
  /** A message from the screen (a refused input, or a coach `tip` that stays longer); a new `id` shows it again. */
  notice: { id: number; text: string; tip?: boolean } | null;
  open: boolean;
  /** Each returns why it was refused (shown in the message line), or null when sent. */
  onInput: (id: CraftButtonId) => string | null;
  onTrash: () => string | null;
  onDeliver: (customer: number) => string | null;
  onClose: () => void;
}

const DRAG_START_PX = 8;

let ghostSeq = 0;
/**
 * A copied SVG still points at the live cup's gradient and clip (`url(#id)`), which unmount as soon as the counter
 * empties; the copy gets ids of its own.
 */
function renameIds(root: Element): void {
  ghostSeq += 1;
  const map = new Map<string, string>();
  root.querySelectorAll('[id]').forEach(el => {
    const fresh = `${el.id}-fly${ghostSeq}`;
    map.set(el.id, fresh);
    el.id = fresh;
  });
  if (map.size === 0) return;
  root.querySelectorAll('*').forEach(el => {
    for (const attr of ['fill', 'clip-path', 'stroke', 'mask', 'filter']) {
      const v = el.getAttribute(attr);
      const m = v === null ? null : /^url\(#(.+)\)$/.exec(v);
      if (m !== null && map.has(m[1])) el.setAttribute(attr, `url(#${map.get(m[1])})`);
    }
  });
}

function TeaIcon({ grade }: { grade: TeaGrade }) {
  const fill = grade === 'premium' ? '#a9693a' : grade === 'skimp' ? '#dcc7a5' : '#c99560';
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" aria-hidden="true">
      <path d="M6 7 L18 7 L19 21 Q19 23 17 23 L7 23 Q5 23 5 21 Z" fill="#fffcf7" stroke="#2a1d15" strokeWidth={1.6} />
      <path d="M5.6 12 L18.4 12 L19 21 Q19 23 17 23 L7 23 Q5 23 5 21 Z" fill={fill} />
      <path d="M6 7 L2 4 L7 9" fill="#fffcf7" stroke="#2a1d15" strokeWidth={1.4} strokeLinejoin="round" />
      <path d="M18 9 Q24 10 22 16 Q21 19 18.6 18" fill="none" stroke="#2a1d15" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}

function IceIcon() {
  return (
    <svg width={26} height={26} viewBox="0 0 26 26" aria-hidden="true">
      <rect x={3} y={9} width={11} height={11} rx={3} fill="#e8f6ff" stroke="#6fa8c9" strokeWidth={1.6} transform="rotate(-12 8.5 14.5)" />
      <rect x={12} y={5} width={11} height={11} rx={3} fill="#f4fbff" stroke="#6fa8c9" strokeWidth={1.6} transform="rotate(10 17.5 10.5)" />
      <path d="M6 12 L9 11" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

function BinIcon({ open }: { open: boolean }) {
  return (
    <svg className="rbin__svg" width={46} height={50} viewBox="0 0 46 50" aria-hidden="true">
      <path d="M8 16 L38 16 L35 46 Q35 48 33 48 L13 48 Q11 48 11 46 Z" fill="#8a8f99" stroke="#3d3a3e" strokeWidth={2} strokeLinejoin="round" />
      <path d="M17 22 L18 42 M23 22 L23 42 M29 22 L28 42" stroke="#5f636b" strokeWidth={2} strokeLinecap="round" />
      <g className="rbin__lid" style={{ transform: open ? 'rotate(-28deg)' : undefined }}>
        <rect x={5} y={9} width={36} height={6} rx={3} fill="#a5aab3" stroke="#3d3a3e" strokeWidth={2} />
        <rect x={18} y={4} width={10} height={6} rx={2} fill="none" stroke="#3d3a3e" strokeWidth={2} />
      </g>
    </svg>
  );
}

function StaffCounter({ progress, servedAt, reduced }: { progress: number; servedAt: number; reduced: boolean }) {
  const { look, traits } = staffLook();
  const latest = useRef(servedAt);
  latest.current = servedAt;
  const state = useCallback((wall: number): PortraitState => {
    const since = (wall - latest.current) / 1000;
    return since < 1.4 ? { clip: 'happy', mood: 'happy', t: since, cup: since < 0.9 } : { clip: 'idle', mood: 'focus', t: 0, cup: false };
  }, []);
  const share = Math.min(1, progress / CONFIG.craft.staffTicks);
  const left = Math.ceil((CONFIG.craft.staffTicks - progress) / 10);
  const r = 23;
  const c = 2 * Math.PI * r;
  return (
    <div className="rstaff" aria-label={`Nhân viên đang pha: còn khoảng ${left} giây`}>
      <div className="rstaff__ring">
        <svg viewBox="0 0 54 54" aria-hidden="true">
          <circle cx={27} cy={27} r={r} className="rstaff__track" />
          <circle cx={27} cy={27} r={r} className="rstaff__prog" strokeDasharray={c}
            strokeDashoffset={(c * (1 - share)).toFixed(1)} transform="rotate(-90 27 27)" />
        </svg>
        <Portrait look={look} traits={traits} state={state} reduced={reduced} className="rstaff__face" />
      </div>
      <span className="rstaff__label"><b>Nhân viên</b><small>{progress === 0 ? 'chờ khách' : `ly kế ~${left}s`}</small></span>
    </div>
  );
}

function CraftButton({ b, price, stock, tea, next, onPress }: {
  b: ButtonState; price: K; stock: Stock | null; tea: TeaGrade; next: boolean; onPress: (b: ButtonState) => void;
}) {
  const sv = stock === null ? null : stockView(stock);
  let icon: React.ReactNode;
  let label: string;
  let sub: React.ReactNode = null;
  let level: 'ok' | 'low' | 'out' = 'ok';
  const id = b.id;
  if (id === 'S' || id === 'M' || id === 'L') {
    icon = <SizeIcon size={id} px={28} />;
    label = id;
    sub = `${orderPrice(price, { size: id as Size, toppings: [], noIce: false })}k`;
  } else if (id === 'ice') {
    icon = <IceIcon />;
    label = 'Đá';
  } else if (id === 'tea') {
    icon = <TeaIcon grade={tea} />;
    label = 'Trà';
    if (sv !== null) {
      sub = fmtMl(sv.teaMl);
      level = sv.tea;
    }
  } else {
    icon = <ToppingIcon id={id as ToppingId} size={26} />;
    label = TOPPING_NAMES[id as ToppingId];
    if (sv !== null) {
      const t = sv.toppings[id as ToppingId];
      sub = `còn ${t.n}`;
      level = t.level;
    }
  }
  return (
    <button type="button" className={cx('cbtn', `cbtn--${b.input.k}`, b.why === null ? 'is-lit' : 'is-dark', next && 'is-next',
      level !== 'ok' && `is-${level}`)}
      aria-disabled={b.why !== null} data-craft={id} title={b.reason ?? undefined}
      aria-label={`${b.input.k === 'size' ? `Ly ${id}` : label}${b.reason ? ` — ${b.reason}` : ''}`}
      onClick={() => onPress(b)}>
      <span className="cbtn__icon">{icon}</span>
      <span className="cbtn__label">{label}</span>
      {sub !== null && <span className="cbtn__sub">{sub}</span>}
      {next && <span className="cbtn__finger" aria-hidden="true">👆</span>}
    </button>
  );
}

function CraftPanelView(p: CraftPanelProps) {
  const { craft } = p;
  const states = buttonStates(craft, p.stock, p.closed);
  const ready = canDeliver(craft) && !p.closed;
  const hasCup = craft.cup !== null;

  // ── messages ──
  const [hint, setHint] = useState<{ id: number; text: string; bad: boolean; ms: number } | null>(null);
  const hintId = useRef(0);
  const say = useCallback((text: string, bad = true, ms = 1900) => {
    hintId.current += 1;
    setHint({ id: hintId.current, text, bad, ms });
  }, []);
  useEffect(() => {
    if (p.notice !== null) say(p.notice.text, !p.notice.tip, p.notice.tip ? 4500 : 1900);
  }, [p.notice, say]);
  useEffect(() => {
    if (hint === null) return;
    const t = window.setTimeout(() => setHint(h => (h?.id === hint.id ? null : h)), hint.ms);
    return () => window.clearTimeout(t);
  }, [hint]);

  // ── buttons ──
  // A dark button still asks: the screen judges it against what was already sent this tick, which may have changed.
  const press = useCallback((b: ButtonState) => {
    const why = p.onInput(b.id);
    if (why !== null) say(why);
  }, [p.onInput, say]);

  // ── the cup: drag or tap ──
  const cupBox = useRef<HTMLDivElement>(null);
  const binRef = useRef<HTMLButtonElement>(null);
  const sloshRef = useRef<((a: number) => void) | null>(null);
  const [selected, setSelected] = useState(false);
  const [hot, setHot] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [binOpen, setBinOpen] = useState(false);
  const binTimer = useRef(0);
  const drag = useRef<null | {
    id: number; x0: number; y0: number; x: number; y: number; lastX: number; lastT: number; vx: number; tilt: number;
    moved: boolean; t0: number; raf: number; scale: number; hitAt: number;
  }>(null);
  useEffect(() => () => {
    if (drag.current !== null) cancelAnimationFrame(drag.current.raf);
    drag.current = null;
    window.clearTimeout(binTimer.current);
  }, []);

  useEffect(() => {
    if (!ready) setSelected(false);
  }, [ready]);

  /** The customer under a cup held at (x, y), from the cards as they stand now (the row slides when someone leaves). */
  const targetAt = (x: number, y: number): number | null => dropTarget(
    [...document.querySelectorAll<HTMLElement>('[data-drop-customer]')].map(el => {
      const r = el.getBoundingClientRect();
      return { id: Number(el.dataset.dropCustomer), left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }), x, y);

  /**
   * The cup flies to a customer or into the bin. A copy of the cup flies, so the sim emptying the counter on its next
   * tick cannot cut the flight short, and the next cup can already be set down while this one is in the air.
   */
  const flyPrepare = useCallback((target: Element, kind: 'deliver' | 'trash'): { go: () => void; cancel: () => void } => {
    const none = { go: () => {}, cancel: () => {} };
    const el = cupBox.current;
    const parent = el?.parentElement ?? null;
    if (el === null || parent === null) return none;
    const cur = el.style.transform || 'translate(0px, 0px)';
    if (p.reduced) return { go: () => { el.style.transform = ''; }, cancel: () => {} };
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.remove('is-ready', 'is-next');
    ghost.classList.add('is-ghost');
    ghost.removeAttribute('role');
    ghost.removeAttribute('tabindex');
    ghost.removeAttribute('aria-pressed');
    ghost.removeAttribute('aria-label');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.querySelector('.cbtn__finger')?.remove();
    renameIds(ghost);
    // a copied canvas comes out blank: the cup's last frame goes into the copy
    const drawn = el.querySelectorAll('canvas');
    ghost.querySelectorAll('canvas').forEach((c, i) => {
      if (drawn[i] !== undefined && drawn[i].width > 0 && drawn[i].height > 0) c.getContext('2d')?.drawImage(drawn[i], 0, 0);
    });
    Object.assign(ghost.style, {
      position: 'absolute', left: `${el.offsetLeft}px`, top: `${el.offsetTop}px`, width: `${el.offsetWidth}px`,
      height: `${el.offsetHeight}px`, margin: '0', transform: cur,
    });
    // the copy is taken now, before the counter re-renders; nothing is shown until `go`
    return {
      cancel: () => {},
      go: () => {
        el.style.transform = '';
        parent.appendChild(ghost);
        const from = ghost.getBoundingClientRect();
        const to = target.getBoundingClientRect();
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        // the drag offset is already in `from`, so the flight adds to it
        const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(cur);
        const ox = m ? Number(m[1]) : 0;
        const oy = m ? Number(m[2]) : 0;
        const lift = kind === 'trash' ? -90 : -30;
        const spin = kind === 'trash' ? 200 : 0;
        const flight = ghost.animate([
          { transform: cur, opacity: 1 },
          { transform: `translate(${ox + dx * 0.5}px, ${oy + dy * 0.5 + lift}px) rotate(${spin / 2}deg) scale(${kind === 'trash' ? 0.7 : 0.75})`, opacity: 1, offset: 0.5 },
          { transform: `translate(${ox + dx}px, ${oy + dy}px) rotate(${spin}deg) scale(${kind === 'trash' ? 0.25 : 0.35})`, opacity: 0 },
        ], { duration: kind === 'trash' ? 520 : 400, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' });
        flight.onfinish = () => ghost.remove();
        flight.oncancel = () => ghost.remove();
      },
    };
  }, [p.reduced]);

  const deliverTo = useCallback((customer: number) => {
    const card = document.querySelector(`[data-drop-customer="${customer}"]`);
    setSelected(false);
    setHot(null);
    setHint(null);
    if (card === null) return;
    // flown from a copy taken now, before the counter re-renders empty
    const fly = flyPrepare(card, 'deliver');
    const why = p.onDeliver(customer);
    if (why !== null) {
      fly.cancel();
      say(why);
      springBack();
      return;
    }
    fly.go();
  }, [flyPrepare, p.onDeliver, say]);

  const trash = useCallback(() => {
    if (!hasCup || p.closed) {
      say(p.closed ? 'Quán đã đóng cửa' : 'Không có ly nào để bỏ');
      return;
    }
    const fly = binRef.current === null ? null : flyPrepare(binRef.current, 'trash');
    const why = p.onTrash();
    if (why !== null) {
      fly?.cancel();
      say(why);
      return;
    }
    setSelected(false);
    setBinOpen(true);
    window.clearTimeout(binTimer.current);
    binTimer.current = window.setTimeout(() => setBinOpen(false), 650);
    fly?.go();
  }, [hasCup, p.closed, p.onTrash, flyPrepare, say]);

  const springBack = () => {
    const el = cupBox.current;
    if (el === null) return;
    const cur = el.style.transform;
    el.style.transform = '';
    if (!p.reduced && cur) {
      el.animate([{ transform: cur }, { transform: 'translate(0px, 0px) rotate(0deg)' }],
        { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    }
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    // one finger or the main button; a second finger does not take over a drag
    if (!e.isPrimary || e.button !== 0 || drag.current !== null || !hasCup) return;
    if (!ready) {
      say(p.closed ? 'Quán đã đóng cửa' : craft.cup?.teaMl ? 'Đợi xong bước này đã' : 'Ly chưa có trà, chưa giao được');
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    // a tall desktop cup shrinks a little in hand, so the order it is held over stays readable
    const scale = Math.min(1.06, 170 / Math.max(1, e.currentTarget.offsetHeight));
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, lastX: e.clientX,
      lastT: performance.now(), vx: 0, tilt: 0, moved: false, t0: performance.now(), raf: 0, scale, hitAt: 0 };
    const tick = (now: number) => {
      const d = drag.current;
      if (d === null) return;
      d.raf = requestAnimationFrame(tick);
      d.vx *= 0.86;
      const target = Math.max(-38, Math.min(38, d.vx * 26));
      d.tilt += (target - d.tilt) * (p.reduced ? 1 : 0.22);
      if (!d.moved) return;
      const el = cupBox.current;
      if (el !== null) el.style.transform = `translate(${d.x - d.x0}px, ${d.y - d.y0}px) rotate(${(p.reduced ? 0 : d.tilt).toFixed(1)}deg) scale(${d.scale.toFixed(3)})`;
      // held still while the row slides: the highlight follows the card now under the cup
      if (now - d.hitAt > 120) {
        d.hitAt = now;
        const id = targetAt(d.x, d.y);
        setHot(h => (h === id ? h : id));
      }
    };
    drag.current.raf = requestAnimationFrame(tick);
  };

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null || e.pointerId !== d.id) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.vx = d.vx * 0.5 + ((e.clientX - d.lastX) / dt) * 0.5;
    d.lastX = e.clientX;
    d.lastT = now;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.moved && Math.hypot(d.x - d.x0, d.y - d.y0) > DRAG_START_PX) {
      d.moved = true;
      setDragging(true);
      setSelected(false);
    }
    if (d.moved) {
      sloshRef.current?.(Math.min(2, Math.abs(d.vx) * 2));
      d.hitAt = now;
      const id = targetAt(d.x, d.y);
      setHot(h => (h === id ? h : id));
    }
  };

  const endDrag = (e: RPointerEvent<HTMLDivElement>, cancel: boolean) => {
    const d = drag.current;
    if (d === null || e.pointerId !== d.id) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    setDragging(false);
    setHot(null);
    if (!d.moved) {
      if (!cancel && performance.now() - d.t0 < 600) {
        setSelected(s => !s);
        if (!selected) say('Giờ chạm vào khách để giao ly', false);
      }
      return;
    }
    // the target is read now, from where the cards stand and where the finger lifted
    const target = cancel ? null : targetAt(e.clientX, e.clientY);
    if (target !== null) deliverTo(target);
    else springBack();
  };

  const pick = useCallback((customer: number) => {
    if (selected && ready) deliverTo(customer);
    else if (ready) say('Chạm vào ly trước, rồi chạm khách (hoặc kéo ly thả vào khách)', false);
    else say(hasCup ? 'Ly chưa xong' : 'Chưa có ly nào: pha một ly đã', false);
  }, [selected, ready, hasCup, deliverTo, say]);

  // Keyboard: S/M/L sizes, D đá, T trà, 1–3 toppings, Q W E R hand the ready cup to customer 1–4, X the bin. One
  // listener that always reads this render's buttons (fast keys come between renders' effects).
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t !== null && (t.tagName === 'INPUT' || t.closest('[role="dialog"]') !== null)) return;
    const k = e.key.toLowerCase();
    const map: Record<string, CraftButtonId> = { s: 'S', m: 'M', l: 'L', d: 'ice', t: 'tea', 1: 'pearl', 2: 'jelly', 3: 'pudding' };
    const id = map[k];
    if (id !== undefined) {
      const b = states.find(x => x.id === id);
      if (b !== undefined) press(b);
      e.preventDefault();
      return;
    }
    const slot = ['q', 'w', 'e', 'r'].indexOf(k);
    if (slot >= 0) {
      const item = p.counter[slot];
      if (item !== undefined && item.leaving === null && ready) deliverTo(item.customer);
      e.preventDefault();
      return;
    }
    if (k === 'x' || k === 'delete' || k === 'backspace') {
      trash();
      e.preventDefault();
    }
  };
  useEffect(() => {
    if (!p.open) return;
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.open]);

  const running = craft.anim;
  const runLabel = running === null ? null : running.step === 'deliver' ? 'Đang giao ly…'
    : running.step === 'tea' ? 'Đang rót trà…' : running.step === 'ice' ? 'Đang đổ đá…'
      : running.step === 'size' ? 'Đặt ly…' : 'Thêm topping…';
  const buffered = bufferLabels(craft);
  const waiting = p.counter.filter(i => i.leaving === null).length + p.rest;
  const nextKey = p.practice;

  return (
    <section className={cx('rcraft', dragging && 'is-dragging', selected && 'is-selected')} aria-label="Bảng pha chế">
      <header className="rcraft__head">
        <span className="rcraft__grip" aria-hidden="true" />
        <h2>Quầy của bạn</h2>
        <span className="rcraft__waiting">{waiting} khách chờ</span>
        <button type="button" className="rcraft__close" onClick={p.onClose} aria-label="Thu bảng pha chế">
          <span aria-hidden="true">▾</span><span className="rcraft__close-txt">Thu bảng</span>
        </button>
      </header>

      <div className={cx('rcounter', (selected || dragging) && 'is-targeting')}>
        {p.counter.map((it, i) => (
          <CounterCustomer key={it.customer} customer={it.customer} look={p.lookOf(it.customer)} order={it.order}
            joinedTick={it.joinedTick} index={i} leaving={it.leaving?.kind ?? null} leftAt={it.leaving?.at ?? 0}
            time={p.time} reduced={p.reduced} hot={hot === it.customer} target={(selected || dragging) && it.leaving === null}
            onPick={pick} />
        ))}
        {p.counter.length === 0 && <p className="rcounter__empty">Chưa có khách ở quầy…</p>}
        {p.rest > 0 && <span className="rcounter__rest" aria-label={`Còn ${p.rest} khách xếp sau`}>+{p.rest}</span>}
      </div>

      <div className="cstage">
        <div className="cstage__top">
        <button ref={binRef} type="button" className={cx('rbin', nextKey === 'trash' && 'is-next')} onClick={trash}
          aria-label="Bỏ ly vào thùng rác" aria-disabled={!hasCup || p.closed}>
          <BinIcon open={binOpen} />
          <span>Bỏ ly</span>
          {nextKey === 'trash' && <span className="cbtn__finger" aria-hidden="true">👆</span>}
        </button>

        <div className="cstage__counter">
          <div ref={cupBox} className={cx('cstage__cup', ready && 'is-ready', nextKey === 'deliver' && 'is-next')}
            role="button" tabIndex={ready ? 0 : -1}
            aria-label={ready ? (selected ? 'Ly đã chọn: chạm khách để giao' : 'Ly đã xong: kéo vào khách hoặc chạm để chọn') : 'Ly đang pha'}
            aria-pressed={selected}
            onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && ready) { e.preventDefault(); setSelected(s => !s); } }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={e => endDrag(e, false)}
            onPointerCancel={e => endDrag(e, true)} onLostPointerCapture={e => endDrag(e, true)}>
            <Cup craft={craft} machine={p.machine} tea={p.tea} time={p.time} reduced={p.reduced} ready={ready} sloshRef={sloshRef} />
            {nextKey === 'deliver' && <span className="cbtn__finger cbtn__finger--cup" aria-hidden="true">👆</span>}
          </div>
        </div>

        {p.staff !== null && <StaffCounter progress={p.staff.progress} servedAt={p.staffServedAt} reduced={p.reduced} />}
        </div>
        <div className="cstage__front">
          <div className="cstage__status" aria-live="polite">
            {craft.cup === null && running === null && <span className="cstage__idle">{p.closed ? 'Đã đóng cửa' : 'Chọn size để đặt ly'}</span>}
            {runLabel !== null && <span className="cstage__run">{runLabel}</span>}
            {ready && !runLabel && <span className="cstage__ready">{selected ? 'Chạm khách để giao' : 'Kéo ly vào khách'}</span>}
          </div>
          <ol className="rbuffer" aria-label={`Bấm trước: ${buffered.length === 0 ? 'chưa có' : buffered.join(', ')}`}>
            {Array.from({ length: CONFIG.craft.bufferMax }, (_, i) => (
              <li key={i} className={cx('rbuffer__slot', buffered[i] !== undefined && 'is-full')}>
                {buffered[i] ?? ''}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className={cx('chint', hint !== null && 'is-on', hint?.bad && 'is-bad', hint !== null && !hint.bad && hint.ms > 1900 && 'is-tip')}
        role="status" aria-live="polite">
        {hint?.text ?? ''}
      </div>

      <div className="cbtns">
        {states.map(b => (
          <CraftButton key={b.id} b={b} price={p.price} stock={p.stock} tea={p.tea} next={nextKey === b.id} onPress={press} />
        ))}
      </div>
    </section>
  );
}

/** Re-rendered at most once per tick; the cup and the portraits animate on their own. */
export const CraftPanel = memo(CraftPanelView);

