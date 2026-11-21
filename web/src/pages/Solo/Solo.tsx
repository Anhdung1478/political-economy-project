// / and /solo (spec §2, §9): the title over the morning street, then the game. The run lives on this device and the
// game plays offline. The leaderboard talks to the server, but its socket code is loaded on demand (`useSoloBoard`),
// so this page never imports `net/socket` statically (spec §10).
import { useState } from 'react';
import { fmtMoney } from '../../game/format';
import { storage } from '../../game/storage';
import { StreetCanvas } from '../../scene/StreetCanvas';
import { Button } from '../../ui/Button';
import { ModeSwitch } from '../../ui/ModeSwitch';
import { Modal } from '../../ui/Modal';
import Game from '../Game/Game';
import { NameForm, NameLine, SoloBoardList } from './SoloBoardView';
import { SoloEndBoard } from './SoloEndBoard';
import { loadName } from './soloQueue';
import { useSoloBoard } from './useSoloBoard';
import { clearSavedRun, newRunId, randomSeed, titleInfo } from './soloRun';
import './solo.css';

interface Play { seed: number; runId: string }

const fresh = (): Play => {
  const seed = randomSeed();
  return { seed, runId: newRunId(Date.now(), seed) };
};

/** The board on the title card; its own component, so a board update never re-renders the game. */
function TitleBoard({ name }: { name: string | null }) {
  const { board, status, stale } = useSoloBoard();
  return (
    <div className="solo__board">
      <SoloBoardList board={board} status={status} stale={stale} me={name} />
    </div>
  );
}

export default function Solo() {
  const [info] = useState(() => titleInfo(storage));
  const [titleSeed] = useState(() => randomSeed());
  const [play, setPlay] = useState<Play | null>(null);
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState(() => loadName(storage));
  // The name step: no name yet, so the press of "Chơi" waits for one (it needs no network).
  const [naming, setNaming] = useState<'new' | 'resume' | null>(null);

  const startNew = () => {
    clearSavedRun(storage);
    setAsking(false);
    setPlay(fresh());
  };
  // Resuming: Game loads the saved run itself; the seed and id here are only its fallback.
  const resume = () => setPlay(fresh());
  const begin = (kind: 'new' | 'resume') => {
    setAsking(false);
    if (name === null) setNaming(kind);
    else if (kind === 'new') startNew();
    else resume();
  };

  if (play !== null) {
    return <Game key={play.runId} mode="solo" seed={play.seed} runId={play.runId} onNewRun={startNew}
      endExtra={run => <SoloEndBoard run={run} />} />;
  }

  const saved = info.resumeDay !== null;

  return (
    <main className="solo">
      <div className="solo__street" aria-hidden="true">
        <StreetCanvas snapshot={null} mode="ambient" timeOfDay="morning" seed={titleSeed} />
      </div>
      <section className="solo__card">
        <ModeSwitch mode="solo" />
        <h1 className="solo__name">Phố Trà Sữa</h1>
        <p className="solo__pitch">Năm ngày, một quán, và cả con phố đang giành khách với bạn.</p>
        {naming !== null ? (
          <div className="solo__actions">
            <NameForm stacked autoFocus label="Tên của bạn" initial="" submitLabel={naming === 'new' ? 'Bắt đầu chơi' : 'Chơi tiếp'}
              onSaved={n => { setName(n); if (naming === 'new') startNew(); else resume(); }} />
            <Button variant="ghost" size="md" block onClick={() => setNaming(null)}>Quay lại</Button>
          </div>
        ) : (
          <>
            <div className="solo__actions">
              {saved ? (
                <>
                  <Button size="xl" block onClick={() => begin('resume')}>Chơi tiếp (ngày {info.resumeDay})</Button>
                  <Button variant="secondary" size="lg" block onClick={() => setAsking(true)}>Ván mới</Button>
                </>
              ) : (
                <Button size="xl" block onClick={() => begin('new')}>Chơi</Button>
              )}
            </div>
            {name !== null && <div className="solo__who"><NameLine name={name} onChange={setName} /></div>}
          </>
        )}
        {info.best !== null && <p className="solo__best">Kỷ lục của bạn: <b>{fmtMoney(info.best)}</b></p>}
        <TitleBoard name={name} />
      </section>
      <Modal open={asking} title={`Bỏ ván đang chơi ở ngày ${info.resumeDay}?`} onClose={() => setAsking(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setAsking(false)}>Giữ ván cũ</Button>
            <Button variant="danger" onClick={() => begin('new')}>Bỏ và chơi ván mới</Button>
          </>
        }>
        <p>Ván cũ sẽ mất, không lấy lại được.</p>
      </Modal>
    </main>
  );
}
