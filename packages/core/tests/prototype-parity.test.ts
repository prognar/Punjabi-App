// Optional: compares this port with the original prototype code over the whole corpus.
// Run with PROTOTYPE_DIR=/path/to/Punjabi-Flash-Cards npm test
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as S from '../src/matcher';
import { model as M } from './fixtures';

const dir = process.env.PROTOTYPE_DIR;
const run = dir && existsSync(join(dir, 'js/speech.js')) ? describe : describe.skip;

run('parity with the prototype', () => {
  let P: any, PM: any;
  beforeAll(() => {
    const window: any = { console: { warn() {} } };
    window.window = window;
    const ctx = vm.createContext(window);
    for (const f of ['data/content.js', 'data/sentences.js', 'data/custom.js', 'js/model.js', 'js/speech.js'])
      vm.runInContext(readFileSync(join(dir!, f), 'utf8'), ctx, { filename: f });
    P = window.SPEECH; PM = window.MODEL;
  });
  const plain = (x: unknown) => JSON.parse(JSON.stringify(x));

  it('model: items, order, lessons, sentences, conversations, categories, groups are identical', () => {
    for (const k of ['items', 'order', 'lessons', 'sentences', 'sentByFocus', 'conversations', 'convByFocus', 'categories', 'groups', 'glossary'] as const)
      expect(plain(M[k]), k).toEqual(plain(PM[k]));
  });
  it('matcher: key, gurToLatin, gurToDeva, anglicize identical for every card', () => {
    const texts = Object.values(M.items).flatMap(it => [it.pa, it.rom, ...it.paAnswers, ...(it.words || []).map(w => w.pa)]);
    for (const t of texts) {
      expect(S.key(t), t).toBe(P.key(t));
      expect(S.gurToLatin(t), t).toBe(P.gurToLatin(t));
      expect(S.gurToDeva(t), t).toBe(P.gurToDeva(t));
      expect(S.anglicize(t), t).toBe(P.anglicize(t));
    }
  });
  it('matcher: scoreHeard identical (each card heard as its neighbours)', () => {
    const ids = [...M.order.vocab, ...M.order.phrase, ...M.order.letter];
    ids.forEach((id, i) => {
      for (const other of [ids[i], ids[(i + 1) % ids.length], ids[(i + 37) % ids.length]])
        for (const heard of [M.items[other].pa, M.items[other].romAnswers[0]])
          expect(S.scoreHeard(heard, M.items[id]), heard + ' vs ' + id).toBe(P.scoreHeard(heard, PM.items[id]));
    });
  });
});
