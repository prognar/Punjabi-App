/*
 * Learning engine: per-item progress, spaced review, mastery gate, session builder, placement seeding, XP.
 * Pure logic — no storage, no UI. Ported 1:1 from the prototype's js/engine.js (same order of random draws,
 * so seeded simulations match the prototype exactly).
 */
import type { Card, Exercise, Item, ItemState, Lesson, Model, Profile, ProfileType, Progress, Settings } from './types';

export const DAY = 864e5, HOUR = 36e5;
/** Spacing after a correct answer, by box (0..6) */
export const INTERVALS = [0, 8 * HOUR, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];
export const MAX_BOX = 6;

let clock: () => number = () => Date.now();
let random: () => number = () => Math.random();
const now = () => clock();
const rnd = () => random();
/** Tests / simulations: fix the time and the random source. Pass nothing to reset. */
export function setClock(fn?: () => number) { clock = fn || (() => Date.now()); }
export function setRandom(fn?: () => number) { random = fn || (() => Math.random()); }

export const dayKey = (ts: number): string => {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

export const PROFILE_DEFAULTS: Record<ProfileType, Settings> = {
  kid:   { sessionSize: 12, maxNew: 5, autoNext: 0, weekly: true, dailyGoal: 100, showGurmukhi: true, showRoman: true, speech: true, writing: true },
  adult: { sessionSize: 20, maxNew: 8, autoNext: 0, weekly: true, dailyGoal: 150, showGurmukhi: true, showRoman: true, speech: true, writing: true }
};

export function emptyProgress(): Progress {
  return { items: {}, unlocked: 1, history: [], days: {}, streakDays: 0, xp: {} };
}

// ---------------------------------------------------------------- item state
export function st(pr: Progress, id: string): ItemState {
  return pr.items[id] || (pr.items[id] = { box: 0, seen: 0, right: 0, wrong: 0, streak: 0, last: 0, due: 0, days: [], intro: false, boxDay: '', writes: 0 });
}
export const peek = (pr: Progress, id: string): ItemState | null => pr.items[id] || null;

// XP: a simple, always-moving measure of effort (daily goal)
export const XP = { right: 10, wrong: 2, intro: 5 };
function addXp(pr: Progress, n: number) { pr.xp = pr.xp || {}; const k = dayKey(now()); pr.xp[k] = (pr.xp[k] || 0) + n; }
export const xpToday = (pr: Progress): number => (pr.xp || {})[dayKey(now())] || 0;
export function xpDays(pr: Progress, n = 7): { day: string; xp: number }[] {
  const out: { day: string; xp: number }[] = []; const d = new Date(now());
  for (let i = n - 1; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - i); const k = dayKey(x.getTime()); out.push({ day: k, xp: (pr.xp || {})[k] || 0 }); }
  return out;
}
/** Cards answered right at least once (words / phrases / letters) */
export function knownCounts(pr: Progress, model: Pick<Model, 'order'>) {
  const c = { letter: 0, vocab: 0, phrase: 0 };
  KINDS.forEach(k => model.order[k].forEach(id => { const s = pr.items[id]; if (s && s.right > 0) c[k]++; }));
  return c;
}

export function markIntroduced(pr: Progress, id: string) {
  const s = st(pr, id); if (!s.intro) addXp(pr, XP.intro); s.intro = true; s.last = now(); s.due = now();
}

/** Record an answer. Box can climb at most one step per calendar day (two on the first day),
 *  so "mastered" always means remembered across separate days. */
export function record(pr: Progress, id: string, ok: boolean, ex?: string, isReview?: boolean, opts: { soft?: boolean } = {}): ItemState {
  const s = st(pr, id), t = now(), today = dayKey(t);
  s.intro = true; s.seen++; s.last = t;
  if (ok) {
    s.right++; s.streak++;
    const firstDay = !s.days.length || (s.days.length === 1 && s.days[0] === today);
    if (s.boxDay !== today) s.gainsToday = 0;
    const allowed = firstDay ? 2 : 1;
    if ((s.gainsToday || 0) < allowed && s.box < MAX_BOX) { s.box++; s.gainsToday = (s.gainsToday || 0) + 1; s.boxDay = today; }
    if (!s.days.includes(today)) { s.days.push(today); if (s.days.length > 8) s.days.shift(); }
    s.due = t + INTERVALS[s.box];
    if (ex === 'trace' || ex === 'write') s.writes++;
    if (!s.everMastered && isMastered(pr, id)) s.everMastered = true; // counts toward unlocking even if it slips later
  } else {
    s.wrong++; s.streak = 0;
    // a slip on a repeat card within the same session (reinforcement / retry) costs less than a fresh miss
    s.box = opts.soft ? Math.max(Math.min(s.box, 1), s.box - 1) : (s.box >= 4 ? 2 : Math.max(0, s.box - 1));
    s.due = t; s.lastWrong = t;
  }
  addXp(pr, ok ? XP.right : XP.wrong);
  pr.history.push({ t, id, ok: !!ok, ex, r: !!isReview });
  if (pr.history.length > 600) pr.history.splice(0, pr.history.length - 600);
  const dk = dayKey(t);
  pr.days[dk] = (pr.days[dk] || 0) + 1;
  return s;
}

