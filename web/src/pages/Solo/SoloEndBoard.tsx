// The solo end screen's board section: sends the run's final score under the device's name (asking for one when there
// is none), says the rank it got, and shows the live board. Offline, the run waits in the queue (`soloQueue`).
import { useEffect, useState } from 'react';
import { score } from '../../../../shared/sim/run';
import type { RunState } from '../../../../shared/sim/types';
import { fmtMoney } from '../../game/format';
import { storage } from '../../game/storage';
import { NameForm, SoloBoardList } from './SoloBoardView';
import { loadName } from './soloQueue';
import { useSoloBoard } from './useSoloBoard';

export function SoloEndBoard({ run }: { run: RunState }) {
  const { board, status, stale, results, submit } = useSoloBoard();
  const [name, setName] = useState(() => loadName(storage));
  const total = score(run).total;
  const runId = run.runId;

  // With a name the score goes out by itself; the queue and the server's runId check make a repeat harmless.
  useEffect(() => {
    if (name !== null) submit({ name, score: total, runId });
  }, [name, total, runId, submit]);

  const result = results[runId];
  let note: string;
  if (name === null) note = 'Nhập tên để điểm của bạn lên bảng xếp hạng.';
  else if (result?.kind === 'saved') {
    note = result.improved
      ? `Hạng #${result.rank} trên bảng với ${fmtMoney(result.best)}${result.rank === 1 ? '. Số một!' : '.'}`
      : `Hạng #${result.rank}. Điểm cao nhất của ${name} trên bảng vẫn là ${fmtMoney(result.best)}.`;
  } else if (result?.kind === 'rejected') note = 'Bảng xếp hạng không nhận điểm này.';
  else if (result?.kind === 'retry' || status === 'offline') note = 'Chưa gửi được. Điểm đã lưu trên máy, sẽ gửi khi có mạng lại.';
  else note = 'Đang gửi điểm lên bảng xếp hạng…';

  return (
    <section className="rsec end-board" aria-label="Bảng xếp hạng">
      <p className="sboard__note" role="status" style={{ marginBottom: 8, color: 'var(--ink)' }}>{note}</p>
      {name === null && <div style={{ marginBottom: 12 }}><NameForm initial="" submitLabel="Lưu lên bảng xếp hạng" onSaved={setName} /></div>}
      <SoloBoardList board={board} status={status} stale={stale} me={name} title="Bảng xếp hạng" />
    </section>
  );
}
