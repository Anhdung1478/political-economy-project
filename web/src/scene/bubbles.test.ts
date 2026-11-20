import { describe, expect, it } from 'vitest';
import type { BubbleRequest } from './director';
import {
  admit, AMBIENT_GAP_MIN, AMBIENT_LINES, AmbientVoice, byPriority, candidates, daySeed, lifeOf, LINES, lineIndex, MAX_BUBBLES, MIN_SHOW, placeBubbles, popOf, POP_OUT,
  rankOf, situationOf, tailTip, WAIT_TICKS, wordsFor, type AdmitContext, type Candidate, type Placing, type Shown, type Situation,
} from './bubbles';

const ctx = (o: Partial<AdmitContext> = {}): AdmitContext => ({
  now: 100, daySeed: daySeed(7, 3), canSpeak: () => true, priceOf: () => 22, ...o,
});
const cand = (customer: number, situation: Situation, player = false, t = 100): Candidate =>
  ({ customer, situation, player, shop: player ? 'player' : 'batu', t });
const req = (o: Partial<BubbleRequest>): BubbleRequest =>
  ({ customer: 1, t: 10, topic: 'tooExpensive', shop: 'batu', playerRelated: false, ...o });

describe('a bubble\'s minimum time', () => {
  it('is about a second, and nothing pushes a bubble out before it (same speaker, same situation)', () => {
    expect(MIN_SHOW).toBeGreaterThanOrEqual(10);
    let r = admit([], [cand(1, 'chosePlayer', true)], ctx());
    for (const dt of [1, MIN_SHOW - 1]) {
      r = admit(r.shown, [cand(1, 'wrongCup', true, 100 + dt)], ctx({ now: 100 + dt }), r.waiting);
      expect(r.shown.map(b => b.situation)).toEqual(['chosePlayer']);
      expect(r.out).toHaveLength(0);
    }
    r = admit(r.shown, [], ctx({ now: 100 + MIN_SHOW }), r.waiting);
    expect(r.shown.map(b => b.situation)).toEqual(['wrongCup']);
    // The same situation: a higher-ranked one waits out the minimum too.
    let q = admit([], [cand(1, 'tooCrowded')], ctx());
    q = admit(q.shown, [cand(2, 'tooCrowded', true, 101)], ctx({ now: 101 }), q.waiting);
    expect(q.shown.map(b => b.customer)).toEqual([1]);
  });

  it('is cut short only when the speaker leaves the view', () => {
    let r = admit([], [cand(1, 'chosePlayer', true)], ctx());
    r = admit(r.shown, [], ctx({ now: 102, canSpeak: () => false }));
    expect(r.out).toHaveLength(1);
    expect(r.out[0].until).toBe(102);
  });

  it('a new word does not start on a speaker who may not start (near the view\'s edge)', () => {
    const r = admit([], [cand(1, 'tooCrowded'), cand(2, 'patience')], ctx({ canStart: id => id === 2 }));
    expect(r.shown.map(b => b.customer)).toEqual([2]);
  });
});

