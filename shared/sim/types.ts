// Shared data types of the Phố Trà Sữa simulation (contract: plan appendix "giao diện của shared/sim").

/** Money in thousand VND, always a multiple of 0.5. */
export type K = number;
/** Simulation time; 1 tick = 100 ms, a rush runs ticks 0..900. */
export type Tick = number;
export type Ml = number;
export type Day = 1 | 2 | 3 | 4 | 5;
export type Phase = 'morning' | 'rush' | 'cards' | 'report' | 'end';
export type Size = 'S' | 'M' | 'L';
export type ToppingId = 'pearl' | 'jelly' | 'pudding';
export type TeaGrade = 'skimp' | 'standard' | 'premium';
export type UpgradeId = 'staff' | 'machine' | 'banner';
export type AiShopId = 'batu' | 'giare' | 'cochap' | 'luotsong' | 'sinhvien' | 'tapdoan';
export type ShopId = 'player' | AiShopId;
export type StoryCardId = 'cartel' | 'shockTopping' | 'blackMarket' | 'tax' | 'inspection' | 'reporter';
export type SideCardId = 'kol' | 'tab' | 'student' | 'complaint' | 'deliveryAd' | 'scholarship';
export type CardId = StoryCardId | SideCardId;
export type Choice = 'A' | 'B';
/** Theme of a day in the 5-day schedule (spec section 3). */
export type ThemeId = 'opening' | 'newShop' | 'priceCeiling' | 'tax' | 'rumor';

/** 1..3 distinct toppings, in canonical order pearl → jelly → pudding. */
export interface Order { size: Size; toppings: ToppingId[] }
export interface Stock { teaMl: Ml; toppings: Record<ToppingId, number> }

/** Fixed for the day; its index in RushState.customers equals its id. */
export interface Customer {
  id: number; budget: K; trust: number;
  /** 0..1000 */
  skeptic: number;
  order: Order; arriveTick: Tick; entry: 'left' | 'right' | 'bus';
  tie: number; look: number; scared: boolean; onlyShop: ShopId | null;
}
export type CustomerOutcome = 'served' | 'servedWrong' | 'noOffer' | 'gaveUp' | 'rushEnd' | 'scared';
export interface CustomerRt {
  status: 'pending' | 'queued' | 'done';
  /** The queue they stand in; once done, the shop that served them (null if they left without a cup). */
  shop: ShopId | null;
  /** Tick they joined their current queue; −1 before the first join. */
  joinedTick: Tick;
  /** Shops whose queue they joined, in order (at most 2). Replaced on change, never pushed (clones share it). */
  visited: readonly ShopId[]; outcome: CustomerOutcome | null;
  /** Budget ≥ the lowest price on the street at arrival, not scared (plan "khách về tay không"). */
  eligible: boolean;
  /** Counted in `missedNoStock` (R16): would have chosen the player's shop had it been in stock, or was sent away
   *  from it for stock. Counted once. */
  missedNoStock: boolean;
}

export type ShopStatus = 'open' | 'soldOut' | 'resting' | 'closed' | 'notYet' | 'closedEarly';
export interface RushShop {
  id: ShopId; slot: number; status: ShopStatus; grandOpening: boolean;
  /** 0 for a shop that does not sell today (resting, closed, not yet open). */
  price: K; openPrice: K;
  /** Price changes as [tick, new price], starting with [0, open price]; empty when not selling. Replaced, never pushed
   *  (clones and the day result share it). */
  trail: readonly (readonly [Tick, K])[];
  rep: number;
  /** Day 5 only (§4 Tin đồn): the temporary penalty customers subtract from `rep`; 0 on other days and for the
   *  shops that are certified. */
  rumorPenalty: number;
  /** Skimp days the day-5 inspection counts: the player's own, Chuỗi GiáRẻ 4, other AI shops 0. */
  skimpDays: number;
  /** Day 5: self-certified from the start, or cleared by the inspection at 450. */
  certified: boolean;
  /** Day 5: named by the inspection at 450 (2+ skimp days); it keeps its penalty. */
  named: boolean;
  queue: number[]; sold: number;
  /** AI shops: Σ price at the moment of each sale. The player's takings are in RushPlayer.tally.revenue. */
  revenue: K;
  ai: null | {
    cost: K;
    /** Cups stocked today (0 when not selling). */
    capacity: number; cupsLeft: number; ticksPerCup: Tick;
    /** Ticks of work on the cup in progress; it only advances while someone waits. */
    busy: Tick;
    frozen: boolean;
  };
}

