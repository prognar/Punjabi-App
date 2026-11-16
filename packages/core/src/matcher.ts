/*
 * Phonetic matching for speech answers, plus Gurmukhi transliteration helpers.
 * Ported from the prototype's js/speech.js (matcher + transliteration only; recognition and TTS are platform code).
 *
 * A recognizer may return Gurmukhi (pa-IN) or English-sounding text (en-US fallback). Both are compared with
 * the expected Gurmukhi and with a forgiving phonetic key built from the romanization.
 */
import type { Item } from './types';

// ---------------------------------------------------------------- transliteration
const CONS: Record<string, string> = { 'ਕ': 'k', 'ਖ': 'kh', 'ਗ': 'g', 'ਘ': 'gh', 'ਙ': 'ng', 'ਚ': 'ch', 'ਛ': 'chh', 'ਜ': 'j', 'ਝ': 'jh', 'ਞ': 'ny',
  'ਟ': 't', 'ਠ': 'th', 'ਡ': 'd', 'ਢ': 'dh', 'ਣ': 'n', 'ਤ': 't', 'ਥ': 'th', 'ਦ': 'd', 'ਧ': 'dh', 'ਨ': 'n', 'ਪ': 'p', 'ਫ': 'ph',
  'ਬ': 'b', 'ਭ': 'bh', 'ਮ': 'm', 'ਯ': 'y', 'ਰ': 'r', 'ਲ': 'l', 'ਵ': 'v', 'ੜ': 'r', 'ਸ': 's', 'ਹ': 'h',
  'ਸ਼': 'sh', 'ਖ਼': 'kh', 'ਗ਼': 'g', 'ਜ਼': 'z', 'ਫ਼': 'f', 'ਲ਼': 'l' };
const NUKTA: Record<string, string> = { 'ਸ': 'sh', 'ਖ': 'kh', 'ਗ': 'g', 'ਜ': 'z', 'ਫ': 'f', 'ਲ': 'l' };
const VOW: Record<string, string> = { 'ਅ': 'a', 'ਆ': 'aa', 'ਇ': 'i', 'ਈ': 'ee', 'ਉ': 'u', 'ਊ': 'oo', 'ਏ': 'e', 'ਐ': 'ai', 'ਓ': 'o', 'ਔ': 'au', 'ੳ': 'u', 'ੲ': 'i' };
const MAT: Record<string, string> = { 'ਾ': 'aa', 'ਿ': 'i', 'ੀ': 'ee', 'ੁ': 'u', 'ੂ': 'oo', 'ੇ': 'e', 'ੈ': 'ai', 'ੋ': 'o', 'ੌ': 'au' };
const GURMUKHI = /[਀-੿]/;

/** Rough Gurmukhi → Latin (good enough for matching, not for display). */
export function gurToLatin(s: string): string {
  const ch = Array.from(s.normalize('NFC'));
  let out = '', double = false;
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i], nx = ch[i + 1];
    if (CONS[c]) {
      let base = CONS[c];
      if (nx === '਼') { base = NUKTA[c] || base; i++; }
      if (double) { out += base[0]; double = false; }
      out += base;
      const after = ch[i + 1];
      const endOfWord = !after || /[\s?.,!।'"\-/]/.test(after);
      if (!(after && (MAT[after] || after === '੍')) && !endOfWord) out += 'a'; // inherent vowel (dropped at word end)
    } else if (VOW[c]) out += VOW[c];
    else if (MAT[c]) out += MAT[c];
    else if (c === 'ੰ' || c === 'ਂ') out += 'n';
    else if (c === 'ੱ') double = true;
    else if (c === '੍' || c === '਼') { /* skip */ }
    else if (/\s/.test(c)) out += ' ';
  }
  return out;
}

/** Phonetic key so that "gaind", "gend", "ਗੇਂਦ", "gained" land close together. */
export function key(s: string): string {
  if (!s) return '';
  if (GURMUKHI.test(s)) s = gurToLatin(s);
  s = s.toLowerCase().replace(/\(n\)/g, 'n').replace(/[^a-z]+/g, '');
  s = s.replace(/chh/g, '§').replace(/ch/g, '§').replace(/c/g, 'k').replace(/§/g, 'c')
    .replace(/ph/g, 'f').replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/jh/g, 'j').replace(/th/g, 't')
    .replace(/dh/g, 'd').replace(/bh/g, 'b').replace(/sh/g, 's').replace(/z/g, 'j').replace(/w/g, 'v')
    .replace(/q/g, 'k').replace(/x/g, 'ks')
    .replace(/ee|ie|ea/g, 'i').replace(/oo|ou/g, 'u').replace(/aa/g, 'a')
    .replace(/ai|ay|ae|ei|ey/g, 'e').replace(/au|aw|ow/g, 'o')
    .replace(/(?!^)h/g, '')            // aspiration is unreliable in recognizers
    .replace(/u/g, 'a')                // schwa: kum / kam / kahm
    .replace(/y/g, 'i')
    .replace(/(.)\1+/g, '$1');         // doubled consonants
  return s;
}

