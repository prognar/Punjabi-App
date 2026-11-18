import { matcher } from '@punjabi-app/core';
import { useEffect, useRef, useState } from 'react';
import type { Me } from '../App';
import { RECORDABLE, canRecord, canReview } from '../lib/review';
import { describeMode, deviceVoices, playUrl, say, stopAll, type VoiceMode } from '../lib/speech';
import { startRecording, type Take } from '../lib/wav';
import { supabase } from '../supabase';
import type { Item, Recording, Tuning } from '../types';

const tuningOf = (it: Item): Tuning => it.data as Tuning;
/** What the computer voice reads for a card (letters say their name). */
export const sayInput = (it: Item, t: Tuning = tuningOf(it)) => ({
  pa: it.kind === 'letter' ? String((it.data as { name?: string }).name ?? it.pa) : it.pa,
  rom: it.rom, speakAs: t.speakAs, voice: (t.voice ?? 'auto') as VoiceMode, rate: t.rate
});

let names: Promise<Map<string, string>> | null = null;
const studioNames = () => (names ??= Promise.resolve(supabase.from('studio_users').select('id, display_name'))
  .then(({ data }) => new Map((data ?? []).map(u => [u.id as string, (u.display_name as string) || 'a reviewer']))));

/** Signed URL for the best approved take, if any. */
export async function bestTakeUrl(item: Item, slow = false): Promise<string | null> {
  const { data } = await supabase.from('recordings').select('storage_path, is_best, created_at')
    .eq('item_id', item.id).eq('status', 'approved').eq('is_slow', slow).eq('pa_version', item.pa_version)
    .order('is_best', { ascending: false }).order('created_at', { ascending: false }).limit(1);
  const path = data?.[0]?.storage_path as string | undefined;
  if (!path) return null;
  const s = await supabase.storage.from('recordings').createSignedUrl(path, 600);
  return s.data?.signedUrl ?? null;
}