export type CraftInput = { k: 'size'; size: Size } | { k: 'ice' } | { k: 'tea' } | { k: 'topping'; id: ToppingId };
export interface Cup { size: Size; iced: boolean; teaMl: Ml; toppings: ToppingId[] }
export interface CraftState {
  /** The cup on the counter, including the step now running (its stock is already taken); null while empty. */
  cup: Cup | null;
  /** The step running until `endsAt` (it completes in the production phase of that tick); null when idle. */
  anim: { step: CraftInput['k'] | 'deliver'; endsAt: Tick } | null;
  /** At most CONFIG.craft.bufferMax inputs queued behind the running animation; empty whenever `anim` is null. */
  buffer: CraftInput[];
}

export interface RushPlayer {
  morningPrice: K; priceChanged: boolean; gouged: boolean; dropPermille: number; brokeCartel: boolean;
  tea: TeaGrade; machine: boolean; stock: Stock; bought: Stock; craft: CraftState;
  staff: null | { progress: Tick };
  tally: {
    /** Paid by customers, before tax. */
    revenue: K; tax: K;
    /** Every cup sold, the staff's included. */
    cups: number; wrong: number; staffCups: number; walkouts: number;
    /** Customers who would have chosen the shop had it been in stock for their order, plus those sent away from it
     *  for stock; each once (R16). */
    missedNoStock: number;
    /** Cups the player threw in the bin (not the cup dropped on closing early or at 900). */
    trashed: number;
  };
}
export interface DayRules { day: Day; ceiling: K | null; taxPerCup: K; rumor: boolean; cartel: boolean; customerFactor: number }
export interface RushState {
  day: Day; tick: Tick; done: boolean; rules: DayRules;
  customers: Customer[]; rt: CustomerRt[];
  arrivalOrder: number[]; nextArrival: number; nextEnter: number;
  shops: RushShop[]; player: RushPlayer;
  street: { eligible: number; emptyHanded: number; taxFund: K };
}

export type Action =
  | { type: 'craft'; input: CraftInput } | { type: 'deliver'; customer: number }
  | { type: 'trash' } | { type: 'setPrice'; price: K } | { type: 'closeEarly' };

export type RejectReason = 'tooExpensive' | 'tooCrowded' | 'lowTrust' | 'outOfStock'
  | 'steepDiscount' | 'otherBetter' | 'closed' | 'visited' | 'rumor';
/** What ran out (R21): the tea, or a topping. An AI shop that is sold out has nothing left: `'tea'`. */
export type StockItem = 'tea' | ToppingId;
export interface ShopVerdict {
  shop: ShopId; score10: number | null; reason: RejectReason | 'chosen';
  /** Only with `outOfStock` (R21): what the shop lacks for this customer's order; for the player the first missing
   *  item, tea before toppings in canonical order; `'tea'` for a sold-out AI shop. */
  missing?: StockItem;
}
export type LeaveCause = 'patience' | 'priceUp' | 'steepDiscount' | 'stockOut' | 'shopClosed';
/** `closed`: the player closed early, every later action is refused. */
export type InputReject = 'order' | 'bufferFull' | 'noTea' | 'noTopping' | 'duplicate' | 'busy'
  | 'noCup' | 'notInFirstFour' | 'priceUsed' | 'priceRange' | 'ceiling' | 'closed';

/**
 * What the rush tells the street scene; the scene may rely on this contract without reading the state.
 * - Events come in the plan's tick order ("Thứ tự trong một nhịp"): player actions, timeline (start, AI checkpoints,
 *   day-5 inspection), customers walking in, arrivals, production, the player's stock re-check, patience, sold-out
 *   signs. `t` is the tick whose step emitted the event; the closing events at the end of the rush carry t = 900.
 * - Every `customerAbandon` is followed, in the same tick, by that customer's re-shop `customerConsider` or their
 *   `customerLeave`.
 * - A `shopPrice` comes before the re-score abandons it causes.
 * - On day 5 `policy inspection` comes before `policy rumorLifted`, both at tick 450.
 * - `rushEnd` is the last event of the rush.
 */
