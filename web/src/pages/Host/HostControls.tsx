// The three session controls (spec §11): Mở chợ, Trao giải, Reset. Trao giải and Reset ask first; buttons that do not
// apply to the current phase are disabled.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { SessionPhase } from '../../../../shared/protocol';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

interface Props {
  phase: SessionPhase;
  onOpen: () => void;
  onAwards: () => void;
  onReset: () => void;
}

export function HostControls({ phase, onOpen, onAwards, onReset }: Props) {
  const [ask, setAsk] = useState<'awards' | 'reset' | null>(null);
  const close = () => setAsk(null);
  return (
    <div className="hctl">
      <Button variant="primary" icon="🏪" onClick={onOpen} disabled={phase !== 'lobby'}
        title={phase === 'lobby' ? 'Mọi người bắt đầu chơi' : 'Chợ đã mở'}>Mở chợ</Button>
      <Button variant="caramel" icon="🏆" onClick={() => setAsk('awards')} disabled={phase !== 'open'}
        title={phase === 'open' ? 'Chốt giải theo kết quả hiện tại' : phase === 'lobby' ? 'Mở chợ trước đã' : 'Đã trao giải'}>Trao giải</Button>
      <Button variant="ghost" icon="↺" onClick={() => setAsk('reset')}>Reset</Button>

      {/* Portalled: the board's sticky bar (backdrop-filter) and the faded projector dock (opacity) would otherwise
          trap or dim the fixed backdrop. */}
      {createPortal(<>
      <Modal open={ask === 'awards'} title="Trao giải ngay?" onClose={close}
        actions={<>
          <Button variant="secondary" onClick={close}>Chưa</Button>
          <Button variant="caramel" onClick={() => { onAwards(); close(); }}>Trao giải</Button>
        </>}>
        <p>Giải và top 5 được chốt theo những ngày đã gửi về lúc này. Ai chưa xong vẫn chơi tiếp được, nhưng giải không
          đổi nữa. Chỉ Reset mới làm lại được.</p>
      </Modal>
      <Modal open={ask === 'reset'} title="Bắt đầu buổi mới?" onClose={close}
        actions={<>
          <Button variant="secondary" onClick={close}>Thôi</Button>
          <Button variant="danger" onClick={() => { onReset(); close(); }}>Reset</Button>
        </>}>
        <p>Seed và mã buổi mới; kết quả, bình chọn và giải bị xoá. Người đang kết nối được giữ tên, không cần quét lại.</p>
      </Modal>
      </>, document.body)}
    </div>
  );
}
