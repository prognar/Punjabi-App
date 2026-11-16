export type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'religious_reviewer' | 'voice_talent' | 'teacher';
export type Kind = 'letter' | 'vocab' | 'phrase' | 'sentence' | 'conversation' | 'story_line';
export type Status = 'draft' | 'in_review' | 'changes_requested' | 'approved_text' | 'recording' | 'approved_audio' | 'ready' | 'published' | 'retired';
export type ReviewField = 'pa' | 'en' | 'rom' | 'alts' | 'gender_note' | 'cultural_fit';
export type Verdict = 'ok' | 'change';

export interface Item {
  id: string;
  legacy_id: string | null;
  kind: Kind;
  en: string;
  pa: string;
  rom: string;
  pa_alts: string[];
  rom_alts: string[];
  note: string;
  category: string | null;
  phrase_group: string | null;
  tags: string[];
  source: string;
  data: Record<string, unknown>;
  status: Status;
  version: number;
  updated_at: string;
}
export interface FieldReview {
  id: number;
  item_id: string;
  field: ReviewField;
  reviewer_id: string;
  verdict: Verdict;
  comment: string;
  item_version: number;
  at: string;
}
export interface Lesson { id: string; legacy_n: number | null; title: string; sort_order: number }
export interface LessonQuality {
  lesson_id: string; legacy_n: number | null; title: string; sort_order: number;
  total: number; text_approved: number; ready: number; in_review: number; changes_requested: number;
}
export interface StatusCount { kind: Kind; status: Status; n: number }

export const KINDS: Kind[] = ['letter', 'vocab', 'phrase', 'sentence', 'conversation'];
export const STATUSES: Status[] = ['draft', 'in_review', 'changes_requested', 'approved_text', 'recording', 'approved_audio', 'ready', 'published', 'retired'];
export const KIND_LABEL: Record<Kind, string> = { letter: 'Letter', vocab: 'Word', phrase: 'Phrase', sentence: 'Sentence', conversation: 'Conversation', story_line: 'Story line' };
export const STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft', in_review: 'In review', changes_requested: 'Changes requested', approved_text: 'Text approved', recording: 'Recording',
  approved_audio: 'Audio approved', ready: 'Ready', published: 'Published', retired: 'Retired'
};
