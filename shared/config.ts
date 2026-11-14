export const GAME = {
  baseCost: 15,
  capacity: 10,
  customersPerPlayer: 15,
  wtpMin: 15,
  wtpMax: 60,
  priceMin: 10,
  priceMax: 50,
  defaultPrice: 25,
  pricingSeconds: 20,
  nicknameMax: 20,
  maxPlayers: 200,
  emojiPerSecond: 5,
} as const;

export const EMOJIS = ['😂', '🔥', '💸', '🥤', '😭', '🤡'] as const;
export type Emoji = (typeof EMOJIS)[number];

export type RoundId = 'free' | 'free2' | 'ceiling' | 'tax' | 'rumor' | 'free3';
export interface RoundRule {
  id: RoundId;
  emoji: string;
  hand: 'invisible' | 'visible' | 'chaos';
  title: string;
  description: string;
  lesson: string;
  maxPrice: number;
  cost: number;
  tax: number;
  customerMultiplier: number;
}

export const ROUNDS: readonly RoundRule[] = [
  {
    id: 'free', emoji: '👻', hand: 'invisible', title: 'Chợ tự do',
    description: 'Bàn tay vô hình lo hết. Muốn bán giá nào thì bán.',
    lesson: 'Không ai ra lệnh, nhưng cạnh tranh tự kéo giá về một mức mà người mua lẫn người bán đều chịu được.',
    maxPrice: 50, cost: 15, tax: 0, customerMultiplier: 1,
  },
  {
    id: 'free2', emoji: '👻', hand: 'invisible', title: 'Chợ tự do (lần 2)',
    description: 'Vẫn chợ tự do, nhưng giờ ai cũng đã thấy giá vòng trước. Chỉnh giá đi!',
    lesson: 'Nhìn giá của nhau rồi tự điều chỉnh — giá hội tụ dần về mức cân bằng mà không cần ai ra lệnh.',
    maxPrice: 50, cost: 15, tax: 0, customerMultiplier: 1,
  },
  {
    id: 'ceiling', emoji: '✋', hand: 'visible', title: 'Nhà nước áp giá trần 20k',
    description: 'Không quán nào được bán quá 20k/ly. Rẻ cho dân, nhưng…',
    lesson: 'Giá trần thấp hơn giá cân bằng → cầu vượt cung → khách xếp hàng mà không mua được.',
    maxPrice: 20, cost: 15, tax: 0, customerMultiplier: 1,
  },
  {
    id: 'tax', emoji: '💸', hand: 'visible', title: 'Thuế trân châu 5k/ly',
    description: 'Vốn mỗi ly tăng từ 15k lên 20k. Tiền thuế chảy vào ngân sách.',
    lesson: 'Thuế làm chi phí tăng, lãi giảm — đổi lại nhà nước có ngân sách làm đường, trường, trạm.',
    maxPrice: 50, cost: 20, tax: 5, customerMultiplier: 1,
  },
  {
    id: 'rumor', emoji: '🤢', hand: 'chaos', title: 'Tin đồn: trà sữa nấu từ nước rửa chén',
    description: 'Một nửa số khách sợ quá, bỏ về uống nước lọc.',
    lesson: 'Thông tin bất cân xứng làm thị trường "đơ" — cần nhà nước kiểm định và công bố thông tin.',
    maxPrice: 50, cost: 15, tax: 0, customerMultiplier: 0.5,
  },
  {
    id: 'free3', emoji: '👻', hand: 'invisible', title: 'Chợ tự do (vòng cuối)',
    description: 'Tin đồn đã được kiểm chứng là sai, khách quay lại đông đủ. Chợ tự do lần cuối!',
    lesson: 'Khi thông tin minh bạch trở lại, thị trường tự hồi phục — bàn tay vô hình làm tốt việc của nó khi luật chơi rõ ràng.',
    maxPrice: 50, cost: 15, tax: 0, customerMultiplier: 1,
  },
];
