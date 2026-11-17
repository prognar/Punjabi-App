/* Local-first persistence: progress lives on the device; changes queue in an outbox and are pushed to Supabase when possible. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { engine as E, progressFromServer, toEventRow, toProgressRow, type EventRow, type HistoryEntry, type ItemProgressRow, type Progress } from '@punjabi-app/core';
import { itemIndex } from './content';
import { supabase } from './supabase';

export interface Learner {
  id: string; account_id: string; name: string; avatar: string; type: 'kid' | 'adult';
  settings: Record<string, unknown>; unlocked: number; unlocked_at: string | null;
}
interface Outbox { ids: string[]; events: EventRow[] }

const kProgress = (id: string) => `progress:${id}`;
const kOutbox = (id: string) => `outbox:${id}`;
const readJson = async <T,>(key: string): Promise<T | null> => { try { const s = await AsyncStorage.getItem(key); return s ? (JSON.parse(s) as T) : null; } catch { return null; } };

export async function saveLocal(learnerId: string, pr: Progress) { await AsyncStorage.setItem(kProgress(learnerId), JSON.stringify(pr)); }

/** Progress for a learner: from this device if present, otherwise rebuilt from the server (new phone / reinstall). */
export async function loadProgress(l: Learner): Promise<Progress> {
  const local = await readJson<Progress>(kProgress(l.id));
  if (local) return { ...E.emptyProgress(), ...local };
  const base: Progress = { ...E.emptyProgress(), unlocked: l.unlocked || 1, unlockedAt: l.unlocked_at ? Date.parse(l.unlocked_at) : undefined };
  try {
    const [rows, events, days] = await Promise.all([
      supabase.from('item_progress').select('*').eq('learner_id', l.id),
      supabase.from('events').select('item_id, exercise, correct, is_review, at').eq('learner_id', l.id).eq('type', 'answer').order('at', { ascending: false }).limit(600),
      supabase.from('learner_days').select('day, answers, xp').eq('learner_id', l.id)
    ]);
    if (rows.error || events.error || days.error) return base;
    const pr = progressFromServer(base, (rows.data ?? []) as ItemProgressRow[], (events.data ?? []) as EventRow[], days.data ?? [], itemIndex());
    await saveLocal(l.id, pr);
    return pr;
  } catch { return base; }
}

/** Save locally, queue what changed, then try to push. Never throws: an offline session is kept and sent later. */
export async function commit(l: Learner, pr: Progress, changedIds: string[], answers: { h: HistoryEntry; ms?: number }[]): Promise<boolean> {
  await saveLocal(l.id, pr);
  const box = (await readJson<Outbox>(kOutbox(l.id))) ?? { ids: [], events: [] };
  box.ids = [...new Set([...box.ids, ...changedIds])];
  box.events = box.events.concat(answers.map(a => toEventRow(l.id, a.h, a.ms)));
  await AsyncStorage.setItem(kOutbox(l.id), JSON.stringify(box));
  return push(l, pr);
}

export async function push(l: Learner, pr: Progress): Promise<boolean> {
  const box = await readJson<Outbox>(kOutbox(l.id));
  try {
    if (box && (box.ids.length || box.events.length)) {
      const rows = box.ids.filter(id => pr.items[id]).map(id => toProgressRow(l.id, id, pr.items[id]));
      if (rows.length) { const r = await supabase.from('item_progress').upsert(rows, { onConflict: 'learner_id,item_id' }); if (r.error) return false; }
      if (box.events.length) { const r = await supabase.from('events').insert(box.events); if (r.error) return false; }
      await AsyncStorage.removeItem(kOutbox(l.id));
    }
    const days = [...new Set([...Object.keys(pr.days), ...Object.keys(pr.xp ?? {})])].sort().slice(-7)
      .map(day => ({ learner_id: l.id, day, answers: pr.days[day] ?? 0, xp: pr.xp?.[day] ?? 0 }));
    if (days.length) { const r = await supabase.from('learner_days').upsert(days, { onConflict: 'learner_id,day' }); if (r.error) return false; }
    const r = await supabase.from('learners').update({ unlocked: pr.unlocked, unlocked_at: pr.unlockedAt ? new Date(pr.unlockedAt).toISOString() : null }).eq('id', l.id);
    return !r.error;
  } catch { return false; }
}

export async function ensureAccount(uid: string) {
  const { data } = await supabase.from('accounts').select('id').eq('id', uid).maybeSingle();
  if (!data) await supabase.from('accounts').insert({ id: uid });
}
export async function fetchLearners(uid: string): Promise<Learner[]> {
  const { data, error } = await supabase.from('learners').select('id, account_id, name, avatar, type, settings, unlocked, unlocked_at').eq('account_id', uid).order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as Learner[];
}
export async function createLearner(uid: string, name: string, type: 'kid' | 'adult', avatar: string): Promise<Learner> {
  const { data, error } = await supabase.from('learners').insert({ account_id: uid, name, type, avatar })
    .select('id, account_id, name, avatar, type, settings, unlocked, unlocked_at').single();
  if (error) throw new Error(error.message);
  return data as Learner;
}
