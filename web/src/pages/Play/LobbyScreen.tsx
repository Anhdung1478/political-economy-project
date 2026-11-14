import { motion } from 'framer-motion';
import { useState } from 'react';
import type { PollChoice, PublicPlayer } from '../../../../shared/types';
import { api, storage } from '../../net/socket';
import { cx } from '../../ui/cx';
import { InvisibleHand, VisibleHand } from '../../ui/Hands';

const VOTE = 'hbt.vote';

export function LobbyScreen({ me }: { me: PublicPlayer }) {
  const [vote, setVote] = useState<PollChoice | null>(() => storage.get(VOTE) as PollChoice | null);
  const choose = (c: PollChoice) => { setVote(c); storage.set(VOTE, c); api.vote(c); };

  return (
    <div className="lobby">
      <motion.div className="shop-card" initial={{ scale: 0.8, rotate: -4 }} animate={{ scale: 1, rotate: -1.5 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
        <small>Quán của bạn</small>
        <b>{me.shopName}</b>
      </motion.div>

      <section className="vote" aria-labelledby="vote-q">
        <h2 id="vote-q">Bạn đứng về phe nào?</h2>
        <p className="play__sub">Nền kinh tế thị trường hoàn hảo nên được vận hành bởi…</p>
        <div className="vote__options" role="radiogroup" aria-labelledby="vote-q">
          <button type="button" role="radio" aria-checked={vote === 'invisible'}
            className={cx('vote__opt', 'vote__opt--invisible', vote === 'invisible' && 'is-on')} onClick={() => choose('invisible')}>
            <InvisibleHand size={64} />
            <span>Bàn tay<br /><b>vô hình</b></span>
          </button>
          <button type="button" role="radio" aria-checked={vote === 'visible'}
            className={cx('vote__opt', 'vote__opt--visible', vote === 'visible' && 'is-on')} onClick={() => choose('visible')}>
            <VisibleHand size={64} />
            <span>Bàn tay<br /><b>hữu hình</b></span>
          </button>
        </div>
        {vote && <motion.p className="vote__thanks" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>Đã ghi nhận! Đổi ý lúc nào cũng được.</motion.p>}
      </section>

      <div className="wait-card">
        <span className="wait-card__emoji" aria-hidden="true">🙏</span>
        <p><b>Đang nghe thuyết trình</b><br />Cất điện thoại đi, game bắt đầu sau phần trình bày.</p>
      </div>
    </div>
  );
}
