import { useState, type FormEvent } from 'react';
import { type Ack, LIMITS } from '../../../../shared/protocol';
import { Button } from '../../ui/Button';
import { InvisibleHand, VisibleHand } from '../../ui/Hands';
import { Input } from '../../ui/Input';

interface Props {
  /** The name remembered from an earlier visit (the host reset the session, or the phone lost its token). */
  initialName?: string;
  /** Joins the session; the server's refusal comes back as `error` and is shown under the field. */
  onSubmit: (name: string) => Promise<Ack>;
}

export function JoinScreen({ initialName = '', onSubmit }: Props) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('Nhập tên đã rồi mới mở quán được 😅'); return; }
    setBusy(true);
    let r: Ack;
    try { r = await onSubmit(trimmed); } catch { r = { ok: false, error: 'Chưa vào được, thử lại nhé' }; }
    // On success this screen is replaced; only a refusal comes back here.
    setBusy(false);
    if (!r.ok) setError(r.error);
  };

  return (
    <form className="join card" onSubmit={submit} noValidate>
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
