// The street itself (spec §9 "Cảnh phố", "Không khí phố"): a row of old tube houses with water tanks on their roofs
// behind the top row, tiled sidewalks with stone curbs, the road with its dashed centre line and a zebra crossing in the
// middle where walkers stop to read the boards, the back alley behind the bottom row, and in portrait a green verge
// below it (a planter wall with bougainvillea, parked motorbikes) so the screen does not end in an empty band.
//
// All of that is drawn once into a sprite the size of the view (rebuilt on a resize or a turn of the phone) and blitted
// each frame; only the swaying tree crowns behind the top row are drawn live. The utility poles with their tangle of
// wires, the street trees on the sidewalks and the verge are props at their own depth (draw/props.ts).
import type { Rect, StreetLayout } from '../layout';
import type { Palette, RenderContext } from '../Scene';
import { hash01 } from '../schedule';
import { blit, SpriteCache } from '../sprites';
import { box, disc, fe, line, oval, poly, rr, shade, type Ctx } from './kit';

const sprites = new SpriteCache();

const ROAD = '#b9ab9c';
const ROAD_DARK = '#a99a8b';
const TILE = '#ecd6b8';
const TILE_ALT = '#e6cdab';
const GROUT = 'rgba(122, 88, 60, 0.16)';
const CURB = '#d9d2c8';
const CURB_FACE = '#b9aea2';
const SKY_TOP = '#cfe6ef';
const SKY_LOW = '#fbefdc';
const HOUSES = ['#f3d9a4', '#cfe3c8', '#f2c6c2', '#efe6d8', '#c9dde8', '#f6dcc0', '#e3d3ef'];

/** Where the utility poles stand: in the gaps between top-row shops. */
export function poleXs(L: StreetLayout): number[] {
  const top = L.shops.filter(s => s.row === 'top');
  const xs: number[] = [];
  for (let i = 0; i + 1 < top.length; i++) xs.push((top[i].rect.x + top[i].rect.w + top[i + 1].rect.x) / 2);
  return xs;
}

/** Tree crowns behind the top row (portrait), swaying: x, crown y, radius. */
export function backTrees(L: StreetLayout): readonly (readonly [number, number, number])[] {
  if (L.kind !== 'portrait') return [];
  const u = L.actorH;
  return [[30, 12, u * 0.75], [150, 4, u * 0.62], [262, 14, u * 0.7], [366, 2, u * 0.66]];
}

export function drawStreet(rc: RenderContext): void {
  const { ctx, layout: L, view, palette } = rc;
  const s = sprites.get(L, 0, view, rc.grid, 1, c => paintStreet(c, L, view, palette));
  blit(ctx, s, rc.grid);
  const sway = rc.reducedMotion ? 0 : 1;
  for (const [x, y, r] of backTrees(L)) swayingCrown(ctx, rc.pxPerUnit, x, y, r, Math.sin(rc.wall / 1300 + x) * 0.05 * sway, x);
}

const crowns = new Map<number, { k: number; canvas: HTMLCanvasElement | OffscreenCanvas | null }>();

/**
 * A crown that sways: drawn once into a little canvas at the device scale `k` and blitted shifted by its lean each
 * frame (one drawImage instead of a dozen arcs).
 */
