// The street's furniture and the day's props (spec §9 "Không khí phố", "Đạo cụ theo ngày"), each depth-sorted with
// the customers:
//
// - every day: concrete utility poles in the gaps of the top row with their tangle of wires and a street lamp; trees at
//   the street's ends (landscape) swaying; a motorbike now and then (one carries boxes, one a potted plant, one a
//   passenger) leaving a puff of exhaust; the cat strolling along the rooftops, sitting, licking a paw;
// - day 3: the ward's loudspeaker on a pole sending out its rings, and a speed-limit style sign "GIÁ TRẦN 20K" (the
//   ceiling read from the day's rules);
// - day 4: the tax officer in his olive uniform going from shop to shop with his clipboard; the bus-stop building site
//   (barriers, a sand pile, a turning mixer, a worker with a hammer, "ĐANG THI CÔNG TRẠM XE BUÝT");
// - day 5: the new shelter; the bus pulling in, opening its doors as its riders step off (the director's bus plan),
//   pulling away; at the inspection the ward's loudspeaker van crawling through with its banner.
//
// Reduced motion: no motorbikes, no cat, no swaying, no rings; the bus and the van appear parked while they matter.
import { CONFIG } from '../../../../shared/sim/config';
import type { StreetLayout } from '../layout';
import { particlesOf } from '../particlesLayer';
import { clipPose, newSkeleton, pose, solve, type ClipInput } from '../rig';
import type { Palette, Prop, RenderContext } from '../Scene';
import {
  busAt, busX, catAt, hash01, motoAt, newBusState, newCat, newRider, newWalker, officerAt, vanProgress, type Stop,
} from '../schedule';
import { blit, SpriteCache } from '../sprites';
import { lerp } from '../tween';
import { buildTraits, drawCharacterAt, shade, type FigureFx, type Traits } from './characters';
import { box, disc, DISPLAY, fe, line, oval, poly, rr, shadow, text, type Ctx } from './kit';
import { crown, poleXs } from './street';

const sprites = new SpriteCache();

/** Motorbike streams: period (ms) and speed (heights a second). */
const MOTO_STREAMS: readonly [number, number][] = [[9000, 6.5], [13700, 5.2]];

/** Street trees on the sidewalks (landscape: at the street's ends). x, base y, crown radius (in heights). */
function sideTrees(L: StreetLayout): readonly (readonly [number, number, number])[] {
  if (L.kind !== 'landscape') return [];
  return [[12, L.sidewalkTop.y1 - 8, 0.68], [788, L.sidewalkTop.y1 - 8, 0.68], [34, L.sidewalkBottom.y1 - 6, 0.8]];
}

interface Live {
  bus: ReturnType<typeof newBusState>;
  officer: ReturnType<typeof newWalker>;
  riders: ReturnType<typeof newRider>[];
  cat: ReturnType<typeof newCat>;
  puffAt: number;
}

function liveOf(rc: RenderContext): Live {
  let l = rc.store.get('props.live') as Live | undefined;
  if (l === undefined) {
    l = { bus: newBusState(), officer: newWalker(), riders: MOTO_STREAMS.map(newRider), cat: newCat(), puffAt: 0 };
    rc.store.set('props.live', l);
  }
  return l;
}

const art = (artKind: Extract<Prop, { kind: 'art' }>['art'], x: number, y: number, i = 0): Prop =>
  ({ kind: 'art', art: artKind, x, y, i });

export function props(rc: RenderContext): readonly Prop[] {
  const d = rc.director;
  const L = rc.layout;
  const u = L.actorH;
  const out: Prop[] = d.overflowMarkers().map(m => ({ kind: 'overflow', ...m }));
  const live = liveOf(rc);
  const day = d.day;
  out.push(art('poles', 0, L.sidewalkTop.y1 - 2));
  sideTrees(L).forEach(([x, y], i) => out.push(art('tree', x, y, i)));
  if (CONFIG.days[day].busStop) out.push(art('shelter', L.busShelter.x, L.busShelter.y));
  if ((d.rules?.taxPerCup ?? CONFIG.days[day].taxPerCup) > 0) {
    out.push(art('site', L.busShelter.x, siteAt(L).y + u * 0.4));
    if (officerAt(officerStops(rc), { x: rc.view.x - u, y: L.lanes[0] }, { x: rc.view.x - u, y: L.lanes[1] }, L.walk,
      rc.now, live.officer)) out.push(art('officer', live.officer.x, live.officer.y));
  }
  if (busAt(d.busVisits, rc.now, live.bus)) out.push(art('bus', 0, L.lanes[1] - u * 0.06));
  if (d.rules?.rumor ?? CONFIG.days[day].rumor) {
    const k = vanProgress(CONFIG.rumor.inspectionTick, rc.now);
    if (k >= 0) out.push(art('van', 0, L.road.y0 + (L.road.y1 - L.road.y0) * 0.5));
  }
  if (!rc.reducedMotion) {
    const v = rc.view;
    MOTO_STREAMS.forEach(([period, speed], i) => {
      const r = live.riders[i];
      if (motoAt(rc.wall, i, v.x, v.x + v.w, speed * u, period, r)) {
        out.push(art('moto', r.x, L.road.y0 + (L.road.y1 - L.road.y0) * (r.half === 0 ? 0.4 : 0.62), i));
      }
    });
    const top = L.shops.filter(s => s.row === 'top');
    const x0 = top[0].rect.x + u * 0.3;
    const last = top[top.length - 1].rect;
    if (catAt(rc.wall, x0, last.x + last.w - u * 0.3, 41000, live.cat)) out.push(art('cat', live.cat.x, top[0].depth + 0.5));
  }
  return out;
}

