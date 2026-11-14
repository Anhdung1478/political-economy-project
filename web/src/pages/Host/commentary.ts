import type { RoundRule } from '../../../../shared/config';
import type { PublicPlayer, RoundResult } from '../../../../shared/types';

/** Two or three football-commentator lines about a round's result. */
export function commentary(result: RoundResult, players: PublicPlayer[], round: RoundRule): string[] {
  const name = (id: string) => players.find(p => p.id === id)?.nickname ?? 'Một quán bí ẩn';
  const lines: string[] = [];
  const shops = [...result.shops];

  const best = shops.sort((a, b) => b.profit - a.profit)[0];
  if (best && best.profit > 0) lines.push(`🎙️ ${name(best.playerId)} ẵm ${best.profit}k với giá ${best.price}k/ly — quá đỉnh!`);

  const zero = result.shops.filter(s => s.sold === 0);
  if (zero.length === 1) lines.push(`😭 ${name(zero[0].playerId)} bán được đúng 0 ly. Chủ quán đang ngồi khóc trong góc.`);
  else if (zero.length > 1) lines.push(`😭 ${zero.length} quán không bán được ly nào. Ế sấp mặt!`);

  const loss = result.shops.filter(s => s.profit < 0);
  if (loss.length > 0) lines.push(`😇 ${loss.length} quán bán dưới vốn — làm từ thiện à?`);

  if (result.unserved > 0) lines.push(`😤 ${result.unserved} khách xếp hàng mà không mua được ly nào.`);
  if (result.taxCollected > 0) lines.push(`🏛️ Nhà nước thu được ${result.taxCollected}k tiền thuế trân châu.`);
  if (round.id === 'rumor') lines.push('🤢 Tin đồn lan nhanh hơn trân châu nở — chợ vắng tanh.');
  return lines.slice(0, 3);
}
