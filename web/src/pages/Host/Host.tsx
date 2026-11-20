// /host (spec §11 "Màn hình host"): the host key flow, then two views switched with a toggle: the projector view for
// the class (ProjectorView) and the private live board (BoardView, only after auth, from `host:board`).
import { useCallback, useState, type FormEvent } from 'react';
import type { SessionPhase } from '../../../../shared/protocol';
import { connect, isNetTimeout, useOnConnect, useSession } from '../../net/socket';
import { Button } from '../../ui/Button';
import { ConnectionBadge } from '../../ui/ConnectionBadge';
import { cx } from '../../ui/cx';
import { Input } from '../../ui/Input';
import { BoardView } from './BoardView';
import { HostControls } from './HostControls';
import { ProjectorView } from './ProjectorView';
import './host.css';

// Remembered on this device (not just this tab), so reopening /host needs no typing.
const HOST_KEY_STORE = 'pts.hostKey';
const keySet = (k: string) => { try { localStorage.setItem(HOST_KEY_STORE, k); } catch { /* private mode */ } };
const keyGet = () => { try { return localStorage.getItem(HOST_KEY_STORE); } catch { return null; } };
const keyForget = () => { try { localStorage.removeItem(HOST_KEY_STORE); } catch { /* private mode */ } };

type View = 'projector' | 'board';
// The last view, for this tab; `?view=board` picks one on load (handy for screenshots).
const VIEW_STORE = 'pts.hostView';
function initialView(): View {
  const q = new URLSearchParams(location.search).get('view');
  let saved: string | null = null;
  try { saved = sessionStorage.getItem(VIEW_STORE); } catch { /* private mode */ }
  const v = q ?? saved;
  return v === 'board' ? 'board' : 'projector';
}

const PHASE_TEXT: Record<SessionPhase, string> = { lobby: 'Phòng chờ', open: 'Chợ đang mở', awards: 'Đã trao giải' };

export default function Host() {
  const { state, board, connected } = useSession();
  const [key, setKey] = useState(() => (new URLSearchParams(location.search).get('key') ?? keyGet() ?? '').trim());
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<'wrong' | 'network' | null>(null);
  const [view, setViewState] = useState<View>(initialView);
  const setView = (v: View) => {
    setViewState(v);
    try { sessionStorage.setItem(VIEW_STORE, v); } catch { /* private mode */ }
  };

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
  const controls = <HostControls phase={state.phase} onOpen={() => client.open()} onAwards={() => client.awards()}
    onReset={() => client.reset()} />;
  const toggle = (
    <div className="vtoggle" role="tablist" aria-label="Chế độ xem">
      <button type="button" role="tab" aria-selected={view === 'projector'} className={cx(view === 'projector' && 'is-on')}
        onClick={() => setView('projector')}>📽️ Màn chiếu</button>
      <button type="button" role="tab" aria-selected={view === 'board'} className={cx(view === 'board' && 'is-on')}
        onClick={() => setView('board')}>📋 Bảng theo dõi</button>
    </div>
  );

  return (
    <div className="host" data-host-ready="1">
      <ConnectionBadge connected={connected} />
      {view === 'projector' ? <>
        <ProjectorView state={state} />
        <div className="hdock">{toggle}{controls}</div>
      </> : <>
        <header className="hbar">
          <span className="hbar__brand">Phố <em>Trà Sữa</em></span>
          <span className="hbar__code">Mã <b>{state.code}</b></span>
          <span className={`chip hbar__phase hbar__phase--${state.phase}`}>{PHASE_TEXT[state.phase]}</span>
          <span className="hbar__spacer" />
          {toggle}
          {controls}
        </header>
        {board ? <BoardView board={board} /> : <div className="boot"><span /><span /><span /></div>}
      </>}
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