/** ▶ Hear / slow. Plays an approved recording if there is one, otherwise the computer voice. */
export function Hear({ item, tuning, auto }: { item: Item; tuning?: Tuning; auto?: boolean }) {
  const [info, setInfo] = useState('');
  const play = async (slow: boolean) => {
    const url = await bestTakeUrl(item, slow && item.kind === 'phrase');
    if (url) { playUrl(url); setInfo('recording'); return; }
    setInfo(await say(sayInput(item, tuning), slow));
  };
  // auto-play when the card changes (browsers allow it once the page has had a tap)
  useEffect(() => { setInfo(''); if (auto) say(sayInput(item, tuning)).then(setInfo); return () => stopAll(); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 'p') { e.preventDefault(); play(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  return (
    <span className="hear">
      <button type="button" onClick={() => play(false)} title="Hear it (P)">▶ Hear <kbd>P</kbd></button>
      <button type="button" onClick={() => play(true)} title="Hear it slowly">🐢 Slow</button>
      {info && <small className="muted">{info}</small>}
    </span>
  );
}

/** "Say it as" tuning for the computer voice, with a confirm button for native speakers. */
export function Pronunciation({ item, me, onSaved }: { item: Item; me: Me; onSaved?: (data: Record<string, unknown>) => void }) {
  const t0 = tuningOf(item);
  const [speakAs, setSpeakAs] = useState(t0.speakAs ?? '');
  const [voice, setVoice] = useState<VoiceMode>(t0.voice ?? 'auto');
  const [rate, setRate] = useState(t0.rate ?? 0.8);
  const [saved, setSaved] = useState<Tuning>(t0);
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dv = deviceVoices();

  useEffect(() => {
    const t = tuningOf(item);
    setSpeakAs(t.speakAs ?? ''); setVoice(t.voice ?? 'auto'); setRate(t.rate ?? 0.8); setSaved(t); setError('');
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (saved.tts_ok_by) studioNames().then(m => setWho(saved.tts_ok_by === me.id ? 'you' : m.get(saved.tts_ok_by!) ?? 'a reviewer'));
  }, [saved.tts_ok_by, me.id]);

  const current: Tuning = { speakAs: speakAs.trim() || undefined, voice: voice === 'auto' ? undefined : voice, rate: Math.abs(rate - 0.8) < 0.001 ? undefined : rate };
  const dirty = (current.speakAs ?? '') !== (saved.speakAs ?? '') || (current.voice ?? '') !== (saved.voice ?? '') || (current.rate ?? 0.8) !== (saved.rate ?? 0.8);
  const confirmed = !!saved.tts_ok_at && !dirty;

  const save = async (confirm: boolean) => {
    setBusy(true); setError('');
    const { data, error } = await supabase.rpc('set_pronunciation', { p_item: item.id, p_speak_as: speakAs, p_voice: voice, p_rate: rate, p_confirm: confirm });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSaved(data as Tuning); onSaved?.(data as Record<string, unknown>);
  };
  const tryWith = (v: VoiceMode) => say(sayInput(item, { ...current, voice: v === 'auto' ? undefined : (v as Tuning['voice']) }));

  return (
    <div className="pron">
      <div className="pron-head">
        <b>Computer voice</b>
        <span className={confirmed ? 'okay' : 'muted'}>{confirmed ? `✓ confirmed by ${who || '…'}` : 'not confirmed yet'}</span>
      </div>
      <p className="muted small">On this device: {describeMode(dv.auto)}.{!dv.pa && ' There is no Punjabi voice here, so what you type below is read by a Hindi or English voice.'}</p>
      <label>Say it as — type how it should sound (English letters or Gurmukhi)
        <input value={speakAs} onChange={e => setSpeakAs(e.target.value)} placeholder={'e.g. ' + (matcher.anglicize(item.pa) || 'gaynd')} lang="pa" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </label>
      <div className="pron-row">
        <label>Voice
          <select value={voice} onChange={e => setVoice(e.target.value as VoiceMode)}>
            <option value="auto">Automatic</option>
            <option value="pa">Punjabi{dv.pa ? '' : ' (not on this device)'}</option>
            <option value="hi">Hindi reading Punjabi{dv.hi ? '' : ' (not on this device)'}</option>
            <option value="en">English reading the spelling</option>
          </select>
        </label>
        <label>Speed {rate.toFixed(2)}<input type="range" min={0.4} max={1.5} step={0.05} value={rate} onChange={e => setRate(Number(e.target.value))} /></label>
      </div>
      <div className="actions">
        <button type="button" onClick={() => say(sayInput(item, current))}>▶ Try it</button>
        <button type="button" onClick={() => tryWith('pa')}>Punjabi</button>
        <button type="button" onClick={() => tryWith('hi')}>Hindi</button>
        <button type="button" onClick={() => tryWith('en')}>English</button>
      </div>
      <div className="actions">
        <button type="button" className="primary" disabled={busy || confirmed} onClick={() => save(true)}>✓ Sounds right</button>
        <button type="button" disabled={busy || !dirty} onClick={() => save(false)}>Save without confirming</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** Recorded takes: record (voice talent), listen, approve / reject (someone other than the speaker). */
export function Takes({ item, me, onChange }: { item: Item; me: Me; onChange?: () => void }) {
  const [takes, setTakes] = useState<Recording[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [rec, setRec] = useState<{ stop: () => void } | null>(null);
  const [draft, setDraft] = useState<(Take & { slow: boolean }) | null>(null);
  const [slow, setSlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const recordable = (RECORDABLE as readonly string[]).includes(item.status);
  const mayRecord = canRecord(me.roles);
  const mayReview = canReview(me.roles);
  const forItem = useRef(item.id);

  const load = async () => {
    const { data } = await supabase.from('recordings').select('*').eq('item_id', item.id).order('created_at', { ascending: false });
    const list = (data as Recording[]) ?? [];
    setTakes(list);
    if (list.length) {
      const { data: signed } = await supabase.storage.from('recordings').createSignedUrls(list.map(r => r.storage_path), 3600);
      setUrls(Object.fromEntries((signed ?? []).filter(s => s.signedUrl && s.path).map(s => [s.path as string, s.signedUrl as string])));
    } else setUrls({});
  };
  useEffect(() => { forItem.current = item.id; setDraft(null); setMsg(''); setSlow(false); load(); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => rec?.stop(), [rec]);

  const record = async () => {
    if (rec) { rec.stop(); return; }
    setMsg(''); setDraft(null); stopAll();
    try {
      const r = await startRecording();
      setRec(r);
      const take = await r.done;
      setRec(null);
      if (forItem.current !== item.id) return;
      setDraft({ ...take, slow });
      playUrl(take.url);
      if (take.tooQuiet) setMsg('That was very quiet. Move closer to the microphone and try again.');
    } catch (e) { setRec(null); setMsg('Microphone not available: ' + (e instanceof Error ? e.message : String(e))); }
  };

  const keep = async () => {
    if (!draft) return;
    setBusy(true); setMsg('');
    const ext = draft.blob.type.includes('wav') ? 'wav' : draft.blob.type.includes('mp4') ? 'm4a' : 'webm';
    const path = `${me.id}/${item.id}/${Date.now()}${draft.slow ? '-slow' : ''}.${ext}`;
    const up = await supabase.storage.from('recordings').upload(path, draft.blob, { contentType: draft.blob.type || 'audio/wav', upsert: false });
    if (up.error) { setBusy(false); setMsg(up.error.message); return; }
    const { error } = await supabase.from('recordings').insert({ item_id: item.id, speaker_id: me.id, storage_path: path, duration_ms: draft.durationMs || null, is_slow: draft.slow });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setDraft(null); setMsg('Saved. Someone other than the speaker approves it.'); load(); onChange?.();
  };

  const judge = async (r: Recording, status: 'approved' | 'rejected') => {
    setBusy(true); setMsg('');
    const hasBest = takes.some(t => t.is_best && t.is_slow === r.is_slow && t.id !== r.id);
    const { error } = await supabase.from('recordings').update(status === 'approved' ? { status, is_best: !hasBest } : { status, is_best: false }).eq('id', r.id);
    setBusy(false);
    if (error) setMsg(error.message); else { load(); onChange?.(); }
  };
  const makeBest = async (r: Recording) => {
    setBusy(true);
    await supabase.from('recordings').update({ is_best: false }).eq('item_id', item.id).eq('is_slow', r.is_slow).eq('is_best', true);
    const { error } = await supabase.from('recordings').update({ is_best: true }).eq('id', r.id);
    setBusy(false);
    if (error) setMsg(error.message); else load();
  };

  return (
    <div className="takes">
      <b>Recordings</b>
      {takes.length === 0 && <p className="muted small">No recordings yet.</p>}
      <ul>
        {takes.map(r => (
          <li key={r.id}>
            <button type="button" aria-label={'Play take ' + r.take_no} disabled={!urls[r.storage_path]} onClick={() => playUrl(urls[r.storage_path])}>▶</button>
            <span className="grow">Take {r.take_no}{r.is_slow ? ' (slow)' : ''}{r.speaker_id === me.id ? ' · yours' : ''}{r.is_best ? ' · ★ best' : ''}{r.pa_version !== item.pa_version ? ' · old spelling' : ''}</span>
            <span className={'status ' + (r.status === 'approved' ? 'ready' : r.status === 'rejected' ? 'changes_requested' : 'in_review')}>{r.status === 'pending' ? 'needs approval' : r.status}</span>
            {mayReview && r.speaker_id !== me.id && r.status !== 'approved' && <button type="button" disabled={busy} onClick={() => judge(r, 'approved')}>✓ Approve</button>}
            {mayReview && r.speaker_id !== me.id && r.status !== 'rejected' && <button type="button" disabled={busy} onClick={() => judge(r, 'rejected')}>✗ Reject</button>}
            {mayReview && r.status === 'approved' && !r.is_best && <button type="button" disabled={busy} onClick={() => makeBest(r)}>★ Best</button>}
          </li>
        ))}
      </ul>
      {mayRecord && (recordable ? (
        <div className="recorder">
          {item.kind === 'phrase' && <label className="inline"><input type="checkbox" checked={slow} onChange={e => setSlow(e.target.checked)} disabled={!!rec} /> slow take</label>}
          <button type="button" className={rec ? 'rec on' : 'rec'} onClick={record} disabled={busy}>{rec ? '■ Stop' : '● Record' + (slow ? ' slow' : '')}</button>
          {draft && <>
            <button type="button" onClick={() => playUrl(draft.url)}>▶ Play back</button>
            <button type="button" className="primary" disabled={busy} onClick={keep}>Keep this take</button>
          </>}
        </div>
      ) : <p className="muted small">Recording opens once the text is approved.</p>)}
      {msg && <p className="muted small">{msg}</p>}
    </div>
  );
}