// ---------------------------------------------------------------- skill + mastery
export type SkillLevel = 'strong' | 'normal' | 'struggling';
export interface MasteryRequirement { box: number; days: number; label: string }

/** Rolling accuracy over the last N graded answers. */
export function skill(pr: Progress, n = 40): { acc: number; n: number; level: SkillLevel } {
  const h = pr.history.filter(x => x.ex !== 'intro').slice(-n);
  if (h.length < 8) return { acc: 0.8, n: h.length, level: 'normal' };
  const acc = h.filter(x => x.ok).length / h.length;
  return { acc, n: h.length, level: acc >= 0.9 ? 'strong' : acc < 0.7 ? 'struggling' : 'normal' };
}
export function reviewAccuracy(pr: Progress, n = 20): number | null {
  const h = pr.history.filter(x => x.r).slice(-n);
  return h.length ? h.filter(x => x.ok).length / h.length : null;
}
/** What "mastered" means right now for this learner: better learners need fewer repetitions. */
export function masteryRequirement(pr: Progress): MasteryRequirement {
  const { level } = skill(pr);
  if (level === 'strong') return { box: 2, days: 2, label: 'strong' };
  if (level === 'struggling') return { box: 3, days: 3, label: 'extra practice' };
  return { box: 3, days: 2, label: 'normal' };
}
export function isMastered(pr: Progress, id: string, req?: MasteryRequirement): boolean {
  const s = peek(pr, id); if (!s) return false;
  req = req || masteryRequirement(pr);
  return s.box >= req.box && s.days.length >= req.days;
}
export function itemStatus(pr: Progress, id: string, req?: MasteryRequirement, forGate?: boolean): 'new' | 'mastered' | 'learning' {
  const s = peek(pr, id);
  if (!s || !s.intro) return 'new';
  return isMastered(pr, id, req) || (forGate && s.everMastered) ? 'mastered' : 'learning';
}

// ---------------------------------------------------------------- lessons
export const KINDS = ['letter', 'vocab', 'phrase'] as const;
export interface KindStats { total: number; mastered: number; learning: number; fresh: number }
export interface LessonStats extends KindStats {
  kinds: Record<(typeof KINDS)[number], KindStats>;
  pct: number;
  progress: number;
  lockTomorrow: number;
}

export function lessonStats(pr: Progress, L: Lesson): LessonStats {
  const req = masteryRequirement(pr);
  const out = { total: 0, mastered: 0, learning: 0, fresh: 0, kinds: {} } as LessonStats;
  KINDS.forEach(k => {
    const ks: KindStats = { total: L[k].length, mastered: 0, learning: 0, fresh: 0 };
    L[k].forEach(id => { const s = itemStatus(pr, id, req, true); ks[s === 'new' ? 'fresh' : s]++; });
    out.kinds[k] = ks;
    out.total += ks.total; out.mastered += ks.mastered; out.learning += ks.learning; out.fresh += ks.fresh;
  });
  out.pct = out.total ? out.mastered / out.total : 1;
  // partial credit so every correct answer visibly moves the bar (levels + separate days, up to the requirement)
  const today = dayKey(now());
  let pts = 0, lockTomorrow = 0;
  KINDS.forEach(k => L[k].forEach(id => {
    const s = peek(pr, id);
    if (!s || !s.intro) return;
    if (itemStatus(pr, id, req, true) === 'mastered') { pts += 1; return; }
    pts += (Math.min(s.box, req.box) + Math.min(s.days.length, req.days)) / (req.box + req.days);
    if (s.days.includes(today) && s.box >= 2) lockTomorrow++; // learned today; needs another day to count as mastered
  }));
  out.progress = out.total ? pts / out.total : 1;
  out.lockTomorrow = lockTomorrow;
  return out;
}