export type SimEvent = { t: Tick } & (
  | { type: 'rushStart'; day: Day; rules: DayRules }
  | { type: 'customerEnter'; customer: number; entry: Customer['entry'] }
  | { type: 'customerConsider'; customer: number; reshop: boolean; verdicts: ShopVerdict[]; chosen: ShopId | null }
  | { type: 'customerJoin'; customer: number; shop: ShopId; position: number }
  | { type: 'customerServed'; customer: number; shop: ShopId; by: 'player' | 'staff' | 'ai'; correct: boolean; paid: K; full: K }
  | { type: 'customerAbandon'; customer: number; shop: ShopId; cause: LeaveCause; repHit: boolean;
      /** Only with `stockOut` (R21), by the rule of `ShopVerdict.missing`. */
      missing?: StockItem }
  | { type: 'customerLeave'; customer: number; outcome: CustomerOutcome; emptyHanded: boolean }
  | { type: 'shopPrice'; shop: ShopId; from: K; to: K }
  | { type: 'shopStatus'; shop: ShopId; status: ShopStatus }
  | { type: 'policy'; kind: 'inspection'; certified: ShopId[]; named: ShopId[] }
  | { type: 'policy'; kind: 'rumorLifted' }
  | { type: 'craftStep'; step: CraftInput['k'] | 'deliver'; endsAt: Tick }
  | { type: 'cupTrashed' }
  | { type: 'inputRejected'; action: Action['type']; why: InputReject }
  | { type: 'rushEnd'; early: boolean });

export interface MorningPlan { price: K; tea: TeaGrade; teaMl: Ml; toppings: Record<ToppingId, number>; upgrade: UpgradeId | null }
export type PlanIssue = 'price' | 'ceiling' | 'teaStep' | 'toppingStep' | 'credit' | 'upgradeOwned' | 'negative';
export interface ShopDayResult {
  id: ShopId; status: ShopStatus; openPrice: K | null; closePrice: K | null;
  trail: readonly (readonly [Tick, K])[]; sold: number; capacity: number; soldOut: boolean; profit: K | null;
  /** Sum of the price at the moment of each sale (plan: AI revenue). */
  revenue: K;
}
export interface RushResult {
  player: RushPlayer['tally'] & {
    closePrice: K; used: Stock; left: Stock;
    gouged: boolean; brokeCartel: boolean;
  };
  shops: ShopDayResult[]; customers: number;
  eligible: number; emptyHanded: number; taxFund: K;
  /** Day 5: customers the rumor scared off; shops certified (from the start or at the inspection) and named at the
   *  end of the rush, in slot order. 0 and empty on other days. */
  scared: number; certified: ShopId[]; named: ShopId[];
}

export type ChoiceLabel = 'skimp' | 'cartelKept' | 'cartelBroke' | 'shockTopping' | 'blackMarket'
  | 'taxEvaded' | 'inspectPass' | 'inspectFail';
export interface DaySummary {
  day: Day; openPrice: K; closePrice: K; tea: TeaGrade; bought: Stock; used: Stock; wasteValue: K;
  cups: number; wrong: number; walkouts: number;
  revenue: K; cost: K; tax: K; fines: K; profit: K; cash: K; rep: number; score: K;
  upgrade: UpgradeId | null; cards: { id: CardId; choice: Choice }[]; labels: ChoiceLabel[]; lost: boolean;
}
/** A delayed card effect is named after its card (the cartel break after `cartel`); `when: 'morning'` marks it. */
export type RepReason = 'tea' | 'wrong' | 'walkout' | 'gouge' | 'clean' | 'banner' | CardId;
export interface RepItem { reason: RepReason; delta: number; count?: number; when: 'morning' | 'evening' }
/** The evening lesson card (§3, §8): one id per day, a variant by the player's choices, the day's real numbers. */
export type LessonId = 'freeMarket' | 'entryRefused' | 'cartelKept' | 'cartelBroke' | 'ceiling' | 'tax' | 'rumor';
export interface DayReport {
  summary: DaySummary;
  /** This morning's items (already applied at opening), then the evening's, in their fixed order. */
  repItems: RepItem[];
  /** Rep at the end of the previous evening; the starting rep on day 1. */
  repBefore: number;
  /** Every shop's day; `profit` filled in the evening: AI shops from their books, the player's day profit, null for
   *  shops not trading. */
  street: ShopDayResult[]; emptyHanded: number; eligible: number; taxFund: K;
  /** Money lines outside the day profit (§16 row 13): the upgrade bought this morning, the cash of this afternoon's
   *  card choices (a tax-evade refund included), the delayed card cash that landed this morning. */
  upgradeCost: K; cardCash: K; delayedCash: K;
  lesson: { id: LessonId; data: Record<string, number> };
}