describe('ambient chatter', () => {
  /** Runs the voice for `ticks` at 3 frames a tick over `visible` walkers, through admit as the speech layer does. */
  const run = (seed: number, ticks: number, visible = 3) => {
    const voice = new AmbientVoice(daySeed(seed, 1));
    let shown: Shown[] = [];
    let waiting: Candidate[] = [];
    const born: { t: number; text: string; customer: number }[] = [];
    for (let f = 0; f < ticks * 3; f++) {
      const now = f / 3;
      // Walkers come and go: a new one every 12 ticks, `visible` of them in view at a time.
      const first = Math.floor(now / 12);
      const walkers = Array.from({ length: visible }, (_, i) => first + i);
      const eligible = walkers.filter(id => !shown.some(b => b.customer === id && b.until > now));
      const k = voice.pick(now, eligible, visible, shown.filter(b => b.until > now).length);
      const r = admit(shown, k === null ? [] : [k], ctx({ now, daySeed: daySeed(seed, 1) }), waiting);
      for (const b of r.shown) if (!shown.includes(b)) born.push({ t: now, text: b.text, customer: b.customer });
      shown = r.shown;
      waiting = r.waiting;
      expect(shown.filter(b => b.until > now).length).toBeLessThanOrEqual(MAX_BUBBLES);
    }
    return born;
  };

  it('says only lines of the ambient pool, as plain chat', () => {
    const born = run(7, 600, 4);
    expect(born.length).toBeGreaterThan(5);
    for (const b of born) expect(AMBIENT_LINES).toContain(b.text);
    const r = admit([], [{ customer: 1, situation: 'chat', player: false, shop: null, t: 0 }], ctx());
    expect(r.shown[0].tone).toBe('plain');
    expect(r.shown[0].situation).toBe('chat');
  });

  it('is calm: about one new word every 3 to 5 seconds with a few walkers, never faster than the floor', () => {
    const born = run(7, 1200, 3);
    const rate = born.length / 120;
    expect(rate).toBeGreaterThan(1 / 6);
    expect(rate).toBeLessThan(1 / 2.5);
    for (let i = 1; i < born.length; i++) expect(born[i].t - born[i - 1].t).toBeGreaterThanOrEqual(AMBIENT_GAP_MIN - 0.5);
    expect(run(7, 1200, 1).length).toBeLessThan(born.length);
    expect(run(7, 1200, 6).length).toBeGreaterThanOrEqual(born.length);
    expect(run(7, 1200, 6).length / 120).toBeLessThanOrEqual(10 / AMBIENT_GAP_MIN);
  });

  it('is deterministic for a seed, and other seeds say other things; each walker speaks once', () => {
    expect(run(7, 600)).toEqual(run(7, 600));
    expect(run(8, 600).map(b => b.text)).not.toEqual(run(7, 600).map(b => b.text));
    const voice = new AmbientVoice(1);
    const got: number[] = [];
    for (let t = 0; t < 2000; t++) {
      const k = voice.pick(t, [1, 2], 2, 0);
      if (k !== null) got.push(k.customer);
    }
    expect(got.sort()).toEqual([1, 2]);
  });

  it('waits when the board is full or nobody can speak, and does not queue up a burst', () => {
    const voice = new AmbientVoice(1);
    for (let t = 0; t < 500; t++) expect(voice.pick(t, [1], 1, MAX_BUBBLES)).toBeNull();
    for (let t = 500; t < 1000; t++) expect(voice.pick(t, [], 0, 0)).toBeNull();
    expect(voice.pick(1000, [9], 1, 0)).not.toBeNull();
    expect(voice.pick(1001, [10], 1, 0)).toBeNull();
  });
});

describe('the ambient pool', () => {
  it('is flavour: no shop, price, queue or stock; all different and short', () => {
    expect(AMBIENT_LINES.length).toBeGreaterThanOrEqual(20);
    expect(AMBIENT_LINES.length).toBeLessThanOrEqual(30);
    expect(new Set(AMBIENT_LINES).size).toBe(AMBIENT_LINES.length);
    for (const l of AMBIENT_LINES) {
      expect(l, l).not.toMatch(/\d|đắt|rẻ|giá|tiền|hàng|đông|hết|bên kia|xếp/i);
      expect(l.length, l).toBeLessThanOrEqual(40);
    }
  });
});