export function swayingCrown(ctx: Ctx, k: number, x: number, y: number, r: number, lean: number, seed: number): void {
  const key = Math.round(r * 100) * 4096 + (seed & 4095);
  let hit = crowns.get(key);
  if (hit === undefined || hit.k !== k) {
    const side = Math.ceil(r * 3.2 * k);
    let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
    if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(side, side);
    else if (typeof document !== 'undefined') {
      canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
    }
    const c = canvas?.getContext('2d') as Ctx | null | undefined;
    if (c) {
      c.scale(k, k);
      crown(c, r * 1.6, r * 1.6, r, 0, seed);
    }
    hit = { k, canvas };
    crowns.set(key, hit);
  }
  if (hit.canvas === null) {
    crown(ctx, x, y, r, lean, seed);
    return;
  }
  const ox = Math.sin(lean) * r * 1.6;
  ctx.drawImage(hit.canvas as CanvasImageSource, x + ox - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
}

/** A round leafy crown at (x, y), radius r, leaning by `lean` radians about its trunk below. */
export function crown(ctx: Ctx, x: number, y: number, r: number, lean: number, seed: number): void {
  const ox = Math.sin(lean) * r * 1.6;
  const dark = '#4f7f36';
  const mid = '#66a046';
  const light = '#86bd5c';
  const j = hash01(seed | 0) * 0.3;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(x + ox - r * 0.55, y + r * 0.2, r * 0.62, 0, Math.PI * 2);
  ctx.arc(x + ox + r * 0.55, y + r * 0.25, r * 0.6, 0, Math.PI * 2);
  ctx.arc(x + ox, y - r * 0.1, r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = mid;
  ctx.beginPath();
  ctx.arc(x + ox * 1.1 - r * 0.32, y - r * (0.12 + j), r * 0.55, 0, Math.PI * 2);
  ctx.arc(x + ox * 1.1 + r * 0.3, y - r * 0.05, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(x + ox * 1.2 - r * 0.25, y - r * (0.38 + j), r * 0.28, 0, Math.PI * 2);
  ctx.arc(x + ox * 1.2 + r * 0.2, y - r * 0.3, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

// ── The static ground ──────────────────────────────────────────────────────────────────────────────────────────────

function paintStreet(c: Ctx, L: StreetLayout, v: Rect, p: Palette): void {
  const u = L.actorH;
  const x0 = v.x - 2;
  const x1 = v.x + v.w + 2;
  const W = x1 - x0;
  // Sky.
  const sky = c.createLinearGradient(0, v.y, 0, L.sidewalkTop.y0);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(0.7, SKY_LOW);
  c.fillStyle = sky;
  c.fillRect(x0, v.y - 2, W, L.sidewalkTop.y0 - v.y + 2);
  clouds(c, L, v);
  houses(c, L, x0, x1);

  // Sidewalks, curbs, road.
  sidewalk(c, L, x0, x1, L.sidewalkTop.y0, L.sidewalkTop.y1, p);
  road(c, L, x0, x1, p);
  sidewalk(c, L, x0, x1, L.sidewalkBottom.y0, L.sidewalkBottom.y1, p);
  curb(c, x0, W, L.sidewalkTop.y1, u, true);
  curb(c, x0, W, L.sidewalkBottom.y0, u, false);

  // Behind the bottom row: the back alley (seen in the gaps and below).
  const by = L.sidewalkBottom.y1;
  c.fillStyle = '#e2c9a6';
  c.fillRect(x0, by, W, v.y + v.h - by + 2);
  alleyBits(c, L, x0, x1);
  if (L.kind === 'portrait') verge(c, L, v, p);
}

function shadow2(c: Ctx, x: number, y: number, r: number): void {
  oval(c, x, y, r, r * 0.25, 'rgba(42, 29, 21, 0.14)');
}

function bench(c: Ctx, x: number, y: number, u: number): void {
  shadow2(c, x + u * 0.5, y + u * 0.02, u * 0.6);
  box(c, x, y - u * 0.55, u * 1.0, u * 0.12, u * 0.04, '#b9855a', u * 0.025);
  box(c, x, y - u * 0.32, u * 1.0, u * 0.12, u * 0.04, '#c99a6a', u * 0.025);
  line(c, x + u * 0.12, y - u * 0.2, x + u * 0.12, y, '#5c4a3a', u * 0.05);
  line(c, x + u * 0.88, y - u * 0.2, x + u * 0.88, y, '#5c4a3a', u * 0.05);
}

/** A scooter parked nose-out, seen from the front three-quarters: s tall. */
function parked(c: Ctx, x: number, y: number, s: number, j: number): void {
  const col = ['#de4f5a', '#2f6fb3', '#f2c14e', '#5b8f3e', '#fffcf7', '#2a2f3a'][Math.floor(j * 6)];
  shadow2(c, x, y, s * 0.4);
  disc(c, x, y - s * 0.12, s * 0.12, '#2a2422');
  poly(c, [x - s * 0.22, y - s * 0.2, x + s * 0.22, y - s * 0.2, x + s * 0.16, y - s * 0.75, x - s * 0.16, y - s * 0.75]);
  fe(c, col, s * 0.04);
  box(c, x - s * 0.3, y - s * 0.86, s * 0.6, s * 0.08, s * 0.04, '#3a2f2a', 0);
  disc(c, x, y - s * 0.62, s * 0.08, '#fff3c4', s * 0.02, '#9d968b');
  box(c, x - s * 0.18, y - s * 0.98, s * 0.36, s * 0.1, s * 0.04, '#2a2422', 0);
}

function clouds(c: Ctx, L: StreetLayout, v: Rect): void {
  const u = L.actorH;
  c.fillStyle = 'rgba(255, 252, 247, 0.85)';
  const n = Math.ceil(v.w / (u * 5)) + 1;
  for (let i = 0; i < n; i++) {
    const x = v.x + (i + hash01(i + 40)) * u * 5;
    const y = v.y + u * (0.25 + hash01(i + 70) * 0.35);
    c.beginPath();
    c.ellipse(x, y, u * 0.9, u * 0.22, 0, 0, Math.PI * 2);
    c.ellipse(x + u * 0.35, y - u * 0.15, u * 0.45, u * 0.25, 0, 0, Math.PI * 2);
    c.ellipse(x - u * 0.3, y - u * 0.08, u * 0.35, u * 0.2, 0, 0, Math.PI * 2);
    c.fill();
  }
}

/** A row of narrow old houses behind the top row, from the sky down to the sidewalk. */
function houses(c: Ctx, L: StreetLayout, x0: number, x1: number): void {
  const u = L.actorH;
  const base = L.sidewalkTop.y0;
  let x = x0 - hash01(3) * u;
  let i = 0;
  while (x < x1) {
    const w = u * (1.1 + hash01(i * 3 + 1) * 0.8);
    const top = L.back.y0 - u * (0.3 + hash01(i * 3 + 2) * 0.9) + (L.kind === 'landscape' ? u * 0.05 : 0);
    const col = HOUSES[Math.floor(hash01(i * 3 + 3) * HOUSES.length)];
    box(c, x, top, w + 1, base - top + 2, u * 0.06, col, u * 0.03);
    // A parapet, windows with shutters, sometimes a balcony.
    c.fillStyle = shade(col, 0.9);
    c.fillRect(x, top, w + 1, u * 0.12);
    const rows = Math.max(1, Math.floor((base - top - u * 0.4) / (u * 0.75)));
    for (let r = 0; r < rows; r++) {
      const wy = top + u * 0.3 + r * u * 0.75;
      const ww = w * 0.36;
      for (let k = 0; k < 2; k++) {
        const wx = x + w * (k === 0 ? 0.1 : 0.54);
        box(c, wx, wy, ww, u * 0.42, u * 0.05, '#7d9bb0', u * 0.025, '#5c7385');
        c.fillStyle = 'rgba(255, 255, 255, 0.35)';
        c.fillRect(wx + ww * 0.12, wy + u * 0.05, ww * 0.18, u * 0.3);
        // Green wooden shutters on some.
        if (hash01(i * 7 + r * 3 + k) < 0.4) {
          box(c, wx - ww * 0.22, wy, ww * 0.22, u * 0.42, u * 0.02, '#6f9a6a', u * 0.02);
          box(c, wx + ww, wy, ww * 0.22, u * 0.42, u * 0.02, '#6f9a6a', u * 0.02);
        }
      }
      if (hash01(i * 11 + r) < 0.35) {
        // A balcony rail with potted plants.
        c.fillStyle = shade(col, 0.75);
        c.fillRect(x + w * 0.06, wy + u * 0.42, w * 0.88, u * 0.05);
        for (let k = 0; k < 3; k++) disc(c, x + w * (0.2 + k * 0.3), wy + u * 0.36, u * 0.08, '#6aa34c');
      }
    }
    // On the roof: a stainless water tank, or a little solar panel, or an antenna.
    const roof = hash01(i * 5 + 9);
    if (roof < 0.45) {
      const tx = x + w * (0.25 + hash01(i) * 0.4);
      box(c, tx, top - u * 0.32, u * 0.5, u * 0.3, u * 0.12, '#d7dde2', u * 0.025, '#8f9aa3');
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.fillRect(tx + u * 0.06, top - u * 0.27, u * 0.38, u * 0.04);
      line(c, tx + u * 0.08, top - u * 0.02, tx + u * 0.08, top + u * 0.02, '#8f9aa3', u * 0.03);
      line(c, tx + u * 0.42, top - u * 0.02, tx + u * 0.42, top + u * 0.02, '#8f9aa3', u * 0.03);
    } else if (roof < 0.65) {
      const ax = x + w * 0.7;
      line(c, ax, top, ax, top - u * 0.45, '#6e5b4d', u * 0.025);
      line(c, ax - u * 0.15, top - u * 0.35, ax + u * 0.15, top - u * 0.35, '#6e5b4d', u * 0.02);
      line(c, ax - u * 0.1, top - u * 0.25, ax + u * 0.1, top - u * 0.25, '#6e5b4d', u * 0.02);
    }
    // An air-conditioner box on the wall.
    if (hash01(i * 13 + 4) < 0.5) box(c, x + w * 0.62, top + u * 0.62, u * 0.34, u * 0.22, u * 0.03, '#f4f1ec', u * 0.02, '#b8b0a6');
    x += w;
    i++;
  }
  // Ground-floor shade behind the top row: the street side of the houses is in the shops' shadow.
  c.fillStyle = 'rgba(42, 29, 21, 0.08)';
  c.fillRect(x0, base - u * 0.5, x1 - x0, u * 0.5);
}

function sidewalk(c: Ctx, L: StreetLayout, x0: number, x1: number, y0: number, y1: number, p: Palette): void {
  const u = L.actorH;
  c.fillStyle = TILE;
  c.fillRect(x0, y0, x1 - x0, y1 - y0);
  // Square tiles, every other one a touch darker, with grout lines.
  const t = u * 0.62;
  const rows = Math.ceil((y1 - y0) / t);
  c.fillStyle = TILE_ALT;
  for (let r = 0; r < rows; r++) {
    for (let x = Math.floor(x0 / t) * t + (r % 2) * t; x < x1; x += t * 2) {
      c.fillRect(x, y0 + r * t, t, Math.min(t, y1 - y0 - r * t));
    }
  }
  c.strokeStyle = GROUT;
  c.lineWidth = u * 0.025;
  c.beginPath();
  for (let r = 1; r < rows; r++) {
    c.moveTo(x0, y0 + r * t);
    c.lineTo(x1, y0 + r * t);
  }
  for (let x = Math.floor(x0 / t) * t; x < x1; x += t) {
    c.moveTo(x, y0);
    c.lineTo(x, y1);
  }
  c.stroke();
}

function curb(c: Ctx, x0: number, w: number, y: number, u: number, above: boolean): void {
  // The stone kerb: its top along the sidewalk edge, its face dropping to the road.
  const top = u * 0.1;
  const face = u * 0.09;
  if (above) {
    c.fillStyle = CURB;
    c.fillRect(x0, y - top - face, w, top);
    c.fillStyle = CURB_FACE;
    c.fillRect(x0, y - face, w, face);
  } else {
    c.fillStyle = CURB;
    c.fillRect(x0, y, w, top);
    c.fillStyle = 'rgba(42, 29, 21, 0.12)';
    c.fillRect(x0, y - face * 0.6, w, face * 0.6);
  }
  // Joints between kerb stones.
  c.strokeStyle = 'rgba(42, 29, 21, 0.12)';
  c.lineWidth = u * 0.02;
  c.beginPath();
  for (let x = x0; x < x0 + w; x += u * 1.1) {
    c.moveTo(x, above ? y - top - face : y);
    c.lineTo(x, above ? y - face : y + top);
  }
  c.stroke();
}

function road(c: Ctx, L: StreetLayout, x0: number, x1: number, p: Palette): void {
  const u = L.actorH;
  const { y0, y1 } = L.road;
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, ROAD_DARK);
  g.addColorStop(0.15, ROAD);
  g.addColorStop(1, ROAD);
  c.fillStyle = g;
  c.fillRect(x0, y0, x1 - x0, y1 - y0);
  // Speckles of aggregate.
  c.fillStyle = 'rgba(255, 252, 247, 0.12)';
  for (let i = 0; i < (x1 - x0) / (u * 0.25); i++) {
    const x = x0 + hash01(i * 2 + 101) * (x1 - x0);
    const y = y0 + hash01(i * 2 + 102) * (y1 - y0);
    c.fillRect(x, y, u * 0.04, u * 0.04);
  }
  // Patches of newer asphalt.
  c.fillStyle = 'rgba(80, 66, 56, 0.08)';
  for (let i = 0; i < 4; i++) {
    const x = x0 + hash01(i + 300) * (x1 - x0);
    rr(c, x, y0 + (y1 - y0) * (0.25 + hash01(i + 310) * 0.5), u * (0.8 + hash01(i + 320)), u * 0.35, u * 0.08);
    c.fill();
  }
  const mid = (y0 + y1) / 2;
  const cx = L.width / 2;
  const zw = u * 1.5;
  // The zebra crossing in the middle of the street.
  c.fillStyle = 'rgba(255, 252, 247, 0.88)';
  const n = Math.max(4, Math.floor((y1 - y0 - u * 0.3) / (u * 0.3)));
  const bh = (y1 - y0 - u * 0.3) / (n * 2 - 1);
  for (let i = 0; i < n; i++) c.fillRect(cx - zw / 2, y0 + u * 0.15 + i * bh * 2, zw, bh);
  // The dashed centre line (broken around the crossing) and the edge lines.
  c.strokeStyle = 'rgba(255, 252, 247, 0.9)';
  c.lineWidth = u * 0.07;
  c.setLineDash([u * 0.7, u * 0.55]);
  c.beginPath();
  c.moveTo(x0, mid);
  c.lineTo(cx - zw / 2 - u * 0.3, mid);
  c.moveTo(cx + zw / 2 + u * 0.3, mid);
  c.lineTo(x1, mid);
  c.stroke();
  c.setLineDash([]);
  c.strokeStyle = 'rgba(255, 252, 247, 0.5)';
  c.lineWidth = u * 0.04;
  c.beginPath();
  c.moveTo(x0, y0 + u * 0.12);
  c.lineTo(x1, y0 + u * 0.12);
  c.moveTo(x0, y1 - u * 0.12);
  c.lineTo(x1, y1 - u * 0.12);
  c.stroke();
  // Manhole covers.
  for (const fx of [0.18, 0.74]) {
    const x = L.width * fx;
    oval(c, x, mid + (fx < 0.5 ? -1 : 1) * u * 0.55, u * 0.32, u * 0.13, '#8a7c6f');
    oval(c, x, mid + (fx < 0.5 ? -1 : 1) * u * 0.55, u * 0.24, u * 0.09, '#9d8f81');
  }
}

/** In the gaps behind the bottom row: potted plants, a parked motorbike, a drain. */
function alleyBits(c: Ctx, L: StreetLayout, x0: number, x1: number): void {
  const u = L.actorH;
  const bottom = L.shops.filter(s => s.row === 'bottom');
  const y = L.sidewalkBottom.y1;
  // Paving lines.
  c.strokeStyle = 'rgba(122, 88, 60, 0.14)';
  c.lineWidth = u * 0.025;
  c.beginPath();
  for (let yy = y + u * 0.5; yy < y + u * 6; yy += u * 0.5) {
    c.moveTo(x0, yy);
    c.lineTo(x1, yy);
  }
  c.stroke();
  // At the street's ends (landscape) a planter, a bench.
  const first = bottom[0].rect;
  const last = bottom[bottom.length - 1].rect;
  if (first.x > u * 1.2) {
    box(c, first.x - u * 1.2, y + u * 0.5, u * 1.0, u * 0.5, u * 0.08, '#c9a27a', u * 0.03);
    for (let k = 0; k < 3; k++) disc(c, first.x - u * 1.05 + k * u * 0.35, y + u * 0.45, u * 0.22, '#6aa34c', u * 0.03);
  }
  if (L.width - (last.x + last.w) > u * 1.2) {
    // Scooters parked behind the last shop.
    parked(c, last.x + last.w + u * 0.55, y + u * 1.6, u * 0.8, 0.1);
    parked(c, last.x + last.w + u * 1.2, y + u * 1.7, u * 0.8, 0.55);
  }
}

/** Portrait: the verge below the bottom row (a planter wall with bougainvillea, grass, a low railing). */
function verge(c: Ctx, L: StreetLayout, v: Rect, p: Palette): void {
  const u = L.actorH;
  const x0 = v.x - 2;
  const x1 = v.x + v.w + 2;
  const y0 = L.front.y0;
  const yEnd = v.y + v.h + 2;
  // A strip of pavement behind the shops, then the planter wall, then grass to the bottom.
  c.fillStyle = '#e8d2b2';
  c.fillRect(x0, y0, x1 - x0, u * 0.7);
  const wallY = y0 + u * 0.7;
  c.fillStyle = '#b5523e';
  c.fillRect(x0, wallY, x1 - x0, u * 0.55);
  c.strokeStyle = 'rgba(255, 230, 210, 0.35)';
  c.lineWidth = u * 0.025;
  c.beginPath();
  for (let r = 0; r < 2; r++) {
    const yy = wallY + u * 0.18 + r * u * 0.18;
    c.moveTo(x0, yy);
    c.lineTo(x1, yy);
    for (let x = x0 + (r % 2) * u * 0.25; x < x1; x += u * 0.5) {
      c.moveTo(x, yy - u * 0.18);
      c.lineTo(x, yy);
    }
  }
  c.stroke();
  c.fillStyle = '#d97a64';
  c.fillRect(x0, wallY, x1 - x0, u * 0.08);
  // Grass below.
  const gy = wallY + u * 0.55;
  const g = c.createLinearGradient(0, gy, 0, yEnd);
  g.addColorStop(0, '#9cc77a');
  g.addColorStop(1, '#86b866');
  c.fillStyle = g;
  c.fillRect(x0, gy, x1 - x0, yEnd - gy);
  c.fillStyle = 'rgba(62, 106, 39, 0.25)';
  for (let i = 0; i < (x1 - x0) / (u * 0.3); i++) {
    const x = x0 + hash01(i + 500) * (x1 - x0);
    const y = gy + u * 0.2 + hash01(i + 600) * (yEnd - gy - u * 0.3);
    poly(c, [x, y, x + u * 0.04, y - u * 0.14, x + u * 0.08, y]);
    c.fill();
  }
  // Stepping stones along the grass, a bench, two little trees, a lamp, flower beds.
  for (let x = x0 + u * 0.4; x < x1; x += u * 1.1) oval(c, x, gy + u * 1.35, u * 0.32, u * 0.1, 'rgba(236, 214, 184, 0.9)');
  const W = x1 - x0;
  for (const [fx, col] of [[0.4, '#ffd23f'], [0.62, '#f07ab4']] as const) {
    oval(c, x0 + W * fx, gy + u * 0.75, u * 0.6, u * 0.2, '#6aa34c');
    for (let k = 0; k < 7; k++) disc(c, x0 + W * fx - u * 0.45 + k * u * 0.15, gy + u * 0.72 + (k % 2) * u * 0.06, u * 0.06, col);
  }
  bench(c, x0 + W * 0.22, gy + u * 1.25, u);
  for (const fx of [0.07, 0.9]) {
    const tx = x0 + W * fx;
    shadow2(c, tx, gy + u * 1.6, u * 0.45);
    box(c, tx - u * 0.06, gy + u * 0.8, u * 0.12, u * 0.8, u * 0.04, '#8a5a36', u * 0.02);
    crown(c, tx, gy + u * 0.55, u * 0.48, 0, Math.round(tx));
  }
  const lx = x0 + W * 0.76;
  line(c, lx, gy + u * 1.5, lx, gy + u * 0.2, '#5c6b5a', u * 0.06);
  disc(c, lx, gy + u * 0.12, u * 0.12, '#fff3c4', u * 0.03, '#5c6b5a');
  // A scooter parked on the grass by the bench, a bicycle by the lamp.
  parked(c, x0 + W * 0.48, gy + u * 1.75, u * 0.75, 0.2);
  parked(c, x0 + W * 0.56, gy + u * 1.8, u * 0.75, 0.75);
  // Bougainvillea spilling over the wall: magenta clusters on dark green.
  for (let x = x0 - u * 0.2; x < x1; x += u * 0.9) {
    const j = hash01(Math.round(x * 10));
    disc(c, x + u * 0.45, wallY - u * 0.02, u * (0.42 + j * 0.12), '#4f8a3a', u * 0.03);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + j * 3;
      disc(c, x + u * 0.45 + Math.cos(a) * u * 0.28, wallY - u * 0.05 + Math.sin(a) * u * 0.18, u * 0.12,
        k % 2 === 0 ? '#e0569a' : '#f07ab4', u * 0.02, '#a8336d');
    }
  }
}