/** The officer's stops: each shop that is selling, its board's side of the road; top row left to right, then back. */
function officerStops(rc: RenderContext): Stop[] {
  const L = rc.layout;
  const memo = rc.store.get('props.stops') as { L: StreetLayout; key: string; stops: Stop[] } | undefined;
  const shops = rc.director.shops;
  let key = '';
  for (const s of shops) key += s.status === 'open' || s.status === 'soldOut' ? '1' : '0';
  if (memo !== undefined && memo.L === L && memo.key === key) return memo.stops;
  const stops: Stop[] = [];
  const open = (id: string) => key[shops.findIndex(s => s.id === id)] === '1';
  for (const s of L.shops.filter(x => x.row === 'top')) if (open(s.id)) stops.push({ x: s.board.x - L.actorH * 0.4, y: L.lanes[0] });
  for (const s of L.shops.filter(x => x.row === 'bottom').reverse()) {
    if (open(s.id)) stops.push({ x: s.rect.x + s.rect.w * 0.55, y: L.lanes[1] });
  }
  rc.store.set('props.stops', { L, key, stops });
  return stops;
}

export function drawProp(rc: RenderContext, prop: Prop): void {
  const { ctx, layout: L, palette: p } = rc;
  const u = L.actorH;
  if (prop.kind === 'overflow') {
    pill(ctx, `+${prop.n}`, prop.x, prop.y - u * 0.45, u * 0.34, p.boba, p.cream);
    return;
  }
  const live = liveOf(rc);
  switch (prop.art) {
    case 'poles': {
      const day = rc.director.day;
      const ceiling = rc.director.rules?.ceiling ?? CONFIG.days[day].ceiling;
      const sig = (ceiling ?? 0) * 2 + (ceiling !== null ? 1 : 0);
      const v = rc.view;
      const rect = { x: v.x, y: v.y, w: v.w, h: L.sidewalkTop.y1 - v.y + 2 };
      const s = sprites.get(L, 0, rect, rc.grid, sig, c => paintPoles(c, L, ceiling));
      blit(ctx, s, rc.grid);
      if (ceiling !== null && !rc.reducedMotion) speakerRings(ctx, L, rc.now, rc.wall);
      return;
    }
    case 'tree': {
      const [x, y, r] = sideTrees(L)[prop.i];
      oval(ctx, x, y, u * 0.42, u * 0.11, 'rgba(90, 62, 40, 0.35)');
      ctx.fillStyle = '#8a5a36';
      ctx.fillRect(x - u * 0.07, y - u * 1.5, u * 0.14, u * 1.5);
      const sway = rc.reducedMotion ? 0 : Math.sin(rc.wall / 1100 + prop.i * 2) * 0.06;
      crown(ctx, x, y - u * 1.85, u * r, sway, prop.i * 17 + 5);
      return;
    }
    case 'shelter': {
      const rect = { x: prop.x - u * 1.6, y: prop.y - u * 2.2, w: u * 2.2, h: u * 2.4 };
      const s = sprites.get(L, 1, rect, rc.grid, 1, c => paintShelter(c, L, p));
      blit(ctx, s, rc.grid);
      return;
    }
    case 'site':
      drawSite(rc);
      return;
    case 'bus':
      drawBus(rc, live.bus);
      return;
    case 'van':
      drawVan(rc);
      return;
    case 'moto':
      drawMoto(rc, live.riders[prop.i], prop.y);
      return;
    case 'cat':
      drawCat(ctx, live.cat, prop.x, L.shops[0].rect.y + 1, u, rc.reducedMotion);
      return;
    case 'officer':
      drawOfficer(rc, live.officer);
      return;
  }
}

