// Draw lists for the street's characters: the parts that never change for a look and a view (head, hair, hat, torso,
// pack, a face at an expression) are drawn once into a recorder that keeps each fill or stroke as a Path2D with its
// style, then replayed every frame as a handful of `fill(path)` / `stroke(path)` calls (building paths call by call was
// most of a character's cost). A "pen" remembers the styles set on the live context during one figure, so a colour or
// width already set is not set again.

type Ctx = CanvasRenderingContext2D;

export interface DrawOp {
  path: Path2D;
  stroke: boolean;
  style: string;
  width: number;
  cap: CanvasLineCap;
}

export type Recording = readonly DrawOp[];

/** Path2D exists (browsers); not in node tests unless a test provides one. */
export const canRecord = (): boolean => typeof Path2D === 'function';

/**
 * Stands in for a canvas context while a part is drawn once: path calls build a Path2D, each fill or stroke keeps it
 * with the style of the moment. Only what the character parts use is supported (no transforms, no clipping).
 */
export class Recorder {
  readonly ops: DrawOp[] = [];
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  lineCap: CanvasLineCap = 'round';
  lineJoin: CanvasLineJoin = 'round';
  private p: Path2D = new Path2D();
  /** The current path was kept by a fill or stroke: adding to it starts a copy. */
  private kept = false;

  private path(): Path2D {
    if (this.kept) {
      this.p = new Path2D(this.p);
      this.kept = false;
    }
    return this.p;
  }

  beginPath(): void {
    this.p = new Path2D();
    this.kept = false;
  }

  moveTo(x: number, y: number): void { this.path().moveTo(x, y); }
  lineTo(x: number, y: number): void { this.path().lineTo(x, y); }
  closePath(): void { this.path().closePath(); }
  rect(x: number, y: number, w: number, h: number): void { this.path().rect(x, y, w, h); }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void { this.path().arc(x, y, r, a0, a1, ccw); }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void { this.path().arcTo(x1, y1, x2, y2, r); }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean): void {
    this.path().ellipse(x, y, rx, ry, rot, a0, a1, ccw);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void { this.path().quadraticCurveTo(cx, cy, x, y); }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.path().bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
  }

  fill(): void {
    this.ops.push({ path: this.p, stroke: false, style: this.fillStyle, width: 0, cap: this.lineCap });
    this.kept = true;
  }

  stroke(): void {
    this.ops.push({ path: this.p, stroke: true, style: this.strokeStyle, width: this.lineWidth, cap: this.lineCap });
    this.kept = true;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const q = new Path2D();
    q.rect(x, y, w, h);
    this.ops.push({ path: q, stroke: false, style: this.fillStyle, width: 0, cap: this.lineCap });
  }
}

/** Draws `paint` into a fresh recorder and returns its list. */
export function record(paint: (ctx: Ctx) => void): Recording {
  const r = new Recorder();
  paint(r as unknown as Ctx);
  return r.ops;
}

// ── The pen: styles already set on the live context during this figure ───────────────────────────────────────────

let live: Ctx | null = null;
let penFill = '';
let penStroke = '';
let penWidth = -1;
let penCap = '';

/** Starts a figure on `ctx`: forget what was set (other renderers may have changed it), set the round joins once. */
export function penStart(ctx: Ctx): void {
  live = ctx;
  penFill = '';
  penStroke = '';
  penWidth = -1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  penCap = 'round';
}

/** After drawing straight on the live context without the pen (no Path2D here): forget what the pen knew. */
export function penForget(): void {
  penFill = '';
  penStroke = '';
  penWidth = -1;
  penCap = '';
}

/** Ends the figure: whatever sets the context next does so directly. */
export function penEnd(): void {
  live = null;
}

export function setFill(ctx: Ctx, c: string): void {
  if (ctx !== live) {
    ctx.fillStyle = c;
  } else if (c !== penFill) {
    ctx.fillStyle = c;
    penFill = c;
  }
}

/** Stroke colour, width and cap (round unless said otherwise). */
export function setStroke(ctx: Ctx, c: string, w: number, cap: CanvasLineCap = 'round'): void {
  if (ctx !== live) {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.lineCap = cap;
    return;
  }
  if (c !== penStroke) {
    ctx.strokeStyle = c;
    penStroke = c;
  }
  if (w !== penWidth) {
    ctx.lineWidth = w;
    penWidth = w;
  }
  if (cap !== penCap) {
    ctx.lineCap = cap;
    penCap = cap;
  }
}

/** Replays a list on the live context (in its current transform). */
export function replay(ctx: Ctx, ops: Recording): void {
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.stroke) {
      setStroke(ctx, o.style, o.width, o.cap);
      ctx.stroke(o.path);
    } else {
      setFill(ctx, o.style);
      ctx.fill(o.path);
    }
  }
}

/** Recordings under two number keys (no strings per frame). Past `max` it starts over. */
export class RecordingCache {
  private readonly map = new Map<number, Map<number, Recording>>();
  private n = 0;

  constructor(private readonly max: number) {}

  get(a: number, b: number): Recording | undefined {
    return this.map.get(a)?.get(b);
  }

  put(a: number, b: number, ops: Recording): Recording {
    if (this.n >= this.max) {
      this.map.clear();
      this.n = 0;
    }
    let inner = this.map.get(a);
    if (inner === undefined) {
      inner = new Map();
      this.map.set(a, inner);
    }
    inner.set(b, ops);
    this.n++;
    return ops;
  }

  get size(): number { return this.n; }
}
