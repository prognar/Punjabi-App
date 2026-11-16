/* Turns raw content (letters, words, phrases, sentences) into items + weekly lessons. Pure; no I/O. */
import type {
  Content, Conversation, Custom, CustomPatch, Item, ItemSet, Kind, Lesson, Model, Row, RowOptions, Sentence, SentencesData
} from './types';

/** Prototype item-id slug. These ids become `legacy_id` in the database — never change this function. */
export const slug = (s: string): string =>
  s.toLowerCase().replace(/\(.*?\)/g, m => m.replace(/[^a-z]/g, '')).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const splitAlts = (s: string) => s.split(/\s+\/\s+/).map(x => x.trim()).filter(Boolean);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const toks = (s: string) => s.split(/\s+/).map(t => t.replace(/_/g, ' '));
const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const PRON = ['speakAs', 'audio', 'rate', 'voice'] as const;

const EMPTY_SENTENCES: SentencesData = { sentences: [], conversations: [], templates: [], classes: {}, glossary: {} };

export function buildModel(C: Content, SB: SentencesData = EMPTY_SENTENCES, CU: Custom = {}): Model {
  const items: Record<string, Item> = {};
  const order: Record<Kind, string[]> = { letter: [], vocab: [], phrase: [] };
  const patches: Record<string, CustomPatch> = CU.items || {};
  const unresolved: string[] = [];

  const applyPron = (it: Item, src: RowOptions) => {
    PRON.forEach(k => { const v = src[k]; if (v != null && v !== '') (it as unknown as Record<string, unknown>)[k] = v; });
  };

  C.letters.forEach(([glyph, name, nameRom, sound, words], i) => {
    const id = 'l' + (i + 1);
    const pt = patches[id] || {};
    const rom = pt.rom || nameRom;
    items[id] = {
      id, kind: 'letter', index: i,
      glyph, pa: glyph, paAnswers: [glyph, name], name, rom, romAnswers: splitAlts(rom.replace(/\(.*?\)/g, '')),
      en: 'letter ' + rom.replace(/\s*\(.*?\)/, ''), sound: pt.sound || sound,
      words: words.map(([pa, rom, en, emoji]) => ({ pa, rom, en, emoji })),
      src: 'teacher', edited: !!patches[id]
    };
    applyPron(items[id], pt);
    order.letter.push(id);
  });

  function makeItem(id: string, kind: Kind, en: string, pa: string, rom: string, opt: RowOptions, origEn?: string): Item {
    const paAnswers = splitAlts(pa).concat(opt.alt || []);
    const it: Item = {
      id, kind, en, origEn: origEn || en, pa, rom, paAnswers, romAnswers: splitAlts(rom),
      note: opt.note || '', check: opt.check || '', src: opt.src || 'teacher', group: opt.group || '',
      verified: !!opt.verified, edited: !!opt.edited,
      cat: kind === 'vocab' ? (opt.cat || (C.vocabCats || {})[(origEn || en).toLowerCase()] || 'other') : null
    };
    applyPron(it, opt);
    return it;
  }

  function addRows(rows: Row[], kind: 'vocab' | 'phrase', prefix: string) {
    const seen: Record<string, number> = {};
    const list: Item[] = [];
    rows.forEach(([en, pa, rom, opt = {}]) => {
      let id = prefix + slug(en);
      if (seen[id]) id += '-' + (++seen[id]); else seen[id] = 1;
      const pt = patches[id];
      const o: RowOptions = Object.assign({}, opt, pt || {}, pt ? { edited: true } : {});
      const it = makeItem(id, kind, (pt && pt.en) || en, (pt && pt.pa) || pa, (pt && pt.rom) || rom, o, en);
      it.base = { en, pa, rom, opt };
      if (pt && pt.hidden) { it.hidden = true; items[id] = it; return; } // kept for the Studio, left out of lessons
      list.push(it);
    });
    // admin-added cards: placed after a given card, or after the last teacher/admin card (ahead of generated filler)
    (CU.added || []).filter(a => a.kind === kind).forEach(a => {
      const pt = Object.assign({}, a, patches[a.id] || {});
      const it = makeItem(a.id, kind, pt.en, pt.pa, pt.rom, Object.assign({ src: 'admin', edited: true }, pt));
      it.added = true;
      if (pt.hidden) { it.hidden = true; items[it.id] = it; return; }
      let at = a.after ? list.findIndex(x => x.id === a.after) + 1 : 0;
      if (!a.after || at === 0) { let last = -1; list.forEach((x, i) => { if (x.src !== 'generated') last = i; }); at = last + 1; }
      list.splice(at, 0, it);
    });
    list.forEach(it => { items[it.id] = it; order[kind].push(it.id); });
  }
  addRows(C.vocab, 'vocab', 'v-');
  addRows(C.phrases, 'phrase', 'p-');

  // Weekly lessons: letters follow perLesson.lettersPattern (2,3,2,3…), then fixed vocab / phrase counts.
  const lessons: Lesson[] = [];
  const pat = C.perLesson.lettersPattern;
  let li = 0, vi = 0, pi = 0, n = 0;
  while (li < order.letter.length || vi < order.vocab.length || pi < order.phrase.length) {
    const nl = pat[n % pat.length];
    lessons.push({
      n: n + 1,
      letter: order.letter.slice(li, li + nl),
      vocab: order.vocab.slice(vi, vi + C.perLesson.vocab),
      phrase: order.phrase.slice(pi, pi + C.perLesson.phrases)
    });
    li += nl; vi += C.perLesson.vocab; pi += C.perLesson.phrases; n++;
  }
  lessons.forEach(L => (['letter', 'vocab', 'phrase'] as const).forEach(k => L[k].forEach(id => { items[id].lesson = L.n; })));

  // ---------------------------------------------------------------- sentences & conversations
  function resolve(ref: string): string | null {
    const [k, ...rest] = ref.split(':'); const en = norm(rest.join(':'));
    const kind: Kind = k === 'v' ? 'vocab' : 'phrase';
    const id = order[kind].find(i => norm(items[i].origEn!) === en || norm(items[i].en) === en) || order[kind].find(i => norm(items[i].origEn!).startsWith(en));
    if (!id) unresolved.push(ref);
    return id || null;
  }
  const sentences: Sentence[] = [], sentByFocus: Record<string, Sentence[]> = {};
  const addSentence = (sn: Omit<Sentence, 'focus'> & { focus: string | null }) => {
    if (!sn.focus) return;
    const s = sn as Sentence;
    sentences.push(s); (sentByFocus[s.focus] = sentByFocus[s.focus] || []).push(s);
  };

  SB.sentences.forEach(([pa, rom, gloss, en, focus, blank, wrong], i) => {
    const P = toks(pa), R = toks(rom), G = gloss.split('|');
    addSentence({ id: 's' + i, pa: P, rom: R.length === P.length ? R : P.map(() => ''), gloss: G, en, focus: resolve(focus), blank, wrong: wrong || [], src: 'generated' });
  });
  const clsOf: Record<string, string> = {};
  Object.entries(SB.classes).forEach(([cls, words]) => words.forEach(w => {
    const id = order.vocab.find(i => norm(items[i].origEn!.replace(/\s*\(.*?\)/, '')) === w);
    if (id) { items[id].cls = cls; clsOf[id] = cls; }
  }));
  SB.templates.forEach(T => {
    Object.entries(clsOf).forEach(([id, cls]) => {
      if (!T.cls.includes(cls)) return;
      const it = items[id], x = it.en.replace(/\s*\(.*?\)/, '');
      const P = toks(T.pa), R = toks(T.rom), G = T.gloss.split('|');
      const xi = P.indexOf('X');
      P[xi] = it.paAnswers[0]; R[xi] = it.romAnswers[0]; G[xi] = x;
      addSentence({ id: 't-' + T.id + '-' + id, pa: P, rom: R, gloss: G, en: T.en.replace('{a}', article(x)).replace('{x}', x),
        focus: id, blank: xi, wrong: [], template: T.id, src: 'generated' });
    });
  });

  // multi-word phrases are sentences too (build it from tiles / fill the missing word)
  const tokGloss: Record<string, string> = {};
  sentences.forEach(sn => sn.pa.forEach((t, i) => { if (sn.gloss[i] && !tokGloss[t]) tokGloss[t] = sn.gloss[i]; }));
  const glossFor = (tok: string): string => {
    const g = (SB.glossary || {})[tok] || tokGloss[tok];
    if (g) return g;
    const v = order.vocab.concat(order.phrase).find(i => items[i].paAnswers.includes(tok));
    return v ? items[v].en : '';
  };
  order.phrase.forEach(id => {
    const it = items[id];
    const P = it.paAnswers[0].replace(/[?,.!]/g, '').trim().split(/\s+/);
    if (P.length < 2) return;
    if ((sentByFocus[id] || []).some(sn => sn.pa.join(' ').replace(/[?,.!]/g, '') === P.join(' '))) return; // already written by hand
    const R0 = it.romAnswers[0].replace(/[?,.!]/g, '').trim().split(/\s+/);
    const R = R0.length === P.length ? R0 : P.map(() => '');
    let bi = 0; P.forEach((w, i) => { if (w.length > P[bi].length) bi = i; }); // blank the longest word
    addSentence({ id: 'ph-' + id, pa: P, rom: R, gloss: P.map(glossFor), en: it.en.replace(/\s*\(.*?\)/, ''), focus: id, blank: bi, wrong: [], template: 'phrase', src: it.src });
  });

  const conversations: Conversation[] = [], convByFocus: Record<string, Conversation[]> = {};
  (SB.conversations || []).forEach(([pPa, pRom, pEn, rPa, rRom, rEn, focus, wrong], i) => {
    const c: Conversation = {
      id: 'c' + i, prompt: { pa: pPa, rom: pRom, en: pEn }, reply: { pa: rPa, rom: rRom, en: rEn },
      focus: focus.map(resolve).filter((x): x is string => !!x), wrong: (wrong || []).map(([pa, rom, en]) => ({ pa, rom, en }))
    };
    conversations.push(c);
    c.focus.forEach(id => (convByFocus[id] = convByFocus[id] || []).push(c));
  });

  // categories (words) and groups (phrases) for "practice by category"
  const categories: ItemSet[] = (C.categories || [])
    .map(([key, name, emoji]) => ({ key, name, emoji, ids: order.vocab.filter(id => items[id].cat === key) }))
    .filter(c => c.ids.length);
  const groups: ItemSet[] = [];
  order.phrase.forEach(id => {
    const g = items[id].group || 'Phrases';
    let G = groups.find(x => x.name === g);
    if (!G) groups.push(G = { key: 'grp-' + slug(g), name: g, emoji: '💬', ids: [] });
    G.ids.push(id);
  });

  return { items, order, lessons, categories, groups, sentences, sentByFocus, conversations, convByFocus, glossary: SB.glossary || {}, custom: CU, unresolved };
}
