import { useState, type FormEvent } from 'react';
import { LIMITS } from '../../../../shared/protocol';
import { connect } from '../../net/socket';
import { Button } from '../../ui/Button';
import { InvisibleHand, VisibleHand } from '../../ui/Hands';
import { Input } from '../../ui/Input';

export function JoinScreen({ onJoined }: { onJoined: (playerId: string, token: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Nhập tên đã rồi mới mở quán được 😅'); return; }
    setBusy(true);
    const r = await connect().join(name);
    setBusy(false);
    if (r.ok) onJoined(r.playerId, r.token);
    else setError(r.error);
  };

  return (
    <form className="join" onSubmit={submit} noValidate>
      <div className="join__hands" aria-hidden="true">
        <InvisibleHand size={84} float />
        <VisibleHand size={84} float />
      </div>
      <h1>Mở một quán trà sữa</h1>
      <p className="play__sub">Nhập tên của bạn. Tên này cũng là tên quán trên bảng xếp hạng.</p>
      <Input
        label="Tên của bạn"
        placeholder="VD: Dũng đẹp trai"
        value={name}
        maxLength={LIMITS.nickname}
        autoComplete="nickname"
        enterKeyHint="go"
        onChange={e => { setName(e.target.value); setError(null); }}
        error={error}
      />
      <Button type="submit" size="lg" block disabled={busy} icon="🥤">{busy ? 'Đang mở quán…' : 'Vào chợ'}</Button>
    </form>
  );
}
