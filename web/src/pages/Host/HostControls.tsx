import { useEffect, useState } from 'react';
import type { Phase } from '../../../../shared/types';
import { api } from '../../net/socket';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';

interface Props { phase: Phase; roundIndex: number; totalRounds: number; playerCount: number }

function primaryLabel(phase: Phase, roundIndex: number, totalRounds: number): string | null {
  switch (phase) {
    case 'lobby': return 'Bắt đầu game';
    case 'event': return 'Mở chọn giá';
    case 'pricing': return 'Chốt giá ngay';
    case 'reveal': return roundIndex < totalRounds - 1 ? `Sang vòng ${roundIndex + 2}` : 'Trao giải 🏆';
    case 'awards': return null;
  }
}

const HINT: Record<Phase, string> = {
  lobby: 'Chờ mọi người quét QR và vào chợ.',
  event: 'Đọc thẻ sự kiện cho cả lớp nghe.',
  pricing: 'Tự động chốt khi hết giờ.',
  reveal: 'Bình luận vài câu rồi sang vòng sau.',
  awards: 'Hết game! Bấm “Chơi lại” nếu muốn thêm một ván.',
};

export function HostControls({ phase, roundIndex, totalRounds, playerCount }: Props) {
  const [confirm, setConfirm] = useState(false);
  const label = primaryLabel(phase, roundIndex, totalRounds);

  // A presentation clicker sends PageDown / → : let it drive the game too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, [role="dialog"]')) return;
      if ((e.key === 'ArrowRight' || e.key === 'PageDown') && label) { e.preventDefault(); api.next(); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [label]);

  return (
    <footer className="controls">
      <p className="controls__hint">{phase === 'lobby' && playerCount === 0 ? 'Chưa có ai trong chợ — chờ chút nhé.' : HINT[phase]}</p>
      <div className="controls__buttons">
        <Button variant="ghost" onClick={() => setConfirm(true)} icon="↺">{phase === 'awards' ? 'Chơi lại' : 'Reset'}</Button>
        {label && <Button size="lg" variant={phase === 'pricing' ? 'caramel' : 'primary'} onClick={api.next} icon="→">{label}</Button>}
      </div>
      <Modal open={confirm} title="Làm lại từ đầu?" onClose={() => setConfirm(false)}
        actions={<>
          <Button variant="secondary" onClick={() => setConfirm(false)}>Thôi</Button>
          <Button variant="danger" onClick={() => { api.reset(); setConfirm(false); }}>Reset game</Button>
        </>}>
        <p>Điểm của mọi quán về 0 và game quay lại phòng chờ. Người chơi vẫn giữ quán, không cần quét lại.</p>
      </Modal>
    </footer>
  );
}
