// The awards on the phone (spec §2 step 4, §11 "Giải") and the "session is over" notice (spec §13). Both end with the
// way to the solo game: only the first run of a session counts.
import { AWARDS, type AwardsResult } from '../../../../shared/protocol';
import { fmtMoney } from '../../game/format';
import { Button } from '../../ui/Button';
import { Confetti } from '../../ui/Confetti';
import { cx } from '../../ui/cx';
import { awardDetail } from '../Host/hostFormat';
import { awardsView } from './playLogic';

const MEDALS = ['🥇', '🥈', '🥉'];

export const goSolo = () => { location.assign('/solo'); };

interface Props {
  awards: AwardsResult | null;
  playerId: string | null;
  /** The player's own rank as last answered by the server, when the awards list does not have it. */
  rank?: number | null;
  /** In an overlay over a run in progress: back to the game. */
  onClose?: () => void;
}

export function AwardsScreen({ awards, playerId, rank, onClose }: Props) {
  const v = awardsView(awards, playerId);
  if (v === null) {
    return (
      <div className="awards-phone card">
        <h2>Đã chốt giải</h2>
        <p className="play__sub">Kết quả đang được gửi tới, chờ một chút nhé.</p>
        {onClose && <Button variant="secondary" block onClick={onClose}>Quay lại ván</Button>}
      </div>
    );
  }
  const shown = v.rank ?? rank ?? null;
  return (
    <div className="awards-phone">
      {v.mine.length > 0 && <Confetti count={48} />}
      <h2>Trao giải Phố Trà Sữa</h2>
      <div className="rank-badge">
        <small>Hạng của bạn</small>
        <b>{shown !== null ? `#${shown}` : '–'}</b>
        {shown === null && <small>chưa có điểm</small>}
      </div>
      {v.mine.length > 0 && (
        <div className="award-list" aria-label="Giải của bạn">
          {v.mine.map(a => (
            <div key={a.id} className="award-row is-me">
              <span className="award-row__emoji" aria-hidden="true">{AWARDS.find(x => x.id === a.id)?.emoji ?? a.emoji}</span>
              <div><b>{a.title}</b><small>{awardDetail(a)}</small></div>
            </div>
          ))}
        </div>
      )}
      {v.mine.length === 0 && shown !== null && (
        <p className="play__sub">Lần này bạn chưa có giải, hẹn bạn ở ván solo nhé!</p>
      )}
      {v.top.length > 0 && (
        <ol className="award-list award-top" aria-label="Top 5">
          <li className="award-top__head">Top 5 theo điểm</li>
          {v.top.map(t => (
            <li key={t.playerId} className={cx('award-row', t.me && 'is-me')}>
              <span className="award-row__emoji" aria-hidden="true">{MEDALS[t.rank - 1] ?? `#${t.rank}`}</span>
              <div><b>{t.name}{t.me ? ' (bạn)' : ''}</b><small>{fmtMoney(t.score)}</small></div>
            </li>
          ))}
        </ol>
      )}
      <div className="awards-phone__actions">
        {onClose && <Button variant="secondary" size="lg" block onClick={onClose}>Quay lại ván</Button>}
        <Button size="lg" block onClick={goSolo} icon="🔁">Chơi solo</Button>
      </div>
    </div>
  );
}

/** Opened `/play` after the awards: the session is over. */
export function EndedScreen() {
  return (
    <div className="awards-phone ended card">
      <span className="ended__emoji" aria-hidden="true">🌙</span>
      <h2>Buổi đã kết thúc</h2>
      <p className="play__sub">Chợ đã đóng cửa và giải đã trao. Bạn vẫn có thể mở quán một mình và chơi solo.</p>
      <Button size="lg" block onClick={goSolo} icon="🥤">Chơi solo</Button>
    </div>
  );
}
