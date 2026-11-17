/* Maps the engine's in-memory progress to database rows (item_progress, events) and back. Pure — no network. */
import type { HistoryEntry, ItemState, Progress } from './types';
import { uuid5 } from './uuid5';

export interface ItemProgressRow {
  learner_id: string; item_id: string;
  box: number; due: string | null; seen: number; right_count: number; wrong_count: number; streak: number;
  days: string[]; last: string | null; intro: boolean; box_day: string | null; gains_today: number; writes: number;
  ever_mastered: boolean; last_wrong: string | null;
}
export interface EventRow {
  learner_id: string; type: 'answer'; item_id: string; exercise: string | null; correct: boolean; is_review: boolean; ms: number | null; at: string;
}

const iso = (ms: number | undefined) => (ms ? new Date(ms).toISOString() : null);
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : 0);

export function toProgressRow(learnerId: string, legacyId: string, s: ItemState): ItemProgressRow {
  return {
    learner_id: learnerId, item_id: uuid5(legacyId),
    box: s.box, due: iso(s.due), seen: s.seen, right_count: s.right, wrong_count: s.wrong, streak: s.streak,
    days: s.days, last: iso(s.last), intro: s.intro, box_day: s.boxDay || null, gains_today: s.gainsToday ?? 0, writes: s.writes,
    ever_mastered: !!s.everMastered, last_wrong: iso(s.lastWrong)
  };
}
export function fromProgressRow(r: ItemProgressRow): ItemState {
  const s: ItemState = {
    box: r.box, seen: r.seen, right: r.right_count, wrong: r.wrong_count, streak: r.streak, last: ms(r.last), due: ms(r.due),
    days: r.days ?? [], intro: r.intro, boxDay: r.box_day ?? '', writes: r.writes, gainsToday: r.gains_today
  };
  if (r.ever_mastered) s.everMastered = true;
  if (r.last_wrong) s.lastWrong = ms(r.last_wrong);
  return s;
}

export function toEventRow(learnerId: string, h: HistoryEntry, tookMs?: number): EventRow {
  return { learner_id: learnerId, type: 'answer', item_id: uuid5(h.id), exercise: h.ex ?? null, correct: h.ok, is_review: h.r, ms: tookMs ?? null, at: new Date(h.t).toISOString() };
}

/** Lookup from database uuid back to legacy id, for every id the app's content knows. */
export function uuidIndex(legacyIds: string[]): Map<string, string> {
  return new Map(legacyIds.map(id => [uuid5(id), id]));
}

/** Rebuild engine progress from server rows (new device / reinstall). Rows for cards this app version doesn't know are skipped. */
export function progressFromServer(
  base: Progress,
  rows: ItemProgressRow[],
  events: Pick<EventRow, 'item_id' | 'exercise' | 'correct' | 'is_review' | 'at'>[],
  days: { day: string; answers: number; xp: number }[],
  index: Map<string, string>
): Progress {
  const pr: Progress = { ...base, items: {}, history: [], days: {}, xp: {} };
  for (const r of rows) { const id = index.get(r.item_id); if (id) pr.items[id] = fromProgressRow(r); }
  pr.history = events
    .map(e => ({ t: Date.parse(e.at), id: index.get(e.item_id) ?? '', ok: e.correct, ex: e.exercise ?? undefined, r: e.is_review }))
    .filter(h => h.id).sort((a, b) => a.t - b.t).slice(-600);
  for (const d of days) { if (d.answers) pr.days[d.day] = d.answers; if (d.xp) pr.xp![d.day] = d.xp; }
  return pr;
}
