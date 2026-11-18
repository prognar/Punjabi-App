import type { FieldReview, Item, ReviewField, Role } from '../types';

export const FIELDS: { key: ReviewField; label: string; hint: string }[] = [
  { key: 'pa', label: 'Gurmukhi', hint: 'Spelling is correct' },
  { key: 'en', label: 'English', hint: 'Meaning is right' },
  { key: 'rom', label: 'Sounds-like', hint: 'Romanization reads correctly' },
  { key: 'alts', label: 'Alternatives', hint: 'Accepted answers are right (or none needed)' },
  { key: 'gender_note', label: 'Gender / register', hint: 'Gender and respectful forms are right (or not applicable)' },
  { key: 'cultural_fit', label: 'Cultural fit', hint: 'Natural and appropriate' }
];

export type Latest = Partial<Record<ReviewField, FieldReview>>;

/** Latest verdict per field at the item's current version (older versions don't count). */
export function latestByField(reviews: FieldReview[], item: Pick<Item, 'id' | 'version'>): Latest {
  const out: Latest = {};
  for (const r of reviews) {
    if (r.item_id !== item.id || r.item_version !== item.version) continue;
    const cur = out[r.field];
    if (!cur || r.at > cur.at || (r.at === cur.at && r.id > cur.id)) out[r.field] = r;
  }
  return out;
}
/** Fields that still need an ✓. */
export const fieldsToApprove = (latest: Latest): ReviewField[] => FIELDS.map(f => f.key).filter(k => latest[k]?.verdict !== 'ok');

export const needsReligiousReview = (item: Pick<Item, 'tags'>) => item.tags.some(t => t === 'gurbani' || t === 'gurdwara');

export const canEdit = (roles: Role[]) => roles.some(r => r === 'owner' || r === 'admin' || r === 'editor');
export const canReview = (roles: Role[]) => roles.some(r => r === 'owner' || r === 'admin' || r === 'reviewer' || r === 'religious_reviewer');
export const isAdmin = (roles: Role[]) => roles.some(r => r === 'owner' || r === 'admin');

/** PostgREST `or` filter for a free-text search over English, Gurmukhi and the legacy id. */
export function searchFilter(q: string): string | null {
  const s = q.trim().replace(/[,()"\\%*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return ['en', 'pa', 'rom', 'legacy_id'].map(c => `${c}.ilike.%${s}%`).join(',');
}
export const canRecord = (roles: Role[]) => roles.some(r => r === 'owner' || r === 'admin' || r === 'voice_talent');
export const RECORDABLE = ['approved_text', 'recording', 'approved_audio', 'ready', 'published'] as const;
