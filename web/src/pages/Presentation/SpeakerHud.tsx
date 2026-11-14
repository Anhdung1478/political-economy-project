import { AnimatePresence, motion } from 'framer-motion';
import { SPEAKERS } from '../../content/speakers';

/** Who is talking on this slide. */
export function SpeakerHud({ speakerIndex }: { speakerIndex: number }) {
  const sp = SPEAKERS[speakerIndex];
  return (
    <div className="hud">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div key={speakerIndex} className="hud__who"
          initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }}>
          <span className="hud__avatar" style={{ background: sp.color }}>{sp.initials}</span>
          <span className="hud__name"><b>{sp.name}</b><small>{sp.role}</small></span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
