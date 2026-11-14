import type { Award } from '../../shared/types';

export interface PlayerHistory {
  playerId: string;
  total: number;
  rounds: { price: number; sold: number; unsold: number }[];
}

/** First item with the highest non-null score; earlier items win ties. */
function best<T>(items: T[], score: (t: T) => number | null): T | null {
  let pick: T | null = null, top = -Infinity;
  for (const it of items) {
    const s = score(it);
    if (s !== null && s > top) { top = s; pick = it; }
  }
  return pick;
}

/** `players` must be in rank order so ties go to the better-ranked player. */
export function computeAwards(players: PlayerHistory[]): Award[] {
  const played = players.filter(p => p.rounds.length > 0);
  const avg = (p: PlayerHistory) => p.rounds.reduce((s, r) => s + r.price, 0) / p.rounds.length;
  const sharkPrice = (p: PlayerHistory) => {
    const sold = p.rounds.filter(r => r.sold > 0);
    return sold.length ? Math.max(...sold.map(r => r.price)) : null;
  };
  const unsold = (p: PlayerHistory) => p.rounds.reduce((s, r) => s + r.unsold, 0);
  const out: Award[] = [];

  const tycoon = best(played, p => p.total);
  if (tycoon) out.push({ id: 'tycoon', emoji: '🏆', title: 'Đại Gia Trân Châu', playerId: tycoon.playerId, detail: `Lãi ${tycoon.total}k sau cả game` });

  const saint = best(played, p => -avg(p));
  if (saint) out.push({ id: 'saint', emoji: '😇', title: 'Mạnh Thường Quân', playerId: saint.playerId, detail: `Giá trung bình chỉ ${Math.round(avg(saint))}k/ly` });

  const shark = best(played, sharkPrice);
  if (shark) {
    const price = sharkPrice(shark)!;
    const sold = shark.rounds.find(r => r.price === price && r.sold > 0)!.sold;
    out.push({ id: 'shark', emoji: '🦈', title: 'Tư Bản Hút Máu', playerId: shark.playerId, detail: `Bán ${price}k/ly mà vẫn có ${sold} người mua` });
  }

  const hoarder = best(played, p => (unsold(p) > 0 ? unsold(p) : null));
  if (hoarder) out.push({ id: 'hoarder', emoji: '📦', title: 'Ông Hoàng Tồn Kho', playerId: hoarder.playerId, detail: `Ôm về ${unsold(hoarder)} ly không ai mua` });

  return out;
}
