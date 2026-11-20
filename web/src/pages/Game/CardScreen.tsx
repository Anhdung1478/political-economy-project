// The afternoon cards (spec §7, §9 "Thẻ"): a character drops by the shop. The card is dealt onto the street from the
// deck, the speaker (drawn with the street's own jointed character renderer) breathes, blinks and gestures, and the
// player picks one of two answers by swiping (the card tilts with the finger and flies off) or with the buttons
// (keyboard: ← and →). Each answer shows which stats it touches (💰 ⭐ 🧋 🏛️), never by how much.
import {
  animate, motion, useMotionValue, useReducedMotion, useTransform, type PanInfo,
} from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CARDS, type Affect, type CardDef } from '../../../../shared/sim/cards';
import type { CardId, Choice, RunState } from '../../../../shared/sim/types';
import type { Intent } from '../../game/runStore';
import {
  characterPose, drawCharacterAt, traitsOf, type Archetype, type FigureFx, type Traits,
} from '../../scene/draw/characters';
import type { Mood } from '../../scene/draw/faces';
import { blendPose, newSkeleton, pose, solve, type Clip, type ClipInput } from '../../scene/rig';
import { cx } from '../../ui/cx';
import './afternoon.css';

// ── The speakers ────────────────────────────────────────────────────────────────────────────────────────────────────

interface SpeakerLook {
  archetype: Archetype;
  fem: boolean;
  /** The talking gesture they make between breaths. */
  gesture: Clip;
  mood: Mood;
  /** Mood while gesturing. */
  gestureMood?: Mood;
  /** Costume touches over the generated look. */
  dress?: Partial<Traits>;
  /** A prop at their side (an emoji old enough to render everywhere). */
  prop: string;
  /** The backdrop: [sky, ground]. */
  scene: [string, string];
  phone?: boolean;
}

const SPEAKERS: Record<CardId, SpeakerLook> = {
  cartel: { archetype: 'office', fem: false, gesture: 'shrug', mood: 'happy', prop: '🤝', scene: ['#2f3b52', '#1c2436'],
    dress: { top: '#2b3550', topEdge: '#161c2c', longSleeves: true, neck: 'tie', neckColor: '#c9772a', glasses: 'sun', bottom: '#1f2638', bottomStyle: 'pants' } },
  shockTopping: { archetype: 'shipper', fem: false, gesture: 'whisper', mood: 'curious', gestureMood: 'happy', prop: '📦',
    scene: ['#6d4a7a', '#3f2a49'], dress: { glasses: 'sun', hat: 'cap', hatColor: '#3a3a3a', hatEdge: '#1a1a1a', bag: 'box' } },
  blackMarket: { archetype: 'student', fem: true, gesture: 'whisper', mood: 'annoyed', gestureMood: 'curious', prop: '💵',
    scene: ['#3b3a33', '#22211c'] },
  tax: { archetype: 'office', fem: true, gesture: 'idle', mood: 'neutral', gestureMood: 'happy', prop: '📋',
    scene: ['#c99560', '#94531a'], dress: { top: '#cdb67c', topEdge: '#9a8550', longSleeves: true, neck: 'collar', bottom: '#4b5a3a', bottomStyle: 'pants', glasses: 'none' } },
  inspection: { archetype: 'office', fem: false, gesture: 'phone', mood: 'scared', gestureMood: 'puzzled', prop: '🔬', phone: true,
    scene: ['#5aa0a8', '#2f6b73'], dress: { top: '#f5f7f8', topEdge: '#b9c2c6', longSleeves: true, neck: 'lanyard', neckColor: '#2f6b73', glasses: 'round' } },
  reporter: { archetype: 'office', fem: true, gesture: 'shrug', mood: 'curious', gestureMood: 'happy', prop: '🎤',
    scene: ['#de4f5a', '#a8323c'], dress: { neck: 'lanyard', neckColor: '#de4f5a', glasses: 'none' } },
  kol: { archetype: 'kol', fem: true, gesture: 'selfie', mood: 'happy', prop: '📱', phone: true, scene: ['#ef9aa6', '#c25f70'] },
  tab: { archetype: 'homemaker', fem: true, gesture: 'shrug', mood: 'happy', gestureMood: 'puzzled', prop: '📒', scene: ['#e9b872', '#c9772a'] },
  student: { archetype: 'student', fem: false, gesture: 'happy', mood: 'happy', prop: '🎓', scene: ['#8cc06b', '#5b8f3e'] },
  complaint: { archetype: 'homemaker', fem: true, gesture: 'crossed', mood: 'annoyed', gestureMood: 'angry', prop: '😤', scene: ['#de4f5a', '#94323c'] },
  deliveryAd: { archetype: 'shipper', fem: false, gesture: 'phone', mood: 'happy', prop: '🛵', phone: true, scene: ['#5b8f3e', '#3e6a27'] },
  scholarship: { archetype: 'elder', fem: false, gesture: 'shrug', mood: 'happy', prop: '🎓', scene: ['#b49ad1', '#6d4a7a'] },
};

