// ---------------------------------------------------------------- raw content (seed / content-pack shape)
export type LetterWordRow = [pa: string, rom: string, en: string, emoji: string];
export type LetterRow = [glyph: string, name: string, nameRom: string, sound: string, words: LetterWordRow[]];

export interface RowOptions {
  alt?: string[];
  note?: string;
  src?: string;
  check?: string;
  group?: string;
  cat?: string;
  verified?: boolean;
  edited?: boolean;
  hidden?: boolean;
  speakAs?: string;
  audio?: string;
  rate?: number;
  voice?: string;
}
export type Row = [en: string, pa: string, rom: string, opt?: RowOptions];

export interface Content {
  perLesson: { vocab: number; phrases: number; lettersPattern: number[] };
  categories?: [key: string, name: string, emoji: string][];
  vocabCats?: Record<string, string>;
  letters: LetterRow[];
  vocab: Row[];
  phrases: Row[];
}

export interface SentenceTemplate { id: string; pa: string; rom: string; gloss: string; en: string; cls: string[] }
export type SentenceRow = [pa: string, rom: string, gloss: string, en: string, focus: string, blank: number, wrong?: string[]];
export type ConversationRow = [
  pPa: string, pRom: string, pEn: string, rPa: string, rRom: string, rEn: string,
  focus: string[], wrong?: [pa: string, rom: string, en: string][]
];
export interface SentencesData {
  glossary?: Record<string, string>;
  classes: Record<string, string[]>;
  templates: SentenceTemplate[];
  sentences: SentenceRow[];
  conversations?: ConversationRow[];
}

export interface CustomPatch extends RowOptions { en?: string; pa?: string; rom?: string; sound?: string }
export interface CustomAdded extends CustomPatch { id: string; kind: 'vocab' | 'phrase'; en: string; pa: string; rom: string; after?: string }
export interface Custom { version?: number; items?: Record<string, CustomPatch>; added?: CustomAdded[] }

// ---------------------------------------------------------------- model
export type Kind = 'letter' | 'vocab' | 'phrase';

export interface Item {
  id: string;
  kind: Kind;
  en: string;
  pa: string;
  rom: string;
  paAnswers: string[];
  romAnswers: string[];
  src: string;
  edited: boolean;
  lesson?: number;
  // letters
  index?: number;
  glyph?: string;
  name?: string;
  sound?: string;
  words?: { pa: string; rom: string; en: string; emoji: string }[];
  // words & phrases
  origEn?: string;
  note?: string;
  check?: string;
  group?: string;
  verified?: boolean;
  cat?: string | null;
  cls?: string;
  hidden?: boolean;
  added?: boolean;
  base?: { en: string; pa: string; rom: string; opt: RowOptions };
  // pronunciation overrides
  speakAs?: string;
  audio?: string;
  rate?: number;
  voice?: string;
}

export interface Lesson { n: number; letter: string[]; vocab: string[]; phrase: string[] }

export interface Sentence {
  id: string;
  pa: string[];
  rom: string[];
  gloss: string[];
  en: string;
  focus: string;
  blank: number;
  wrong: string[];
  template?: string;
  src: string;
}
export interface Line { pa: string; rom: string; en: string }
export interface Conversation { id: string; prompt: Line; reply: Line; focus: string[]; wrong: Line[] }
export interface ItemSet { key: string; name: string; emoji: string; ids: string[] }

export interface Model {
  items: Record<string, Item>;
  order: Record<Kind, string[]>;
  lessons: Lesson[];
  categories: ItemSet[];
  groups: ItemSet[];
  sentences: Sentence[];
  sentByFocus: Record<string, Sentence[]>;
  conversations: Conversation[];
  convByFocus: Record<string, Conversation[]>;
  glossary: Record<string, string>;
  custom: Custom;
  /** Sentence / conversation refs that did not resolve to an item (content bugs to fix in the Studio). */
  unresolved: string[];
}

// ---------------------------------------------------------------- learner state
export type Exercise =
  | 'intro' | 'pick-letter' | 'name-letter' | 'word-letter' | 'trace' | 'write'
  | 'mc-en2pa' | 'mc-pa2en' | 'listen' | 'fill' | 'respond' | 'tiles-pa2en' | 'tiles-en2pa' | 'say' | 'build' | 'match';

export interface ItemState {
  box: number;
  seen: number;
  right: number;
  wrong: number;
  streak: number;
  last: number;
  due: number;
  days: string[];
  intro: boolean;
  boxDay: string;
  writes: number;
  gainsToday?: number;
  everMastered?: boolean;
  lastWrong?: number;
}
export interface HistoryEntry { t: number; id: string; ok: boolean; ex?: string; r: boolean }

export interface Progress {
  items: Record<string, ItemState>;
  unlocked: number;
  history: HistoryEntry[];
  days: Record<string, number>;
  streakDays?: number;
  xp?: Record<string, number>;
  unlockedAt?: number;
  placement?: { lesson: number; lettersKnown: boolean; score?: number; at: number };
}

export type ProfileType = 'kid' | 'adult';
export interface Settings {
  sessionSize: number;
  maxNew: number;
  autoNext: number;
  weekly: boolean;
  dailyGoal: number;
  showGurmukhi: boolean;
  showRoman: boolean;
  speech: boolean;
  writing: boolean;
}
export interface Profile { id?: string; name?: string; avatar?: string; type: ProfileType; created?: number; settings: Settings }

export interface Card {
  id: string;
  ex: Exercise;
  review?: boolean;
  ids?: string[];
  reinforce?: boolean;
  retry?: boolean;
  retries?: number;
}
