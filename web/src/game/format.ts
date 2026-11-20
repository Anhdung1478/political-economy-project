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

// Game formatters (Phố Trà Sữa). Money is in thousand đồng, written Vietnamese style: a dot between thousands, a comma
// before the half (`1.250k`, `27,5k`), the true minus sign for losses.

/** A number Vietnamese style: `1.250`, `27,5`, `−3`; at most `digits` decimals, trailing zeros dropped. */
export function fmtNumber(n: number, digits = 1): string {
  const f = 10 ** digits;
  const r = Math.round(Math.abs(n) * f) / f;
  const [whole, frac] = r.toFixed(digits).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const tail = frac?.replace(/0+$/, '') ?? '';
  return `${n < 0 && r !== 0 ? '−' : ''}${grouped}${tail ? `,${tail}` : ''}`;
}

/** Money in thousand đồng: `27,5k`, `1.250k`, `−40k`. */
export const fmtMoney = (k: number) => `${fmtNumber(k)}k`;

/** Money with its sign, for gains and losses: `+12k`, `−7,5k`, `0k`. */
export const fmtMoneySigned = (k: number) => `${k > 0 && fmtNumber(k) !== '0' ? '+' : ''}${fmtMoney(k)}`;

/** A share (0..1) as a percent: `45%`, `12,5%` with `digits` decimals. */
export const fmtPercent = (share: number, digits = 0) => `${fmtNumber(share * 100, digits)}%`;

/** Whole seconds left from rush ticks left (100 ms each), rounded up so 0 shows only at the end. */
export const secondsLeft = (ticksLeft: number, tickMs = 100) => Math.max(0, Math.ceil((ticksLeft * tickMs) / 1000));

/** A countdown in seconds as `m:ss`: `1:30`, `0:05`. */
export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds in words: `25 giây`. */
export const fmtSeconds = (seconds: number) => `${fmtNumber(seconds)} giây`;
