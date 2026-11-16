import { describe, expect, it } from 'vitest';
import type { FieldReview } from '../types';
import { canEdit, canReview, fieldsToApprove, latestByField, needsReligiousReview, searchFilter } from './review';

const r = (id: number, field: FieldReview['field'], verdict: FieldReview['verdict'], item_version = 2, at = '2026-11-16T10:00:0' + id): FieldReview =>
  ({ id, item_id: 'a', field, reviewer_id: 'u', verdict, comment: '', item_version, at });

describe('review helpers', () => {
  const item = { id: 'a', version: 2 };
  it('uses the latest verdict per field at the current version only', () => {
    const latest = latestByField([r(1, 'pa', 'change'), r(2, 'pa', 'ok'), r(3, 'en', 'ok', 1), r(4, 'rom', 'ok'), r(5, 'rom', 'change'), { ...r(6, 'en', 'ok'), item_id: 'b' }], item);
    expect(latest.pa?.verdict).toBe('ok');
    expect(latest.rom?.verdict).toBe('change');
    expect(latest.en).toBeUndefined();
    expect(fieldsToApprove(latest)).toEqual(['en', 'rom', 'alts', 'gender_note', 'cultural_fit']);
  });
  it('nothing reviewed → all six fields', () => { expect(fieldsToApprove({})).toHaveLength(6); });
  it('gurdwara / gurbani tags need a religious reviewer', () => {
    expect(needsReligiousReview({ tags: ['gurdwara'] })).toBe(true);
    expect(needsReligiousReview({ tags: ['food'] })).toBe(false);
  });
  it('roles', () => {
    expect(canEdit(['reviewer'])).toBe(false); expect(canEdit(['editor'])).toBe(true);
    expect(canReview(['voice_talent'])).toBe(false); expect(canReview(['religious_reviewer'])).toBe(true); expect(canReview(['owner'])).toBe(true);
  });
  it('search filter strips characters that would break the filter syntax', () => {
    expect(searchFilter('  ')).toBeNull();
    expect(searchFilter('thank you')).toBe('en.ilike.%thank you%,pa.ilike.%thank you%,rom.ilike.%thank you%,legacy_id.ilike.%thank you%');
    expect(searchFilter('a,b)(c%')).toBe('en.ilike.%a b c%,pa.ilike.%a b c%,rom.ilike.%a b c%,legacy_id.ilike.%a b c%');
    expect(searchFilter('ਪਾਣੀ')).toContain('pa.ilike.%ਪਾਣੀ%');
  });
});
