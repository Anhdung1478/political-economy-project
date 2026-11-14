import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { PHOTO_CREDITS, SLIDES } from '../../content/slides';
import { SPEAKERS } from '../../content/speakers';
import { useRoom } from '../../net/socket';
import { Button } from '../../ui/Button';
import { ConnectionBadge } from '../../ui/ConnectionBadge';
import { Select } from '../../ui/Select';
import { useStageScale } from '../../ui/useStageScale';
import { NotesPanel } from './NotesPanel';
import { SpeakerHud, type Clock } from './SpeakerHud';
import './presentation.css';

const clampIndex = (i: number) => Math.min(SLIDES.length - 1, Math.max(0, i));

const emptyClock = (): Clock => ({ started: null, starts: SPEAKERS.map(() => null), ends: SPEAKERS.map(() => null) });

/** Record that `speaker` is now talking: their section starts, earlier sections end. */
function markSpeaker(clock: Clock, speaker: number, now: number): Clock {
  if (clock.started === null) return clock;
  const starts = clock.starts.map((t, s) => (s === speaker ? t ?? now : t));
  const ends = clock.ends.map((t, s) => (s < speaker && starts[s] !== null ? t ?? now : t));
  return { ...clock, starts, ends };
}

export default function Presentation() {
  const [index, setIndex] = useState(() => clampIndex(Number(location.hash.slice(1) || 1) - 1));
  const [dir, setDir] = useState(1);
  const [notes, setNotes] = useState(false);
  const [clock, setClock] = useState<Clock>(emptyClock);
  const scale = useStageScale();
  const { connected } = useRoom();
  const slide = SLIDES[index];
  const speaker = SPEAKERS[slide.speaker];

  const startClock = useCallback(() => {
    setClock(c => (c.started !== null ? c : markSpeaker({ ...c, started: Date.now() }, SLIDES[index].speaker, Date.now())));
  }, [index]);

  const go = useCallback((to: number) => {
    const next = clampIndex(to);
    if (next === index) return;
    setDir(next > index ? 1 : -1);
    setIndex(next);
    setClock(c => {
      const now = Date.now();
      const started = c.started === null ? markSpeaker({ ...c, started: now }, SLIDES[index].speaker, now) : c;
      return markSpeaker(started, SLIDES[next].speaker, now);
    });
  }, [index]);

  useEffect(() => { history.replaceState(null, '', `#${index + 1}`); }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // The dropdown's own trigger handles ↑ ↓ Enter Space; ← → still change slides from it.
      if (t.closest('input, textarea, [role="listbox"], [role="dialog"]')) return;
      const onButton = t.tagName === 'BUTTON';
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !onButton)) { e.preventDefault(); go(index + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(index - 1); }
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(SLIDES.length - 1);
      else if (e.key.toLowerCase() === 'n') setNotes(v => !v);
      else if (e.key.toLowerCase() === 's') startClock();
      else if (e.key.toLowerCase() === 'r') setClock(emptyClock());
      else if (e.key.toLowerCase() === 'f') toggleFullscreen();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [go, index, startClock]);

  return (
    <div className="deck">
      <ConnectionBadge connected={connected} />
      <div className="stage" style={{ '--scale': scale, '--accent': speaker.color, '--accent-soft': speaker.soft } as CSSProperties}>
        <div className="stage__slides">
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.section
              key={slide.id}
              className={`slide slide--${slide.id}`}
              custom={dir}
              variants={{
                enter: (d: number) => ({ x: d * 90, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (d: number) => ({ x: d * -90, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', stiffness: 260, damping: 32 }}
              aria-roledescription="slide"
              aria-label={`${index + 1} / ${SLIDES.length}: ${slide.label}`}
            >
              <header className="slide__head">
                <span className="kicker">{slide.kicker}</span>
                <h1>{slide.title}</h1>
              </header>
              <div className="slide__body">{slide.body()}</div>
              {slide.id === 'game' && <p className="credits">{PHOTO_CREDITS}</p>}
            </motion.section>
          </AnimatePresence>
        </div>

        <footer className="bar">
          <SpeakerHud speakerIndex={slide.speaker} clock={clock} onStart={startClock} />
          <div className="bar__progress" aria-hidden="true">
            {SLIDES.map((s, i) => (
              <span key={s.id} className={i <= index ? 'is-done' : undefined}
                style={{ '--seg': SPEAKERS[s.speaker].color } as CSSProperties} />
            ))}
          </div>
          <nav className="bar__nav" aria-label="Điều khiển slide">
            <Button variant="ghost" size="icon" onClick={() => setNotes(v => !v)} aria-label="Bật tắt ghi chú (N)" aria-pressed={notes} title="Ghi chú (N)">📝</Button>
            <Button variant="ghost" size="icon" onClick={toggleFullscreen} aria-label="Toàn màn hình (F)" title="Toàn màn hình (F)">⛶</Button>
            <Select
              label="Slide"
              direction="up"
              value={index}
              onChange={v => go(v)}
              options={SLIDES.map((s, i) => ({ value: i, label: s.label, meta: String(i + 1).padStart(2, '0') }))}
            />
            <Button variant="secondary" size="icon" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Slide trước">←</Button>
            <Button variant="dark" size="icon" onClick={() => go(index + 1)} disabled={index === SLIDES.length - 1} aria-label="Slide sau">→</Button>
          </nav>
        </footer>
      </div>
      <NotesPanel open={notes} onClose={() => setNotes(false)} slide={slide} index={index} />
    </div>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}
