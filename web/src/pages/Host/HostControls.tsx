// The three session controls (spec §11): Mở chợ, Trao giải, Reset. Trao giải and Reset ask first; buttons that do not
// apply to the current phase are disabled, and all of them are while the socket is down (socket.io would buffer the
// command and flush it before `host:auth` on reconnect, so the server would drop it).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SessionPhase } from '../../../../shared/protocol';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

interface Props {
  phase: SessionPhase;
  connected: boolean;
  /** Nobody has sent a day yet: the awards would be empty. */
  noDays: boolean;
  /** Each returns whether the command was sent (false when offline). */
  onOpen: () => boolean;
  onAwards: () => boolean;
  onReset: () => boolean;
  /** Empties the solo leaderboard; resolves whether the server did it (false when offline or refused). */
  onSoloReset: () => Promise<boolean>;
}

const OFFLINE = 'Mất kết nối';
const FEEDBACK_MS = 2500;

export function HostControls({ phase, connected, noDays, onOpen, onAwards, onReset, onSoloReset }: Props) {
  const [ask, setAsk] = useState<'awards' | 'reset' | 'solo' | null>(null);
  const [feedback, setFeedback] = useState<'sent' | 'failed' | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), FEEDBACK_MS);
    return () => clearTimeout(t);
  }, [feedback]);
  const close = () => setAsk(null);
  const run = (send: () => boolean) => { setFeedback(send() ? 'sent' : 'failed'); close(); };
  const off = !connected;
  const runSolo = () => { close(); void onSoloReset().then(ok => setFeedback(ok ? 'sent' : 'failed')); };

  return (
    <div className="hctl">
      <Button variant="primary" icon="🏪" onClick={() => run(onOpen)} disabled={off || phase !== 'lobby'}
        title={off ? OFFLINE : phase === 'lobby' ? 'Mọi người bắt đầu chơi' : 'Chợ đã mở'}>Mở chợ</Button>
      <Button variant="caramel" icon="🏆" onClick={() => setAsk('awards')} disabled={off || phase !== 'open'}
        title={off ? OFFLINE : phase === 'open' ? 'Chốt giải theo kết quả hiện tại' : phase === 'lobby' ? 'Mở chợ trước đã' : 'Đã trao giải'}>Trao giải</Button>
      <Button variant="ghost" icon="↺" onClick={() => setAsk('reset')} disabled={off} title={off ? OFFLINE : 'Bắt đầu buổi mới'}>Reset</Button>
      <Button variant="ghost" icon="🧹" onClick={() => setAsk('solo')} disabled={off} title={off ? OFFLINE : 'Xoá hết điểm trên bảng chơi một mình'}>
        Xoá bảng xếp hạng một mình</Button>
      <span className={`hctl__fb hctl__fb--${feedback ?? 'none'}`} role="status" aria-live="polite">
        {feedback === 'sent' ? '✓ Đã gửi' : feedback === 'failed' ? 'Chưa gửi được' : ''}
      </span>

      {/* Portalled: the board's sticky bar (backdrop-filter) and the faded projector dock (opacity) would otherwise
          trap or dim the fixed backdrop. */}
      {createPortal(<>
        <Modal open={ask === 'awards'} title="Trao giải ngay?" onClose={close}
          actions={<>
            <Button variant="secondary" onClick={close}>Chưa</Button>
            <Button variant="caramel" onClick={() => run(onAwards)} disabled={off} title={off ? OFFLINE : undefined}>Trao giải</Button>
          </>}>
          {noDays && <p className="hctl__warn">Chưa ai gửi về ngày nào, nên giải và top 5 sẽ trống.</p>}
          <p>Giải và top 5 được chốt theo những ngày đã gửi về lúc này. Ai chưa xong vẫn chơi tiếp được, nhưng giải không
            đổi nữa. Chỉ Reset mới làm lại được.</p>
          {off && <p className="hctl__warn">Mất kết nối, chờ nối lại rồi bấm.</p>}
        </Modal>
        <Modal open={ask === 'reset'} title="Bắt đầu buổi mới?" onClose={close}
          actions={<>
            <Button variant="secondary" onClick={close}>Thôi</Button>
            <Button variant="danger" onClick={() => run(onReset)} disabled={off} title={off ? OFFLINE : undefined}>Reset</Button>
          </>}>
          <p>Seed và mã buổi mới; kết quả, bình chọn và giải bị xoá. Người đang kết nối được giữ tên, không cần quét lại.</p>
          {off && <p className="hctl__warn">Mất kết nối, chờ nối lại rồi bấm.</p>}
        </Modal>
        <Modal open={ask === 'solo'} title="Xoá bảng xếp hạng một mình?" onClose={close}
          actions={<>
            <Button variant="secondary" onClick={close}>Thôi</Button>
            <Button variant="danger" onClick={runSolo} disabled={off} title={off ? OFFLINE : undefined}>Xoá bảng</Button>
          </>}>
          <p>Mọi điểm trên bảng xếp hạng chơi một mình bị xoá cho tất cả mọi người, không lấy lại được. Bảng của buổi lớp không bị ảnh hưởng.</p>
          {off && <p className="hctl__warn">Mất kết nối, chờ nối lại rồi bấm.</p>}
        </Modal>
      </>, document.body)}
    </div>
  );
}
