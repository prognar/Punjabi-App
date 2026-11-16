/*
 * Letter tracing / freehand writing scorer. Pure TypeScript — no canvas.
 * Ported from the prototype's js/trace.js. The prototype rasterized ink and the letter with a browser canvas;
 * here ink is rasterized in code and the platform supplies the letter mask (render the glyph black-on-white
 * at N×N with Skia and pass the pixels to maskFromRGBA, or ship precomputed masks in the content pack).
 *
 *   trace: coverage  = how much of the letter was drawn over
 *          precision = how much of the ink stayed on the letter
 *   write: the drawing is rescaled to each candidate letter's bounding box and compared with every letter;
 *          it passes when the target is among the closest matches and close enough in absolute terms.
 */
export const N = 128; // scoring grid

/** Normalized point 0..1 within the drawing pad. */
export type Point = [x: number, y: number];
export type Stroke = Point[];
export type Mask = Uint8Array; // N*N, 1 = inked

/** Ink width as a fraction of the pad, matching the prototype. */
export const INK_WIDTH = { trace: 0.065, write: 0.05 } as const;
/** Glyph placement used by the prototype (font size and baseline as fractions of the pad). */
export const GLYPH_LAYOUT = { fontSize: 0.66, centerX: 0.5, centerY: 0.56 } as const;
/** Pass thresholds. strict = adult. */
export const TRACE_NEED = { kid: 0.55, adult: 0.6 } as const;
export const WRITE_LIMITS = { kid: { maxRank: 3, maxDist: 2.1 }, adult: { maxRank: 2, maxDist: 1.9 } } as const;

export const hasInk = (strokes: Stroke[]): boolean => strokes.some(s => s.length > 1);

/** Rasterize strokes as round-capped thick lines. `width` is in grid cells. */
export function rasterize(strokes: Stroke[], width: number, map?: (x: number, y: number) => Point): Mask {
  const m = new Uint8Array(N * N);
  const r = width / 2, r2 = r * r;
  const seg = (ax: number, ay: number, bx: number, by: number) => {
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r)), x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx) + r));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r)), y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by) + r));
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - ax, py = y + 0.5 - ay;
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const ex = px - t * dx, ey = py - t * dy;
      if (ex * ex + ey * ey <= r2) m[y * N + x] = 1;
    }
  };
  strokes.forEach(s => {
    if (!s.length) return;
    const pts = s.map(([x, y]) => { const p = map ? map(x, y) : [x, y]; return [p[0] * N, p[1] * N]; });
    if (pts.length === 1) { seg(pts[0][0], pts[0][1], pts[0][0], pts[0][1]); return; }
    for (let i = 1; i < pts.length; i++) seg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  });
  return m;
}

/** Mask from N×N RGBA pixels of a dark glyph on a white background (same threshold as the prototype). */
export function maskFromRGBA(rgba: ArrayLike<number>): Mask {
  if (rgba.length < N * N * 4) throw new Error(`expected ${N}x${N} RGBA pixels`);
  const m = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) m[i] = rgba[i * 4] < 160 ? 1 : 0;
  return m;
}

export function dilate(m: Mask, r: number): Mask {
  const out = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!m[y * N + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < N && Y < N) out[Y * N + X] = 1;
    }
  }
  return out;
}