function pill(ctx: Ctx, s: string, x: number, y: number, size: number, bg: string, fg: string): void {
  ctx.font = `700 ${size}px "Be Vietnam Pro", system-ui, sans-serif`;
  const w = ctx.measureText(s).width + size * 0.9;
  const h = size * 1.45;
  rr(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  text(ctx, s, x, y + size * 0.05, size, fg, { weight: 700 });
}

// ── Poles, wires, the loudspeaker and the ceiling sign ─────────────────────────────────────────────────────────────

function poleTop(L: StreetLayout): number {
  return L.kind === 'portrait' ? -24 : -10;
}

function paintPoles(c: Ctx, L: StreetLayout, ceiling: number | null): void {
  const u = L.actorH;
  const xs = poleXs(L);
  const base = L.sidewalkTop.y1 - u * 0.12;
  const top = poleTop(L);
  // Wires first (behind the poles): a few sagging lines between neighbours, past both ends, and the black tangles.
  const ends = [xs[0] - (xs[1] - xs[0]), ...xs, xs[xs.length - 1] + (xs[1] - xs[0])];
  c.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    c.strokeStyle = k === 3 ? 'rgba(42, 29, 21, 0.75)' : 'rgba(42, 29, 21, 0.55)';
    c.lineWidth = u * (k === 3 ? 0.04 : 0.022);
    c.beginPath();
    for (let i = 0; i + 1 < ends.length; i++) {
      const a = ends[i];
      const b = ends[i + 1];
      const flat = L.kind === 'landscape';
      const y = top + u * ((flat ? 0.28 : 0.35) + k * (flat ? 0.09 : 0.12));
      c.moveTo(a, y);
      c.quadraticCurveTo((a + b) / 2, y + u * (flat ? 0.22 + k * 0.04 : 0.35 + k * 0.08), b, y);
    }
    c.stroke();
  }
  for (const x of xs) {
    // The pole, tapering, with a cross-arm, insulators, a lamp and a coil of cable.
    poly(c, [x - u * 0.09, base, x + u * 0.09, base, x + u * 0.05, top, x - u * 0.05, top]);
    fe(c, '#c9c3bb', u * 0.025, '#8f877c');
    c.fillStyle = 'rgba(255, 255, 255, 0.35)';
    c.fillRect(x - u * 0.05, top + u * 0.2, u * 0.03, base - top - u * 0.3);
    box(c, x - u * 0.35, top + u * 0.28, u * 0.7, u * 0.07, u * 0.02, '#8f877c', 0);
    for (const dx of [-0.3, 0.3]) disc(c, x + dx * u, top + u * 0.26, u * 0.04, '#e6dccb', u * 0.015, '#8f877c');
    // The tangle.
    c.strokeStyle = '#2a1d15';
    c.lineWidth = u * 0.025;
    c.beginPath();
    for (let i = 0; i < 4; i++) {
      c.ellipse(x + u * 0.02, top + u * (0.85 + i * 0.05), u * (0.16 + i * 0.03), u * 0.07, 0.2 * i, 0, Math.PI * 2);
    }
    c.stroke();
    // A street lamp on an arm toward the road.
    line(c, x, top + u * 1.2, x + u * 0.42, top + u * 1.05, '#8f877c', u * 0.04);
    box(c, x + u * 0.3, top + u * 1.02, u * 0.26, u * 0.1, u * 0.04, '#6e665c', 0);
    oval(c, x + u * 0.43, top + u * 1.13, u * 0.1, u * 0.04, '#fff3c4');
    // Its foot and a meter box.
    box(c, x - u * 0.13, base - u * 0.15, u * 0.26, u * 0.18, u * 0.03, '#b9aea2', u * 0.02);
  }
  if (ceiling !== null) {
    // Day 3: the ward's loudspeaker high on the first pole, and the ceiling sign on the second.
    const sx = xs[0];
    const sy = top + u * 0.62;
    horn(c, sx, sy, u, -1);
    horn(c, sx, sy, u, 1);
    const cx = xs[xs.length - 1];
    const cy = L.kind === 'portrait' ? L.shops[0].rect.y + u * 0.95 : L.shops[0].rect.y + u * 1.05;
    const r = u * 0.4;
    disc(c, cx, cy, r, '#fffcf7', u * 0.09, '#d6333f');
    text(c, `${ceiling}K`, cx, cy + u * 0.02, u * 0.3, '#2a1d15', { font: DISPLAY, maxW: r * 1.5 });
    box(c, cx - u * 0.42, cy + r + u * 0.05, u * 0.84, u * 0.26, u * 0.04, '#fffcf7', u * 0.03, '#2a1d15');
    text(c, 'GIÁ TRẦN', cx, cy + r + u * 0.18, u * 0.15, '#2a1d15', { maxW: u * 0.76 });
  }
}

function horn(c: Ctx, x: number, y: number, u: number, side: -1 | 1): void {
  poly(c, [x + side * u * 0.06, y - u * 0.05, x + side * u * 0.42, y - u * 0.2, x + side * u * 0.42, y + u * 0.2,
    x + side * u * 0.06, y + u * 0.05]);
  fe(c, '#e9e4dc', u * 0.025, '#6e665c');
  oval(c, x + side * u * 0.42, y, u * 0.05, u * 0.2, '#6e665c');
}

/** Rings from the loudspeaker while it speaks: as the rush opens, then a while every 20 s. */
function speakerRings(ctx: Ctx, L: StreetLayout, now: number, wall: number): void {
  const t = now % 200;
  if (t > 45) return;
  const u = L.actorH;
  const x = poleXs(L)[0];
  const y = poleTop(L) + u * 0.62;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const k = ((wall / 900 + i / 3) % 1);
    ctx.strokeStyle = `rgba(222, 79, 90, ${0.8 * (1 - k)})`;
    ctx.lineWidth = u * 0.05;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      const cx = x + side * u * 0.45;
      const r = u * (0.15 + k * 0.6);
      ctx.arc(cx, y, r, side > 0 ? -0.7 : Math.PI - 0.7, side > 0 ? 0.7 : Math.PI + 0.7);
      ctx.stroke();
    }
  }
}

// ── The bus shelter and the building site ──────────────────────────────────────────────────────────────────────────

function paintShelter(c: Ctx, L: StreetLayout, p: Palette): void {
  const u = L.actorH;
  const { x, y } = L.busShelter;
  const w = u * 1.25;
  const x0 = x - w * 0.62;
  shadow(c, x, y + u * 0.05, w * 0.6, u * 0.12);
  // Back panel (an advert), posts, the bench, the roof.
  box(c, x0 + u * 0.08, y - u * 1.3, w - u * 0.16, u * 0.95, u * 0.04, 'rgba(200, 228, 240, 0.7)', u * 0.025, '#7d9bb0');
  box(c, x0 + u * 0.2, y - u * 1.18, w * 0.5, u * 0.7, u * 0.03, p.strawberrySoft, 0);
  text(c, 'TRÀ', x0 + u * 0.2 + w * 0.25, y - u * 0.98, u * 0.14, p.strawberryDeep);
  text(c, 'SỮA', x0 + u * 0.2 + w * 0.25, y - u * 0.78, u * 0.14, p.strawberryDeep);
  line(c, x0 + u * 0.05, y, x0 + u * 0.05, y - u * 1.45, '#5c7385', u * 0.06);
  line(c, x0 + w - u * 0.05, y, x0 + w - u * 0.05, y - u * 1.45, '#5c7385', u * 0.06);
  box(c, x0 + u * 0.1, y - u * 0.42, w - u * 0.2, u * 0.08, u * 0.03, '#8a5a36', u * 0.02);
  poly(c, [x0 - u * 0.12, y - u * 1.42, x0 + w + u * 0.12, y - u * 1.42, x0 + w + u * 0.02, y - u * 1.62, x0 - u * 0.02,
    y - u * 1.62]);
  fe(c, '#5b8f3e', u * 0.03);
  // The stop's sign on its own pole, toward the road.
  const sx = x0 - u * 0.05;
  line(c, sx, y - u * 0.05, sx, y - u * 1.9, '#5c7385', u * 0.05);
  disc(c, sx, y - u * 2.0, u * 0.24, '#2f6fb3', u * 0.03, '#1d4d80');
  box(c, sx - u * 0.13, y - u * 2.1, u * 0.26, u * 0.15, u * 0.03, '#fffcf7', 0);
  disc(c, sx - u * 0.07, y - u * 1.93, u * 0.03, '#fffcf7', 0);
  disc(c, sx + u * 0.07, y - u * 1.93, u * 0.03, '#fffcf7', 0);
}

