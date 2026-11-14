import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useState, type CSSProperties, type FormEvent } from 'react';
import { ROUNDS } from '../../../../shared/config';
import { api, NET_TIMEOUT, useOnConnect, useRoom, usePlayUrl } from '../../net/socket';

// Remembered on this device (not just this tab), so reopening /host needs no typing.
const HOST_KEY_STORE = 'hbt.hostKey';
const keySet = (k: string) => { try { localStorage.setItem(HOST_KEY_STORE, k); } catch { /* private mode */ } };
const keyGet = () => { try { return localStorage.getItem(HOST_KEY_STORE); } catch { return null; } };
const keyForget = () => { try { localStorage.removeItem(HOST_KEY_STORE); } catch { /* private mode */ } };
import { Button } from '../../ui/Button';
import { ConnectionBadge } from '../../ui/ConnectionBadge';
import { Input } from '../../ui/Input';
import { useStageScale } from '../../ui/useStageScale';
import { AwardsView } from './AwardsView';
import { EmojiRain } from './EmojiRain';
import { EventView } from './EventView';
import { HostControls } from './HostControls';
import { LobbyView } from './LobbyView';
import { PricingView } from './PricingView';
import { RevealView } from './RevealView';
import './host.css';

export default function Host() {
  const { state, connected, serverOffset } = useRoom();
  const [key, setKey] = useState(() => (new URLSearchParams(location.search).get('key') ?? keyGet() ?? '').trim());
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<'wrong' | 'network' | null>(null);
  const scale = useStageScale();
  const playUrl = usePlayUrl();

  const auth = useCallback(() => {
    if (!key) { setProblem(null); setAuthed(false); return; }
    const attempt = (left: number) => {
      void api.hostAuth(key).then(r => {
        if (r.ok) {
          setProblem(null); setAuthed(true);
          keySet(key);
          // Keep the key off the projected address bar.
          if (location.search) history.replaceState(null, '', '/host');
        } else if (r.error === NET_TIMEOUT) {
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

  const round = state.roundIndex >= 0 ? ROUNDS[state.roundIndex] : null;
  const viewKey = `${state.phase}-${state.roundIndex}`;
  let view: React.ReactNode;
  if (state.phase === 'lobby') view = <LobbyView players={state.players} />;
  else if (state.phase === 'event' && round) view = <EventView round={round} index={state.roundIndex} total={state.totalRounds} shops={state.players.length} />;
  else if (state.phase === 'pricing' && round) view = <PricingView round={round} players={state.players} deadline={state.deadline} serverOffset={serverOffset} />;
  else if (state.phase === 'reveal' && round && state.lastResult) view = <RevealView round={round} result={state.lastResult} players={state.players} />;
  else view = <AwardsView awards={state.awards} players={state.players} />;

  return (
    <div className="deck host">
      <ConnectionBadge connected={connected} />
      <div className="stage host__stage" style={{ '--scale': scale } as CSSProperties}>
        <header className="host__top">
          <span className="host__brand"><img src="/favicon.svg" alt="" width="40" height="40" /> Chợ Trà Sữa <em>Hỗn Loạn</em></span>
          <div className="host__pips" aria-label="Tiến độ vòng chơi">
            {ROUNDS.map((r, i) => (
              <span key={r.id} className={i < state.roundIndex || state.phase === 'awards' ? 'is-done' : i === state.roundIndex ? 'is-now' : undefined}>
                {r.emoji}
              </span>
            ))}
          </div>
          <span className="host__join">🥤 <b>{state.players.length}</b> quán · {playUrl.replace(/^https?:\/\//, '')}</span>
        </header>
        <div className="host__view">
          <AnimatePresence mode="wait">
            <motion.div key={viewKey} className="host__panel"
              initial={{ opacity: 0, scale: 0.98, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: -20 }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
              {view}
            </motion.div>
          </AnimatePresence>
        </div>
        <HostControls phase={state.phase} roundIndex={state.roundIndex} totalRounds={state.totalRounds} playerCount={state.players.length} />
      </div>
      <EmojiRain />
    </div>
  );
}

function KeyForm({ initial, onSubmit, problem }: { initial: string; onSubmit: (k: string) => void; problem: 'wrong' | 'network' | null }) {
  const [value, setValue] = useState(initial);
  const submit = (e: FormEvent) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); };
  return (
    <form className="keyform card" onSubmit={submit}>
      <h1>Màn hình host 🔐</h1>
      <p>Chỉ người điều khiển game mới cần vào đây. Nhập mã host một lần, máy này sẽ nhớ cho lần sau.</p>
      <Input label="Mã host" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
        value={value} onChange={e => setValue(e.target.value)} autoFocus
        error={problem === 'wrong' ? 'Sai mã host rồi, kiểm tra lại từng chữ nhé.' : problem === 'network' ? 'Mạng chậm, chưa kiểm tra được mã. Bấm lại thử nhé.' : null} />
      <Button type="submit" size="lg" variant="dark" block>Vào điều khiển</Button>
    </form>
  );
}