const speakerTraits = new Map<CardId, Traits>();

/** The speaker's look: the first generated look of their archetype and leaning, then their costume. */
export function traitsForSpeaker(id: CardId): Traits {
  const hit = speakerTraits.get(id);
  if (hit !== undefined) return hit;
  const s = SPEAKERS[id];
  let found: Traits | null = null;
  for (let look = 11; look < 20000 && found === null; look += 7) {
    const t = traitsOf(look);
    if (t.archetype === s.archetype && t.fem === s.fem && !t.cane && t.hat !== 'helmet') found = t;
  }
  const tr: Traits = { ...(found ?? traitsOf(1)), ...s.dress, cane: false };
  speakerTraits.set(id, tr);
  return tr;
}

const sk = newSkeleton();
const restPose = pose();
const gestPose = pose();
const outPose = pose();
const input: ClipInput = { t: 0, loop: 0, phase: 0, pace: 0, side: false, stoop: 0, calm: false };
const fx: FigureFx = { mood: 'neutral', blink: 0, cup: false, phone: false };

/** Breathe 2.6 s, gesture 2.2 s (blended in and out), and again. */
const CYCLE = 4.8;
const REST = 2.6;

function paintSpeaker(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, id: CardId, tr: Traits,
  sec: number, calm: boolean): void {
  const s = SPEAKERS[id];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const c = (sec + tr.phaseOffset) % CYCLE;
  const into = c - REST;
  // the gesture's weight: 0 at rest, eased up over 0.35 s and back down at the end
  const wgt = calm ? 0 : into <= 0 ? 0 : Math.min(1, into / 0.35, (CYCLE - c) / 0.35);
  input.loop = sec + tr.phaseOffset;
  input.stoop = tr.stoop;
  input.calm = calm;
  input.t = 0;
  characterPose(restPose, 'idle', input, tr);
  input.t = Math.max(0, into);
  characterPose(gestPose, s.gesture, input, tr);
  blendPose(outPose, restPose, gestPose, wgt);
  solve(outPose, tr.dims, 'front', sk);
  fx.mood = wgt > 0.5 ? s.gestureMood ?? s.mood : s.mood;
  fx.blink = (sec + tr.phaseOffset) % (3 + (tr.phaseOffset % 2)) < 0.12 ? 1 : 0;
  fx.phone = s.phone === true && wgt > 0.3;
  fx.cup = false;
  // Down to the knees: the whole head and both hands in view, the legs below the frame.
  const size = Math.min(h * 0.98, w * 1.15) * tr.height;
  drawCharacterAt(ctx, tr, w / 2, h * 0.08 + size, size, 1, 'front', outPose, sk, fx, null);
}

/** The speaker on a canvas, breathing, blinking and gesturing (one rAF loop, about 30 fps). */
export function Speaker({ id, className }: { id: CardId; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion() ?? false;
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d') ?? null;
    if (el === null || ctx === null) return;
    const tr = traitsForSpeaker(id);
    let size = { w: 1, h: 1, dpr: 1 };
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      size = { w, h, dpr };
    };
    fit();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    ro?.observe(el);
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 32) return;
      last = now;
      paintSpeaker(ctx, size.w, size.h, size.dpr, id, tr, (now - t0) / 1000 + 0.4, reduced);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [id, reduced]);
  return <canvas ref={canvas} className={cx('speaker', className)} aria-hidden="true" />;
}

// ── Affect icons (drawn, so every one renders on every device) ──────────────────────────────────────────────────────

export const AFFECT_NAMES: Record<Affect, string> = { cash: 'tiền', rep: 'uy tín', stock: 'hàng', law: 'pháp luật' };

