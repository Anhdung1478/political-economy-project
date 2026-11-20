// The street as a list (spec §13 "Canvas không khởi tạo được: trưa vẫn chơi được với dải phố dạng danh sách"): when
// the canvas cannot start, or a renderer keeps failing, StreetCanvas shows this instead. Each shop on a card in the
// street's order (the top row, then the bottom row with yours in the middle): its name, the price on its board (an
// arrow when it just changed), whether it is selling, and how many are queueing. It reads the same director the canvas
// would have drawn, which keeps taking the rush's events, and refreshes a few times a second.
import { useEffect, useState, type RefObject } from 'react';
import type { ShopId, ShopStatus } from '../../../shared/sim/types';
import { fmtMoney } from '../game/format';
import { SHOP_NAMES } from '../pages/Game/copy';
import type { Director } from './director';
import './streetList.css';

const STATUS: Record<ShopStatus, { label: string; tone: 'matcha' | 'caramel' | 'strawberry' | 'plain' }> = {
  open: { label: 'Đang bán', tone: 'matcha' },
  soldOut: { label: 'Hết hàng', tone: 'strawberry' },
  resting: { label: 'Nghỉ bán', tone: 'plain' },
  closed: { label: 'Sang nhượng', tone: 'plain' },
  notYet: { label: 'Sắp khai trương', tone: 'caramel' },
  closedEarly: { label: 'Đóng cửa sớm', tone: 'plain' },
};

export interface StreetRow {
  id: ShopId;
  name: string;
  status: ShopStatus;
  /** 0 when not selling today. */
  price: number;
  /** +1 the price just went up, −1 down, 0 unchanged. */
  trend: -1 | 0 | 1;
  queue: number;
  certified: boolean;
  named: boolean;
}

/** How long a price change keeps its arrow (ticks). */
const TREND_TICKS = 50;

/**
 * The rows to show, in the street's order. Pure. The clock is the latest of the picture's time and the last event
 * applied: with the canvas stopped only events move it, so a price arrow still clears.
 */
export function streetRows(d: Pick<Director, 'shops' | 'now' | 'lastEventTick'>): StreetRow[] {
  const now = Math.max(d.now, d.lastEventTick);
  return d.shops.map(s => ({
    id: s.id, name: SHOP_NAMES[s.id], status: s.status, price: s.price,
    trend: s.prevPrice === null || now - s.priceSince > TREND_TICKS ? 0 : s.price > s.prevPrice ? 1 : s.price < s.prevPrice ? -1 : 0,
    queue: s.queue.length, certified: s.certified, named: s.named,
  }));
}

const same = (a: StreetRow[], b: StreetRow[]) => a.length === b.length
  && a.every((r, i) => {
    const o = b[i];
    return r.id === o.id && r.status === o.status && r.price === o.price && r.trend === o.trend && r.queue === o.queue
      && r.certified === o.certified && r.named === o.named;
  });


export function StreetList({ director }: { director: RefObject<Director | null> }) {
  const [rows, setRows] = useState<StreetRow[]>(() => (director.current === null ? [] : streetRows(director.current)));
  useEffect(() => {
    const id = setInterval(() => {
      const d = director.current;
      if (d === null) return;
      const next = streetRows(d);
      setRows(prev => (same(prev, next) ? prev : next));
    }, 400);
    return () => clearInterval(id);
  }, [director]);

  return (
    <section className="street-list" aria-label="Các quán trên phố">
      <p className="street-list__note">Phố đang hiện dạng danh sách</p>
      <ul className="street-list__grid">
        {rows.map(r => {
          const st = STATUS[r.status];
          const selling = r.status === 'open' || r.status === 'soldOut';
          return (
            <li key={r.id} className={`street-list__shop card${r.id === 'player' ? ' is-player' : ''}`}
              data-shop={r.id} data-status={r.status}>
              <div className="street-list__head">
                <b className="street-list__name">{r.name}</b>
                <span className={`chip${st.tone === 'plain' ? '' : ` chip--${st.tone}`} street-list__status`}>{st.label}</span>
              </div>
              <span className="street-list__price">
                <span className="sr-only">{selling && r.price > 0 ? 'Giá ' : 'Không bán hôm nay'}</span>
                <span aria-hidden={!(selling && r.price > 0)}>{selling && r.price > 0 ? fmtMoney(r.price) : '—'}</span>
                {r.trend !== 0 && (
                  <i className={`street-list__trend is-${r.trend > 0 ? 'up' : 'down'}`} aria-hidden="true">
                    {r.trend > 0 ? '▲' : '▼'}
                  </i>
                )}
              </span>
              <span className="street-list__queue">
                <span className="street-list__dots" aria-hidden="true">
                  {Array.from({ length: Math.min(r.queue, 6) }, (_, i) => <i key={i} />)}
                </span>
                {r.queue > 0 ? `${r.queue} người xếp hàng` : 'Chưa ai xếp hàng'}
              </span>
              {(r.certified || r.named) && (
                <div className="street-list__badges">
                  {r.certified && <span className="chip chip--matcha">✓ Đã kiểm định</span>}
                  {r.named && <span className="chip chip--strawberry">Bị nêu tên</span>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
