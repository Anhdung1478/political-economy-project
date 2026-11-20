// / and /solo (spec §2, §9): the title over the morning street, then the game. No server: the run lives on this
// device. It must never import `net/socket` (spec §10).
import { useState } from 'react';
import { fmtMoney } from '../../game/format';
import { storage } from '../../game/storage';
import { StreetCanvas } from '../../scene/StreetCanvas';
import { Button } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import Game from '../Game/Game';
import { clearSavedRun, newRunId, randomSeed, titleInfo } from './soloRun';
import './solo.css';

interface Play { seed: number; runId: string }

const fresh = (): Play => {
  const seed = randomSeed();
  return { seed, runId: newRunId(Date.now(), seed) };
};

export default function Solo() {
  const [info] = useState(() => titleInfo(storage));
  const [titleSeed] = useState(() => randomSeed());
  const [play, setPlay] = useState<Play | null>(null);
  const [asking, setAsking] = useState(false);

  const startNew = () => {
    clearSavedRun(storage);
    setAsking(false);
    setPlay(fresh());
  };

  if (play !== null) {
    return <Game key={play.runId} mode="solo" seed={play.seed} runId={play.runId} onNewRun={startNew} />;
  }

  const saved = info.resumeDay !== null;
  // Resuming: Game loads the saved run itself; the seed and id here are only its fallback.
  const resume = () => setPlay(fresh());

  return (
    <main className="solo">
      <div className="solo__street" aria-hidden="true">
        <StreetCanvas snapshot={null} mode="ambient" timeOfDay="morning" seed={titleSeed} />
      </div>
      <section className="solo__card">
        <h1 className="solo__name">Phố Trà Sữa</h1>
        <p className="solo__pitch">Năm ngày, một quán, và cả con phố đang giành khách với bạn.</p>
        <div className="solo__actions">
          {saved ? (
            <>
              <Button size="xl" block onClick={resume}>Chơi tiếp (ngày {info.resumeDay})</Button>
              <Button variant="secondary" size="lg" block onClick={() => setAsking(true)}>Ván mới</Button>
            </>
          ) : (
            <Button size="xl" block onClick={startNew}>Chơi</Button>
          )}
        </div>
        {info.best !== null && <p className="solo__best">Kỷ lục của bạn: <b>{fmtMoney(info.best)}</b></p>}
      </section>
      <Modal open={asking} title={`Bỏ ván đang chơi ở ngày ${info.resumeDay}?`} onClose={() => setAsking(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setAsking(false)}>Giữ ván cũ</Button>
            <Button variant="danger" onClick={startNew}>Bỏ và chơi ván mới</Button>
          </>
        }>
        <p>Ván cũ sẽ mất, không lấy lại được.</p>
      </Modal>
    </main>
  );
}