export function AffectIcon({ kind, size = 22 }: { kind: Affect; size?: number }) {
  return (
    <svg className={`aff aff--${kind}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {kind === 'cash' && (<>
        <circle cx={12} cy={12} r={9.5} fill="#f2c14e" stroke="#94531a" strokeWidth={1.6} />
        <circle cx={12} cy={12} r={6.5} fill="none" stroke="#c9922a" strokeWidth={1.2} />
        <path d="M12 7.5v9M9.6 10c0-1.2 1.1-1.8 2.4-1.8s2.4.6 2.4 1.6c0 2.4-4.8 1.4-4.8 3.9 0 1 1 1.8 2.4 1.8s2.4-.7 2.4-1.8"
          fill="none" stroke="#94531a" strokeWidth={1.5} strokeLinecap="round" />
      </>)}
      {kind === 'rep' && (
        <path d="M12 2.6l2.8 5.8 6.3.8-4.6 4.4 1.2 6.3L12 16.9l-5.7 3 1.2-6.3L2.9 9.2l6.3-.8z"
          fill="#ffd25e" stroke="#c9772a" strokeWidth={1.6} strokeLinejoin="round" />
      )}
      {kind === 'stock' && (<>
        <path d="M6.5 7.5h11l-1.5 13.2a1.4 1.4 0 01-1.4 1.3H9.4a1.4 1.4 0 01-1.4-1.3z" fill="#fffcf7" stroke="#3a271c" strokeWidth={1.5} strokeLinejoin="round" />
        <path d="M7.3 12h9.4l-1 8.6a1 1 0 01-1 .9H9.3a1 1 0 01-1-.9z" fill="#c99560" />
        <circle cx={10} cy={19} r={1.1} fill="#3a271c" /><circle cx={12.6} cy={18.4} r={1.1} fill="#3a271c" /><circle cx={14.2} cy={19.6} r={1} fill="#3a271c" />
        <rect x={5} y={5.6} width={14} height={2.6} rx={1.3} fill="#3a271c" />
        <path d="M13.5 5.6L15.5 1.5" stroke="#de4f5a" strokeWidth={1.8} strokeLinecap="round" />
      </>)}
      {kind === 'law' && (<>
        <path d="M3 9L12 3.5 21 9z" fill="#e9b872" stroke="#6e5b4d" strokeWidth={1.4} strokeLinejoin="round" />
        <rect x={4} y={9} width={16} height={1.8} fill="#6e5b4d" />
        <rect x={5.5} y={11.5} width={2.2} height={6.5} fill="#fffcf7" stroke="#6e5b4d" strokeWidth={1.1} />
        <rect x={10.9} y={11.5} width={2.2} height={6.5} fill="#fffcf7" stroke="#6e5b4d" strokeWidth={1.1} />
        <rect x={16.3} y={11.5} width={2.2} height={6.5} fill="#fffcf7" stroke="#6e5b4d" strokeWidth={1.1} />
        <rect x={3} y={18.5} width={18} height={2.4} rx={0.6} fill="#6e5b4d" />
      </>)}
    </svg>
  );
}

export function Affects({ list, size }: { list: Affect[]; size?: number }) {
  if (list.length === 0) return <span className="affects affects--none">không ảnh hưởng gì</span>;
  return (
    <span className="affects" aria-label={`Ảnh hưởng: ${list.map(a => AFFECT_NAMES[a]).join(', ')}`}>
      {list.map(a => <AffectIcon key={a} kind={a} size={size} />)}
    </span>
  );
}

// ── The card ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Dispatch = (i: Intent) => void;

/** How far (px) or how fast (px/s) a swipe must go to count as a choice. */
const SWIPE_PX = 110;
const SWIPE_V = 650;

export interface CardViewProps {
  card: CardDef;
  index: number;
  total: number;
  day: number;
  onChoose: (c: Choice) => void;
  /** A card shown for a vote only (the end screen's reporter card): no deal from the deck, no counter. */
  inline?: boolean;
}

/** One card with its two answers, swipe and buttons. */
export function CardView({ card, index, total, day, onChoose, inline }: CardViewProps) {
  const reduced = useReducedMotion() ?? false;
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-320, 0, 320], [-16, 0, 16]);
  const leanA = useTransform(x, [-SWIPE_PX, -24, 0], [1, 0, 0]);
  const leanB = useTransform(x, [0, 24, SWIPE_PX], [0, 0, 1]);
  const btnA = useTransform(x, [-SWIPE_PX, 0], [1.06, 1]);
  const btnB = useTransform(x, [0, SWIPE_PX], [1, 1.06]);
  const [gone, setGone] = useState<Choice | null>(null);
  const goneRef = useRef(false);

  const choose = useCallback((c: Choice) => {
    if (goneRef.current) return;
    goneRef.current = true;
    setGone(c);
    if (reduced) {
      onChoose(c);
      return;
    }
    const dir = c === 'A' ? -1 : 1;
    void animate(x, dir * (window.innerWidth * 0.6 + 420), { duration: 0.42, ease: [0.4, 0, 0.9, 0.6] })
      .then(() => onChoose(c));
  }, [onChoose, reduced, x]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); choose('A'); }
      if (e.key === 'ArrowRight') { e.preventDefault(); choose('B'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const off = info.offset.x;
    const v = info.velocity.x;
    if (off < -SWIPE_PX || v < -SWIPE_V) choose('A');
    else if (off > SWIPE_PX || v > SWIPE_V) choose('B');
    else void animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 });
  };

  const deal = inline || reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : {
      initial: { x: 180, y: -260, rotate: 28, scale: 0.7, opacity: 0 },
      animate: { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1,
        transition: { type: 'spring' as const, stiffness: 170, damping: 19, delay: 0.12 } },
    };
  const story = card.kind === 'story';
  const sp = SPEAKERS[card.id];
  const remaining = total - index - 1;

  return (
    <div className={cx('cards', inline && 'cards--inline')} data-card={card.id}>
      <div className="cards__table">
        {!inline && (
          <div className="cards__deck" aria-hidden="true">
            {Array.from({ length: Math.max(0, remaining) }, (_, i) => <i key={i} style={{ transform: `translate(${(i + 1) * 5}px, ${(i + 1) * -6}px) rotate(${(i + 1) * 3}deg)` }} />)}
          </div>
        )}
        <motion.div className="cards__dealt" {...deal}>
          <motion.article
            className={cx('ccard', story ? 'ccard--story' : 'ccard--side', gone && 'is-gone')}
            style={{ x, rotate }}
            drag={gone === null ? 'x' : false}
            dragElastic={0.9}
            dragMomentum={false}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={onDragEnd}
            aria-labelledby={`ccard-${card.id}-name`}
            aria-describedby={`ccard-${card.id}-lines`}
          >
            <header className="ccard__top">
              <span className="ccard__kind">{story ? 'Thẻ cốt truyện' : 'Thẻ phụ'}</span>
              {!inline && <span className="ccard__count">Ngày {day} · {index + 1}/{total}</span>}
            </header>
            <div className="ccard__stage" style={{ ['--sky' as string]: sp.scene[0], ['--ground' as string]: sp.scene[1] }}>
              <div className="ccard__awning" aria-hidden="true" />
              <Speaker id={card.id} className="ccard__speaker" />
              <motion.span className="ccard__prop" aria-hidden="true"
                animate={reduced ? undefined : { rotate: [0, -10, 8, 0], y: [0, -4, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.6, ease: 'easeInOut' }}>
                {sp.prop}
              </motion.span>
            </div>
            <div className="ccard__body">
              <h2 className="ccard__name" id={`ccard-${card.id}-name`}>{card.speaker}</h2>
              <div className="ccard__lines" id={`ccard-${card.id}-lines`}>
                {card.lines.map((l, i) => (
                  <motion.p key={l} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: (inline ? 0.1 : 0.55) + i * 0.45, duration: 0.35 }}>
                    {l}
                  </motion.p>
                ))}
              </div>
            </div>
            <motion.div className="ccard__stamp ccard__stamp--a" style={{ opacity: leanA }} aria-hidden="true">{card.a.label}</motion.div>
            <motion.div className="ccard__stamp ccard__stamp--b" style={{ opacity: leanB }} aria-hidden="true">{card.b.label}</motion.div>
            <div className="ccard__swipe" aria-hidden="true"><span>←</span> vuốt để chọn <span>→</span></div>
          </motion.article>
        </motion.div>
      </div>
      <div className="cards__choices" role="group" aria-label="Chọn một trong hai">
        {(['A', 'B'] as const).map(c => {
          const o = c === 'A' ? card.a : card.b;
          return (
            <motion.button key={c} type="button" className={cx('choice', `choice--${c.toLowerCase()}`, gone === c && 'is-picked')}
              style={{ scale: c === 'A' ? btnA : btnB }}
              initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: inline ? 0.15 : 0.7 + (c === 'B' ? 0.08 : 0) }}
              disabled={gone !== null} onClick={() => choose(c)}>
              <span className="choice__key" aria-hidden="true">{c === 'A' ? '←' : '→'}</span>
              <span className="choice__label">{o.label}</span>
              <Affects list={o.affects} size={20} />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/** The afternoon: the card in hand of `run.cards`, answered through the run store. */
export function CardScreen({ run, dispatch }: { run: RunState; dispatch: Dispatch }) {
  const id = run.cards[run.cardIndex];
  const onChoose = useCallback((choice: Choice) => dispatch({ type: 'chooseCard', choice }), [dispatch]);
  if (id === undefined) return null;
  return <CardView card={CARDS[id]} index={run.cardIndex} total={run.cards.length} day={run.day} onChoose={onChoose} />;
}
