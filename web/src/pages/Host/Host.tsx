import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useState, type CSSProperties, type FormEvent } from 'react';
import { ROUNDS } from '../../../../shared/config';
import { api, useOnConnect, useRoom, usePlayUrl } from '../../net/socket';

const HOST_KEY_STORE = 'hbt.hostKey';
const sessionSet = (k: string) => { try { sessionStorage.setItem(HOST_KEY_STORE, k); } catch { /* private mode */ } };
const sessionGet = () => { try { return sessionStorage.getItem(HOST_KEY_STORE); } catch { return null; } };
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
  const [key, setKey] = useState(() => new URLSearchParams(location.search).get('key') ?? sessionGet() ?? '');
  const [authed, setAuthed] = useState<boolean | null>(null);
  const scale = useStageScale();
  const playUrl = usePlayUrl();

  const auth = useCallback(() => {
    if (!key) { setAuthed(false); return; }
    void api.hostAuth(key).then(r => {
      setAuthed(r.ok);
      if (r.ok) {
        // Keep the key off the projected address bar.
        sessionSet(key);
        if (location.search) history.replaceState(null, '', '/host');
      }
    });
  }, [key]);
  useOnConnect(auth);

  if (authed === false) return <KeyForm initial={key} onSubmit={k => { setKey(k); setAuthed(null); }} failed={key !== ''} />;
  if (!state || authed === null) return <div className="boot"><span /><span /><span /></div>;

  const round = state.roundIndex >= 0 ? ROUNDS[state.roundIndex] : null;
  const viewKey = `${state.phase}-${state.roundIndex}`;
  let view: React.ReactNode;
  if (state.phase === 'lobby') view = <LobbyView players={state.players} />;
  else if (state.phase === 'event' && round) view = <EventView round={round} index={state.roundIndex} total={state.totalRounds} />;
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

function KeyForm({ initial, onSubmit, failed }: { initial: string; onSubmit: (k: string) => void; failed: boolean }) {
  const [value, setValue] = useState(initial);
  const submit = (e: FormEvent) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); };
  return (
    <form className="keyform card" onSubmit={submit}>
      <h1>Màn hình host 🔐</h1>
      <p>Chỉ người điều khiển game mới cần vào đây. Nhập mã host (biến môi trường <code>HOST_KEY</code>).</p>
      <Input label="Mã host" type="password" value={value} onChange={e => setValue(e.target.value)} autoFocus
        error={failed ? 'Sai mã host rồi, thử lại nhé.' : null} />
      <Button type="submit" size="lg" variant="dark" block>Vào điều khiển</Button>
    </form>
  );
}
