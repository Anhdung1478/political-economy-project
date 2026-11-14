import { AnimatePresence, motion } from 'framer-motion';
import { ROUNDS } from '../../../../shared/config';
import type { PublicPlayer } from '../../../../shared/types';
import { JoinQR } from '../../ui/JoinQR';

const MAX_CHIPS = 30;

export function LobbyView({ players }: { players: PublicPlayer[] }) {
  const shown = [...players].sort((a, b) => Number(b.id.slice(1)) - Number(a.id.slice(1))).slice(0, MAX_CHIPS);
  return (
    <div className="lobby-host">
      <div className="lobby-host__qr">
        <h1>Quét mã, mở quán</h1>
        <JoinQR size={330} />
      </div>
      <div className="lobby-host__side">
        <div className="rules card">
          <h2>Luật chơi trong 15 giây</h2>
          <ol>
            <li>Mỗi vòng, kéo thanh trượt để <b>chọn giá bán</b>.</li>
            <li>Khách mua ở quán <b>rẻ nhất trước</b>, mỗi quán pha tối đa <b>10 ly</b>.</li>
            <li>Giá vượt túi tiền thì khách <b>bỏ đi</b>.</li>
            <li>Được <b>ăn bớt nguyên liệu</b> (tối thiểu 8k): lãi hơn, nhưng vòng sau mất uy tín, bán ít ly hơn.</li>
            <li>Bán lỗ thì vòng sau có <b>2 khách quen</b> nếu không tăng giá quá 20%.</li>
            <li><b>Lãi = (giá − vốn) × số ly bán.</b> {ROUNDS.length} vòng, lãi nhất thắng.</li>
          </ol>
        </div>
        <div className="crowd" aria-live="polite">
          <p className="crowd__count"><b>{players.length}</b> quán đã mở cửa</p>
          <div className="crowd__chips">
            <AnimatePresence initial={false}>
              {shown.map(p => (
                <motion.span key={p.id} layout className="crowd__chip"
                  initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}>
                  {p.nickname}
                </motion.span>
              ))}
            </AnimatePresence>
            {players.length > MAX_CHIPS && <span className="crowd__chip crowd__chip--more">+{players.length - MAX_CHIPS}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