export interface PendingEffect {
  day: Day; source: CardId | 'cartelBreak'; rep?: number; cash?: K;
  tempStaff?: true; adCustomers?: number;
}

/** One shop in the morning's table of yesterday's street (§5 Bản tin). */
export interface BriefShopRow {
  id: ShopId;
  /** `closed`: gone for good; `new`: on the street for the first time today; `rested`: sat yesterday out;
   *  `open`: sold yesterday (the player always). */
  status: 'open' | 'rested' | 'closed' | 'new' | 'notYet';
  /** Yesterday's closing price; null when it did not sell yesterday (resting, not open yet, closed before). */
  closePrice: K | null; sold: number; soldOut: boolean;
  /** AI shops: cups left at close (capacity − sold), 0 when it did not sell; null for the player, whose leftovers
   *  are in the hint line. */
  unsold: number | null;
  /** On the street for the first time today (Chuỗi Tập Đoàn on day 2). */
  opensToday: boolean;
  /** The evening it closed for good; `day − 1` means it closed last night. Null while trading. */
  closedOn: Day | null;
}
/** What the morning screen shows (§5), as data; the UI writes the sentences. */
export interface MorningBrief {
  day: Day; theme: ThemeId; rules: DayRules; busStop: boolean;
  /** Delayed card effects landing this morning; `openDay` applies them. `cash` already counts their cash (R28). */
  news: PendingEffect[];
  /** Yesterday's street in street order, the player included; empty on day 1. */
  street: BriefShopRow[];
  /** The hint line: yesterday's cups sold and stock used; null on day 1. */
  yesterday: null | { cups: number; used: Stock };
  /** "Sức pha hôm nay: khoảng N ly" for `run.plan`. */
  capacity: number;
  /** Bus-stop days: the street's customers without and with the stop (§4 Chính sách). */
  bus: null | { without: number; with: number };
  /** Cash at opening (R28). */
  cash: K;
  /** Rep after this morning's delayed rep, clamped: what customers see if no banner is bought. */
  rep: number;
  /** Today's price of a topping portion (the shock price on its days). */
  toppingCost: K;
}
export interface AiShopState {
  id: AiShopId; status: 'notYet' | 'active' | 'closed'; closedOn: Day | null;
  todayPrice: K | null; resting: boolean; probeDir: -1 | 1;
  history: { day: Day; closePrice: K | null; sold: number; profit: K; rested: boolean }[];
}
export interface RunFlags {
  cartel: 'none' | 'refused' | 'agreed'; cartelBroken: boolean; shockTopping: boolean;
  blackMarket: boolean; taxEvaded: boolean; inspection: 'none' | 'wait' | 'pass' | 'fail'; reporter: Choice | null;
}
export interface RunState {
  v: 1; seed: number; runId: string; day: Day; phase: Phase;
  cash: K; rep: number; upgrades: UpgradeId[]; skimpDays: number;
  flags: RunFlags; pending: PendingEffect[];
  sideDeck: SideCardId[]; sideDrawn: SideCardId[];
  shops: AiShopState[]; plan: MorningPlan; morningNews: RepItem[];
  today: null | {
    plan: MorningPlan; spent: K; tempStaff: boolean;
    /** The delayed effects `openDay` applied this morning (R29); their rep is also in `morningNews`. */
    applied: PendingEffect[];
  };
  rushResult: RushResult | null;
  cards: CardId[]; cardIndex: number; choices: { id: CardId; choice: Choice }[]; cardRep: RepItem[];
  reports: DayReport[]; outcome: null | 'finished' | 'lostTrust';
}
