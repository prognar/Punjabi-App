/*
 * Which voice reads a card, shared by the Studio (browser) and the apps (device TTS). Ported from the prototype:
 * Punjabi voice if the device has one, else a Hindi voice reading the Gurmukhi converted to Devanagari, else an
 * English voice reading the sounds-like spelling. "Say it as" replaces what the voice reads; "voice" forces one.
 */
import { gurToDeva } from './matcher';

export type VoiceMode = 'auto' | 'pa' | 'hi' | 'en';
export interface SayInput { pa: string; rom: string; speakAs?: string; voice?: VoiceMode; rate?: number }
export interface VoiceLike { lang: string; name: string; voiceURI?: string; localService?: boolean }
export interface Try { text: string; voice: VoiceLike | null; lang: string }

const GUR = /[਀-੿]/;

export function pickVoice(voices: VoiceLike[], prefix: string, bad: Set<string> = new Set()): VoiceLike | undefined {
  const ok = voices.filter(v => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith(prefix) && !bad.has(v.voiceURI || v.name));
  return ok.find(v => v.localService) || ok[0];
}
export function autoMode(voices: VoiceLike[], bad?: Set<string>): Exclude<VoiceMode, 'auto'> {
  return pickVoice(voices, 'pa', bad) ? 'pa' : pickVoice(voices, 'hi', bad) ? 'hi' : 'en';
}

/** Ways to say it on this device, best first (pure, so it is unit-tested). */
export function plan(input: SayInput, voices: VoiceLike[], bad: Set<string> = new Set()): Try[] {
  const auto = autoMode(voices, bad);
  let mode: Exclude<VoiceMode, 'auto'> = input.voice && input.voice !== 'auto' ? input.voice : auto;
  if (mode === 'pa' && !pickVoice(voices, 'pa', bad)) mode = auto;
  if (mode === 'hi' && !pickVoice(voices, 'hi', bad)) mode = auto === 'pa' ? 'pa' : 'en';
  const src = (input.speakAs || input.pa || '').split(' / ')[0];
  const isGur = GUR.test(src);
  const enText = (input.speakAs && !isGur ? input.speakAs : input.rom || '').replace(/\(n\)/g, 'n').replace(/-/g, '').split(' / ')[0];
  const tries: Try[] = [];
  if (isGur && mode === 'pa') tries.push({ text: src, voice: pickVoice(voices, 'pa', bad) ?? null, lang: 'pa-IN' });
  if (isGur && (mode === 'hi' || mode === 'pa') && pickVoice(voices, 'hi', bad)) tries.push({ text: gurToDeva(src), voice: pickVoice(voices, 'hi', bad)!, lang: 'hi-IN' });
  if (isGur && mode === 'pa') tries.push({ text: src, voice: null, lang: 'pa-IN' });
  if (enText) { tries.push({ text: enText, voice: pickVoice(voices, 'en', bad) ?? null, lang: 'en-US' }); tries.push({ text: enText, voice: null, lang: 'en-US' }); }
  return tries;
}
