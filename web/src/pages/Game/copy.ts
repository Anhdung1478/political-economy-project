// Vietnamese words of the game screens that several screens share: shop names, the day's theme as a title, the
// toppings and tea grades, upgrades. Numbers always come from the run or the config, never written here.
import { CONFIG, type SimConfig } from '../../../../shared/sim/config';
import { fmtMoney, fmtNumber } from '../../game/format';
import type {
  DayRules, ShopId, TeaGrade, ThemeId, ToppingId, UpgradeId,
} from '../../../../shared/sim/types';

export const SHOP_NAMES: Record<ShopId, string> = {
  player: 'Quán bạn',
  batu: 'Quán Bà Tư',
  giare: 'Chuỗi GiáRẻ',
  cochap: 'Quán Ông Cố Chấp',
  luotsong: 'Anh Lướt Sóng',
  sinhvien: 'Quán Sinh Viên',
  tapdoan: 'Chuỗi Tập Đoàn',
};

export const TOPPING_NAMES: Record<ToppingId, string> = { pearl: 'Trân châu', jelly: 'Thạch', pudding: 'Pudding' };

export const TEA_NAMES: Record<TeaGrade, string> = { skimp: 'Ăn bớt', standard: 'Chuẩn', premium: 'Cao cấp' };
export const TEA_ICONS: Record<TeaGrade, string> = { skimp: '🥄', standard: '🍵', premium: '💎' };

export const UPGRADE_NAMES: Record<UpgradeId, string> = { staff: 'Nhân viên', machine: 'Máy pha', banner: 'Băng rôn' };
export const UPGRADE_ICONS: Record<UpgradeId, string> = { staff: '🙋', machine: '⚙️', banner: '🎌' };

/** What an upgrade does, in a short line (numbers from the config). */
export function upgradeLine(id: UpgradeId, cfg: SimConfig = CONFIG): string {
  switch (id) {
    case 'staff': return `Phụ pha song song, cứ ${cfg.craft.staffTicks / 10} giây một ly đúng món`;
    case 'machine': return 'Rót trà nhanh gấp đôi';
    case 'banner': return `+${cfg.upgrades.banner.rep} uy tín ngay khi treo`;
  }
}

export interface DayTitleText {
  /** "Ngày 3" */
  kicker: string;
  emoji: string;
  /** "Giá trần 20k" */
  title: string;
}

const THEME_EMOJI: Record<ThemeId, string> = {
  opening: '👻', newShop: '👻', priceCeiling: '✋', tax: '✋', rumor: '🤢',
};

/** The day's theme as a title, its numbers from the day's rules. */
export function themeTitle(theme: ThemeId, rules: DayRules): string {
  switch (theme) {
    case 'opening': return 'Khai trương';
    case 'newShop': return 'Phố đông lên';
    case 'priceCeiling': return rules.ceiling === null ? 'Giá trần' : `Giá trần ${rules.ceiling}k`;
    case 'tax': return `Thuế ${rules.taxPerCup}k/ly`;
    case 'rumor': return 'Tin đồn nước rửa chén';
  }
}

export function dayTitle(theme: ThemeId, rules: DayRules): DayTitleText {
  return { kicker: `Ngày ${rules.day}`, emoji: THEME_EMOJI[theme], title: themeTitle(theme, rules) };
}

/** "Mở cửa"-time feel per phase, for the HUD. */
export const PHASE_LABELS = {
  morning: '☀️ Sáng', rush: '🔥 Trưa', cards: '🃏 Chiều', report: '🌙 Tối', end: '🏁 Hết ván',
} as const;

/** Money for the narrow top bar: from 1.000k up, rounded to whole k ("1.327k", not "1.326,5k"). */
export const hudMoney = (k: number): string => (Math.abs(k) >= 1000 ? `${fmtNumber(Math.round(k), 0)}k` : fmtMoney(k));

/** What the rep number in the top bar means, shown on hover, focus or tap (numbers from the config). */
export function repTip(cfg: SimConfig = CONFIG): string {
  return `Uy tín (${cfg.run.minRep}–${cfg.run.maxRep}): khách tin quán bạn tới đâu. Uy tín càng cao, khách càng chọn quán bạn, `
    + 'kể cả khi giá nhỉnh hơn quán bên cạnh. Trà ăn bớt, giao sai món, để khách chờ bỏ về hay tăng giá chặt chém đều làm mất uy tín. '
    + `Cuối ván mỗi điểm uy tín đáng ${fmtMoney(cfg.run.brandPerRep)} tiền thương hiệu; về ${cfg.run.minRep} là quán phải đóng cửa.`;
}

/** What the cash number in the top bar means. */
export function cashTip(cfg: SimConfig = CONFIG): string {
  return `Tiền trong két. Nhập hàng được mua chịu tới ${fmtMoney(cfg.run.creditFloor)}; số âm nghĩa là đang nợ nhà cung cấp.`;
}