describe('the lines', () => {
  it('has 3 or 4 lines for each of the table\'s situations, the spec\'s example among them', () => {
    for (const [s, lines] of Object.entries(LINES)) {
      expect(lines.length, s).toBeGreaterThanOrEqual(3);
      expect(lines.length, s).toBeLessThanOrEqual(4);
      expect(new Set(lines).size, s).toBe(lines.length);
    }
    expect(LINES.tooExpensive).toContain('Quán này đắt quá, đi quán khác thôi.');
    expect(LINES.tooCrowded).toContain('Đông quá, xếp hàng chắc lâu lắm, mình qua quán khác.');
    expect(LINES.lowTrust).toContain('Quán này nghe nói không ổn lắm, chọn quán khác vậy.');
    expect(LINES.otherCheaper).toContain('Bên kia rẻ hơn mà.');
    expect(LINES.chosePlayer).toContain('Quán này giá ổn nè.');
    expect(LINES.patience).toContain('Chờ lâu quá, thôi khỏi!');
    expect(LINES.wrongCup).toContain('Ủa, sai món rồi?');
    expect(LINES.priceUp).toContain('Ủa tăng giá hả? Thôi.');
    expect(LINES.steepDiscount).toContain('Giảm dữ vậy, có khi trà đểu.');
    expect(LINES.emptyHanded).toContain('Quán nào cũng hết sạch…');
    expect(LINES.rumor).toContain('Nghe đồn nấu bằng nước rửa chén đó.');
  });

  it('names what ran out, and has words when the sim did not say', () => {
    expect(wordsFor('outOfStock', 0, { missing: 'pearl' })).toBe('Hết trân châu rồi à…');
    expect(wordsFor('outOfStock', 2, { missing: 'jelly' })).toBe('Ơ, hết thạch sao?');
    expect(wordsFor('outOfStock', 0, { missing: 'tea' })).toBe('Hết trà rồi à…');
    expect(wordsFor('outOfStock', 0, {})).toBe('Hết hàng rồi à…');
  });

  it('fills in the price, and skips a line that needs one when there is none', () => {
    expect(wordsFor('tooExpensive', 1, { price: 28 })).toBe('28k một ly? Quá túi tiền rồi.');
    expect(wordsFor('tooExpensive', 1, { price: null })).toBe('Đắt thế, để dành tiền ăn trưa vậy.');
  });

  it('skips a line already on screen', () => {
    const first = wordsFor('patience', 0, {});
    expect(wordsFor('patience', 0, {}, t => t === first)).toBe(LINES.patience[1]);
  });

  it('a "too expensive" whose price alone was affordable is about trust and value, never "đắt"', () => {
    expect(situationOf(req({ priceOk: true }))).toBe('valueDoubt');
    expect(situationOf(req({ priceOk: false }))).toBe('tooExpensive');
    expect(situationOf(req({}))).toBe('tooExpensive');
    for (let i = 0; i < 4; i++) expect(wordsFor('valueDoubt', i, { price: 25 }).toLowerCase()).not.toMatch(/đắt/);
  });

  it('says "cheaper" only when the chosen shop was cheaper; otherwise neutral words', () => {
    expect(situationOf(req({ topic: 'otherBetter', cheaper: true }))).toBe('otherCheaper');
    expect(situationOf(req({ topic: 'otherBetter', cheaper: false }))).toBe('otherBetter');
    expect(situationOf(req({ topic: 'otherBetter' }))).toBe('otherBetter');
    for (const l of LINES.otherBetter) expect(l).not.toMatch(/rẻ|hời|ngon/);
    for (const l of LINES.otherCheaper) expect(l).toMatch(/rẻ|hời/);
  });

  it('picks a line per customer and situation from the day\'s seed: the same each time, varied across customers', () => {
    const s = daySeed(7, 3);
    expect(lineIndex(s, 12, 'patience', 4)).toBe(lineIndex(s, 12, 'patience', 4));
    const seen = new Set<number>();
    for (let c = 0; c < 60; c++) seen.add(lineIndex(s, c, 'patience', 4));
    expect(seen.size).toBe(4);
    // Another day or seed picks differently for some customers.
    let differ = 0;
    for (let c = 0; c < 40; c++) if (lineIndex(daySeed(7, 4), c, 'patience', 4) !== lineIndex(s, c, 'patience', 4)) differ++;
    expect(differ).toBeGreaterThan(10);
    expect(daySeed(7, 3)).not.toBe(daySeed(8, 3));
  });
});

