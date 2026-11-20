// /play (spec §2, §11, §13): the student's class screens. Join (or resume with the saved token), the vote and the wait
// over the ambient street, the game itself in class mode when the market opens, the awards, and the way out to solo.
// The logic lives in `PlayController` (socket, token, report queue) and `playLogic` (pure); this file only chooses the
// screen and wires the game to them.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Day, Phase } from '../../../../shared/sim/types';
import { KEYS } from '../../game/runStore';
import { storage } from '../../game/storage';
import { connect } from '../../net/socket';
import { ConnectionBadge } from '../../ui/ConnectionBadge';
import { AwardsScreen, EndedScreen, goSolo } from './AwardsScreen';
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

  // The game tells its day and phase (`onPhase`): sent as `player:progress`, and it says where the strip may go.
  const [gamePhase, setGamePhase] = useState<Phase | null>(null);
  const onPhase = useCallback((day: Day, phase: Phase) => {
    setGamePhase(phase);
    ctl.reportProgress(day, phase);
  }, [ctl]);
  useEffect(() => { if (screen !== 'game') setGamePhase(null); }, [screen]);

  // The awards over a run still in progress or finished: a small strip on top (the game moves down by its height, see
  // play.css) opens them. It never interrupts: no sheet opens by itself, and the strip is not there during the rush.
  const [awardsOpen, setAwardsOpen] = useState(false);
  useEffect(() => { if (!awardsOut) setAwardsOpen(false); }, [awardsOut]);
  const strip = screen === 'game' && awardsOut && gamePhase !== 'rush';
  useEffect(() => {
    document.documentElement.classList.toggle('play-strip-on', strip);
    return () => document.documentElement.classList.remove('play-strip-on');
  }, [strip]);

  // The sheet is a dialog: focus goes into it, Escape closes it.
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!awardsOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    sheet.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAwardsOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [awardsOpen]);

  // No "connection lost" flash while the page is still making its first connection.
  const [grace, setGrace] = useState(true);
  useEffect(() => { const t = setTimeout(() => setGrace(false), 2500); return () => clearTimeout(t); }, []);
  const online = view.connected || grace;

  // Made once per session and kept; read again only when the session changes.
  const runId = useMemo(() => (code === null ? '' : ctl.runId()), [ctl, code]);

  if (screen === 'game' && code !== null && seed !== null) {
    return (
      <>
        <ConnectionBadge connected={online} />
        <Suspense fallback={<Boot />}>
          <Game key={code} mode="class" seed={seed} runId={runId} sessionCode={code} persistKey={KEYS.class(code)}
            rank={myRank ?? null} awaitingAwards={!awardsOut} onNewRun={goSolo} unsent={view.unsent}
            onDayReport={(_, run) => ctl.reportDay(run)} onReporterVote={c => ctl.reporterVote(c)} onPhase={onPhase} />
        </Suspense>
        {strip && (
          <div className="play-strip" role="region" aria-label="Buổi chơi">
            <button type="button" className="play-pill play-pill--awards" onClick={() => setAwardsOpen(true)}>
              <span aria-hidden="true">🏆</span> Đã trao giải · Xem
            </button>
          </div>
        )}
        {awardsOut && awardsOpen && (
          <div className="play-overlay" role="dialog" aria-modal="true" aria-label="Kết quả buổi chơi" ref={sheet}>
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
      <ConnectionBadge connected={online} />
      <header className="play__top">
        <span className="play__brand"><img src="/favicon.svg" alt="" width="28" height="28" /> Phố Trà Sữa</span>
      </header>
      <main className="play__main">{body}</main>
    </div>
  );
}
