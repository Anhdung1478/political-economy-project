// PLACEHOLDERS (Task 19) — Task 21 replaces these with CardScreen, ReportScreen and EndScreen. They only let the day
// loop be played end to end: answer the afternoon cards, read a bare report, move on.
import { CARDS } from '../../../../shared/sim/cards';
import { score } from '../../../../shared/sim/run';
import type { RunState } from '../../../../shared/sim/types';
import { fmtMoney, fmtMoneySigned } from '../../game/format';
import type { Intent } from '../../game/runStore';
import { Button } from '../../ui/Button';

type Dispatch = (i: Intent) => void;

export function CardsPlaceholder({ run, dispatch }: { run: RunState; dispatch: Dispatch }) {
  const id = run.cards[run.cardIndex];
  if (id === undefined) return null;
  const card = CARDS[id];
  return (
    <div className="ph">
      <section className="ph__card panel" aria-labelledby="ph-card">
        <small className="ph__tag">Thẻ {run.cardIndex + 1}/{run.cards.length} · tạm, Task 21</small>
        <h2 id="ph-card">{card.speaker}</h2>
        {card.lines.map(l => <p key={l}>{l}</p>)}
        <div className="ph__choices">
          <Button variant="caramel" onClick={() => dispatch({ type: 'chooseCard', choice: 'A' })}>{card.a.label}</Button>
          <Button variant="secondary" onClick={() => dispatch({ type: 'chooseCard', choice: 'B' })}>{card.b.label}</Button>
        </div>
      </section>
    </div>
  );
}

export function ReportPlaceholder({ run, dispatch }: { run: RunState; dispatch: Dispatch }) {
  const r = run.reports.find(x => x.summary.day === run.day);
  if (r === undefined) return null;
  const s = r.summary;
  const last = run.outcome === 'lostTrust' || run.day >= 5;
  return (
    <div className="ph">
      <section className="ph__card panel" aria-labelledby="ph-report">
        <small className="ph__tag">Báo cáo tối · tạm, Task 21</small>
        <h2 id="ph-report">Tối ngày {s.day}</h2>
        <p>Bán {s.cups} ly · lãi ngày <b>{fmtMoneySigned(s.profit)}</b></p>
        <p>Tiền {fmtMoney(s.cash)} · uy tín {s.rep}</p>
        <Button variant="primary" onClick={() => dispatch({ type: 'nextDay' })}>{last ? 'Xem kết ván' : `Sang ngày ${s.day + 1}`}</Button>
      </section>
    </div>
  );
}

export function EndPlaceholder({ run, onNewRun }: { run: RunState; onNewRun?: () => void }) {
  const sc = score(run);
  return (
    <div className="ph">
      <section className="ph__card panel" aria-labelledby="ph-end">
        <small className="ph__tag">Màn kết · tạm, Task 21</small>
        <h2 id="ph-end">{run.outcome === 'lostTrust' ? 'Mất hết lòng tin' : 'Hết 5 ngày!'}</h2>
        <p>Điểm: <b>{fmtMoney(sc.total)}</b> (lãi {fmtMoneySigned(sc.profit)} + thương hiệu {fmtMoney(sc.brand)})</p>
        {onNewRun && <Button variant="primary" onClick={onNewRun}>Chơi ván mới</Button>}
      </section>
    </div>
  );
}
