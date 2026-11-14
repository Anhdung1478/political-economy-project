import { AnimatePresence, motion } from 'framer-motion';
import type { Slide } from '../../content/slides';
import { SPEAKERS } from '../../content/speakers';
import { Button } from '../../ui/Button';

export function NotesPanel({ open, onClose, slide, index }: { open: boolean; onClose: () => void; slide: Slide; index: number }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.aside className="notes" aria-label="Ghi chú người nói"
          initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 360, damping: 32 }}>
          <div className="notes__head">
            <span className="chip">Slide {index + 1} · {SPEAKERS[slide.speaker].name}</span>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Đóng ghi chú">✕</Button>
          </div>
          <p>{slide.notes}</p>
          <p className="notes__keys">← → chuyển slide · N ghi chú · F toàn màn hình</p>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