export const GATE = { overall: 0.8, perKind: 0.6, review: 0.6 };
export type GateStatus =
  | { ok: false; done: true }
  | { ok: boolean; done?: undefined; pct: number; kindsOk: boolean; reviewOk: boolean; reviewAcc: number | null; stats: LessonStats; last: boolean };

export function gateStatus(pr: Progress, lessons: Lesson[]): GateStatus {
  const L = lessons[pr.unlocked - 1];
  if (!L) return { ok: false, done: true };
  const s = lessonStats(pr, L);
  const kindsOk = KINDS.every(k => !s.kinds[k].total || s.kinds[k].mastered / s.kinds[k].total >= GATE.perKind);
  const ra = reviewAccuracy(pr);
  const reviewOk = pr.unlocked === 1 || ra === null || ra >= GATE.review;
  return { ok: s.pct >= GATE.overall && kindsOk && reviewOk, pct: s.pct, kindsOk, reviewOk, reviewAcc: ra, stats: s, last: pr.unlocked >= lessons.length };
}
/** Learner chooses to move on before the gate is met — unmastered cards stay in review. */
export function forceAdvance(pr: Progress, lessons: Lesson[]): boolean {
  if (pr.unlocked < lessons.length) { pr.unlocked++; pr.unlockedAt = now(); return true; }
  return false;
}
export function maybeAdvance(pr: Progress, lessons: Lesson[]): boolean {
  const g = gateStatus(pr, lessons);
  if (g.ok && pr.unlocked < lessons.length) { pr.unlocked++; pr.unlockedAt = now(); return true; }
  return false;
}
/** Follow a weekly class: a new lesson opens every 7 days even if the last one isn't mastered yet. */
export function weeklyUnlock(pr: Progress, profile: Pick<Profile, 'settings'> | null | undefined, lessons: Lesson[]): number {
  if (!profile || !profile.settings || profile.settings.weekly === false) return 0;
  if (!pr.unlockedAt) { pr.unlockedAt = now(); return 0; }
  let n = 0;
  while (pr.unlocked < lessons.length && now() - pr.unlockedAt >= 7 * DAY) { pr.unlocked++; pr.unlockedAt += 7 * DAY; n++; }
  return n;
}

export interface PlacementResult { lesson: number; lettersKnown?: boolean; rightIds?: string[]; wrongIds?: string[]; score?: number }
/**
 * Placement test result → starting point.
 * Cards in lessons before `lesson` are treated as already seen (reviewed over the next week);
 * cards answered right in the test start a step further; letters marked known if the letter part was passed.
 */
export function applyPlacement(pr: Progress, model: Pick<Model, 'lessons' | 'order'>, { lesson, lettersKnown, rightIds = [], wrongIds = [], score }: PlacementResult) {
  const t = now(), today = dayKey(t);
  const seed = (id: string, box: number) => {
    const s = st(pr, id);
    if (s.box >= box) return;
    s.intro = true; s.box = box; s.boxDay = ''; s.gainsToday = 0; s.right = Math.max(s.right || 0, 1); // counts as known
    if (!s.days.includes(today)) s.days.push(today);
    s.last = t; s.due = t + (1 + Math.floor(rnd() * 6)) * DAY; // spread the first reviews over the week
  };
  model.lessons.slice(0, lesson - 1).forEach(L => (['vocab', 'phrase'] as const).forEach(k => L[k].forEach(id => seed(id, 2))));
  if (lettersKnown) model.order.letter.forEach(id => { seed(id, 2); st(pr, id).writes = Math.max(st(pr, id).writes || 0, 2); });
  rightIds.forEach(id => { seed(id, 2); const s = st(pr, id); s.right = (s.right || 0) + 1; });
  wrongIds.forEach(id => { const s = pr.items[id]; if (s && s.box > 1) { s.box = 1; s.due = t; } });
  pr.unlocked = Math.max(1, Math.min(model.lessons.length, lesson));
  pr.unlockedAt = t;
  pr.placement = { lesson: pr.unlocked, lettersKnown: !!lettersKnown, score, at: t };
}

// ---------------------------------------------------------------- exercises
function multiWord(item: Item) { return item.paAnswers[0].replace(/[?,.!]/g, '').trim().split(/\s+/).length >= 2; }