export interface Box { x0: number; y0: number; x1: number; y1: number }
export function bbox(m: Mask): Box | null {
  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (m[y * N + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0: x0 / N, y0: y0 / N, x1: (x1 + 1) / N, y1: (y1 + 1) / N };
}
/** Share of a's cells that are also set in b. */
export function overlap(a: Mask, b: Mask): number { let n = 0, k = 0; for (let i = 0; i < a.length; i++) if (a[i]) { n++; if (b[i]) k++; } return n ? k / n : 0; }

/** Distance (in grid cells) from every cell to the nearest inked cell — two-pass chamfer transform. */
export function distMap(m: Mask): Float32Array {
  const INF = 1e6, d = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) d[i] = m[i] ? 0 : INF;
  const rel = (i: number, j: number, w: number) => { if (d[j] + w < d[i]) d[i] = d[j] + w; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (x > 0) rel(i, i - 1, 1);
    if (y > 0) { rel(i, i - N, 1); if (x > 0) rel(i, i - N - 1, 1.414); if (x < N - 1) rel(i, i - N + 1, 1.414); }
  }
  for (let y = N - 1; y >= 0; y--) for (let x = N - 1; x >= 0; x--) {
    const i = y * N + x;
    if (x < N - 1) rel(i, i + 1, 1);
    if (y < N - 1) { rel(i, i + N, 1); if (x < N - 1) rel(i, i + N + 1, 1.414); if (x > 0) rel(i, i + N - 1, 1.414); }
  }
  return d;
}
function meanDist(A: Mask, dB: Float32Array): number { let s = 0, n = 0; for (let i = 0; i < A.length; i++) if (A[i]) { s += Math.min(dB[i], 40); n++; } return n ? s / n : 40; }

export interface GlyphInfo { m: Mask; d: Float32Array; b: Box | null }
/** Precompute what the scorer needs for one letter. Cache the result per glyph. */
export function glyphInfo(mask: Mask): GlyphInfo { return { m: mask, d: distMap(mask), b: bbox(mask) }; }

/** How far apart the drawing and a letter are after fitting the drawing into the letter's box (lower = closer). */
export function shapeDistance(strokes: Stroke[], G: GlyphInfo): number {
  const raw = rasterize(strokes, N * INK_WIDTH.write);
  const bu = bbox(raw), bg = G.b;
  if (!bu || !bg) return 99;
  const s = Math.min((bg.x1 - bg.x0) / Math.max(bu.x1 - bu.x0, 0.05), (bg.y1 - bg.y0) / Math.max(bu.y1 - bu.y0, 0.05));
  const cux = (bu.x0 + bu.x1) / 2, cuy = (bu.y0 + bu.y1) / 2, cgx = (bg.x0 + bg.x1) / 2, cgy = (bg.y0 + bg.y1) / 2;
  const U = rasterize(strokes, N * INK_WIDTH.write, (px, py) => [cgx + (px - cux) * s, cgy + (py - cuy) * s]);
  return (meanDist(U, G.d) + meanDist(G.m, distMap(U))) / 2;
}

export interface TraceScore { pass: boolean; coverage: number; precision: number; score: number }
/** Tracing over the guide letter. strict = adult. */
export function scoreTrace(strokes: Stroke[], G: GlyphInfo, strict = false): TraceScore {
  if (!hasInk(strokes)) return { pass: false, coverage: 0, precision: 0, score: 0 };
  const U = rasterize(strokes, N * INK_WIDTH.trace);
  const coverage = overlap(G.m, dilate(U, 8));
  const precision = overlap(U, dilate(G.m, 8));
  const need = strict ? TRACE_NEED.adult : TRACE_NEED.kid;
  return { coverage, precision, score: Math.min(coverage, precision), pass: coverage >= need && precision >= need };
}

export interface WriteScore { pass: boolean; rank: number; dist: number; best: string; score: number }
/** Writing from memory: `glyphs` holds every candidate letter (including the target), keyed by glyph. strict = adult. */
export function scoreWrite(strokes: Stroke[], target: string, glyphs: Record<string, GlyphInfo>, strict = false): WriteScore {
  if (!hasInk(strokes) || !glyphs[target]) return { pass: false, rank: -1, dist: 99, best: '', score: 0 };
  const ranked = Object.keys(glyphs).map(g => [g, shapeDistance(strokes, glyphs[g])] as [string, number]).sort((a, b) => a[1] - b[1]);
  const rank = ranked.findIndex(r => r[0] === target);
  const dist = ranked[rank][1];
  const lim = strict ? WRITE_LIMITS.adult : WRITE_LIMITS.kid;
  return { rank, dist, best: ranked[0][0], score: 1 / (1 + dist), pass: rank <= lim.maxRank && dist <= lim.maxDist };
}