/** The building site's anchor and scale: tighter in portrait, where the street's right end is narrow. */
function siteAt(L: StreetLayout): { x: number; y: number; k: number } {
  const u = L.actorH;
  return L.kind === 'portrait'
    ? { x: L.busShelter.x + u * 0.1, y: L.busShelter.y + u * 0.15, k: 0.85 }
    : { x: L.busShelter.x, y: L.busShelter.y + u * 0.2, k: 1 };
}

function drawSite(rc: RenderContext): void {
  const { ctx, layout: L } = rc;
  const u = L.actorH;
  const { x, y, k } = siteAt(L);
  const rect = { x: x - u * 1.3 * k, y: y - u * 1.75 * k, w: u * 2.0 * k, h: u * 2.1 * k };
  const s = sprites.get(L, 2, rect, rc.grid, 1, c => {
    c.translate(x, y);
    c.scale(k, k);
    paintSite(c, u);
  });
  blit(ctx, s, rc.grid);
  // The mixer turning and the worker's hammer.
  const sec = rc.wall / 1000;
  const calm = rc.reducedMotion;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.save();
  ctx.translate(-u * 0.78, -u * 0.55);
  ctx.rotate(-0.35);
  ctx.beginPath();
  ctx.ellipse(0, 0, u * 0.28, u * 0.2, 0, 0, Math.PI * 2);
  fe(ctx, '#f08a3a', u * 0.03);
  ctx.strokeStyle = '#b8601f';
  ctx.lineWidth = u * 0.04;
  const turn = calm ? 0 : sec * 3;
  for (let i = 0; i < 3; i++) {
    const a = turn + (i * Math.PI * 2) / 3;
    const q = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(q * u * 0.23, -u * 0.17);
    ctx.lineTo(q * u * 0.18, u * 0.17);
    ctx.stroke();
  }
  ctx.restore();
  const tr = workerTraits();
  const m = officerMemo;
  clipPose(m.pose, 'idle', inputFor(m.input, sec, calm));
  const hit = calm ? 0.5 : (Math.sin(sec * 7) + 1) / 2;
  m.pose.a0 = 1.4 + hit * 1.2;
  m.pose.e0 = 0.9;
  m.pose.lean = 0.25;
  m.pose.nod = 0.25;
  const wx = -u * 0.05;
  const wy = u * 0.05;
  const sk = solve(m.pose, tr.dims, 'side', m.sk);
  m.fx.mood = 'focus';
  m.fx.phone = false;
  drawCharacterAt(ctx, tr, wx, wy, u * 0.95, -1, 'side', m.pose, sk, m.fx, null);
  const hx = wx - sk.hand0.x * u * 0.95;
  const hy = wy + sk.hand0.y * u * 0.95;
  line(ctx, hx, hy, hx - u * 0.12, hy - u * 0.14, '#8a5a36', u * 0.04);
  box(ctx, hx - u * 0.2, hy - u * 0.22, u * 0.16, u * 0.08, u * 0.02, '#6e665c', 0);
  ctx.restore();
  const pool = particlesOf(rc);
  if (pool !== null && hit > 0.97 && rc.wall - liveOf(rc).puffAt > 300) {
    liveOf(rc).puffAt = rc.wall;
    pool.spawn({ kind: 'dust', x: x - u * 0.4 * k, y: y, vx: -u * 0.4, vy: -u * 0.5, life: 0.8, size: u * 0.1,
      drag: 1.5, color: '#cdb892' });
  }
}

/** The site, around its anchor (0, 0): dug-up paving, sand, cement bags, rebar, barriers, the notice board. */
function paintSite(c: Ctx, u: number): void {
  c.fillStyle = '#c9ab82';
  rr(c, -u * 1.15, -u * 0.25, u * 1.6, u * 0.5, u * 0.15);
  c.fill();
  c.beginPath();
  c.ellipse(u * 0.25, u * 0.05, u * 0.32, u * 0.22, 0, Math.PI, 0);
  c.closePath();
  fe(c, '#e6c98f', u * 0.03);
  for (let i = 0; i < 3; i++) box(c, -u * 0.62 + (i % 2) * u * 0.16, u * 0.1 - Math.floor(i / 2) * u * 0.12, u * 0.28, u * 0.13, u * 0.04, '#e9e4dc', u * 0.02, '#a59e96');
  for (let i = 0; i < 3; i++) line(c, -u * 1.1 + i * u * 0.07, -u * 0.95, -u * 1.04 + i * u * 0.07, -u * 0.05, '#8a5a3a', u * 0.025);
  // The mixer's stand and wheels (the drum turns live).
  line(c, -u * 0.92, -u * 0.25, -u * 0.78, -u * 0.55, '#6e665c', u * 0.05);
  line(c, -u * 0.64, -u * 0.25, -u * 0.78, -u * 0.55, '#6e665c', u * 0.05);
  disc(c, -u * 0.92, -u * 0.2, u * 0.06, '#3a2f2a');
  disc(c, -u * 0.64, -u * 0.2, u * 0.06, '#3a2f2a');
  // The notice board on its pole, behind.
  line(c, -u * 0.35, -u * 0.6, -u * 0.35, -u * 1.05, '#6e665c', u * 0.04);
  box(c, -u * 0.85, -u * 1.65, u * 1.0, u * 0.62, u * 0.04, '#2f6fb3', u * 0.03, '#1d4d80');
  text(c, 'ĐANG THI CÔNG', -u * 0.35, -u * 1.48, u * 0.13, '#fffcf7', { maxW: u * 0.92 });
  text(c, 'TRẠM XE BUÝT', -u * 0.35, -u * 1.3, u * 0.13, '#ffd23f', { maxW: u * 0.92 });
  text(c, 'từ tiền thuế', -u * 0.35, -u * 1.13, u * 0.11, '#e3efd6', { maxW: u * 0.92, weight: 600 });
  // Barriers in front.
  for (const bx of [-u * 1.2, u * 0.0]) {
    box(c, bx, u * 0.0, u * 0.5, u * 0.18, u * 0.03, '#fffcf7', u * 0.02, '#c0323e');
    c.fillStyle = '#e8533f';
    for (let q = 0; q < 3; q++) {
      const sx = bx + q * u * 0.17;
      poly(c, [sx, u * 0.18, sx + u * 0.08, 0, sx + u * 0.16, 0, sx + u * 0.08, u * 0.18]);
      c.fill();
    }
    line(c, bx + u * 0.05, u * 0.18, bx + u * 0.05, u * 0.4, '#8f877c', u * 0.04);
    line(c, bx + u * 0.45, u * 0.18, bx + u * 0.45, u * 0.4, '#8f877c', u * 0.04);
  }
}

