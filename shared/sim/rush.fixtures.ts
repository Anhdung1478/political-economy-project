// Builders and a stepping runner shared by the rush tests (not a test file itself).
import { CONFIG, type SimConfig } from './config';
import { createRushWith, step, type RushInput } from './rush';
import type {
  Action, AiShopId, AiShopState, CraftInput, Customer, Day, DayRules, K, Order, RushShop, RushState, SimEvent, Size,
  Stock, ToppingId,
} from './types';

export const rules = (day: Day, over: Partial<DayRules> = {}): DayRules => {
  const d = CONFIG.days[day];
  return { day, ceiling: d.ceiling, taxPerCup: d.taxPerCup, rumor: d.rumor, cartel: false,
    customerFactor: d.customerFactor, ...over };
};

export const stock = (teaMl: number, each = 0): Stock =>
  ({ teaMl, toppings: { pearl: each, jelly: each, pudding: each } });
export const PLENTY = stock(10000, 50);

export const shop = (id: AiShopId, todayPrice: K | null, over: Partial<AiShopState> = {}): AiShopState => ({
  id, status: 'active', closedOn: null, todayPrice, resting: false, probeDir: -1, history: [], ...over,
});

export type PlayerIn = RushInput['player'];
export const input = (over: Partial<RushInput> = {}, player: Partial<PlayerIn> = {}): RushInput => ({
  seed: 1, rules: rules(1), ai: [], adCustomers: 0,
  player: { price: 30, tea: 'standard', stock: PLENTY, rep: 50, machine: false, staff: false, skimpDays: 0,
    selfCertified: false, ...player },
  ...over,
});

export const order = (size: Size, ...toppings: ToppingId[]): Order => ({ size, toppings, noIce: false });
/** The same order "không đá". */
export const dryOrder = (size: Size, ...toppings: ToppingId[]): Order => ({ size, toppings, noIce: true });

export const cust = (id: number, over: Partial<Customer> = {}): Customer => ({
  id, budget: 40, trust: 0, skeptic: 0, order: order('M', 'pearl'), arriveTick: 0, entry: 'left',
  tie: 0, look: 0, scared: false, onlyShop: null, ...over,
});

/** A hand-built street: these AI shops, these customers, the player's shop as given. */
export const street = (ai: AiShopState[], customers: Customer[], player: Partial<PlayerIn> = {},
  over: Partial<RushInput> = {}, cfg: SimConfig = CONFIG) => createRushWith(input({ ai, ...over }, player), customers, cfg).state;

export const deepFreeze = <T>(x: T): T => {
  if (x !== null && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
};

/** Actions by tick, or a policy that looks at the state about to be stepped. */
export type Script = Record<number, Action[]> | ((s: RushState) => Action[]);

/**
 * Steps one tick at a time until the clock reaches `until` or the rush ends, feeding the script's actions and
 * collecting every event. Every state is deep-frozen before it is stepped, so each scenario also checks that
 * `step` leaves its input alone. `states[t]` is the state after the step of tick t.
 */
export const runTo = (state: RushState, until = Infinity, script: Script = {}, cfg: SimConfig = CONFIG) => {
  const events: SimEvent[] = [];
  const states: RushState[] = [];
  let s = state;
  while (!s.done && s.tick < until) {
    const actions = typeof script === 'function' ? script(s) : script[s.tick] ?? [];
    const r = step(deepFreeze(s), actions, cfg);
    states[s.tick] = r.state;
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events, states };
};

export const craft = (i: CraftInput): Action => ({ type: 'craft', input: i });
export const size = (sz: Size): Action => craft({ k: 'size', size: sz });
export const ICE = craft({ k: 'ice' });
export const TEA = craft({ k: 'tea' });
export const top = (id: ToppingId): Action => craft({ k: 'topping', id });
export const deliver = (customer: number): Action => ({ type: 'deliver', customer });
export const TRASH: Action = { type: 'trash' };
export const CLOSE: Action = { type: 'closeEarly' };
/** Every input of an order, in step order. */
export const make = (o: Order): Action[] => [size(o.size), ...(o.noIce ? [] : [ICE]), TEA, ...o.toppings.map(top)];

export const about = (events: SimEvent[], id: number) => events.filter(e => 'customer' in e && e.customer === id);
export const at = (events: SimEvent[], t: number) => events.filter(e => e.t === t);
export const ofType = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);

export const playerShop = (s: RushState): RushShop => {
  const p = s.shops.find(x => x.id === 'player');
  if (!p) throw new Error('no player shop');
  return p;
};

type AiSpec = SimConfig['aiShops'][AiShopId];
/** A config where some AI shops have another capacity or pace. */
export const tuned = (over: Partial<Record<AiShopId, Partial<AiSpec>>>): SimConfig => {
  const aiShops = { ...CONFIG.aiShops };
  for (const [id, o] of Object.entries(over) as [AiShopId, Partial<AiSpec>][]) aiShops[id] = { ...aiShops[id], ...o };
  return { ...CONFIG, aiShops };
};
