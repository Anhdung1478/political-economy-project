import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { Emoji } from '../../../../shared/config';
import { socket } from '../../net/socket';

interface Drop { id: number; emoji: Emoji; x: number; sway: number; dur: number }
const MAX = 60;

/** Emoji sent from phones float up across the projector screen. */
export function EmojiRain() {
  const [drops, setDrops] = useState<Drop[]>([]);
  useEffect(() => {
    const on = ({ emoji, id }: { emoji: Emoji; id: number }) => {
      const drop = { id, emoji, x: 4 + Math.random() * 92, sway: (Math.random() - 0.5) * 120, dur: 2.4 + Math.random() * 1.4 };
      setDrops(d => [...d.slice(-(MAX - 1)), drop]);
      setTimeout(() => setDrops(d => d.filter(x => x.id !== id)), drop.dur * 1000 + 100);
    };
    socket.on('emoji', on);
    return () => { socket.off('emoji', on); };
  }, []);
  return (
    <div className="rain" aria-hidden="true">
      <AnimatePresence>
        {drops.map(d => (
          <motion.span key={d.id} className="rain__drop" style={{ left: `${d.x}%` }}
            initial={{ y: 0, x: 0, opacity: 0, scale: 0.5 }}
            animate={{ y: '-105vh', x: [0, d.sway, -d.sway / 2], opacity: [0, 1, 1, 0], scale: [0.5, 1.2, 1] }}
            transition={{ duration: d.dur, ease: 'easeOut' }}>
            {d.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
