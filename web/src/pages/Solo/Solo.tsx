// / and /solo (spec §2, §9): the title over the morning street, then the game. No server: the run lives on this
// device. It must never import `net/socket` (spec §10).
import { useState } from 'react';
import { storage } from '../../game/storage';
import { StreetCanvas } from '../../scene/StreetCanvas';
import { Button } from '../../ui/Button';
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
  const [play, setPlay] = useState<Play | null>(null);

  if (play !== null) return <Game key={play.runId} mode="solo" seed={play.seed} runId={play.runId} />;

  const start = () => {
    clearSavedRun(storage);
    setPlay(fresh());
  };
  // Resuming: Game loads the saved run itself; the seed and id here are only its fallback.
  const resume = () => setPlay({ ...fresh(), runId: 'resume' });

  return (
    <main className="solo">
      <div className="solo__street" aria-hidden="true">
        <StreetCanvas snapshot={null} mode="ambient" timeOfDay="morning" />
      </div>
      <section className="solo__card">
        <h1 className="solo__name">Phố Trà Sữa</h1>
        <p className="solo__pitch">Năm ngày, một quán, và cả con phố đang giành khách với bạn.</p>
        <div className="solo__actions">
          <Button size="xl" block onClick={start}>Chơi</Button>
          {info.resumeDay !== null && (
            <Button variant="secondary" size="lg" block onClick={resume}>Chơi tiếp (ngày {info.resumeDay})</Button>
          )}
        </div>
        {info.best !== null && <p className="solo__best">Kỷ lục của bạn: <b>{info.best.toLocaleString('vi-VN')}</b> điểm</p>}
      </section>
    </main>
  );
}
