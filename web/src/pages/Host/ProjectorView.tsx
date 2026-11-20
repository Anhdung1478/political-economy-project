// The projector view (spec §11 "Màn hình host"): what the whole class sees. Lobby: the big QR and how many joined;
// market open: the street in the background and the class counts; awards: AwardsView. No per-student data here
// except the award winners and the top 5.
import { AnimatePresence, motion } from 'framer-motion';
import type { CSSProperties } from 'react';
import type { SessionSnapshot } from '../../../../shared/protocol';
import { JoinQR } from '../../ui/JoinQR';
import { useStageScale } from '../../ui/useStageScale';
import { AwardsView } from './AwardsView';
import { StreetBackdrop } from './StreetBackdrop';

export function ProjectorView({ state }: { state: SessionSnapshot }) {
  const scale = useStageScale();
  return (
    <div className="deck proj" data-host-view="projector">
      {state.phase === 'open' && <StreetBackdrop />}
      <div className="stage proj__stage" style={{ '--scale': scale } as CSSProperties}>
        <header className="proj__top">
          <span className="proj__brand">Phố <em>Trà Sữa</em></span>
          <span className="proj__code">Mã buổi <b>{state.code}</b></span>
        </header>
        <AnimatePresence mode="wait">
          <motion.main key={state.phase} className="proj__body"
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}>
            {state.phase === 'lobby' && <Lobby state={state} />}
            {state.phase === 'open' && <Market state={state} />}
            {state.phase === 'awards' && state.awards && <AwardsView awards={state.awards} />}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Lobby({ state }: { state: SessionSnapshot }) {
  return (
    <div className="proj-lobby">
      <div className="proj-lobby__qr">
        <JoinQR size={400} />
      </div>
      <div className="proj-lobby__side">
        <h1>Quét mã, mở quán trà sữa của bạn</h1>
        <ol className="proj-steps">
          <li><span>Quét mã QR, nhập tên.</span></li>
          <li><span>Bình chọn: <b>bàn tay vô hình</b> hay <b>bàn tay hữu hình</b> sẽ cứu phố?</span></li>
          <li><span>Chờ chợ mở, rồi tự kinh doanh 5 ngày trên cùng một con phố.</span></li>
        </ol>
        <p className="proj-count" aria-live="polite">
          <BigNumber value={state.counts.joined} /> người đã vào chợ
        </p>
      </div>
    </div>
  );
}

function Market({ state }: { state: SessionSnapshot }) {
  const { joined, playing, finished, lostTrust } = state.counts;
  const done = joined > 0 ? finished / joined : 0;
  return (
    <div className="proj-market">
      <section className="proj-market__card card">
        <p className="proj-market__kicker">Chợ đang mở</p>
        <h1>Cả phố đang bán trà sữa</h1>
        <div className="proj-stats">
          <Stat label="Đang chơi" value={playing} tone="matcha" />
          <Stat label="Đã xong" value={finished} tone="caramel" />
          <Stat label="Mất uy tín" value={lostTrust} tone="strawberry" />
        </div>
        <div className="proj-progress" role="img" aria-label={`${finished} trên ${joined} người đã xong`}>
          <motion.span className="proj-progress__bar" initial={false} animate={{ width: `${done * 100}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
        </div>
        <p className="proj-progress__text">{finished} / {joined} người đã xong 5 ngày</p>
      </section>
      <aside className="proj-late card">
        <JoinQR size={120} showUrl={false} />
        <p><b>Vào muộn vẫn kịp</b><br />Quét mã là bắt đầu ngay.</p>
      </aside>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'matcha' | 'caramel' | 'strawberry' }) {
  return (
    <div className={`proj-stat proj-stat--${tone}`}>
      <BigNumber value={value} />
      <span>{label}</span>
    </div>
  );
}

/** A number that pops when it changes. */
function BigNumber({ value }: { value: number }) {
  return (
    <span className="bignum">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.b key={value} initial={{ y: 18, opacity: 0, scale: 0.8 }} animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -18, opacity: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 26 }}>
          {value}
        </motion.b>
      </AnimatePresence>
    </span>
  );
}
