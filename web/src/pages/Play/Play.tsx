// /play (spec §2, §11, §13): the student's class screens. Join (or resume with the saved token), the vote and the wait
// over the ambient street, the game itself in class mode when the market opens, the awards, and the way out to solo.
// The logic lives in `PlayController` (socket, token, report queue) and `playLogic` (pure); this file only chooses the
// screen and wires the game to them.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Phase } from '../../../../shared/sim/types';
import { KEYS } from '../../game/runStore';
import { storage } from '../../game/storage';
import { connect } from '../../net/socket';
import { ConnectionBadge } from '../../ui/ConnectionBadge';
import { AwardsScreen, EndedScreen, goSolo } from './AwardsScreen';
import { watchGamePhase } from './gameWatch';
import { JoinScreen } from './JoinScreen';
import { LobbyScreen } from './LobbyScreen';
import { PlayController } from './PlayController';
import { chooseScreen } from './playLogic';
import { PlayStreet } from './PlayStreet';
import './play.css';

const Game = lazy(() => import('../Game/Game'));

const Boot = () => <div className="boot" aria-label="Đang tải"><span /><span /><span /></div>;

export default function Play() {
  const [ctl] = useState(() => new PlayController(connect(), storage));
  useEffect(() => ctl.attach(), [ctl]);
  const view = useSyncExternalStore(ctl.subscribe, ctl.getView);

  const { session } = view;
  const phase = session?.phase ?? null;
  const screen = chooseScreen({ resume: view.resume, phase, hasRun: view.hasRun });
  const code = session?.code ?? view.local?.code ?? null;
  const seed = session?.seed ?? view.local?.seed ?? null;
  const awards = session?.awards ?? null;
  const awardsOut = phase === 'awards';
  const myRank = (view.playerId !== null ? awards?.ranks[view.playerId] : undefined) ?? view.rank;

  // The game's phase, for `player:progress` and for where the banners go (the game does not tell the socket).
  const [gamePhase, setGamePhase] = useState<Phase | null>(null);
  useEffect(() => {
    if (screen !== 'game') { setGamePhase(null); return; }
    return watchGamePhase(p => {
      setGamePhase(p);
      if (p !== null) ctl.reportProgress(p);
    });
  }, [screen, ctl]);

  // The awards over a run still in progress: a small banner opens them; a finished run sees them once on its own.
  const [awardsOpen, setAwardsOpen] = useState(false);
  const autoOpened = useRef(false);
  useEffect(() => {
    if (awardsOut && screen === 'game' && gamePhase === 'end' && !autoOpened.current) {
      autoOpened.current = true;
      setAwardsOpen(true);
    }
  }, [awardsOut, screen, gamePhase]);
  useEffect(() => { if (!awardsOut) { autoOpened.current = false; setAwardsOpen(false); } }, [awardsOut]);

  // A thin strip over the game (the game moves down by its height, see play.css): the awards banner of a run still in
  // progress and, once the run is over, the way to solo (the class end screen has no "Chơi lại"). Never during the rush.
  const strip = screen === 'game' && ((awardsOut && gamePhase !== 'rush') || gamePhase === 'end');
  useEffect(() => {
    document.documentElement.classList.toggle('play-strip-on', strip);
    return () => document.documentElement.classList.remove('play-strip-on');
  }, [strip]);

  // Made once per session and kept; read again only when the session changes.
  const runId = useMemo(() => (code === null ? '' : ctl.runId()), [ctl, code]);

  if (screen === 'game' && code !== null && seed !== null) {
    return (
      <>
        <ConnectionBadge connected={view.connected} />
        <Suspense fallback={<Boot />}>
          <Game key={code} mode="class" seed={seed} runId={runId} sessionCode={code} persistKey={KEYS.class(code)}
            rank={myRank ?? null} awaitingAwards={!awardsOut} onNewRun={goSolo}
            onDayReport={(_, run) => ctl.reportDay(run)} onReporterVote={c => ctl.reporterVote(c)} />
        </Suspense>
        {strip && (
          <div className="play-strip" role="region" aria-label="Buổi chơi">
            {awardsOut && (
              <button type="button" className="play-pill play-pill--awards" onClick={() => setAwardsOpen(true)}>
                <span aria-hidden="true">🏆</span> Đã trao giải · Xem
              </button>
            )}
            {gamePhase === 'end' && (
              <button type="button" className="play-pill" onClick={goSolo}>
                <span aria-hidden="true">🔁</span> {awardsOut ? 'Chơi solo' : 'Chơi lại (solo)'}
              </button>
            )}
          </div>
        )}
        {awardsOut && awardsOpen && (
          <div className="play-overlay" role="dialog" aria-label="Kết quả buổi chơi">
            <div className="play play--overlay">
              <AwardsScreen awards={awards} playerId={view.playerId} rank={view.rank} onClose={() => setAwardsOpen(false)} />
            </div>
          </div>
        )}
      </>
    );
  }

  let body: React.ReactNode;
  switch (screen) {
    case 'join': body = <JoinScreen initialName={view.name} onSubmit={name => ctl.join(name)} />; break;
    case 'ended': body = <EndedScreen />; break;
    case 'lobby':
      body = <LobbyScreen name={view.name} vote={view.vote} onVote={c => ctl.vote(c)} session={session} />;
      break;
    case 'awards': body = <AwardsScreen awards={awards} playerId={view.playerId} rank={view.rank} />; break;
    default: body = <Boot />;
  }
  const withStreet = (screen === 'join' || screen === 'lobby' || screen === 'ended') && seed !== null;

  return (
    <div className={`play${withStreet ? ' play--street' : ''}`}>
      {withStreet && <PlayStreet seed={seed} />}
      <ConnectionBadge connected={view.connected} />
      <header className="play__top">
        <span className="play__brand"><img src="/favicon.svg" alt="" width="28" height="28" /> Phố Trà Sữa</span>
      </header>
      <main className="play__main">{body}</main>
    </div>
  );
}
