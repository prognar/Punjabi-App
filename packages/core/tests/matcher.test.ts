import { describe, expect, it } from 'vitest';
import * as S from '../src/matcher';
import { model as M } from './fixtures';

const cases: [heard: string, id: string, expected: boolean][] = [
  ['ਗੇਂਦ', 'v-ball', true], ['gained', 'v-ball', true], ['gand', 'v-ball', true],
  ['sat sri akal', 'p-hello-anytimeofday', true],
  ['ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ', 'p-hello-anytimeofday', true],
  ['ਮੈਨੂੰ ਭੁੱਖ ਲੱਗੀ ਆ', 'p-i-am-hungry', true], ['ਮੈਨੂੰ ਭੁੱਖ ਲੱਗੀ ਹੈ', 'p-i-am-hungry', true],
  ['ਪਾਣੀ', 'p-water', true], ['ਘਰ', 'p-water', false], ['banana', 'v-ball', false],
  ['ਕੱਕਾ', 'l6', true], ['kakka', 'l6', true], ['ਗੱਗਾ', 'l6', false],
  ['ਬਿੱਲੀ', 'v-cat', true], ['billy', 'v-cat', true], ['ਕੁੱਤਾ', 'v-cat', false],
  ['ਧੰਨਵਾਦ ਜੀ', 'p-thank-you', true], ['dhanyavad', 'p-thank-you', true]
];

describe('speech matcher', () => {
  it.each(cases)('%s → %s : %s', (heard, id, expected) => {
    expect(M.items[id]).toBeTruthy();
    expect(S.scoreHeard(heard, M.items[id]) >= 0.6).toBe(expected);
  });
  it('picks the best alternative', () => {
    const r = S.scoreAlternatives(['banana', 'billy'], M.items['v-cat']);
    expect(r.ok).toBe(true); expect(r.heard).toBe('billy');
  });
  it('transliterates', () => {
    expect([S.gurToLatin('ਕਿਤਾਬ'), S.gurToLatin('ਘਰ'), S.gurToLatin('ਸ਼ੁਰੂ')]).toEqual(['kitaab', 'ghar', 'shuroo']);
    expect([S.gurToDeva('ਮੈਨੂੰ ਭੁੱਖ ਲੱਗੀ ਆ'), S.gurToDeva('ਸ਼ਾਮ'), S.gurToDeva('ਘੋੜਾ')]).toEqual(['मैनूं भुख्ख लग्गी आ', 'शाम', 'घोड़ा']);
  });
  it('suggests sounds-like spellings in the teacher style', () => {
    expect(S.anglicize('ਕੁੱਤਾ')).toBe('kut-taa');
    expect(S.anglicize('ਪਾਣੀ')).toBe('paa-nee');
    expect(S.anglicize('ਗੇਂਦ')).toBe('gaynd');
  });
});
