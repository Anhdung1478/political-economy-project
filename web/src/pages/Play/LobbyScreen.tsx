// The lobby (spec §2 step 1): the shop's name, the vote "bàn tay vô hình hay hữu hình", and the wait for the market to
// open, over the ambient street. The vote can be changed until the market opens; it is queued like a day.
import type { ReactNode } from 'react';
import type { SessionSnapshot, VoteChoice } from '../../../../shared/protocol';
import { InvisibleHand, VisibleHand } from '../../ui/Hands';
import { cx } from '../../ui/cx';
import { lobbyLine } from './playLogic';

interface Props {
  name: string;
  vote: VoteChoice | null;
  onVote: (choice: VoteChoice) => void;
  session: SessionSnapshot | null;
}

const OPTIONS: { choice: VoteChoice; title: string; line: string; hand: ReactNode }[] = [
  { choice: 'invisible', title: 'Bàn tay vô hình', line: 'Thị trường tự lo', hand: <InvisibleHand size={64} title="" /> },
  { choice: 'visible', title: 'Bàn tay hữu hình', line: 'Nhà nước ra tay', hand: <VisibleHand size={64} title="" /> },
];

export function LobbyScreen({ name, vote, onVote, session }: Props) {
  return (
    <section className="lobby">
      <div className="shop-card">
        <small>Quán của bạn</small>
        <b>{name || 'Quán không tên'}</b>
      </div>
      <div className="vote card">
        <h2>Ai sẽ cứu được phố trà sữa?</h2>
        <p className="play__sub">Chọn trước khi chơi. Cuối buổi thầy cô sẽ hỏi lại.</p>
        <div className="vote__options" role="radiogroup" aria-label="Bình chọn trước khi chơi">
          {OPTIONS.map(o => (
            <button key={o.choice} type="button" role="radio" aria-checked={vote === o.choice}
              className={cx('vote__opt', `vote__opt--${o.choice}`, vote === o.choice && 'is-on')}
              onClick={() => onVote(o.choice)}>
              {o.hand}
              <b>{o.title}</b>
              <span>{o.line}</span>
            </button>
          ))}
        </div>
        <p className="vote__thanks" role="status">
          {vote === null ? 'Bấm để chọn nhé.' : 'Đã ghi nhận. Đổi ý thì bấm lại.'}
        </p>
      </div>
      <div className="wait-card card" role="status">
        <span className="wait-card__emoji" aria-hidden="true">🥤</span>
        <p><b>Chờ thầy/cô mở chợ…</b><br />Chợ chưa mở · {lobbyLine(session)}</p>
      </div>
    </section>
  );
}
