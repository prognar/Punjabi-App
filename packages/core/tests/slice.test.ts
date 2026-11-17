import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as E from '../src/engine';
import { MC_EXERCISES, buildQuestion, distractors, fallbackExercise } from '../src/exercises';
import { fromProgressRow, progressFromServer, toEventRow, toProgressRow, uuidIndex } from '../src/sync';
import type { Exercise } from '../src/types';
import { sha1, uuid5 } from '../src/uuid5';
import { model as M, seededRandom } from './fixtures';

describe('uuid5', () => {
  it('sha1 matches node crypto, including multi-block and Gurmukhi input', () => {
    for (const s of ['', 'abc', 'v-cat', 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ 🙂', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000)]) {
      const bytes = [...Buffer.from(s, 'utf8')];
      expect(Buffer.from(sha1(bytes)).toString('hex')).toBe(createHash('sha1').update(s, 'utf8').digest('hex'));
    }
  });
  it('is a stable v5 uuid — these ids are in the live database', () => {
    expect(uuid5('v-cat')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid5('v-cat')).toBe(uuid5('v-cat'));
    expect(uuid5('v-cat')).not.toBe(uuid5('v-cap'));
  });
});

describe('questions', () => {
  const rnd = seededRandom(7);
  it('every card in the course yields a valid question for each multiple-choice exercise', () => {
    for (const id of [...M.order.letter, ...M.order.vocab, ...M.order.phrase]) {
      const it0 = M.items[id];
      const exs: Exercise[] = it0.kind === 'letter' ? ['pick-letter', 'name-letter', 'word-letter'] : ['mc-en2pa', 'mc-pa2en'];
      for (const ex of exs) {
        const q = buildQuestion(M, ex, it0, rnd)!;
        expect(q.choices.length, id).toBe(4);
        expect(q.choices.filter(c => c.id === q.answerId).length).toBe(1);
        expect(new Set(q.choices.map(c => c.label)).size, id + ' ' + ex).toBe(4);
        expect(q.prompt.text.length).toBeGreaterThan(0);
      }
    }
  });
  it('wrong options are plausible: same category for words, same group for phrases', () => {
    const cat = M.items['v-cat'];
    expect(distractors(M, cat, 3, rnd).every(d => d.kind === 'vocab' && d.cat === cat.cat)).toBe(true);
    const p = M.items['p-thank-you'];
    expect(distractors(M, p, 3, rnd).every(d => d.kind === 'phrase' && d.group === p.group)).toBe(true);
  });
  it('letter quizzes never show the Gurmukhi letter name', () => {
    const l = M.items.l6;
    const pick = buildQuestion(M, 'pick-letter', l, rnd)!;
    expect(pick.prompt.text).not.toContain(l.glyph!);
    expect(pick.prompt.speak).toBe(l.name);
    const name = buildQuestion(M, 'name-letter', l, rnd)!;
    expect(name.choices.every(c => !/[਀-੿]/.test(c.label))).toBe(true);
    const word = buildQuestion(M, 'word-letter', l, rnd)!;
    expect(word.prompt.text).not.toMatch(/[਀-੿]/);
  });
  it('unsupported exercises fall back to a multiple-choice one of the right kind', () => {
    for (const ex of ['trace', 'write', 'say', 'listen', 'fill', 'respond', 'tiles-pa2en', 'tiles-en2pa', 'build', 'match'] as Exercise[]) {
      expect(MC_EXERCISES).toContain(fallbackExercise(ex, M.items['v-cat']));
      expect(['pick-letter', 'name-letter']).toContain(fallbackExercise(ex, M.items.l1));
    }
    expect(fallbackExercise('intro', M.items.l1)).toBe('intro');
    expect(buildQuestion(M, 'trace', M.items.l1)).toBeNull();
  });
  it('a whole first session is playable with fallbacks', () => {
    E.setRandom(seededRandom(3));
    const { queue } = E.buildSession(E.emptyProgress(), { settings: E.PROFILE_DEFAULTS.kid }, M);
    E.setRandom();
    expect(queue.length).toBeGreaterThan(5);
    for (const c of queue) {
      const ex = fallbackExercise(c.ex, M.items[c.id]);
      if (ex !== 'intro') expect(buildQuestion(M, ex, M.items[c.id], rnd)).not.toBeNull();
    }
  });
});

describe('progress sync mapping', () => {
  it('round-trips item state through a database row', () => {
    E.setClock(() => Date.parse('2026-11-16T15:00:00Z'));
    const pr = E.emptyProgress();
    E.record(pr, 'v-cat', true, 'mc-en2pa'); E.record(pr, 'v-cat', false, 'mc-pa2en', true); E.record(pr, 'l1', true, 'trace');
    E.setClock();
    for (const id of ['v-cat', 'l1']) {
      const row = toProgressRow('learner-1', id, pr.items[id]);
      expect(row.item_id).toBe(uuid5(id));
      expect(fromProgressRow(row)).toEqual(pr.items[id]);
    }
    const never = toProgressRow('learner-1', 'v-dog', E.st(E.emptyProgress(), 'v-dog'));
    expect([never.due, never.last, never.box_day, never.last_wrong]).toEqual([null, null, null, null]);
  });
  it('rebuilds progress from server rows and skips unknown cards', () => {
    E.setClock(() => Date.parse('2026-11-16T15:00:00Z'));
    const pr = E.emptyProgress();
    E.record(pr, 'v-cat', true, 'mc-en2pa'); E.record(pr, 'v-cat', false, 'mc-pa2en', true);
    E.setClock();
    const rows = [toProgressRow('L', 'v-cat', pr.items['v-cat']), { ...toProgressRow('L', 'v-cat', pr.items['v-cat']), item_id: uuid5('retired-card') }];
    const events = pr.history.map(h => toEventRow('L', h));
    const back = progressFromServer({ ...E.emptyProgress(), unlocked: 4 }, rows, events, [{ day: '2026-11-16', answers: 2, xp: 12 }], uuidIndex(M.order.vocab));
    expect(back.unlocked).toBe(4);
    expect(Object.keys(back.items)).toEqual(['v-cat']);
    expect(back.items['v-cat']).toEqual(pr.items['v-cat']);
    expect(back.history).toEqual(pr.history);
    expect(back.days).toEqual({ '2026-11-16': 2 }); expect(back.xp).toEqual({ '2026-11-16': 12 });
  });
});