export function lev(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length; if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
export const sim = (a: string, b: string): number => (!a || !b) ? 0 : 1 - lev(a, b) / Math.max(a.length, b.length);

function normGur(s: string) { return s.normalize('NFC').replace(/[ੱ਼?.,!।'\s]/g, '').replace(/ੰ/g, 'ਂ'); }

/** Pass thresholds for a spoken answer (similarity 0..1). */
export const SPEECH_THRESHOLD = { kid: 0.55, adult: 0.65 } as const;

/** Score one heard transcript against an item. Returns 0..1 */
export function scoreHeard(heard: string, item: Pick<Item, 'romAnswers' | 'paAnswers' | 'kind' | 'name'>): number {
  const hk = key(heard);
  let best = 0;
  const targets = item.romAnswers.concat(item.paAnswers);
  if (item.kind === 'letter' && item.name) targets.push(item.name);
  for (const t of targets) {
    const tk = key(t);
    if (!tk) continue;
    let s = sim(hk, tk);
    if (hk.length > tk.length && hk.includes(tk)) s = Math.max(s, 0.95);           // said it inside a sentence
    if (tk.length >= 6 && tk.includes(hk) && hk.length >= tk.length * 0.6) s = Math.max(s, 0.75); // partial phrase
    best = Math.max(best, s);
  }
  if (GURMUKHI.test(heard)) {
    const hg = normGur(heard);
    for (const p of item.paAnswers) {
      const pg = normGur(p);
      best = Math.max(best, sim(hg, pg), hg.includes(pg) ? 0.95 : 0);
    }
  }
  return best;
}

/** Best score over a recognizer's alternatives. */
export function scoreAlternatives(alts: string[], item: Parameters<typeof scoreHeard>[1], threshold = 0.6): { ok: boolean; score: number; heard: string } {
  let best = { score: 0, heard: alts[0] || '' };
  alts.forEach(a => { const s = scoreHeard(a, item); if (s > best.score) best = { score: s, heard: a }; });
  return { ok: best.score >= threshold, ...best };
}

// ---------------------------------------------------------------- Gurmukhi → Devanagari (Hindi-voice TTS fallback)
export function gurToDeva(s: string): string {
  let out = '';
  const ch = Array.from(s.normalize('NFC'));
  const SPECIAL: Record<string, string> = { 'ੰ': 'ं', 'ਂ': 'ं', 'ੲ': 'इ', 'ੳ': 'उ', 'ੜ': 'ड़', 'ਖ਼': 'ख़', 'ਗ਼': 'ग़', 'ਜ਼': 'ज़', 'ਫ਼': 'फ़', 'ਲ਼': 'ळ', 'ਸ਼': 'श' };
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (c === 'ੱ') { // addak: double the next consonant
      const n = ch[i + 1];
      if (n && /[\u0A15-\u0A39\u0A59-\u0A5E]/.test(n)) { const d = SPECIAL[n] || String.fromCharCode(n.charCodeAt(0) - 0x100); out += d + '्'; }
      continue;
    }
    if (c === 'ਸ' && ch[i + 1] === '਼') { out += 'श'; i++; continue; }
    if (SPECIAL[c]) { out += SPECIAL[c]; continue; }
    const code = c.charCodeAt(0);
    out += (code >= 0x0A00 && code <= 0x0A7F) ? String.fromCharCode(code - 0x100) : c;
  }
  return out;
}

// ---------------------------------------------------------------- "sounds-like" romanization (Studio auto-suggest)
/**
 * Gurmukhi → English-letters "sounds-like" spelling in the teacher's style (syllables split by hyphens),
 * e.g. ਕੁੱਤਾ → kut-taa, ਪਾਣੀ → paa-nee, ਗੇਂਦ → gaind, ਬਾਂਹ → baan(h)
 */
const AV: Record<string, string> = { 'ਾ': 'aa', 'ਿ': 'i', 'ੀ': 'ee', 'ੁ': 'u', 'ੂ': 'oo', 'ੇ': 'ay', 'ੈ': 'ai', 'ੋ': 'o', 'ੌ': 'au' };
const AVI: Record<string, string> = { 'ਅ': 'a', 'ਆ': 'aa', 'ਇ': 'i', 'ਈ': 'ee', 'ਉ': 'u', 'ਊ': 'oo', 'ਏ': 'ay', 'ਐ': 'ai', 'ਓ': 'o', 'ਔ': 'au', 'ੳ': 'u', 'ੲ': 'i' };
const AC: Record<string, string> = Object.assign({}, CONS, { 'ਟ': 't', 'ਤ': 't', 'ਡ': 'd', 'ਦ': 'd', 'ੜ': 'r', 'ਣ': 'n' });

interface Syl { c: string; v: string; coda?: string; nas?: boolean; ind?: boolean; sync?: boolean }

function anglicizeWord(w: string): string {
  const ch = Array.from(w.normalize('NFC'));
  const syl: Syl[] = [];
  let cur: Syl = { c: '', v: '' }, dbl = false;
  const flush = () => { syl.push(cur); cur = { c: '', v: '' }; };
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i], nx = ch[i + 1];
    if (AC[c]) {
      let b = AC[c];
      if (nx === '਼') { b = NUKTA[c] || b; i++; }
      if (cur.v) flush();
      if (dbl) { // addak: close previous syllable with this consonant (ਬੱਚਾ → buch-chaa)
        if (syl.length) syl[syl.length - 1].coda = (syl[syl.length - 1].coda || '') + (b === 'chh' ? 'ch' : b.length > 1 && b.endsWith('h') ? b.slice(0, -1) : b);
        dbl = false;
      }
      cur.c += b;
      const after = ch[i + 1];
      if (after === '੍') { i++; continue; }            // cluster
      if (!(after && (AV[after] || after === 'ੱ' || after === 'ੰ' || after === 'ਂ'))) cur.v = 'a';   // inherent vowel
    } else if (AVI[c]) { if (cur.v || cur.c) flush(); cur.v = AVI[c]; cur.ind = true; }
    else if (AV[c]) cur.v = AV[c];
    else if (c === 'ੰ' || c === 'ਂ') { if (!cur.v) cur.v = 'u'; cur.nas = true; }
    else if (c === 'ੱ') { if (!cur.v) cur.v = 'u'; dbl = true; }
  }
  if (cur.c || cur.v) flush();
  // drop the inherent vowel at the end of the word (ਘਰ → ghar)
  if (syl.length > 1) { const L = syl[syl.length - 1]; if (L.v === 'a' && !L.nas && !L.coda) { const P = syl[syl.length - 2]; P.coda = (P.coda || '') + L.c; syl.pop(); } }
  // Punjabi drops the short "a" in the middle of a word: ਕੁਰਸੀ is kur-see, not ku-ra-see
  for (let i = 1; i < syl.length - 1; i++) {
    const x = syl[i];
    if (x.v === 'a' && !x.nas && !x.coda && !x.ind && x.c && syl[i - 1].v && syl[i + 1].v && syl[i + 1].c && !syl[i - 1].sync) {
      syl[i - 1].coda = (syl[i - 1].coda || '') + x.c; syl[i - 1].sync = true; syl.splice(i, 1); i--;
    }
  }
  const parts = syl.map(x => {
    const v = x.v === 'a' && !x.ind ? 'u' : x.v;       // schwa sounds like the u in "cup"
    let s = x.c + v;
    if (x.nas) s += (/aa|ee|oo|ai|au|ay|o$/.test(v) && !x.coda ? '(n)' : 'n');
    return s + (x.coda || '');
  });
  // merge a syllable that is only consonants into its neighbour
  const out: string[] = [];
  parts.forEach(p => { if (out.length && !/[aeiou]/.test(p)) out[out.length - 1] += p; else out.push(p); });
  return out.join('-').replace(/u-hi([^aeiou(-]*)/g, 'eh$1').replace(/ih(?=-)/g, 'eh').replace(/^-|-$/g, '').replace(/--+/g, '-');
}
export function anglicize(s: string): string {
  return (s || '').split(' / ').map(alt => alt.replace(/[?,.!।]/g, '').trim().split(/\s+/).filter(Boolean).map(anglicizeWord).join(' ')).join(' / ');
}