describe('who speaks', () => {
  it('turns requests into candidates and adds a happy word for some correct cups at the player\'s counter', () => {
    const c = candidates([req({ customer: 3, topic: 'outOfStock', missing: 'pearl', playerRelated: true })], [], 0);
    expect(c).toEqual([{ customer: 3, situation: 'outOfStock', player: true, shop: 'batu', missing: 'pearl', t: 10 }]);
    const sales = Array.from({ length: 60 }, (_, i) => ({ shop: 'player' as const, customer: i, correct: true, t: 5 }));
    const happy = candidates([], sales, daySeed(7, 1));
    expect(happy.length).toBeGreaterThan(8);
    expect(happy.length).toBeLessThan(35);
    expect(happy.every(h => h.situation === 'served' && h.player)).toBe(true);
    expect(candidates([], [{ shop: 'batu', customer: 1, correct: true, t: 5 }], 0)).toEqual([]);
    expect(candidates([], [{ shop: 'player', customer: 1, correct: false, t: 5 }], 0)).toEqual([]);
  });

  it('orders the player\'s and the day\'s theme first, then the weightier situation, then the earlier', () => {
    const list = [cand(1, 'tooCrowded'), cand(2, 'chosePlayer', true), cand(3, 'wrongCup', true), cand(4, 'patience'),
      cand(5, 'emptyHanded')];
    expect([...list].sort(byPriority).map(c => c.customer)).toEqual([3, 5, 2, 4, 1]);
    expect(rankOf({ player: false, situation: 'rumor' })).toBeGreaterThan(rankOf({ player: true, situation: 'served' }));
  });

  it('shows at most three; a player-related word pushes out the oldest that is not; plain words do not', () => {
    let r = admit([], [cand(1, 'tooCrowded'), cand(2, 'lowTrust'), cand(3, 'otherBetter'), cand(4, 'patience')], ctx());
    expect(r.shown).toHaveLength(MAX_BUBBLES);
    expect(r.shown.map(b => b.customer)).not.toContain(3); // the lightest of four (another shop better) is left out
    r = admit(r.shown, [cand(5, 'tooExpensive')], ctx({ now: 101 }));
    expect(r.shown.map(b => b.customer)).not.toContain(5);
    const later = 100 + MIN_SHOW;
    r = admit(r.shown, [cand(6, 'patience', true, later)], ctx({ now: later }));
    expect(r.shown).toHaveLength(MAX_BUBBLES);
    expect(r.shown.map(b => b.customer)).toContain(6);
    expect(r.out).toHaveLength(1);
    expect(r.out[0].until).toBe(later);
  });

  it('shows one bubble per situation: a word of the same rank waits, a higher one takes its place', () => {
    let r = admit([], [cand(1, 'tooCrowded')], ctx());
    r = admit(r.shown, [cand(2, 'tooCrowded')], ctx({ now: 101 }), r.waiting);
    expect(r.shown.map(b => b.customer)).toEqual([1]);
    expect(r.waiting.map(k => k.customer)).toEqual([2]);
    r = admit(r.shown, [cand(3, 'tooCrowded', true)], ctx({ now: 100 + MIN_SHOW }), r.waiting);
    expect(r.shown.map(b => b.customer)).toEqual([3]);
    expect(r.out.map(b => b.customer)).toEqual([1]);
  });

  it('a full board of lighter player words takes a wrong cup (once they have shown a moment)', () => {
    let r = admit([], [cand(1, 'tooCrowded', true), cand(2, 'otherBetter', true), cand(3, 'chosePlayer', true)], ctx());
    expect(r.shown).toHaveLength(3);
    r = admit(r.shown, [cand(4, 'wrongCup', true)], ctx({ now: 102 }), r.waiting);
    expect(r.shown.map(b => b.customer)).not.toContain(4); // too soon: it waits
    expect(r.waiting.map(k => k.customer)).toEqual([4]);
    r = admit(r.shown, [], ctx({ now: 100 + MIN_SHOW }), r.waiting);
    expect(r.shown.map(b => b.customer)).toContain(4);
    expect(r.shown.map(b => b.customer)).not.toContain(3); // the lightest (chose the player) made room
  });

  it('a waiting word is dropped after a while', () => {
    let r = admit([], [cand(1, 'wrongCup', true), cand(2, 'patience', true), cand(3, 'priceUp', true)], ctx());
    r = admit(r.shown, [cand(4, 'tooCrowded', true)], ctx({ now: 101 }), r.waiting);
    expect(r.waiting).toHaveLength(1);
    r = admit(r.shown, [], ctx({ now: 101 + WAIT_TICKS + 1 }), r.waiting);
    expect(r.waiting).toHaveLength(0);
  });

  it('under a saturated stream every situation gets airtime by rank: wrong cups and the day\'s theme get through', () => {
    // 600 ticks, three player words a tick of the light kinds, and now and then a weighty one.
    const light: Situation[] = ['otherBetter', 'tooCrowded', 'chosePlayer', 'tooExpensive', 'lowTrust'];
    let shown: Shown[] = [];
    let waiting: Candidate[] = [];
    const heavy = { wrongCup: [0, 0], emptyHanded: [0, 0] };
    let id = 0;
    for (let t = 0; t < 600; t++) {
      const cs: Candidate[] = [];
      for (let k = 0; k < 3; k++) cs.push(cand(id++, light[(t * 3 + k) % light.length], true, t));
      if (t % 40 === 7) { cs.push(cand(id++, 'wrongCup', true, t)); heavy.wrongCup[0]++; }
      if (t % 40 === 23) { cs.push(cand(id++, 'emptyHanded', false, t)); heavy.emptyHanded[0]++; }
      const r = admit(shown, cs, ctx({ now: t }), waiting);
      shown = r.shown;
      waiting = r.waiting;
      expect(shown.filter(b => b.until > t).length).toBeLessThanOrEqual(MAX_BUBBLES);
      const live = shown.filter(b => b.until > t).map(b => b.situation);
      expect(new Set(live).size).toBe(live.length);
      for (const b of shown) if (b.born === t && (b.situation === 'wrongCup' || b.situation === 'emptyHanded')) heavy[b.situation][1]++;
    }
    expect(heavy.wrongCup[1]).toBe(heavy.wrongCup[0]);
    expect(heavy.emptyHanded[1]).toBe(heavy.emptyHanded[0]);
  });

  it('one bubble per customer: a weightier word replaces theirs', () => {
    let r = admit([], [cand(1, 'chosePlayer', true)], ctx());
    r = admit(r.shown, [cand(1, 'wrongCup', true)], ctx({ now: 100 + MIN_SHOW }));
    expect(r.shown).toHaveLength(1);
    expect(r.shown[0].situation).toBe('wrongCup');
    r = admit(r.shown, [cand(1, 'chosePlayer', true)], ctx({ now: 102 + MIN_SHOW }));
    expect(r.shown[0].situation).toBe('wrongCup');
  });

  it('drops bubbles whose time is up (after the pop-out) or whose speaker is gone', () => {
    let r = admit([], [cand(1, 'tooCrowded'), cand(2, 'patience')], ctx());
    const life = r.shown[0].until - 100;
    expect(life).toBeCloseTo(lifeOf(r.shown[0].text));
    r = admit(r.shown, [], ctx({ now: 100 + life + POP_OUT + 50, canSpeak: () => true }));
    expect(r.shown).toHaveLength(0);
    r = admit(admit([], [cand(1, 'tooCrowded')], ctx()).shown, [], ctx({ now: 105, canSpeak: () => false }));
    expect(r.shown).toHaveLength(0);
    expect(r.out).toHaveLength(1);
  });

  it('a speaker who cannot be seen says nothing', () => {
    expect(admit([], [cand(1, 'patience', true)], ctx({ canSpeak: () => false })).shown).toEqual([]);
  });

  it('lives long enough to read, longer for longer words', () => {
    expect(lifeOf('Ngon nha!')).toBeGreaterThanOrEqual(22);
    expect(lifeOf(LINES.tooCrowded[0])).toBeGreaterThan(lifeOf('Ngon nha!'));
    expect(lifeOf('x'.repeat(200))).toBe(40);
  });

  it('pops in with an overshoot and out with a shrink; reduced motion only fades', () => {
    const b: Pick<Shown, 'born' | 'until'> = { born: 0, until: 30 };
    expect(popOf(b, 0, false).scale).toBeCloseTo(0);
    let peak = 0;
    for (let t = 0; t <= 3; t += 0.1) peak = Math.max(peak, popOf(b, t, false).scale);
    expect(peak).toBeGreaterThan(1.02);
    expect(popOf(b, 10, false)).toEqual({ scale: 1, alpha: 1 });
    expect(popOf(b, 31.5, false).scale).toBeLessThan(1);
    expect(popOf(b, 30 + POP_OUT, false).alpha).toBe(0);
    expect(popOf(b, 0.5, true)).toEqual({ scale: 1, alpha: 1 });
    expect(popOf(b, 31.5, true).scale).toBe(1);
  });
});