// ── People among the props ─────────────────────────────────────────────────────────────────────────────────────────

interface Memo { pose: ReturnType<typeof pose>; sk: ReturnType<typeof newSkeleton>; input: ClipInput; fx: FigureFx }
const officerMemo: Memo = {
  pose: pose(), sk: newSkeleton(), input: { t: 0, loop: 0, phase: 0, pace: 0, side: true, stoop: 0, calm: false },
  fx: { mood: 'neutral', blink: 0, cup: false, phone: false },
};

function inputFor(i: ClipInput, sec: number, calm: boolean): ClipInput {
  i.t = sec;
  i.loop = sec;
  i.calm = calm;
  i.stoop = 0;
  return i;
}

let officerTr: Traits | null = null;
let workerTr: Traits | null = null;

function officerTraits(): Traits {
  if (officerTr === null) {
    const b = buildTraits(4242);
    officerTr = {
      ...b, look: -20, archetype: 'office', fem: false, hair: 'short', hairColor: '#231a15', hairEdge: shade('#231a15', 0.66),
      top: '#7d8b4a', topEdge: shade('#7d8b4a', 0.66), longSleeves: false, tunic: false, bottom: '#4a4f3a',
      bottomEdge: shade('#4a4f3a', 0.66), bottomStyle: 'pants', hat: 'cap', hatColor: '#5f6b36', hatEdge: shade('#5f6b36', 0.66),
      neck: 'collar', neckColor: '#9aa66a', pattern: 'none', glasses: 'none', bag: 'none', cane: false, stoop: 0, phone: 0,
      height: 1, width: 1.05, legColor: b.skin,
    };
  }
  return officerTr;
}

function workerTraits(): Traits {
  if (workerTr === null) {
    const b = buildTraits(777);
    workerTr = {
      ...b, look: -21, archetype: 'shipper', fem: false, hat: 'helmet', hatColor: '#ffd23f', hatEdge: shade('#ffd23f', 0.66),
      top: '#f08a3a', topEdge: shade('#f08a3a', 0.66), neck: 'zip', neckColor: '#fffcf7', bottom: '#3b4a6b',
      bottomEdge: shade('#3b4a6b', 0.66), bottomStyle: 'pants', bag: 'none', cane: false, stoop: 0, glasses: 'none', phone: 0,
    };
  }
  return workerTr;
}

function drawOfficer(rc: RenderContext, w: ReturnType<typeof newWalker>): void {
  const { ctx, layout: L } = rc;
  const u = L.actorH;
  const tr = officerTraits();
  const m = officerMemo;
  const sec = rc.wall / 1000;
  const input = inputFor(m.input, sec, rc.reducedMotion);
  let view: 'side' | 'front' | 'back' = 'side';
  if (w.walking) {
    input.phase = (w.x / (u * 1.3)) * Math.PI * 2;
    input.pace = 0.8;
    input.side = true;
    clipPose(m.pose, 'walk', input);
  } else {
    // At a shop: turned to it, clipboard up, writing.
    view = w.y < (L.road.y0 + L.road.y1) / 2 ? 'back' : 'front';
    input.side = false;
    clipPose(m.pose, 'idle', input);
    const scribble = rc.reducedMotion ? 0 : Math.sin(sec * 11) * 0.08;
    m.pose.a0 = 0.9;
    m.pose.e0 = 1.5;
    m.pose.x0 = 0.05;
    m.pose.a1 = 0.75 + scribble;
    m.pose.e1 = 1.55;
    m.pose.x1 = 0.02;
    m.pose.nod = 0.25;
  }
  const sk = solve(m.pose, tr.dims, view, m.sk);
  m.fx.mood = w.walking ? 'neutral' : 'focus';
  m.fx.phone = false;
  m.fx.blink = 0;
  drawCharacterAt(ctx, tr, w.x, w.y, u * tr.height, w.facing, view, m.pose, sk, m.fx, null);
  if (view !== 'back') {
    // The clipboard in his hand.
    const hx = w.x + w.facing * sk.hand0.x * u;
    const hy = w.y + sk.hand0.y * u;
    box(ctx, hx - u * 0.1, hy - u * 0.16, u * 0.2, u * 0.25, u * 0.02, '#c9a27a', u * 0.015);
    ctx.fillStyle = '#fffcf7';
    ctx.fillRect(hx - u * 0.07, hy - u * 0.12, u * 0.14, u * 0.18);
  }
  if (!w.walking && w.since > 8) {
    // "Thuế 5k/ly" noted: a small tag over his head.
    const tax = rc.director.rules?.taxPerCup ?? 5;
    pill(ctx, `${tax}k/ly`, w.x, w.y - u * 1.3, u * 0.22, '#5f6b36', '#fffcf7');
  }
}