export interface ChooseOptions { salt?: number; sent?: boolean; conv?: boolean; not?: Exercise }
type ExerciseState = Pick<ItemState, 'intro' | 'box' | 'seen' | 'writes'>;

export function chooseExercise(item: Item, s: ExerciseState | null | undefined, profile: Pick<Profile, 'settings'>, opts: ChooseOptions = {}): Exercise {
  const set: Partial<Settings> = profile.settings || {};
  if (!s || !s.intro) return 'intro';
  const b = s.box, flip = (s.seen + (opts.salt || 0)) % 2 === 0;
  if (item.kind === 'letter') {
    const words = item.words || [];
    if (b <= 0) return flip ? 'pick-letter' : 'name-letter';
    if (set.writing !== false && s.writes < 2) return 'trace';
    if (b === 1) return flip ? 'pick-letter' : 'name-letter';
    if (b === 2) return words.length && flip ? 'word-letter' : (set.writing !== false ? 'trace' : 'pick-letter');
    if (set.writing !== false && flip) return 'write';
    return words.length ? 'word-letter' : 'name-letter';
  }
  // words & phrases: mix of recognition, sentences in context, conversation replies and producing it
  const sent = !!opts.sent, conv = !!opts.conv;
  let pool: Exercise[];
  if (b <= 0) pool = (['mc-en2pa', 'mc-en2pa'] as Exercise[]).concat(sent ? ['fill'] : []);
  else if (b === 1) pool = (['mc-pa2en', 'listen'] as Exercise[]).concat(sent ? ['fill', 'fill'] : ['mc-en2pa'], conv ? ['respond'] : []);
  else if (b === 2) pool = (['listen', 'mc-pa2en'] as Exercise[]).concat(sent ? ['tiles-pa2en', 'fill', 'tiles-pa2en'] : ['say'], conv ? ['respond', 'respond'] : []);
  else pool = (['say'] as Exercise[]).concat(sent ? ['tiles-en2pa', 'tiles-en2pa', 'tiles-pa2en'] : ['mc-pa2en'], conv ? ['respond', 'respond'] : [],
    item.kind === 'phrase' && multiWord(item) ? ['build'] : []);
  if (opts.not) { const f = pool.filter(x => x !== opts.not); if (f.length) pool = f; }
  return pool[Math.floor(rnd() * pool.length)];
}
/** Easier exercise used when re-asking a missed item later in the same session. */
export function retryExercise(item: Item): Exercise { return item.kind === 'letter' ? 'pick-letter' : 'mc-en2pa'; }

// ---------------------------------------------------------------- sessions
export function reviewShareFor(acc: number) { return acc < 0.7 ? 0.6 : acc > 0.9 ? 0.25 : 0.4; }

export interface SessionInfo {
  size: number; acc: number; reviewShare: number; newCount: number; reviewCount: number; currentCount: number; lesson: number; req: MasteryRequirement;
}
/** 'all' | 'letter' | 'vocab' | 'phrase' | 'review' | 'cat:<key>' | 'grp:<key>' */
export type SessionScope = string;

