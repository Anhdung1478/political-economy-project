// /host, temporary page (Task 24): the host key flow and the three session controls. Task 26 replaces the body with
// the projector view and the private board.
import { useCallback, useState, type FormEvent } from 'react';
import type { SessionPhase } from '../../../../shared/protocol';
import { connect, isNetTimeout, useOnConnect, useSession } from '../../net/socket';
import { Button } from '../../ui/Button';
import { ConnectionBadge } from '../../ui/ConnectionBadge';
import { Input } from '../../ui/Input';
import { JoinQR } from '../../ui/JoinQR';
import { Modal } from '../../ui/Modal';
import './host.css';

// Remembered on this device (not just this tab), so reopening /host needs no typing.
const HOST_KEY_STORE = 'pts.hostKey';
const keySet = (k: string) => { try { localStorage.setItem(HOST_KEY_STORE, k); } catch { /* private mode */ } };
const keyGet = () => { try { return localStorage.getItem(HOST_KEY_STORE); } catch { return null; } };
const keyForget = () => { try { localStorage.removeItem(HOST_KEY_STORE); } catch { /* private mode */ } };

const PHASE_TEXT: Record<SessionPhase, string> = { lobby: 'Phòng chờ', open: 'Chợ đang mở', awards: 'Đã trao giải' };

export default function Host() {
  const { state, board, connected } = useSession();
  const [key, setKey] = useState(() => (new URLSearchParams(location.search).get('key') ?? keyGet() ?? '').trim());
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<'wrong' | 'network' | null>(null);
  const [confirm, setConfirm] = useState(false);

  const auth = useCallback(() => {
    if (!key) { setProblem(null); setAuthed(false); return; }
    const attempt = (left: number) => {
      void connect().hostAuth(key).then(r => {
        if (r.ok) {
          setProblem(null); setAuthed(true);
          keySet(key);
          // Keep the key off the projected address bar.
          if (location.search) history.replaceState(null, '', '/host');
        } else if (isNetTimeout(r)) {
          // Slow network is not a wrong key: retry before asking again.
          if (left > 0) attempt(left - 1);
          else { setProblem('network'); setAuthed(false); }
        } else {
          keyForget(); setProblem('wrong'); setAuthed(false);
        }
      });
    };
    attempt(2);
  }, [key]);
  useOnConnect(auth);

  if (authed === false) {
    return <KeyForm initial={key} problem={problem} onSubmit={k => { setKey(k); setAuthed(null); if (k === key) auth(); }} />;
  }
  if (!state || authed === null) return <div className="boot"><span /><span /><span /></div>;

  const client = connect();
  const { counts } = state;
  return (
    <div className="keyform card">
      <ConnectionBadge connected={connected} />
      <h1>Phố Trà Sữa · {state.code}</h1>
      <p>{PHASE_TEXT[state.phase]} · {counts.joined} đã vào · {counts.playing} đang chơi · {counts.finished} đã xong
        {board ? ` · bảng: ${board.members.length} dòng` : ''}</p>
      {state.phase === 'lobby' && <JoinQR size={200} />}
      <Button size="lg" onClick={() => client.open()} disabled={state.phase !== 'lobby'}>Mở chợ</Button>
      <Button size="lg" variant="caramel" onClick={() => client.awards()} disabled={state.phase !== 'open'}>Trao giải</Button>
      <Button variant="ghost" onClick={() => setConfirm(true)} icon="↺">Reset</Button>
      <Modal open={confirm} title="Bắt đầu buổi mới?" onClose={() => setConfirm(false)}
        actions={<>
          <Button variant="secondary" onClick={() => setConfirm(false)}>Thôi</Button>
          <Button variant="danger" onClick={() => { client.reset(); setConfirm(false); }}>Reset</Button>
        </>}>
        <p>Seed và mã buổi mới; kết quả và bình chọn bị xoá. Người đang kết nối được giữ tên, không cần quét lại.</p>
      </Modal>
    </div>
  );
}

function KeyForm({ initial, onSubmit, problem }: { initial: string; onSubmit: (k: string) => void; problem: 'wrong' | 'network' | null }) {
  const [value, setValue] = useState(initial);
  const submit = (e: FormEvent) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); };
  return (
    <form className="keyform card" onSubmit={submit}>
      <h1>Màn hình host 🔐</h1>
      <p>Chỉ người điều khiển buổi chơi mới cần vào đây. Nhập mã host một lần, máy này sẽ nhớ cho lần sau.</p>
      <Input label="Mã host" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
        value={value} onChange={e => setValue(e.target.value)} autoFocus
        error={problem === 'wrong' ? 'Sai mã host rồi, kiểm tra lại từng chữ nhé.' : problem === 'network' ? 'Mạng chậm, chưa kiểm tra được mã. Bấm lại thử nhé.' : null} />
      <Button type="submit" size="lg" variant="dark" block>Vào điều khiển</Button>
    </form>
  );
}