// ── Vehicles ───────────────────────────────────────────────────────────────────────────────────────────────────────

function wheel(ctx: Ctx, x: number, y: number, r: number): void {
  disc(ctx, x, y, r, '#2a2422', r * 0.1);
  disc(ctx, x, y, r * 0.5, '#9d968b', 0);
}

function drawBus(rc: RenderContext, s: ReturnType<typeof newBusState>): void {
  const { ctx, layout: L, view: v } = rc;
  const u = L.actorH;
  const len = u * 3.3;
  const h = u * 1.45;
  const doorFrom = len * 0.74;
  let x: number;
  const doors = s.doors;
  if (rc.reducedMotion) {
    if (s.phase !== 'stop') return;
    x = L.busStop.x - doorFrom;
  } else {
    x = busX(s, L.busStop.x, doorFrom, len, v.x, v.x + v.w);
  }
  const ground = L.lanes[1] - u * 0.06;
  const y = ground - h;
  const bob = rc.reducedMotion || s.phase === 'stop' ? 0 : Math.sin(rc.wall / 90) * u * 0.012;
  shadow(ctx, x + len / 2, ground, len * 0.52, u * 0.12, 0.2);
  ctx.save();
  ctx.translate(0, bob);
  // Body: matcha green with a cream band, rounded front at the right.
  box(ctx, x, y, len, h - u * 0.14, u * 0.22, '#5b8f3e', u * 0.04);
  ctx.fillStyle = '#f6e7d2';
  ctx.fillRect(x + u * 0.05, y + h * 0.56, len - u * 0.1, u * 0.18);
  // Windows with passengers' heads.
  const wy = y + u * 0.18;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const wx = x + u * 0.18 + i * (len - u * 0.75) / n;
    box(ctx, wx, wy, (len - u * 0.75) / n - u * 0.08, u * 0.42, u * 0.06, '#a8cfe0', 0);
    if (hash01(i + 3) < 0.75) {
      const hx = wx + u * 0.2;
      disc(ctx, hx, wy + u * 0.3, u * 0.11, ['#f0c6a2', '#e2ad86', '#cc9066'][i % 3], 0);
      ctx.fillStyle = i % 2 ? '#3b2a20' : '#231a15';
      ctx.beginPath();
      ctx.arc(hx, wy + u * 0.27, u * 0.115, Math.PI, 0);
      ctx.fill();
      box(ctx, hx - u * 0.13, wy + u * 0.38, u * 0.26, u * 0.06, u * 0.03, SHIRTS[i % SHIRTS.length], 0);
    }
  }
  // Windscreen.
  box(ctx, x + len - u * 0.5, wy, u * 0.4, u * 0.55, u * 0.1, '#bfe0ec', 0);
  // The route sign.
  box(ctx, x + u * 0.4, y - u * 0.02, u * 1.3, u * 0.16, u * 0.04, '#2a1d15', 0);
  text(ctx, '09 · PHỐ TRÀ SỮA', x + u * 1.05, y + u * 0.06, u * 0.11, '#ffd23f', { maxW: u * 1.2 });
  // The door, sliding open.
  const dx = x + doorFrom - u * 0.24;
  const dw = u * 0.48;
  box(ctx, dx, wy, dw, h - u * 0.36, u * 0.04, '#3a4a40', 0);
  const panel = (dw / 2) * (1 - doors);
  if (panel > 0.5) {
    box(ctx, dx, wy, panel, h - u * 0.36, u * 0.03, '#a8cfe0', u * 0.02, '#3e6a27');
    box(ctx, dx + dw - panel, wy, panel, h - u * 0.36, u * 0.03, '#a8cfe0', u * 0.02, '#3e6a27');
  }
  if (doors > 0.5) {
    // A step down and a warm light inside.
    ctx.fillStyle = 'rgba(255, 230, 170, 0.35)';
    ctx.fillRect(dx + u * 0.05, wy + u * 0.05, dw - u * 0.1, h - u * 0.5);
  }
  wheel(ctx, x + u * 0.62, ground - u * 0.17, u * 0.2);
  wheel(ctx, x + len - u * 0.68, ground - u * 0.17, u * 0.2);
  ctx.restore();
  const pool = particlesOf(rc);
  if (pool !== null && s.phase !== 'stop' && rc.wall - liveOf(rc).puffAt > 140) {
    liveOf(rc).puffAt = rc.wall;
    pool.spawn({ kind: 'dust', x: x - u * 0.05, y: ground - u * 0.15, vx: -u * 0.6, vy: -u * 0.2, life: 0.9,
      size: u * 0.12, drag: 1, color: '#b9aea4' });
  }
}

