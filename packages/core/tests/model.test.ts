import { describe, expect, it } from 'vitest';
import { slug } from '../src/model';
import { model } from './fixtures';

describe('model', () => {
  it('matches the prototype counts (35 / 760 / 288 / 38)', () => {
    expect(model.order.letter.length).toBe(35);
    expect(model.order.vocab.length).toBe(760);
    expect(model.order.phrase.length).toBe(288);
    expect(model.lessons.length).toBe(38);
  });
  it('lessons: 2–3 letters for 1–14, 20 words, 8 phrases', () => {
    const shape = model.lessons.map(L => [L.letter.length, L.vocab.length, L.phrase.length].join('/'));
    expect(shape.slice(0, 4)).toEqual(['2/20/8', '3/20/8', '2/20/8', '3/20/8']);
    expect(shape[14]).toBe('0/20/8');
    expect(shape[37]).toBe('0/20/0');
  });
  it('ids are unique, stable slugs', () => {
    expect(slug('hello (any time of day)')).toBe('hello-anytimeofday');
    expect(model.items['p-hello-anytimeofday']).toBeTruthy();
    expect(model.items['v-age'].lesson).toBe(1);
    const all = [...model.order.letter, ...model.order.vocab, ...model.order.phrase];
    expect(new Set(all).size).toBe(all.length);
  });
  it('builds sentences, conversations, categories', () => {
    expect(model.sentences.length).toBeGreaterThan(1200);
    expect(model.conversations.length).toBe(25);
    expect(model.categories.length).toBe(22);
    expect(model.groups.length).toBe(20);
    expect(model.unresolved).toEqual([]);
  });
});
