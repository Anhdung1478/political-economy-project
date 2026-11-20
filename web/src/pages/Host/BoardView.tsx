// The private live board (spec §11 "Bảng theo dõi"), from `host:board`: the overview strip (counts, class average
// price per day, label shares, before → after votes) and the member table, sortable, with a per-day detail row.
import { Fragment, useState, type KeyboardEvent } from 'react';
import type { BoardMember, HostBoard } from '../../../../shared/protocol';
import { fmtMoney, fmtMoneySigned, fmtNumber, fmtPercent } from '../../game/format';
import { cx } from '../../ui/cx';
import {
  avgPriceText, DAY_COLUMNS, dayCells, LABEL_INFO, labelShares, memberVoteText, orDash, progressText,
  SORT_DEFAULT_DESC, sortMembers, voteRows, type SortKey,
} from './hostFormat';

export function BoardView({ board }: { board: HostBoard }) {
  return (
    <div className="board" data-host-view="board">
      <Overview board={board} />
      <Members members={board.members} />
    </div>
  );
}

function Overview({ board }: { board: HostBoard }) {
  const { counts, avgPrice, labels, votes } = board.overview;
  return (
    <section className="ov" aria-label="Tổng quan">
      <div className="ov__card card ov__counts">
        <h2>Người chơi</h2>
        <div className="ov__nums">
          <Num label="Đã vào" value={counts.joined} />
          <Num label="Đang chơi" value={counts.playing} tone="matcha" />
          <Num label="Đã xong" value={counts.finished} tone="caramel" />
          <Num label="Thua sớm" value={counts.lostTrust} tone="strawberry" />
        </div>
      </div>

      <div className="ov__card card">
        <h2>Giá trung bình của lớp <small>sáng → đóng cửa</small></h2>
        <table className="ov__prices">
          <tbody>
            {avgPrice.map(p => (
              <tr key={p.day}>
                <th>Ngày {p.day}</th>
                <td>{avgPriceText(p)}</td>
                <td className="ov__n">{p.n > 0 ? `${p.n} người` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ov__card card">
        <h2>Lựa chọn <small>{labels.n > 0 ? `trên ${labels.n} người đã gửi ngày` : 'chưa có ngày nào'}</small></h2>
        <ul className="ov__labels">
          {labelShares(labels).map(l => (
            <li key={l.label} title={l.text}>
              <span className="ov__icon" aria-hidden="true">{l.icon}</span>
              <span className="ov__ltext">{l.text}</span>
              <span className="ov__bar"><span style={{ width: `${l.share * 100}%` }} /></span>
              <span className="ov__pct">{l.count > 0 ? `${fmtPercent(l.share)} · ${l.count}` : '—'}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="ov__card card">
        <h2>Bình chọn <small>{votes.n > 0 ? `${votes.n} người có cả trước và sau` : 'chưa ai có đủ hai lần'}</small></h2>
        <div className="ov__votes">
          {voteRows(votes).map(v => (
            <div key={v.choice} className={`ov__vote ov__vote--${v.choice}`}>
              <span className="ov__vname">{v.text}</span>
              <span className="ov__vbar"><span style={{ width: `${v.beforeShare * 100}%` }} /></span>
              <span className="ov__vnum">{v.before}</span>
              <span className="ov__arrow">→</span>
              <span className="ov__vbar ov__vbar--after"><span style={{ width: `${v.afterShare * 100}%` }} /></span>
              <span className="ov__vnum">{v.after}</span>
            </div>
          ))}
          <p className="ov__vhint">Trước khi chơi → sau thẻ phóng viên</p>
        </div>
      </div>
    </section>
  );
}

function Num({ label, value, tone }: { label: string; value: number; tone?: 'matcha' | 'caramel' | 'strawberry' }) {
  return <div className={cx('ov__num', tone && `ov__num--${tone}`)}><b>{value}</b><span>{label}</span></div>;
}

const COLUMNS: { key: SortKey | null; text: string; num?: boolean }[] = [
  { key: null, text: '#' },
  { key: 'name', text: 'Tên' },
  { key: 'progress', text: 'Tiến độ' },
  { key: 'score', text: 'Điểm', num: true },
  { key: 'profit', text: 'Tổng lãi', num: true },
  { key: 'rep', text: 'Uy tín', num: true },
  { key: 'lastPrice', text: 'Giá', num: true },
  { key: 'cups', text: 'Ly', num: true },
  { key: 'wrong', text: 'Sai', num: true },
  { key: 'walkouts', text: 'Bỏ về', num: true },
  { key: null, text: 'Nhãn' },
  { key: null, text: 'Bình chọn' },
];

function Members({ members }: { members: BoardMember[] }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'score', desc: true });
  const [openId, setOpenId] = useState<string | null>(null);
  const rank = new Map(members.map((m, i) => [m.id, i + 1]));
  const rows = sortMembers(members, sort.key, sort.desc);
  const toggle = (id: string) => setOpenId(o => (o === id ? null : id));
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(id); }
  };

  return (
    <section className="members card" aria-label="Thành viên">
      <div className="members__head">
        <h2>Thành viên <small>{members.length}</small></h2>
        <p>Bấm vào một dòng để xem từng ngày. Bấm tiêu đề cột để sắp xếp.</p>
      </div>
      {members.length === 0 ? (
        <p className="members__empty">Chưa có ai vào. Chiếu mã QR ở <b>Màn chiếu</b> để cả lớp quét.</p>
      ) : (
        <div className="members__scroll">
          <table className="mt">
            <thead>
              <tr>
                {COLUMNS.map(c => (
                  <th key={c.text} className={cx(c.num && 'num')}
                    aria-sort={c.key && sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                    {c.key ? (
                      <button type="button" className={cx('mt__sort', sort.key === c.key && 'is-on')}
                        onClick={() => setSort(s => s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key!, desc: SORT_DEFAULT_DESC[c.key!] })}>
                        {c.text}{sort.key === c.key ? (sort.desc ? ' ▾' : ' ▴') : ''}
                      </button>
                    ) : c.text}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(m => (
                <Fragment key={m.id}>
                  <tr className={cx('mt__row', openId === m.id && 'is-open', m.lost && 'is-lost')} tabIndex={0}
                    aria-expanded={openId === m.id} onClick={() => toggle(m.id)} onKeyDown={e => onKey(e, m.id)}>
                    <td className="mt__rank">{m.score === null ? '' : rank.get(m.id)}</td>
                    <td className="mt__name">
                      <span className={cx('dot', m.connected && 'dot--on')} title={m.connected ? 'Đang kết nối' : 'Mất kết nối'} />
                      <span className="mt__nametext">{m.name}</span>
                    </td>
                    <td className="mt__prog">{progressText(m)}</td>
                    <td className="num mt__score">{orDash(m.score, fmtMoney)}</td>
                    <td className={cx('num', m.profit !== null && m.profit < 0 && 'neg')}>{orDash(m.profit, fmtMoneySigned)}</td>
                    <td className="num">{orDash(m.rep, r => fmtNumber(r, 0))}</td>
                    <td className="num">{orDash(m.lastPrice, fmtMoney)}</td>
                    <td className="num">{m.days.length ? m.cups : '—'}</td>
                    <td className="num">{m.days.length ? m.wrong : '—'}</td>
                    <td className="num">{m.days.length ? m.walkouts : '—'}</td>
                    <td className="mt__labels">
                      {m.labels.map(l => <span key={l} title={LABEL_INFO[l].text}>{LABEL_INFO[l].icon}</span>)}
                    </td>
                    <td className="mt__vote">{memberVoteText(m.vote)}</td>
                  </tr>
                  {openId === m.id && (
                    <tr className="mt__detail">
                      <td colSpan={COLUMNS.length}><DayDetail member={m} /></td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DayDetail({ member }: { member: BoardMember }) {
  if (member.days.length === 0) {
    return <p className="dd__empty">{member.name} chưa gửi ngày nào. Tiến độ: {progressText(member)}.</p>;
  }
  return (
    <div className="dd">
      <table className="dd__table">
        <thead><tr>{DAY_COLUMNS.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {member.days.map(d => (
            <tr key={d.day} className={cx(d.lost && 'is-lost')}>
              {dayCells(d).map((c, i) => <td key={i} className={cx(i === 13 && d.profit < 0 && 'neg')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dd__note">Topping theo thứ tự trân châu / thạch / pudding. ☠ = ngày mất hết uy tín.</p>
    </div>
  );
}
