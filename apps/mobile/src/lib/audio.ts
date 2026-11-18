/*
 * Sound for the app. For a card: an approved native recording if there is one, otherwise the device's text-to-speech
 * using the card's "say it as" tuning from the Studio. The tuning and recording list (the audio manifest) is fetched
 * from Supabase and cached on the phone, so tuning still works offline; recordings need a connection for now.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { plan, type Item, type SayInput, type VoiceLike, type VoiceMode } from '@punjabi-app/core';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { itemIndex } from './content';
import { supabase } from './supabase';

interface Entry { speakAs?: string; voice?: VoiceMode; rate?: number; rec?: string; recSlow?: string }
type Manifest = Record<string, Entry>; // legacy id → entry
interface ManifestRow { item_id: string; speak_as: string | null; voice: string | null; rate: number | null; rec: string | null; rec_slow: string | null }

const KEY = 'audio-manifest';
let manifest: Manifest = {};
let loadedAt = 0;

/** Load the cached manifest, then refresh it from the server (at most every 5 minutes). */
export async function refreshAudio(force = false): Promise<void> {
  if (!loadedAt) {
    try { const s = await AsyncStorage.getItem(KEY); if (s) manifest = JSON.parse(s) as Manifest; } catch { /* ignore */ }
  }
  if (!force && Date.now() - loadedAt < 5 * 60e3) return;
  try {
    const { data, error } = await supabase.rpc('audio_manifest');
    if (error || !data) return;
    const idx = itemIndex(), next: Manifest = {};
    for (const r of data as ManifestRow[]) {
      const id = idx.get(r.item_id);
      if (!id) continue;
      next[id] = {
        speakAs: r.speak_as ?? undefined, voice: (r.voice as VoiceMode | null) ?? undefined, rate: r.rate ?? undefined,
        rec: r.rec ?? undefined, recSlow: r.rec_slow ?? undefined
      };
    }
    manifest = next; loadedAt = Date.now();
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* offline: keep the cached copy */ }
}

// ---------------------------------------------------------------- recordings
const urls = new Map<string, { url: string; until: number }>();

/** Sign recording URLs ahead of time (e.g. for a whole session) so playback starts instantly. */
export async function prefetch(items: Item[]) {
  const paths = [...new Set(items.flatMap(it => [manifest[it.id]?.rec, manifest[it.id]?.recSlow]).filter((p): p is string => !!p))]
    .filter(p => (urls.get(p)?.until ?? 0) < Date.now() + 60e3);
  if (!paths.length) return;
  try {
    const { data } = await supabase.storage.from('recordings').createSignedUrls(paths, 3600);
    for (const s of data ?? []) if (s.signedUrl && s.path) urls.set(s.path, { url: s.signedUrl, until: Date.now() + 3500e3 });
  } catch { /* offline */ }
}
async function urlFor(path: string): Promise<string | null> {
  const hit = urls.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  try {
    const { data } = await supabase.storage.from('recordings').createSignedUrl(path, 3600);
    if (!data?.signedUrl) return null;
    urls.set(path, { url: data.signedUrl, until: Date.now() + 3500e3 });
    return data.signedUrl;
  } catch { return null; }
}

let player: AudioPlayer | null = null;
let audioModeSet = false;
async function playRecording(path: string): Promise<boolean> {
  const url = await urlFor(path);
  if (!url) return false;
  try {
    if (!audioModeSet) { audioModeSet = true; await setAudioModeAsync({ playsInSilentMode: true }); }
    stop();
    const p = createAudioPlayer(url);
    player = p;
    const sub = p.addListener('playbackStatusUpdate', s => { if (s.didJustFinish) { sub.remove(); p.remove(); if (player === p) player = null; } });
    p.play();
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------- text-to-speech
let voices: VoiceLike[] | null = null;
const bad = new Set<string>();
async function deviceVoices(): Promise<VoiceLike[]> {
  if (voices) return voices;
  try {
    const list = await Speech.getAvailableVoicesAsync();
    voices = list.map(v => ({ lang: v.language, name: v.name, voiceURI: v.identifier, localService: true }));
  } catch { voices = []; }
  return voices;
}

async function speak(input: SayInput, slow: boolean) {
  const tries = plan(input, await deviceVoices(), bad);
  const rate = (input.rate ?? 0.8) * (slow ? 0.65 : 1);
  const attempt = (i: number) => {
    const t = tries[i];
    if (!t) return;
    let started = false;
    Speech.speak(t.text, {
      language: t.voice?.lang ?? t.lang, voice: t.voice?.voiceURI, rate,
      onStart: () => { started = true; },
      onError: () => { if (t.voice?.voiceURI) bad.add(t.voice.voiceURI); if (!started) attempt(i + 1); }
    });
  };
  attempt(0);
}

export function stop() {
  Speech.stop();
  if (player) { try { player.pause(); player.remove(); } catch { /* ignore */ } player = null; }
}

/** What the voice reads for a card: letters say their name, words and phrases their first answer. */
const baseText = (it: Item) => (it.kind === 'letter' ? it.name ?? it.pa : it.paAnswers[0] ?? it.pa);

/** Play a card: recording first, else the tuned computer voice. */
export async function sayItem(it: Item, slow = false) {
  stop();
  const e = manifest[it.id] ?? {};
  const rec = slow && it.kind === 'phrase' ? e.recSlow ?? e.rec : e.rec;
  if (rec && (await playRecording(rec))) return;
  await speak({ pa: baseText(it), rom: it.kind === 'letter' ? it.rom : it.romAnswers[0] ?? it.rom, speakAs: e.speakAs, voice: e.voice, rate: e.rate }, slow);
}

/** Play plain Gurmukhi that isn't a card of its own (a letter's picture word). */
export async function sayText(pa: string, rom = '') {
  stop();
  await speak({ pa, rom }, false);
}
