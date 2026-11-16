import { beforeAll, describe, expect, it } from 'vitest';
import * as E from '../src/engine';
import type { Card, Profile, ProfileType, Progress } from '../src/types';
import { model as M, seededRandom } from './fixtures';

let T = 0;
const fresh = (): Progress => ({ items: {}, unlocked: 1, history: [], days: {} });
const profile = (type: ProfileType): Profile => ({ type, settings: { ...E.PROFILE_DEFAULTS[type] } });

function simulate(rand: () => number, type: ProfileType, accuracy: number, days: number, sessionsPerDay: number) {
  const prof = profile(type);
  const pr = fresh();
  const unlockDays: number[] = [];
  const reviewShares: number[] = [];
  for (let d = 0; d < days; d++) {
    for (let s = 0; s < sessionsPerDay; s++) {
      const { queue, info } = E.buildSession(pr, prof, M, 'all');
      reviewShares.push(info.reviewCount / Math.max(1, queue.length));
      for (let i = 0; i < queue.length; i++) {
        const c: Card = queue[i];
        if (c.ex === 'intro') { E.markIntroduced(pr, c.id); continue; }
        const ok = rand() < accuracy;
        (c.ids || [c.id]).forEach(id => E.record(pr, id, ok, c.ex, c.review, { soft: c.reinforce || c.retry }));
        if (!ok) E.requeueMiss(queue, i, c, M);
        T += 20e3;
      }
      if (E.maybeAdvance(pr, M.lessons)) unlockDays.push(d + 1);
      T += 2 * 3600e3;
    }
    T = new Date(new Date(T).toDateString()).getTime() + 86400e3 + 18 * 3600e3;
  }
  return { pr, unlockDays, avgReview: reviewShares.reduce((a, b) => a + b, 0) / reviewShares.length, skill: E.skill(pr), req: E.masteryRequirement(pr) };
}

describe('seeded learner simulations (30 days, 2 sessions/day)', () => {
  let strong: ReturnType<typeof simulate>, kid: ReturnType<typeof simulate>, weak: ReturnType<typeof simulate>;
  beforeAll(() => {
    const rand = seededRandom();
    E.setRandom(rand);
    E.setClock(() => T);
    T = new Date('2026-10-01T18:00:00').getTime();
    strong = simulate(rand, 'adult', 0.97, 30, 2);
    kid = simulate(rand, 'kid', 0.85, 30, 2);
    weak = simulate(rand, 'kid', 0.68, 30, 2);
  });

  it('reproduces the prototype exactly (same seed, TZ=UTC → same unlock days)', () => {
    expect(strong.pr.unlocked).toBe(11);
    expect(strong.unlockDays).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
    expect(kid.pr.unlocked).toBe(6);
    expect(kid.unlockDays).toEqual([6, 12, 16, 22, 29]);
    expect(weak.pr.unlocked).toBe(3);
    expect(weak.unlockDays).toEqual([8, 21]);
    expect([strong.req.label, kid.req.label, weak.req.label]).toEqual(['strong', 'normal', 'normal']);
    expect([strong, kid, weak].map(x => x.avgReview.toFixed(2))).toEqual(['0.14', '0.14', '0.22']);
  });
  it('strong learner advances faster than average, average faster than struggling', () => {
    expect(strong.pr.unlocked).toBeGreaterThan(kid.pr.unlocked);
    expect(kid.pr.unlocked).toBeGreaterThan(weak.pr.unlocked);
  });
  it('no unlock on day 1 (needs 2 separate days)', () => { expect(strong.unlockDays[0]).toBeGreaterThanOrEqual(2); });
  it('struggling learner still progresses', () => { expect(weak.pr.unlocked).toBeGreaterThan(1); });
  it('struggling learner gets a bigger review share', () => {
    expect(E.buildSession(weak.pr, profile('kid'), M).info.reviewShare).toBeGreaterThan(E.buildSession(strong.pr, profile('adult'), M).info.reviewShare);
  });
  it('struggling learner needs more reps for mastery', () => {
    expect(weak.req.days > strong.req.days || weak.req.box > strong.req.box).toBe(true);
  });
});

describe('engine rules', () => {
  beforeAll(() => { E.setRandom(seededRandom(99)); E.setClock(() => T); });

  it('box: max 2 gains on the first day, 1 per day after; a miss drops it and makes it due', () => {
    T = new Date('2026-11-01T10:00:00').getTime();
    const pr = fresh();
    for (let i = 0; i < 6; i++) E.record(pr, 'l1', true, 'pick-letter');
    expect(pr.items.l1.box).toBe(2);
    T += 86400e3; for (let i = 0; i < 4; i++) E.record(pr, 'l1', true, 'pick-letter');
    expect(pr.items.l1.box).toBe(3);
    E.record(pr, 'l1', false, 'pick-letter');
    expect(pr.items.l1.box).toBe(2);
    expect(pr.items.l1.due).toBeLessThanOrEqual(T);
  });

  it('a miss is re-asked 3–4 cards later with an easier exercise, at most twice', () => {
    const q: Card[] = [{ id: 'l1', ex: 'trace' }, { id: 'l2', ex: 'trace' }, { id: 'v-age', ex: 'say' }, { id: 'v-arm', ex: 'say' }, { id: 'v-air', ex: 'say' }];
    expect(E.requeueMiss(q, 0, q[0], M)).toBe(true);
    const idx = q.findIndex((c, i) => i > 0 && c.id === 'l1');
    expect(idx).toBeGreaterThanOrEqual(3);
    expect(q[idx].ex).toBe('pick-letter');
    expect(E.requeueMiss(q, idx, q[idx], M)).toBe(true);
    const again = q.findIndex((c, i) => i > idx && c.id === 'l1');
    expect(E.requeueMiss(q, again, q[again], M)).toBe(false);
  });

  it('first session introduces letters, words and phrases', () => {
    const s0 = E.buildSession(fresh(), profile('kid'), M, 'all');
    const kinds = new Set(s0.queue.filter(c => c.ex === 'intro').map(c => M.items[c.id].kind));
    expect(kinds.size).toBe(3);
  });

  it('weekly unlock opens one lesson per 7 days', () => {
    T = new Date('2026-11-01T10:00:00').getTime();
    const pr = fresh();
    expect(E.weeklyUnlock(pr, profile('kid'), M.lessons)).toBe(0);
    T += 15 * E.DAY;
    expect(E.weeklyUnlock(pr, profile('kid'), M.lessons)).toBe(2);
    expect(pr.unlocked).toBe(3);
  });

  it('placement seeds earlier lessons and sets the starting lesson', () => {
    const pr = fresh();
    E.applyPlacement(pr, M, { lesson: 5, lettersKnown: true, rightIds: ['v-age'], wrongIds: [], score: 0.8 });
    expect(pr.unlocked).toBe(5);
    expect(pr.items['v-age'].box).toBe(2);
    expect(pr.items.l35.box).toBe(2);
    expect(E.knownCounts(pr, M).vocab).toBe(80);
    expect(pr.items[M.lessons[4].vocab[0]]).toBeUndefined();
  });

  it('category practice only uses that category', () => {
    const pr = fresh();
    const { queue } = E.buildSession(pr, profile('adult'), M, 'cat:colors');
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every(c => M.items[c.id].cat === 'colors')).toBe(true);
  });
});
