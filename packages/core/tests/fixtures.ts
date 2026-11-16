import contentJson from '../../content/seed/content.json';
import sentencesJson from '../../content/seed/sentences.json';
import customJson from '../../content/seed/custom.json';
import { buildModel } from '../src/model';
import type { Content, Custom, SentencesData } from '../src/types';

export const content = contentJson as unknown as Content;
export const sentences = sentencesJson as unknown as SentencesData;
export const custom = customJson as unknown as Custom;
export const model = buildModel(content, sentences, custom);

/** Same LCG the prototype tests used, so simulations are repeatable and comparable. */
export function seededRandom(seed = 12345) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}