function drawVan(rc: RenderContext): void {
  const { ctx, layout: L, view: v } = rc;
  const u = L.actorH;
  const at = CONFIG.rumor.inspectionTick;
  let k = vanProgress(at, rc.now);
  if (k < 0) return;
  if (rc.reducedMotion) {
    if (Math.abs(rc.now - at) > 25) return;
    k = 0.5;
  }
  const len = u * 2.1;
  const h = u * 1.05;
  const x = lerp(v.x - len - u, v.x + v.w + u, k);
  const ground = L.road.y0 + (L.road.y1 - L.road.y0) * 0.5;
  const y = ground - h;
  shadow(ctx, x + len / 2, ground, len * 0.5, u * 0.1, 0.2);
  // A little white van with a blue stripe, horns on the roof, a red banner on its side.
  box(ctx, x, y + u * 0.15, len, h - u * 0.3, u * 0.14, '#f4f1ec', u * 0.035, '#9d968b');
  box(ctx, x + len - u * 0.6, y + u * 0.2, u * 0.45, u * 0.32, u * 0.08, '#a8cfe0', 0);
  ctx.fillStyle = '#2f6fb3';
  ctx.fillRect(x + u * 0.05, y + h * 0.66, len - u * 0.1, u * 0.07);
  box(ctx, x + u * 0.1, y + u * 0.24, len - u * 0.8, u * 0.36, u * 0.04, '#c0323e', 0);
  text(ctx, 'KẾT QUẢ KIỂM ĐỊNH', x + u * 0.1 + (len - u * 0.8) / 2, y + u * 0.42, u * 0.12, '#ffd23f', { maxW: len - u * 0.9 });
  line(ctx, x + len * 0.42, y + u * 0.15, x + len * 0.42, y - u * 0.05, '#6e665c', u * 0.04);
  horn(ctx, x + len * 0.42, y - u * 0.12, u * 0.7, -1);
  horn(ctx, x + len * 0.42, y - u * 0.12, u * 0.7, 1);
  wheel(ctx, x + u * 0.42, ground - u * 0.14, u * 0.16);
  wheel(ctx, x + len - u * 0.45, ground - u * 0.14, u * 0.16);
  if (!rc.reducedMotion) {
    // Rings from the horns.
    for (let i = 0; i < 3; i++) {
      const r = ((rc.wall / 700 + i / 3) % 1);
      ctx.strokeStyle = `rgba(222, 79, 90, ${0.75 * (1 - r)})`;
      ctx.lineWidth = u * 0.045;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(x + len * 0.42 + side * u * 0.3, y - u * 0.12, u * (0.12 + r * 0.55),
          side > 0 ? -0.7 : Math.PI - 0.7, side > 0 ? 0.7 : Math.PI + 0.7);
        ctx.stroke();
      }
    }
  }
}

const MOTO_COLS = ['#de4f5a', '#2f6fb3', '#f2c14e', '#5b8f3e', '#2a2f3a', '#b49ad1'];
const SHIRTS = ['#7fb8e0', '#f6e7d2', '#9dbb6e', '#f08a3a', '#fffcf7', '#e3d3ef'];

const motoSprites = new Map<number, { k: number; canvas: HTMLCanvasElement | null }>();

/** A motorbike and its rider (and cargo), drawn once per look and direction into a little canvas, then blitted. */
function drawMoto(rc: RenderContext, r: ReturnType<typeof newRider>, ground: number): void {
  const { ctx, layout: L } = rc;
  const u = L.actorH;
  const x = r.x;
  const d = r.dir;
  const k = rc.pxPerUnit;
  const key = r.look * 2 + (d > 0 ? 1 : 0);
  let hit = motoSprites.get(key);
  if (hit === undefined || hit.k !== k) {
    if (motoSprites.size > 12) motoSprites.clear();
    let canvas: HTMLCanvasElement | null = null;
    if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = Math.ceil(u * 1.8 * k);
      canvas.height = Math.ceil(u * 1.5 * k);
      const c = canvas.getContext('2d');
      if (c !== null) {
        c.scale(k, k);
        c.translate(u * 0.9, u * 1.4);
        paintMoto(c, r.look, d, u);
      }
    }
    hit = { k, canvas };
    motoSprites.set(key, hit);
  }
  const bob = rc.reducedMotion ? 0 : Math.sin(r.t * 18) * u * 0.012;
  shadow(ctx, x, ground, u * 0.55, u * 0.08, 0.2);
  if (hit.canvas !== null) ctx.drawImage(hit.canvas, x - u * 0.9, ground - u * 1.4 + bob, u * 1.8, u * 1.5);
  else {
    ctx.translate(x, ground + bob);
    paintMoto(ctx, r.look, d, u);
    ctx.translate(-x, -ground - bob);
  }
  const pool = particlesOf(rc);
  if (pool !== null && hash01(Math.floor(rc.wall / 110) + r.look) < 0.6) {
    pool.spawn({ kind: 'dust', x: x - d * u * 0.48, y: ground - u * 0.16, vx: -d * u * 0.5, vy: -u * 0.25, life: 0.7,
      size: u * 0.07, drag: 1, color: '#c8bfb5' });
  }
}

