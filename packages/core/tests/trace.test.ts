import { describe, expect, it } from 'vitest';
import * as T from '../src/trace';

// Synthetic "letters": the scorer only needs masks, so shapes stand in for font-rendered glyphs.
const line = (ax: number, ay: number, bx: number, by: number, n = 24): T.Stroke =>
  Array.from({ length: n + 1 }, (_, i) => [ax + (bx - ax) * i / n, ay + (by - ay) * i / n] as T.Point);
const circle = (cx: number, cy: number, r: number, n = 48): T.Stroke =>
  Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(2 * Math.PI * i / n), cy + r * Math.sin(2 * Math.PI * i / n)] as T.Point);

const L: T.Stroke[] = [line(0.3, 0.25, 0.3, 0.75), line(0.3, 0.75, 0.7, 0.75)];
const O: T.Stroke[] = [circle(0.5, 0.5, 0.22)];
const X: T.Stroke[] = [line(0.28, 0.28, 0.72, 0.72), line(0.72, 0.28, 0.28, 0.72)];
const glyph = (s: T.Stroke[]) => T.glyphInfo(T.rasterize(s, T.N * 0.08));
const glyphs = { L: glyph(L), O: glyph(O), X: glyph(X) };
const shift = (s: T.Stroke[], dx: number, dy: number, k = 1): T.Stroke[] => s.map(st => st.map(([x, y]) => [0.5 + (x - 0.5) * k + dx, 0.5 + (y - 0.5) * k + dy] as T.Point));

describe('tracing scorer', () => {
  it('no ink never passes', () => {
    expect(T.scoreTrace([], glyphs.L).pass).toBe(false);
    expect(T.scoreTrace([[[0.5, 0.5]]], glyphs.L).pass).toBe(false);
    expect(T.scoreWrite([], 'L', glyphs).pass).toBe(false);
  });
  it('tracing over the letter passes, with a little wobble', () => {
    const r = T.scoreTrace(shift(L, 0.02, -0.015), glyphs.L, true);
    expect(r.pass).toBe(true);
    expect(r.coverage).toBeGreaterThan(0.9);
  });
  it('a small part of the letter fails on coverage; a scribble elsewhere fails on precision', () => {
    const half = T.scoreTrace([line(0.3, 0.25, 0.3, 0.5)], glyphs.L);
    expect(half.pass).toBe(false); expect(half.precision).toBeGreaterThan(0.9); expect(half.coverage).toBeLessThan(0.5);
    const off = T.scoreTrace(shift(L, 0.25, -0.2), glyphs.L);
    expect(off.pass).toBe(false);
  });
  it('adult threshold is stricter than kid', () => {
    expect(T.TRACE_NEED.adult).toBeGreaterThan(T.TRACE_NEED.kid);
    expect(T.WRITE_LIMITS.adult.maxRank).toBeLessThan(T.WRITE_LIMITS.kid.maxRank);
  });
  it('freehand: recognizes the shape wherever and however big it is drawn', () => {
    for (const [name, strokes] of Object.entries({ L, O, X })) {
      const r = T.scoreWrite(shift(strokes, -0.12, 0.1, 0.55), name, glyphs, true);
      expect(r.best).toBe(name);
      expect(r.rank).toBe(0);
      expect(r.pass).toBe(true);
    }
  });
  it('freehand: the wrong shape is far from the target', () => {
    const r = T.scoreWrite(O, 'L', glyphs, true);
    expect(r.best).toBe('O');
    expect(r.dist).toBeGreaterThan(T.WRITE_LIMITS.kid.maxDist);
    expect(r.pass).toBe(false);
  });
  it('maskFromRGBA thresholds dark pixels', () => {
    const px = new Uint8Array(T.N * T.N * 4).fill(255);
    px[0] = 0; px[4] = 159; px[8] = 160;
    const m = T.maskFromRGBA(px);
    expect([m[0], m[1], m[2], m[3]]).toEqual([1, 1, 0, 0]);
  });
});
