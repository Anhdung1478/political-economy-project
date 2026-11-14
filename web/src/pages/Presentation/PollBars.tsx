import { motion } from 'framer-motion';
import { useRoom } from '../../net/socket';
import { cx } from '../../ui/cx';
import { InvisibleHand, VisibleHand } from '../../ui/Hands';

/** Live poll results: invisible vs visible hand. */
export function PollBars({ compact }: { compact?: boolean }) {
  const { state } = useRoom();
  const poll = state?.poll ?? { invisible: 0, visible: 0 };
  const total = poll.invisible + poll.visible;
  const rows = [
    { key: 'invisible', label: 'Vô hình', n: poll.invisible, Hand: InvisibleHand },
    { key: 'visible', label: 'Hữu hình', n: poll.visible, Hand: VisibleHand },
  ] as const;
  return (
    <div className={cx('poll', compact && 'poll--compact')}>
      {rows.map(({ key, label, n, Hand }) => {
        const pct = total ? Math.round((n / total) * 100) : 0;
        return (
          <div key={key} className={`poll__row poll__row--${key}`}>
            <Hand size={compact ? 34 : 44} title={label} />
            <div className="poll__bar-wrap">
              <div className="poll__meta"><span>{label}</span><b>{pct}%</b></div>
              <div className="poll__track">
                <motion.div className="poll__bar" initial={false} animate={{ width: `${Math.max(pct, total ? 2 : 0)}%` }}
                  transition={{ type: 'spring', stiffness: 140, damping: 20 }} />
              </div>
            </div>
          </div>
        );
      })}
      <p className="poll__total">{total ? `${total} phiếu` : 'Chưa ai bình chọn — quét QR đi nào!'}</p>
    </div>
  );
}

export function PlayerCount() {
  const { state } = useRoom();
  return (
    <motion.b key={state?.players.length ?? 0} initial={{ scale: 1.5 }} animate={{ scale: 1 }}>
      {state?.players.length ?? 0}
    </motion.b>
  );
}