/** Build a practice queue. */
export function buildSession(pr: Progress, profile: Pick<Profile, 'settings'>, model: Model, scope: SessionScope = 'all'): { queue: Card[]; info: SessionInfo } {
  const set = profile.settings;
  const kinds: readonly (typeof KINDS)[number][] = (KINDS as readonly string[]).includes(scope) ? [scope as (typeof KINDS)[number]] : KINDS;
  const t = now();
  const { acc } = skill(pr);
  const req = masteryRequirement(pr);
  const size = set.sessionSize || 12;
  const cur = model.lessons[pr.unlocked - 1] || model.lessons[model.lessons.length - 1];
  // category / phrase-group practice: any card in that set, regardless of lesson
  const catSet = /^(cat|grp):/.test(scope) ? ((scope.startsWith('cat:') ? model.categories : model.groups) || []).find(c => c.key === scope.slice(4)) : null;
  const curIds = catSet ? catSet.ids.slice() : kinds.flatMap(k => cur[k]);
  const prevIds = catSet ? [] : model.lessons.slice(0, pr.unlocked - 1).flatMap(L => kinds.flatMap(k => L[k]));

  // --- review candidates: anything introduced from earlier lessons (+ current lesson items in review mode)
  const reviewPoolIds = scope === 'review' ? prevIds.concat(curIds) : prevIds;
  const scoreReview = (id: string): number => {
    const s = peek(pr, id); if (!s || !s.intro) return -1;
    const overdue = (t - s.due) / Math.max(INTERVALS[s.box] || HOUR, HOUR); // >0 means due
    const mastered = isMastered(pr, id, req);
    const recentMiss = s.lastWrong && t - s.lastWrong < 3 * DAY ? 1.5 : 0;
    return (overdue > 0 ? 2 + Math.min(overdue, 3) : overdue) + (mastered ? 0 : 1.5) + recentMiss + (MAX_BOX - s.box) * 0.15 + rnd() * 0.3;
  };
  const reviewRanked = reviewPoolIds.map(id => [id, scoreReview(id)] as [string, number]).filter(x => x[1] > -1).sort((a, b) => b[1] - a[1]);

  let reviewIds: string[], currentIds: string[] = [], newIds: string[] = [];
  if (scope === 'review') {
    reviewIds = reviewRanked.filter(x => x[1] > 0.5).slice(0, size).map(x => x[0]);
  } else {
    // --- new items for this lesson (in teaching order); fewer when struggling or many still shaky
    // "shaky" = introduced but not yet answered well (box < 2). Cards waiting only for another day don't block new ones.
    const shaky = curIds.filter(id => { const s = peek(pr, id); return s && s.intro && s.box < 2 && !isMastered(pr, id, req); }).length;
    let maxNew = set.maxNew || 4;
    if (acc < 0.7) maxNew = Math.max(1, Math.floor(maxNew / 2));
    if (shaky >= 6) maxNew = Math.min(maxNew, 1);
    // earlier lessons first (catch-up after jumping ahead), then this lesson, in teaching order
    // (round-robin across letters / words / phrases so one session touches each section)
    const fresh = prevIds.concat(curIds).filter(id => !(peek(pr, id) || ({} as Partial<ItemState>)).intro);
    const byKind = kinds.map(k => fresh.filter(id => model.items[id].kind === k));
    for (let r = 0; newIds.length < maxNew && byKind.some(a => a.length); r++) {
      byKind.forEach(a => { if (a.length && newIds.length < maxNew) newIds.push(a.shift()!); });
    }
    // --- items of current lesson already introduced: weakest / most due first
    currentIds = curIds.filter(id => (peek(pr, id) || ({} as Partial<ItemState>)).intro)
      .map(id => { const s = peek(pr, id)!; return [id, (isMastered(pr, id, req) ? 0 : 3) + (t >= s.due ? 2 : 0) + (MAX_BOX - s.box) * 0.3 + rnd() * 0.4] as [string, number]; })
      .sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const reviewTarget = reviewRanked.length ? Math.round(size * reviewShareFor(acc)) : 0;
    const currentSlots = Math.max(0, size - reviewTarget - newIds.length * 2); // each new item = intro + quiz
    currentIds = currentIds.slice(0, currentSlots);
    const reviewSlots = size - newIds.length * 2 - currentIds.length;
    reviewIds = reviewRanked.slice(0, Math.max(0, reviewSlots)).map(x => x[0]);
    // if review ran short, top up with more current practice
    const left = size - newIds.length * 2 - currentIds.length - reviewIds.length;
    if (left > 0) {
      const extra = curIds.filter(id => (peek(pr, id) || ({} as Partial<ItemState>)).intro && !currentIds.includes(id)).slice(0, left);
      currentIds = currentIds.concat(extra);
    }
  }

  // --- assemble: interleave review between current items, new item quiz 2–3 cards after its intro
  const availFor = (id: string) => ({ sent: !!(model.sentByFocus && model.sentByFocus[id]), conv: !!(model.convByFocus && model.convByFocus[id]) });
  const exFor = (id: string, s: ExerciseState | null, not?: Exercise) =>
    chooseExercise(model.items[id], s, profile, Object.assign({ salt: Math.floor(rnd() * 2), not }, availFor(id)));
  const mk = (id: string, review: boolean): Card => ({ id, ex: exFor(id, peek(pr, id)), review });
  const main: Card[] = [];
  const cq = currentIds.map(id => mk(id, false));
  const rq = reviewIds.map(id => mk(id, true));
  while (cq.length || rq.length) {
    if (cq.length) main.push(cq.shift()!);
    if (rq.length) main.push(rq.shift()!);
    if (rq.length && rq.length > cq.length) main.push(rq.shift()!);
  }
  let queue: Card[] = [];
  if (newIds.length) {
    // spread intros across the session; each followed by its first quiz a couple of cards later
    const gap = Math.max(2, Math.floor(main.length / (newIds.length + 1)));
    let mi = 0;
    newIds.forEach(id => {
      queue.push({ id, ex: 'intro', review: false });
      const before = main.slice(mi, mi + Math.min(2, gap)); mi += before.length;
      queue = queue.concat(before);
      queue.push({ id, ex: model.items[id].kind === 'letter' ? chooseExercise(model.items[id], { intro: true, box: 0, seen: 0, writes: 0 }, profile) : 'mc-en2pa', review: false });
      const after = main.slice(mi, mi + Math.max(0, gap - 2)); mi += after.length;
      queue = queue.concat(after);
    });
    queue = queue.concat(main.slice(mi));
  } else queue = main;

  // --- reinforcement: words being learned come back again later in the session, in a different kind of exercise
  if (scope !== 'review') {
    const focus = newIds.concat(currentIds);
    const extra = Math.max(2, Math.round(size * 0.5));
    focus.slice(0, extra).forEach(id => {
      const it = model.items[id];
      const lastIdx = queue.map(c => c.id).lastIndexOf(id);
      if (lastIdx < 0) return;
      const prev = queue[lastIdx].ex;
      const s: ExerciseState = Object.assign({ intro: true, box: 0, seen: 0, writes: 99 }, peek(pr, id) || {});
      if (newIds.includes(id)) s.box = 1; // second look at a brand-new word: one step harder than the first quiz
      s.writes = 99; // don't stack two tracing cards
      const ex: Exercise = it.kind === 'letter' ? (prev === 'pick-letter' ? 'name-letter' : 'pick-letter') : exFor(id, s, prev);
      const at = Math.min(queue.length, lastIdx + 4 + Math.floor(rnd() * 3));
      queue.splice(at, 0, { id, ex, review: false, reinforce: true });
    });
    // --- one "match the pairs" round with words/phrases already met
    const pairPool = queue.filter(c => model.items[c.id].kind !== 'letter').map(c => c.id)
      .filter((id, i, a) => a.indexOf(id) === i && model.items[id].en.length <= 28);
    const known = pairPool.filter(id => (peek(pr, id) || ({} as Partial<ItemState>)).intro || newIds.includes(id));
    if (known.length >= 4) {
      const ids = known.slice(0, 5);
      // place it after the last intro of those words
      const after = Math.max(...ids.map(id => queue.findIndex(c => c.id === id && c.ex !== 'intro')));
      queue.splice(Math.min(queue.length, Math.max(after + 1, Math.floor(queue.length * 0.6))), 0, { id: ids[0], ids, ex: 'match', review: false });
    }
  }

  return {
    queue,
    info: { size, acc, reviewShare: reviewShareFor(acc), newCount: newIds.length, reviewCount: reviewIds.length, currentCount: currentIds.length, lesson: cur.n, req }
  };
}

