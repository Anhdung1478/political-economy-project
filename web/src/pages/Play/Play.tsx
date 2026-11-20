// /play, temporary page (Task 24): join the class session and wait. Task 25 replaces it with the real screens
// (vote, lobby, the game in class mode, the report queue, awards).
import { useCallback, useState } from 'react';
import type { SessionPhase } from '../../../../shared/protocol';
import { storage } from '../../game/storage';
import { connect, isNetTimeout, useOnConnect, useSession } from '../../net/socket';
import { ConnectionBadge } from '../../ui/ConnectionBadge';
import { JoinScreen } from './JoinScreen';
import './play.css';

const TOKEN = 'pts.token';

const PHASE_TEXT: Record<SessionPhase, string> = {
  lobby: 'Chờ host mở chợ…',
  open: 'Chợ đã mở!',
  awards: 'Buổi đã trao giải.',
};

export default function Play() {
  const { state, connected } = useSession();
  const [me, setMe] = useState<{ playerId: string; name: string } | null>(null);
  const [checking, setChecking] = useState(() => storage.get(TOKEN) !== null);

  // Re-attach this phone to its player on every (re)connect.
  const resume = useCallback(function resume() {
    const token = storage.get(TOKEN);
    if (!token) { setChecking(false); return; }
    void connect().resume(token).then(r => {
      if (r.ok) { setMe({ playerId: r.playerId, name: r.name }); setChecking(false); }
      else if (isNetTimeout(r)) setTimeout(resume, 1500); // keep the player; try again
      else { storage.set(TOKEN, null); setMe(null); setChecking(false); }
    });
  }, []);
  useOnConnect(resume);

  let body: React.ReactNode;
  if (!state || checking) body = <div className="boot"><span /><span /><span /></div>;
  else if (!me) {
    body = <JoinScreen onJoined={(playerId, token) => { storage.set(TOKEN, token); setMe({ playerId, name: '' }); resume(); }} />;
  } else {
    body = (
      <div className="wait-card">
        <span className="wait-card__emoji" aria-hidden="true">🧋</span>
        <p><b>{me.name || 'Bạn'} đã vào phố</b><br />{PHASE_TEXT[state.phase]}</p>
      </div>
    );
  }

  return (
    <div className="play">
      <ConnectionBadge connected={connected} />
      <header className="play__top">
        <span className="play__brand"><img src="/favicon.svg" alt="" width="28" height="28" /> Phố Trà Sữa</span>
      </header>
      <main className="play__main">{body}</main>
    </div>
  );
}
