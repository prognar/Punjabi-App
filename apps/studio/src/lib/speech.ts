/*
 * Computer voice for the Studio, ported from the prototype: Punjabi voice if the device has one, else a Hindi voice
 * reading the Gurmukhi converted to Devanagari, else an English voice reading the sounds-like spelling.
 * "Say it as" replaces what the voice reads (Gurmukhi or English letters); "voice" forces one of the three.
 */
import { matcher } from '@punjabi-app/core';

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
  if (isGur && (mode === 'hi' || mode === 'pa') && pickVoice(voices, 'hi', bad)) tries.push({ text: matcher.gurToDeva(src), voice: pickVoice(voices, 'hi', bad)!, lang: 'hi-IN' });
  if (isGur && mode === 'pa') tries.push({ text: src, voice: null, lang: 'pa-IN' });
  if (enText) { tries.push({ text: enText, voice: pickVoice(voices, 'en', bad) ?? null, lang: 'en-US' }); tries.push({ text: enText, voice: null, lang: 'en-US' }); }
  return tries;
}

// ---------------------------------------------------------------- browser playback
const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
let voices: VoiceLike[] = [];
const bad = new Set<string>();
const load = () => { try { voices = synth ? synth.getVoices() : []; } catch { voices = []; } };
if (synth) { load(); synth.addEventListener?.('voiceschanged', load); }

export function deviceVoices() {
  load();
  return { pa: pickVoice(voices, 'pa', bad)?.name ?? null, hi: pickVoice(voices, 'hi', bad)?.name ?? null, en: pickVoice(voices, 'en', bad)?.name ?? null, auto: synth ? autoMode(voices, bad) : null };
}
export const describeMode = (m: VoiceMode | null) =>
  m === 'pa' ? 'Punjabi voice' : m === 'hi' ? 'Hindi voice reading the Gurmukhi' : m === 'en' ? 'English voice reading the spelling' : 'no voice on this device';

let audioEl: HTMLAudioElement | null = null;
export function stopAll() { try { audioEl?.pause(); } catch { /* ignore */ } audioEl = null; try { if (synth && (synth.speaking || synth.pending)) synth.cancel(); } catch { /* ignore */ } }

/** Play a recorded take. */
export function playUrl(url: string) { stopAll(); audioEl = new Audio(url); audioEl.play().catch(() => { /* blocked or failed */ }); }

/** Speak with the computer voice. Must be started from a tap the first time (browsers block sound otherwise). Resolves with the voice used. */
export function say(input: SayInput, slow = false): Promise<string> {
  return new Promise(resolve => {
    stopAll();
    if (!synth) { resolve('no text-to-speech in this browser'); return; }
    load();
    if (synth.paused) synth.resume();
    const tries = plan(input, voices, bad);
    const rate = (input.rate || 0.8) * (slow ? 0.65 : 1);
    const attempt = (i: number) => {
      const t = tries[i];
      if (!t) { resolve('no working voice'); return; }
      const u = new SpeechSynthesisUtterance(t.text);
      if (t.voice) u.voice = t.voice as SpeechSynthesisVoice;
      u.lang = t.voice?.lang || t.lang;
      u.rate = rate;
      let started = false;
      const tag = `${t.voice?.name ?? 'device default'} (${u.lang})`;
      u.onstart = () => { started = true; resolve(tag); };
      u.onerror = e => {
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        if (t.voice && /synthesis|voice|language/.test(e.error || '')) bad.add(t.voice.voiceURI || t.voice.name);
        if (!started && i + 1 < tries.length) { try { synth.cancel(); } catch { /* ignore */ } setTimeout(() => attempt(i + 1), 60); }
        else resolve('voice failed: ' + e.error);
      };
      synth.speak(u);
      setTimeout(() => { try { if (synth.pending && !synth.speaking) synth.resume(); } catch { /* ignore */ } }, 250); // Android Chrome stall
    };
    attempt(0);
  });
}