describe('where they go', () => {
  const view = { x: 0, y: 0, w: 400, h: 800 };
  const item = (ax: number, ay: number, o: Partial<Placing> = {}): Placing =>
    ({ ax, ay, footY: ay + 40, w: 120, h: 30, prev: -1, ...o });
  const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }, w = 120, h = 30) =>
    a.x < b.x + w && b.x < a.x + w && a.y < b.y + h && b.y < a.y + h;

  it('puts a bubble above its speaker, centred, its tail rooted at the bottom over the head', () => {
    const [p] = placeBubbles([item(200, 300)], view, [], 8, 4);
    expect(p.opt).toBe(0);
    expect(p.x).toBe(140);
    expect(p.y + 30).toBe(292);
    expect(p.edge).toBe('bottom');
    expect(p.rootX).toBe(200);
  });

  it('keeps bubbles of speakers side by side from overlapping', () => {
    const ps = placeBubbles([item(200, 300), item(230, 305), item(170, 310)], view, [], 8, 4);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(overlaps(ps[i], ps[j])).toBe(false);
  });

  it('keeps clear of the van\'s banner and the ceiling sign', () => {
    const banner = { x: 120, y: 230, w: 200, h: 80 };
    const [p] = placeBubbles([item(200, 320)], view, [banner], 8, 4);
    const clear = p.x + 120 <= banner.x || p.x >= banner.x + banner.w || p.y + 30 <= banner.y || p.y >= banner.y + banner.h;
    expect(clear).toBe(true);
  });

  it('stays inside the view, the tail still toward the speaker', () => {
    const [p] = placeBubbles([item(10, 300)], view, [], 8, 4);
    expect(p.x).toBeGreaterThanOrEqual(4);
    expect(p.rootX).toBeGreaterThanOrEqual(p.x);
    const [q] = placeBubbles([item(200, 10)], view, [], 8, 4);
    expect(q.y).toBeGreaterThanOrEqual(4);
  });

  it('keeps last frame\'s spot when it is still clear (no hopping)', () => {
    const [p] = placeBubbles([item(200, 300, { prev: 2 })], view, [], 8, 4);
    expect(p.opt).toBe(2);
  });

  it('a far tail only points the way', () => {
    expect(tailTip({ x: 0, y: 0 }, { x: 0, y: 5 }, 10)).toEqual({ x: 0, y: 5 });
    const t = tailTip({ x: 0, y: 0 }, { x: 30, y: 40 }, 10);
    expect(t.x).toBeCloseTo(6);
    expect(t.y).toBeCloseTo(8);
  });
});
