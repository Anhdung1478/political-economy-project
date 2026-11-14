import { GAME, roundCustomers, type RoundRule } from '../../../shared/config';

export const fmtK = (n: number) => `${n}k`;
export const fmtProfit = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}k`;

/** Short facts about a round, for chips on the event card. */
export function roundChips(r: RoundRule, shops: number): { text: string; tone: 'matcha' | 'caramel' | 'strawberry' | undefined }[] {
  const chips: { text: string; tone: 'matcha' | 'caramel' | 'strawberry' | undefined }[] = [];
  chips.push({ text: `Vốn ${r.cost}k/ly`, tone: r.cost > GAME.baseCost ? 'strawberry' : undefined });
  chips.push({ text: `Giá tối đa ${r.maxPrice}k`, tone: r.maxPrice < GAME.priceMax ? 'caramel' : undefined });
  chips.push({ text: `👥 ${roundCustomers(r, shops)} khách`, tone: r.customerMultiplier < 1 ? 'strawberry' : 'matcha' });
  if (r.fixedCost) chips.push({ text: 'Không được ăn bớt nguyên liệu', tone: 'caramel' });
  if (r.tax > 0) chips.push({ text: `Thuế ${r.tax}k/ly`, tone: 'caramel' });
  return chips;
}

export const HAND_LABEL: Record<RoundRule['hand'], string> = {
  invisible: 'Bàn tay vô hình',
  visible: 'Bàn tay hữu hình',
  chaos: 'Tin đồn hỗn loạn',
};
