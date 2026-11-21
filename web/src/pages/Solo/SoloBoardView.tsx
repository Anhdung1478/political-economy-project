// The solo leaderboard as a list (compact top 10, "Xem tất cả" opens the 50) and the name line. Shared by the title
// card and the end screen; the live data comes from `useSoloBoard`.
import { useState, type FormEvent } from 'react';
import { LIMITS, soloKey, type SoloBoard } from '../../../../shared/protocol';
import { fmtMoney } from '../../game/format';
import { storage } from '../../game/storage';
import { Button } from '../../ui/Button';
import { cx } from '../../ui/cx';
import { Input } from '../../ui/Input';
import { saveName } from './soloQueue';
import type { BoardStatus } from './useSoloBoard';

const COMPACT = 10;

/** Competition ranking over the entries: equal scores share a rank (as the server's `rank` does). */
export function ranked(board: SoloBoard): { rank: number; name: string; score: number }[] {
  let rank = 0;
  return board.entries.map((e, i) => {
    if (i === 0 || e.score < board.entries[i - 1]!.score) rank = i + 1;
    return { rank, name: e.name, score: e.score };
  });
}

interface ListProps {
  board: SoloBoard | null;
  status: BoardStatus;
  stale: boolean;
  /** The player's name, to find and highlight their row. */
  me: string | null;
  title?: string;
}

export function SoloBoardList({ board, status, stale, me, title = 'Bảng xếp hạng một mình' }: ListProps) {
  const [all, setAll] = useState(false);
  const myKey = me === null ? null : soloKey(me);
  const rows = board === null ? [] : ranked(board);
  const shown = all ? rows : rows.slice(0, COMPACT);
  const mine = myKey === null ? undefined : rows.find(r => soloKey(r.name) === myKey);
  return (
    <section className="sboard" aria-label={title}>
      <div className="sboard__head">
        <h2 className="sboard__title">{title}</h2>
        {rows.length > COMPACT && (
          <button type="button" className="sboard__more" aria-expanded={all} onClick={() => setAll(a => !a)}>
            {all ? 'Thu gọn' : `Xem tất cả (${rows.length})`}
          </button>
        )}
      </div>
      {status === 'offline' && <p className="sboard__note sboard__note--warn" role="status">Chưa kết nối được bảng xếp hạng.</p>}
      {status === 'loading' && <p className="sboard__note" role="status">Đang tải bảng xếp hạng…</p>}
      {status === 'live' && rows.length === 0 && <p className="sboard__note">Chưa có ai trên bảng. Ván đầu tiên thuộc về bạn.</p>}
      {rows.length > 0 && (
        <ol className={cx('sboard__list', all && 'sboard__list--tall')}>
          {shown.map(r => (
            <li key={r.name} className={cx('sboard__row', myKey !== null && soloKey(r.name) === myKey && 'is-me')}
              aria-current={myKey !== null && soloKey(r.name) === myKey ? 'true' : undefined}>
              <span className="sboard__rank">#{r.rank}</span>
              <span className="sboard__name">{r.name}</span>
              <span className="sboard__score">{fmtMoney(r.score)}</span>
            </li>
          ))}
        </ol>
      )}
      {mine !== undefined && !all && mine.rank > COMPACT && (
        <p className="sboard__note">Bạn đang hạng <b>#{mine.rank}</b>.</p>
      )}
      {stale && <p className="sboard__note sboard__note--warn" role="status">Mất kết nối, bảng có thể chưa mới nhất.</p>}
    </section>
  );
}

/** Asks for the name (end screen, no name yet) or edits it (title card). */
export function NameForm({ initial, submitLabel, onSaved, autoFocus }: {
  initial: string; submitLabel: string; onSaved: (name: string) => void; autoFocus?: boolean;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const saved = saveName(storage, name);
    if (saved === null) { setError('Nhập một cái tên (tối đa 20 ký tự) nhé'); return; }
    onSaved(saved);
  };
  return (
    <form className="sboard__name-form" onSubmit={submit} noValidate>
      <Input label="Tên trên bảng xếp hạng" value={name} maxLength={LIMITS.nickname} autoComplete="nickname" enterKeyHint="done"
        autoFocus={autoFocus} placeholder="VD: Dũng đẹp trai" error={error}
        onChange={e => { setName(e.target.value); setError(null); }} />
      <Button type="submit" variant="caramel" size="md">{submitLabel}</Button>
    </form>
  );
}

/** "Tên trên bảng: X · Đổi tên" on the title card. */
export function NameLine({ name, onChange }: { name: string | null; onChange: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <NameForm initial={name ?? ''} submitLabel="Lưu" autoFocus onSaved={n => { onChange(n); setEditing(false); }} />;
  }
  return (
    <p className="sboard__name-line">
      {name === null ? <span>Chưa có tên trên bảng.</span> : <span>Tên trên bảng: <b>{name}</b></span>}
      <button type="button" className="sboard__more" onClick={() => setEditing(true)}>{name === null ? 'Đặt tên' : 'Đổi tên'}</button>
    </p>
  );
}