/** The motorbike at the origin (its ground point), facing `d`. */
function paintMoto(ctx: Ctx, look: number, d: 1 | -1, u: number): void {
  const col = MOTO_COLS[look % MOTO_COLS.length];
  const shirt = SHIRTS[(look >> 3) % SHIRTS.length];
  const helmet = MOTO_COLS[(look >> 6) % MOTO_COLS.length];
  const cargo = (look >> 9) % 4;
  wheel(ctx, -d * u * 0.36, -u * 0.13, u * 0.13);
  wheel(ctx, d * u * 0.36, -u * 0.13, u * 0.13);
  ctx.save();
  ctx.scale(d, 1);
  // The scooter body.
  poly(ctx, [-u * 0.42, -u * 0.2, -u * 0.1, -u * 0.38, u * 0.22, -u * 0.32, u * 0.3, -u * 0.62, u * 0.38, -u * 0.6,
    u * 0.4, -u * 0.2, u * 0.12, -u * 0.12, -u * 0.36, -u * 0.12]);
  fe(ctx, col, u * 0.03);
  box(ctx, -u * 0.32, -u * 0.46, u * 0.42, u * 0.09, u * 0.04, '#2a2422', 0);
  disc(ctx, u * 0.42, -u * 0.5, u * 0.05, '#fff3c4', 0);
  // The rider: legs, body, arm to the handlebar, a helmet.
  line(ctx, -u * 0.05, -u * 0.48, u * 0.12, -u * 0.22, '#3b4a6b', u * 0.09);
  box(ctx, -u * 0.18, -u * 0.9, u * 0.26, u * 0.44, u * 0.1, shirt, u * 0.025);
  line(ctx, u * 0.02, -u * 0.8, u * 0.3, -u * 0.62, shirt, u * 0.07);
  disc(ctx, -u * 0.04, -u * 1.0, u * 0.13, '#f0c6a2', u * 0.02);
  ctx.beginPath();
  ctx.arc(-u * 0.05, -u * 1.03, u * 0.15, Math.PI, 0);
  ctx.closePath();
  fe(ctx, helmet, u * 0.025);
  // What it carries.
  if (cargo === 1) {
    for (let i = 0; i < 3; i++) box(ctx, -u * 0.62, -u * (0.62 + i * 0.2), u * 0.36, u * 0.2, u * 0.02, '#c8995e', u * 0.02);
  } else if (cargo === 2) {
    // A potted tree riding pillion.
    box(ctx, -u * 0.55, -u * 0.62, u * 0.26, u * 0.22, u * 0.04, '#b5523e', u * 0.02);
    disc(ctx, -u * 0.42, -u * 0.95, u * 0.26, '#66a046', u * 0.025);
    disc(ctx, -u * 0.3, -u * 1.12, u * 0.15, '#86bd5c', 0);
  } else if (cargo === 3) {
    // A passenger.
    box(ctx, -u * 0.42, -u * 0.86, u * 0.24, u * 0.4, u * 0.1, SHIRTS[(look >> 12) % SHIRTS.length], u * 0.025);
    disc(ctx, -u * 0.3, -u * 0.97, u * 0.12, '#e2ad86', u * 0.02);
    ctx.beginPath();
    ctx.arc(-u * 0.3, -u * 1.0, u * 0.14, Math.PI, 0);
    ctx.closePath();
    fe(ctx, MOTO_COLS[(look >> 14) % MOTO_COLS.length], u * 0.025);
  }
  ctx.restore();
}

// ── The cat ────────────────────────────────────────────────────────────────────────────────────────────────────────

function drawCat(ctx: Ctx, c: ReturnType<typeof newCat>, x: number, y: number, u: number, calm: boolean): void {
  const s = u * 0.38;
  const d = c.dir;
  const fur = '#e9a15a';
  const dark = '#b9733a';
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(d, 1);
  const step = calm ? 0 : Math.sin(c.t * 9);
  const tail = calm ? 0 : Math.sin(c.t * 2.2) * 0.3;
  ctx.strokeStyle = dark;
  ctx.lineCap = 'round';
  if (c.pose === 'walk') {
    // Legs, body, head, tail up.
    ctx.lineWidth = s * 0.12;
    ctx.beginPath();
    ctx.moveTo(-s * 0.35, -s * 0.25);
    ctx.lineTo(-s * 0.35 + step * s * 0.12, 0);
    ctx.moveTo(-s * 0.2, -s * 0.25);
    ctx.lineTo(-s * 0.2 - step * s * 0.12, 0);
    ctx.moveTo(s * 0.25, -s * 0.25);
    ctx.lineTo(s * 0.25 - step * s * 0.12, 0);
    ctx.moveTo(s * 0.4, -s * 0.25);
    ctx.lineTo(s * 0.4 + step * s * 0.12, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.38, s * 0.52, s * 0.2, 0, 0, Math.PI * 2);
    fe(ctx, fur, s * 0.05, dark);
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(-s * 0.48, -s * 0.42);
    ctx.quadraticCurveTo(-s * 0.8, -s * 0.6, -s * 0.7 + tail * s * 0.3, -s * 0.95);
    ctx.stroke();
    catHead(ctx, s * 0.55, -s * 0.58, s, fur, dark);
  } else {
    // Sitting up: tail curled round; licking: head down to a raised paw.
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.38, s * 0.28, s * 0.38, 0, 0, Math.PI * 2);
    fe(ctx, fur, s * 0.05, dark);
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(-s * 0.2, -s * 0.05);
    ctx.quadraticCurveTo(-s * 0.6, 0, -s * 0.5, -s * 0.3 + tail * s * 0.2);
    ctx.stroke();
    const lick = c.pose === 'lick' && !calm ? Math.abs(Math.sin(c.t * 6)) : 0;
    catHead(ctx, s * 0.12, -s * (0.85 - lick * 0.12), s, fur, dark);
    if (c.pose === 'lick') {
      ctx.lineWidth = s * 0.12;
      ctx.beginPath();
      ctx.moveTo(s * 0.15, -s * 0.35);
      ctx.lineTo(s * 0.32, -s * (0.62 + lick * 0.1));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function catHead(ctx: Ctx, x: number, y: number, s: number, fur: string, dark: string): void {
  poly(ctx, [x - s * 0.18, y - s * 0.08, x - s * 0.14, y - s * 0.3, x - s * 0.02, y - s * 0.14]);
  fe(ctx, fur, s * 0.04, dark);
  poly(ctx, [x + s * 0.18, y - s * 0.08, x + s * 0.14, y - s * 0.3, x + s * 0.02, y - s * 0.14]);
  fe(ctx, fur, s * 0.04, dark);
  disc(ctx, x, y, s * 0.2, fur, s * 0.04, dark);
  disc(ctx, x + s * 0.07, y - s * 0.02, s * 0.03, '#2a1d15', 0);
  disc(ctx, x - s * 0.06, y - s * 0.02, s * 0.03, '#2a1d15', 0);
}
