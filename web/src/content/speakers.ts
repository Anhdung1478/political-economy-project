/** Edit names here before the presentation. */
export interface Speaker { name: string; role: string; color: string; soft: string; initials: string }

export const SPEAKERS: [Speaker, Speaker, Speaker] = [
  { name: 'Người 1', role: 'Bàn tay vô hình', color: 'var(--matcha)', soft: 'var(--matcha-soft)', initials: '1' },
  { name: 'Người 2', role: 'Bàn tay hữu hình', color: 'var(--caramel)', soft: 'var(--caramel-soft)', initials: '2' },
  { name: 'Người 3', role: 'Kết hợp hai bàn tay', color: 'var(--strawberry)', soft: 'var(--strawberry-soft)', initials: '3' },
];

/** Target length of each speaker's part, in seconds (3 × 200 s = 10 min). */
export const SECTION_SECONDS = 200;
export const TOTAL_SECONDS = SECTION_SECONDS * SPEAKERS.length;
