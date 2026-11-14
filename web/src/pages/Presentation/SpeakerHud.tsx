import { AnimatePresence, motion } from 'framer-motion';
import { SECTION_SECONDS, SPEAKERS, TOTAL_SECONDS } from '../../content/speakers';
import { useNow } from '../../net/socket';
import { cx } from '../../ui/cx';

export interface Clock { started: number | null; starts: (number | null)[]; ends: (number | null)[] }

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Who is talking, how long their part has run, and the whole talk's clock. */
export function SpeakerHud({ speakerIndex, clock, onStart }: { speakerIndex: number; clock: Clock; onStart: () => void }) {
  const now = useNow(500);
  const sp = SPEAKERS[speakerIndex];
  const start = clock.starts[speakerIndex];
  const section = start === null ? 0 : ((clock.ends[speakerIndex] ?? now) - start) / 1000;
  const total = clock.started === null ? 0 : (now - clock.started) / 1000;
  const state = section > SECTION_SECONDS ? 'over' : section >= SECTION_SECONDS - 30 ? 'warn' : 'ok';

  return (
    <div className="hud">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={speakerIndex} className="hud__who"
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}>
          <span className="hud__avatar" style={{ background: sp.color }}>{sp.initials}</span>
          <span className="hud__name"><b>{sp.name}</b><small>{sp.role}</small></span>
        </motion.div>
      </AnimatePresence>
      {clock.started === null ? (
        <button type="button" className="hud__start" onClick={onStart}>▶ Bắt đầu tính giờ <kbd>S</kbd></button>
      ) : (
        <div className="hud__times">
          <span className={cx('hud__section', `hud__section--${state}`)} title="Thời gian phần của bạn">
            {mmss(section)} <small>/ {mmss(SECTION_SECONDS)}</small>
          </span>
          <span className="hud__total" title="Tổng thời gian">Tổng {mmss(total)} <small>/ {mmss(TOTAL_SECONDS)}</small></span>
        </div>
      )}
    </div>
  );
}
