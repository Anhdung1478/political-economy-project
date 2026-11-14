import { AnimatePresence, motion } from 'framer-motion';

export function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <AnimatePresence>
      {!connected && (
        <motion.div
          className="conn"
          role="status"
          initial={{ y: -40, x: '-50%', opacity: 0 }}
          animate={{ y: 0, x: '-50%', opacity: 1 }}
          exit={{ y: -40, x: '-50%', opacity: 0 }}
        >
          <span className="conn__dot" /> Mất kết nối, đang nối lại…
        </motion.div>
      )}
    </AnimatePresence>
  );
}
