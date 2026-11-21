// Every tunable number of the simulation. Money in K (thousand VND, multiples of 0.5);
// every duration or tick mark in whole ticks (1 tick = 100 ms). "§n" = spec section n,
// "plan" = the plan's "Những chỗ spec để ngỏ" rulings.
import type { AiShopId, Day, K, Size, StoryCardId, TeaGrade, ThemeId, Tick, ToppingId } from './types';

export interface DaySchedule {
  theme: ThemeId;
  /** Highest price of an M cup, or null when free (§4 Chính sách). */
  ceiling: K | null;
  taxPerCup: K;
  rumor: boolean;
  /** Cartel takes effect today if the player agreed on day 1 (§3, §7). */
  cartelPossible: boolean;
  /** Customers = base × factor (§4 Khách). */
  customerFactor: number;
  /** Bus stop open: part of the crowd arrives by bus (§4 Chính sách, plan). */
  busStop: boolean;
  /** Story cards of the afternoon, in order (§3, §7). */
  storyCards: StoryCardId[];
  /** A side card is drawn before the story cards (§3, §7, §16.14). */
  sideCard: boolean;
}

export interface AiShopSpec {
  firstDay: Day;
  /** Day-one price; null = computed by its pricing rule (Chuỗi Tập Đoàn). */
  openPrice: K | null;
  cost: K;
  rep: number;
  capacity: number;
  ticksPerCup: Tick;
  /** Reprices at the mid-rush checkpoints (§4: all but Ông Cố Chấp and Chuỗi GiáRẻ). */
  midRush: boolean;
  /** Certified before the rumor day, never penalised (§4 Tin đồn). */
  selfCertified: boolean;
  /** Skimp days counted for the rumor (§4: Chuỗi GiáRẻ counts as 4). */
  rumorSkimpDays: number;
}

const days: Record<Day, DaySchedule> = {
  1: { theme: 'opening', ceiling: null, taxPerCup: 0, rumor: false, cartelPossible: false, customerFactor: 1,
    busStop: false, storyCards: ['cartel'], sideCard: true },
  2: { theme: 'newShop', ceiling: null, taxPerCup: 0, rumor: false, cartelPossible: true, customerFactor: 1,
    busStop: false, storyCards: ['shockTopping'], sideCard: true },
  3: { theme: 'priceCeiling', ceiling: 20, taxPerCup: 0, rumor: false, cartelPossible: false, customerFactor: 1,
    busStop: false, storyCards: ['blackMarket'], sideCard: true },
  4: { theme: 'tax', ceiling: null, taxPerCup: 5, rumor: false, cartelPossible: false, customerFactor: 1,
    busStop: false, storyCards: ['tax', 'inspection'], sideCard: false },
  5: { theme: 'rumor', ceiling: null, taxPerCup: 0, rumor: true, cartelPossible: false, customerFactor: 1.25,
    busStop: true, storyCards: ['reporter'], sideCard: false },
};

const aiShops: Record<AiShopId, AiShopSpec> = {
  batu: { firstDay: 1, openPrice: 30, cost: 12, rep: 50, capacity: 12, ticksPerCup: 70,
    midRush: true, selfCertified: false, rumorSkimpDays: 0 },
  giare: { firstDay: 1, openPrice: 28, cost: 10, rep: 35, capacity: 12, ticksPerCup: 70,
    midRush: false, selfCertified: false, rumorSkimpDays: 4 },
  cochap: { firstDay: 1, openPrice: 28, cost: 14, rep: 55, capacity: 12, ticksPerCup: 70,
    midRush: false, selfCertified: true, rumorSkimpDays: 0 },
  luotsong: { firstDay: 1, openPrice: 32, cost: 13, rep: 50, capacity: 12, ticksPerCup: 70,
    midRush: true, selfCertified: false, rumorSkimpDays: 0 },
  sinhvien: { firstDay: 1, openPrice: 34, cost: 15, rep: 45, capacity: 12, ticksPerCup: 70,
    midRush: true, selfCertified: false, rumorSkimpDays: 0 },
  tapdoan: { firstDay: 2, openPrice: null, cost: 11, rep: 60, capacity: 18, ticksPerCup: 50,
    midRush: true, selfCertified: true, rumorSkimpDays: 0 },
};

const sizeTable = (s: number, m: number, l: number): Record<Size, number> => ({ S: s, M: m, L: l });

