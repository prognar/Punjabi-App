import { useCallback, useEffect, useState } from 'react';
import type { Me } from '../App';
import { Hear, Pronunciation, Takes } from '../components/Sound';
import { canRecord, canReview } from '../lib/review';
import { playUrl } from '../lib/speech';
import { supabase } from '../supabase';
import { KIND_LABEL, STATUS_LABEL, type Item, type Lesson, type Recording } from '../types';

const COLS = 'id, legacy_id, kind, en, pa, rom, pa_alts, rom_alts, note, category, phrase_group, tags, source, data, status, version, pa_version, updated_at';

/** Recording sessions (voice talent) and checking takes (reviewers). */
export function Audio({ me }: { me: Me }) {
  const [mode, setMode] = useState<'record' | 'check'>(canRecord(me.roles) ? 'record' : 'check');
  return (
    <div className="stack">
      <div className="actions">
        {canRecord(me.roles) && <button className={mode === 'record' ? 'primary' : ''} onClick={() => setMode('record')}>Record</button>}
        {canReview(me.roles) && <button className={mode === 'check' ? 'primary' : ''} onClick={() => setMode('check')}>Check takes</button>}
      </div>
      {mode === 'record' ? <RecordQueue me={me} /> : <CheckTakes me={me} />}
    </div>
  );
}

function RecordQueue({ me }: { me: Me }) {
  const [lesson, setLesson] = useState('');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [queue, setQueue] = useState<Item[]>([]);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(true);

  useEffect(() => { supabase.from('lessons').select('id, legacy_n, title, sort_order').order('sort_order').then(({ data }) => setLessons((data as Lesson[]) ?? [])); }, []);
  const load = useCallback(async () => {
    setBusy(true);
    let ids: string[] | null = null;
    if (lesson) {
      const { data } = await supabase.from('lesson_items').select('item_id, sort_order').eq('lesson_id', lesson).order('sort_order');
      ids = (data ?? []).map(d => d.item_id as string);
    }
    // text approved and still waiting for a take (phrases also wait for a slow take)
    let q = supabase.from('items').select(COLS).in('status', ['approved_text', 'recording', 'approved_audio']).in('kind', ['letter', 'vocab', 'phrase']);
    if (ids) q = q.in('id', ids);
    const { data } = await q.order('updated_at').limit(300);
    let list = (data as unknown as Item[]) ?? [];
    if (ids) { const pos = new Map(ids.map((id, n) => [id, n])); list = [...list].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)); }
    setQueue(list); setI(0); setBusy(false);
  }, [lesson]);
  useEffect(() => { load(); }, [load]);

  const item = queue[i];
  const refresh = async () => {
    if (!item) return;
    const { data } = await supabase.from('items').select(COLS).eq('id', item.id).single();
    if (data) setQueue(q => q.map(x => (x.id === item.id ? (data as unknown as Item) : x)));
  };

  return (
    <>
      <div className="filters">
        <select value={lesson} onChange={e => setLesson(e.target.value)}><option value="">All lessons</option>{lessons.map(l => <option key={l.id} value={l.id}>{l.title || 'Lesson ' + l.legacy_n}</option>)}</select>
        <span className="muted">{busy ? 'Loading…' : `${queue.length} cards to record`}</span>
      </div>
      {!item && !busy && (
        <div className="card empty"><h2>Nothing to record</h2><p className="muted">Cards show up here after their text is approved in Review.</p></div>
      )}
      {item && (
        <div className="card review">
          <div className="muted">{i + 1} of {queue.length} · {KIND_LABEL[item.kind]} · {STATUS_LABEL[item.status]}{item.kind === 'phrase' ? ' · needs a normal and a slow take' : ''}</div>
          <div className="pa huge" lang="pa">{item.kind === 'letter' ? `${item.pa}  ${String((item.data as { name?: string }).name ?? '')}` : item.pa}</div>
          <div className="rom">{item.rom}</div>
          <div className="en">{item.en}</div>
          <div className="actions center-row"><Hear item={item} /></div>
          <Takes item={item} me={me} onChange={refresh} />
          <details><summary className="muted">Computer voice (used until a recording is approved)</summary><Pronunciation item={item} me={me} /></details>
          <div className="actions">
            <button disabled={i === 0} onClick={() => setI(n => n - 1)}>← Previous</button>
            <button className="primary" disabled={i >= queue.length - 1} onClick={() => setI(n => n + 1)}>Next →</button>
          </div>
        </div>
      )}
    </>
  );
}

interface Pending extends Recording { item: Item; url?: string }

function CheckTakes({ me }: { me: Me }) {
  const [rows, setRows] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    const { data } = await supabase.from('recordings').select('*').eq('status', 'pending').neq('speaker_id', me.id).order('created_at').limit(100);
    const recs = (data as Recording[]) ?? [];
    if (!recs.length) { setRows([]); setBusy(false); return; }
    const [{ data: items }, { data: signed }] = await Promise.all([
      supabase.from('items').select(COLS).in('id', [...new Set(recs.map(r => r.item_id))]),
      supabase.storage.from('recordings').createSignedUrls(recs.map(r => r.storage_path), 3600)
    ]);
    const byId = new Map(((items as unknown as Item[]) ?? []).map(x => [x.id, x]));
    const urls = new Map((signed ?? []).map(s => [s.path, s.signedUrl]));
    setRows(recs.filter(r => byId.has(r.item_id)).map(r => ({ ...r, item: byId.get(r.item_id)!, url: urls.get(r.storage_path) ?? undefined })));
    setBusy(false);
  }, [me.id]);
  useEffect(() => { load(); }, [load]);

  const judge = async (r: Pending, status: 'approved' | 'rejected') => {
    setMsg('');
    let is_best = false;
    if (status === 'approved') {
      const { count } = await supabase.from('recordings').select('id', { count: 'exact', head: true }).eq('item_id', r.item_id).eq('is_slow', r.is_slow).eq('is_best', true);
      is_best = !count;
    }
    const { error } = await supabase.from('recordings').update({ status, is_best }).eq('id', r.id);
    if (error) { setMsg(error.message); return; }
    setRows(rs => rs.filter(x => x.id !== r.id));
  };

  return (
    <>
      <div className="filters"><span className="muted">{busy ? 'Loading…' : `${rows.length} takes waiting`}</span>{msg && <span className="error">{msg}</span>}</div>
      {!rows.length && !busy && <div className="card empty"><h2>No takes waiting</h2><p className="muted">Takes recorded by someone else appear here for you to check.</p></div>}
      {rows.length > 0 && (
        <div className="card flush">
          <table className="rows">
            <thead><tr><th></th><th>Gurmukhi</th><th>English</th><th>Take</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><button disabled={!r.url} onClick={() => r.url && playUrl(r.url)} aria-label="Play take">▶</button></td>
                  <td className="pa">{r.item.pa}</td>
                  <td>{r.item.en}<div className="muted small">{r.item.rom}</div></td>
                  <td>#{r.take_no}{r.is_slow ? ' slow' : ''}</td>
                  <td className="nowrap"><button onClick={() => judge(r, 'approved')}>✓ Approve</button> <button onClick={() => judge(r, 'rejected')}>✗ Reject</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