/** After a miss, re-insert the item 3–4 cards later (max twice per session). */
export function requeueMiss(queue: Card[], pos: number, card: Card, model: Pick<Model, 'items'>): boolean {
  card.retries = (card.retries || 0) + 1;
  if (card.retries > 2) return false;
  const at = Math.min(queue.length, pos + 3 + Math.floor(rnd() * 2));
  queue.splice(at, 0, { id: card.id, ex: retryExercise(model.items[card.id]), review: card.review, retries: card.retries, retry: true });
  return true;
}

export function touchStreak(pr: Progress): { streak: number; totalDays: number } {
  const days = Object.keys(pr.days).sort();
  let streak = 0; const d = new Date(now());
  for (;;) {
    const k = dayKey(d.getTime());
    if (pr.days[k]) { streak++; d.setDate(d.getDate() - 1); } else break;
  }
  pr.streakDays = streak;
  return { streak, totalDays: days.length };
}

// ---------------------------------------------------------------- prototype backups
export interface LegacyBackup { app: 'punjabi-lessons'; version: number; exported?: string; profiles: { profile: Profile; progress: Progress }[] }
/** Validate a backup exported by the web prototype (Settings → Backup) so family progress can be migrated. */
export function parseLegacyBackup(data: unknown): LegacyBackup {
  const d = data as LegacyBackup | null;
  if (!d || d.app !== 'punjabi-lessons' || !Array.isArray(d.profiles)) throw new Error('Not a Punjabi Lessons backup file');
  d.profiles.forEach(p => { p.progress = Object.assign(emptyProgress(), p.progress || {}); });
  return d;
}
