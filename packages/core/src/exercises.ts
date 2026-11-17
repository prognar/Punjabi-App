/*
 * Turns a session card into something a screen can render. Platform-independent, so every app asks the same questions.
 * Rules carried over from the prototype: wrong options come from the same category / group (plausible),
 * and letter quizzes never show the Gurmukhi letter name (it contains the letter) — romanized name + audio instead.
 */
import type { Exercise, Item, Model } from './types';

export interface Choice { id: string; label: string; sub?: string; gurmukhi: boolean }
export interface Question {
  ex: Exercise;
  instruction: string;
  prompt: { text: string; sub?: string; emoji?: string; gurmukhi: boolean; speak?: string };
  choices: Choice[];
  answerId: string;
}

/** Exercises that are multiple choice (what the first mobile slice can play). */
export const MC_EXERCISES: Exercise[] = ['mc-en2pa', 'mc-pa2en', 'pick-letter', 'name-letter', 'word-letter'];

/** Nearest multiple-choice exercise for one that a client can't play yet (tracing, speech, tiles…). */
export function fallbackExercise(ex: Exercise, item: Item, supported: Exercise[] = MC_EXERCISES): Exercise {
  if (ex === 'intro' || supported.includes(ex)) return ex;
  if (item.kind === 'letter') return ex === 'write' ? 'name-letter' : 'pick-letter';
  return ex === 'listen' || ex === 'tiles-pa2en' || ex === 'respond' || ex === 'match' ? 'mc-pa2en' : 'mc-en2pa';
}

const shuffle = <T>(a: T[], rnd: () => number): T[] => {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};
const same = (a: Item, b: Item) => a.pa === b.pa || a.en.toLowerCase() === b.en.toLowerCase() || a.paAnswers.some(p => b.paAnswers.includes(p));

/**
 * n wrong options for an item: same kind, nearest first — same category / phrase group, then cards from lessons the
 * learner has reached, then anything. Never a card with the same Gurmukhi or English as the answer.
 */
export function distractors(model: Pick<Model, 'items' | 'order'>, item: Item, n = 3, rnd: () => number = Math.random): Item[] {
  const all = model.order[item.kind].map(id => model.items[id]).filter(x => x.id !== item.id && !same(x, item));
  const reached = (x: Item) => (x.lesson ?? 0) <= (item.lesson ?? 0);
  const near = (x: Item) => (item.kind === 'vocab' ? x.cat === item.cat : item.kind === 'phrase' ? (x.group || '') === (item.group || '') : Math.abs((x.index ?? 0) - (item.index ?? 0)) <= 7);
  const tiers = [all.filter(x => near(x) && reached(x)), all.filter(x => near(x) && !reached(x)), all.filter(x => !near(x) && reached(x)), all.filter(x => !near(x) && !reached(x))];
  const out: Item[] = [];
  for (const tier of tiers) {
    for (const x of shuffle(tier, rnd)) {
      if (out.length >= n) return out;
      if (!out.some(o => same(o, x))) out.push(x);
    }
  }
  return out;
}

const plainEn = (it: Item) => it.en;
const firstPa = (it: Item) => it.paAnswers[0] ?? it.pa;
const firstRom = (it: Item) => it.romAnswers[0] ?? it.rom;
const letterName = (it: Item) => it.rom.replace(/\s*\(.*?\)/, '');

/** Build a multiple-choice question for a card. Returns null for exercises that are not multiple choice. */
export function buildQuestion(model: Pick<Model, 'items' | 'order'>, ex: Exercise, item: Item, rnd: () => number = Math.random): Question | null {
  const wrong = distractors(model, item, 3, rnd);
  const mix = (toChoice: (it: Item) => Choice) => shuffle([item, ...wrong].map(toChoice), rnd);
  switch (ex) {
    case 'mc-en2pa':
      return { ex, instruction: 'Choose the Punjabi', prompt: { text: plainEn(item), gurmukhi: false }, answerId: item.id,
        choices: mix(it => ({ id: it.id, label: firstPa(it), sub: firstRom(it), gurmukhi: true })) };
    case 'mc-pa2en':
      return { ex, instruction: 'What does this mean?', prompt: { text: firstPa(item), sub: firstRom(item), gurmukhi: true, speak: firstPa(item) }, answerId: item.id,
        choices: mix(it => ({ id: it.id, label: plainEn(it), gurmukhi: false })) };
    case 'pick-letter':
      return { ex, instruction: 'Find the letter', prompt: { text: letterName(item), sub: item.sound ? 'sounds like ' + item.sound : undefined, gurmukhi: false, speak: item.name }, answerId: item.id,
        choices: mix(it => ({ id: it.id, label: it.glyph ?? it.pa, gurmukhi: true })) };
    case 'name-letter':
      return { ex, instruction: 'Which letter is this?', prompt: { text: item.glyph ?? item.pa, gurmukhi: true, speak: item.name }, answerId: item.id,
        choices: mix(it => ({ id: it.id, label: letterName(it), gurmukhi: false })) };
    case 'word-letter': {
      const words = item.words ?? [];
      if (!words.length) return buildQuestion(model, 'pick-letter', item, rnd);
      const w = words[Math.floor(rnd() * words.length)];
      return { ex, instruction: 'Which letter does it start with?', prompt: { text: w.en, sub: w.rom, emoji: w.emoji, gurmukhi: false, speak: w.pa }, answerId: item.id,
        choices: mix(it => ({ id: it.id, label: it.glyph ?? it.pa, gurmukhi: true })) };
    }
    default:
      return null;
  }
}
