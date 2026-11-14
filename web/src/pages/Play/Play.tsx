import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useState } from 'react';
import { ROUNDS } from '../../../../shared/config';
import { api, storage, useOnConnect, useRoom } from '../../net/socket';
import { ConnectionBadge } from '../../ui/ConnectionBadge';
import { AwardsScreen } from './AwardsScreen';
import { EventScreen } from './EventScreen';
import { JoinScreen } from './JoinScreen';
import { LobbyScreen } from './LobbyScreen';
import { PricingScreen } from './PricingScreen';
import { RevealScreen } from './RevealScreen';
import './play.css';

const TOKEN = 'hbt.token';

export default function Play() {
  const { state, connected, serverOffset } = useRoom();
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [checking, setChecking] = useState(() => storage.get(TOKEN) !== null);

  // Re-attach this phone to its shop on every (re)connect.
  const resume = useCallback(() => {
    const token = storage.get(TOKEN);
    if (!token) { setChecking(false); return; }
    void api.resume(token).then(r => {
      if (r.ok) setPlayerId(r.playerId);
      else { storage.set(TOKEN, null); setPlayerId(null); }
      setChecking(false);
    });
  }, []);
  useOnConnect(resume);

  const me = state?.players.find(p => p.id === playerId) ?? null;
  const round = state && state.roundIndex >= 0 ? ROUNDS[state.roundIndex] : null;

  let screen: { key: string; node: React.ReactNode };
  if (!state || checking || (playerId && !me)) {
    screen = { key: 'loading', node: <div className="boot"><span /><span /><span /></div> };
  } else if (!playerId || !me) {
    screen = {
      key: 'join',
      node: <JoinScreen onJoined={(id, token) => { storage.set(TOKEN, token); setPlayerId(id); }} />,
    };
  } else if (state.phase === 'lobby') {
    screen = { key: 'lobby', node: <LobbyScreen me={me} /> };
  } else if (state.phase === 'event' && round) {
    screen = { key: `event-${state.roundIndex}`, node: <EventScreen round={round} index={state.roundIndex} total={state.totalRounds} /> };
  } else if (state.phase === 'pricing' && round) {
    screen = {
      key: `pricing-${state.roundIndex}`,
      node: <PricingScreen round={round} index={state.roundIndex} me={me} deadline={state.deadline} serverOffset={serverOffset} />,
    };
  } else if (state.phase === 'reveal' && round && state.lastResult) {
    screen = { key: `reveal-${state.roundIndex}`, node: <RevealScreen round={round} result={state.lastResult} me={me} total={state.players.length} /> };
  } else {
    screen = { key: 'awards', node: <AwardsScreen me={me} awards={state.awards} players={state.players} /> };
  }

  return (
    <div className="play">
      <ConnectionBadge connected={connected} />
      <header className="play__top">
        <span className="play__brand"><img src="/favicon.svg" alt="" width="28" height="28" /> Chợ Trà Sữa</span>
        {me && (
          <span className="play__me">
            <small>Tổng lãi</small>
            <motion.b key={me.total} initial={{ scale: 1.4 }} animate={{ scale: 1 }}>{me.total}k</motion.b>
          </span>
        )}
      </header>
      <AnimatePresence mode="wait">
        <motion.main
          key={screen.key}
          className="play__main"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
          {screen.node}
        </motion.main>
      </AnimatePresence>
    </div>
  );
}