export const CONFIG = {
  /** §3 Một ván, §4 Giá và chi phí, §4 Uy tín. */
  run: {
    dayCount: 5,
    startCash: 300,
    /** Buying on credit allowed until cash reaches this (§4). */
    creditFloor: -150,
    startRep: 50,
    minRep: 0,
    maxRep: 100,
    /** Brand value per reputation point in the final score (§3). */
    brandPerRep: 12,
  },

  days,

  /** §5 Buổi sáng. */
  morning: {
    defaultPrice: 30,
    defaultTea: 'standard' as TeaGrade,
    /** Quick-fill levels in cups; "high" = today's capacity estimate. */
    quickFillCups: { low: 10, mid: 15 },
  },

  /** §6 and plan conventions. */
  rush: {
    ticks: 900,
    tickMs: 100,
    /** Customers arrive uniformly in [0, 750) (§4: first 75 s). */
    arrivalWindowTicks: 750,
    /** `customerEnter` fires this many ticks before arrival (plan tick order). */
    enterLeadTicks: 15,
    patienceTicks: 250,
    /** A customer will not join a queue already this long (§16.2). */
    maxQueue: 5,
    /** Shops visited at most (§4 Khách). */
    maxVisits: 2,
    /** Customers at the player's counter that can be served (§6 Quầy). */
    counterSlots: 4,
  },

  /** §4 Khách and plan "Sinh khách". */
  customers: {
    base: 130,
    budgetMin: 15,
    budgetMax: 60,
    /** Budgets are rounded to this step. */
    budgetStep: 0.5,
    trustMin: 0,
    trustMax: 50,
    skepticMax: 1000,
    /** pM = mediumShare; pL = largeBase + largeBudgetTilt·(budget − mid)/(budgetMax − budgetMin); pS = 1 − pM − pL. */
    size: { mediumShare: 0.5, largeBase: 0.25, largeBudgetTilt: 0.3 },
    /** Chance (percent) of 0, 1, 2, 3 toppings: the index is the topping count; a plain cup is a fine order. */
    toppingCountPercent: [25, 40, 25, 10],
    /** Draw weights, without repetition. */
    toppingWeights: { pearl: 2, jelly: 1, pudding: 1 } as Record<ToppingId, number>,
    /** Canonical order toppings are stored in. */
    toppingOrder: ['pearl', 'jelly', 'pudding'] as ToppingId[],
    /** `tie` is a whole number in 0..tieMax. */
    tieMax: 6,
    /** Share of the non-bus customers entering from the left end of the street. */
    entryLeftShare: 0.5,
    /** Share of customers entering from the bus stop on bus-stop days. */
    busShare: 0.2,
  },

  /** Score of a shop for a customer, in tenths of K (§4, plan):
   *  budget·10 − price·10 + (rep − repPivot)·repWeight10 − queueWeight10·queueAhead. */
  score: { repPivot: 50, repWeight10: 2, queueWeight10: 20 },

  /** §4 Giá và chi phí, §6 Quầy. */
  pricing: {
    /** Player's M price range and step. */
    min: 10,
    max: 50,
    step: 1,
    sizeSurcharge: sizeTable(-5, 0, 5),
    toppingSurcharge: 5,
    /** Wrong cup pays floor(min(order, cup) × wrongPayTenths / 10). */
    wrongPayTenths: 7,
  },

  /** §4 Giá và chi phí. */
  supplies: {
    sizeMl: sizeTable(250, 350, 500),
    teaStepMl: 250,
    teaGrades: {
      skimp: { costPer100Ml: 2, rep: -12 },
      standard: { costPer100Ml: 3, rep: 0 },
      premium: { costPer100Ml: 4, rep: 8 },
    } as Record<TeaGrade, { costPer100Ml: K; rep: number }>,
    toppingCost: 2,
    /** Sold-out sign below this much tea (§6). */
    soldOutBelowMl: 250,
  },

  /** §4 Nâng cấp. */
  upgrades: {
    staff: { cost: 150 },
    machine: { cost: 80 },
    banner: { cost: 150, rep: 10 },
  },

  /** §6 Pha một ly, §16.4, plan. */
  craft: {
    sizeTicks: 4,
    iceTicks: 8,
    teaTicks: sizeTable(12, 16, 20),
    /** Machine halves the pour. */
    machineTeaTicks: sizeTable(6, 8, 10),
    toppingTicks: 6,
    deliverTicks: 4,
    /** Inputs that can be queued behind a running animation. */
    bufferMax: 3,
    /** Staff serves one correct cup every this many ticks (§4: 9 s). */
    staffTicks: 90,
    /** Whole cup including handling, for the capacity estimate (§6: about 5 s). */
    cupTicksEstimate: 50,
  },

  /** §6 Đổi giá giữa trưa. */
  priceChange: {
    perRush: 1,
    /** Raise above this percent of the morning price is gouging. */
    gougePercent: 20,
    /** Drops beyond this (permille of the morning price) trigger the skeptic test. */
    discountPermille: 200,
    /** Leaves if skeptic·10 > 10000 − (dropPermille − discountPermille)·skepticSlopeTenths (slope 2.5). */
    skepticSlopeTenths: 25,
  },

  /** §4 Uy tín (evening items; banner and card items live with their source). */
  rep: {
    wrongCup: -2,
    walkout: -1,
    gouge: -5,
    clean: 3,
    /** Clean service needs at least this many cups sold (§16.11). */
    cleanMinCups: 1,
  },

  aiShops,

  /** §4 6 quán AI: pricing rules, clamp, rest, exit. */
  aiPricing: {
    maxPrice: 50,
    /** Lowest price = cost + tax + clampMargin. */
    clampMargin: 1,
    /** Rests when the highest allowed price < cost + restMargin. */
    restMargin: 8,
    /** Paid every day, resting or not. */
    rent: 60,
    /** Closes for good after this many losing days in a row. */
    exitLossDays: 2,
    /** Added to every AI price on tax days, after the rule. */
    taxPassThrough: 3,
    /** "Earned most" = (closePrice − earnedCost) × sold, for every shop. */
    earnedCost: 13,
    batuNudge: 1,
    giareUndercut: 1,
    cochapPrice: 28,
    sinhvienStep: 3,
    sinhvienFirstDir: -1 as -1 | 1,
    tapdoanUndercut: 6,
    /** §4 "Phản ứng khi có quán mới": the morning an AI shop opens, every other AI shop already open and not listed in
     *  `exempt` asks at most the entrant's opening price + `gap`, after its own rule and the tax pass-through, before
     *  the clamp. Not on a cartel day; the player is never forced. */
    entryReaction: { gap: 0, exempt: ['cochap'] as AiShopId[] },
  },

  /** §4 Chỉnh giá giữa trưa, §16.1. Sold thresholds are percent of capacity. */
  midRush: {
    step: 2,
    /** Raise when at least this many wait in the queue. */
    queueUp: 4,
    checkpoints: [
      { tick: 300, soldUpPercent: 33, soldDownPercent: 33 },
      { tick: 600, soldUpPercent: 66, soldDownPercent: 66 },
    ],
  },

  /** §4 Tin đồn, §16.8–9, plan. */
  rumor: {
    basePenalty: 10,
    penaltyPerSkimpDay: 5,
    inspectionTick: 450,
    /** At or above this many skimp days a shop fails inspection (also the self-paid check, §7). */
    failSkimpDays: 2,
    /** Chance an arrival before the inspection is scared off. */
    scaredShare: 0.5,
  },

  /** §7 Thẻ nhân vật: amounts and effects. Delays are in days after the day the card is played;
   *  delayed effects land in the morning, immediate rep in the evening. */
  cards: {
    cartel: { price: 36, refuseRep: 3, fine: 150, fineRep: -2, breakRep: -8, breakDelayDays: 1 },
    shockTopping: { toppingCost: 0.5, days: [3, 4] as Day[], repPerDay: -3 },
    blackMarket: { cash: 50, exposeRep: -4, exposeDelayDays: 1, refuseRep: 2 },
    tax: { evadeRep: -10 },
    inspection: { cost: 40, failRep: -15 },
    kol: { acceptCash: -30, acceptRep: 8, acceptDelayDays: 1, declineRep: -2 },
    tab: { acceptCash: -20, repayCash: 30, repayRep: 3, repayDelayDays: 2, declineRep: -2 },
    student: { acceptCash: -40, staffDelayDays: 1 },
    complaint: { acceptCash: -15, acceptRep: 3, declineRep: -3 },
    deliveryAd: { acceptCash: -40, customers: 6, delayDays: 1, budgetMin: 40, budgetMax: 60, trust: 0 },
    scholarship: { acceptCash: -20, acceptRep: 5 },
  },
};

export type SimConfig = typeof CONFIG;
