/* Browser playback for the Studio. The voice choice itself lives in @punjabi-app/core (shared with the apps). */
import { autoMode, pickVoice, plan, type SayInput, type VoiceLike, type VoiceMode } from '@punjabi-app/core';

export type { SayInput, VoiceMode };

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
