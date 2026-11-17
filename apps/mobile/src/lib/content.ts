import contentJson from '@punjabi-app/content/seed/content.json';
import customJson from '@punjabi-app/content/seed/custom.json';
import sentencesJson from '@punjabi-app/content/seed/sentences.json';
import { buildModel, uuidIndex, type Content, type Custom, type Model, type SentencesData } from '@punjabi-app/core';

// First slice: the prototype content is bundled with the app. Later this is replaced by published content packs
// downloaded from the CDN (native-verified text + recordings).
export const model: Model = buildModel(contentJson as unknown as Content, sentencesJson as unknown as SentencesData, customJson as unknown as Custom);

let index: Map<string, string> | null = null;
/** database uuid → legacy id, for every card in the bundled content */
export const itemIndex = () => (index ??= uuidIndex([...model.order.letter, ...model.order.vocab, ...model.order.phrase]));
