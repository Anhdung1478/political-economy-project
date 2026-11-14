const TEMPLATES: ((n: string) => string)[] = [
  n => `Trà Sữa Tâm Linh của ${n}`,
  n => `${n} Tea — Uống Là Ghiền, Ghiền Là Nợ`,
  n => `Tiệm Trà Chanh Giải Nghiệp ${n}`,
  n => `${n} Milk Tea & Drama`,
  n => `Trân Châu Đường Đen Đủi của ${n}`,
  n => `${n} — Trà Sữa Không Đường Lui`,
  n => `Quán Nước Mía Đi Lạc của ${n}`,
  n => `${n} Coffee (nhưng bán trà sữa)`,
  n => `Trà Sữa Thất Tình ${n}`,
  n => `Hợp Tác Xã Trân Châu ${n}`,
];

export function makeShopName(nickname: string, random: () => number): string {
  return TEMPLATES[Math.floor(random() * TEMPLATES.length)](nickname);
}
