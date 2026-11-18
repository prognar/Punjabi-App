import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Me } from '../App';
import { Hear, Pronunciation } from '../components/Sound';
import { FIELDS, fieldsToApprove, latestByField, needsReligiousReview } from '../lib/review';
import { supabase } from '../supabase';
import { KINDS, KIND_LABEL, STATUS_LABEL, type FieldReview, type Item, type Kind, type Lesson, type ReviewField } from '../types';

const COLS = 'id, legacy_id, kind, en, pa, rom, pa_alts, rom_alts, note, category, phrase_group, tags, source, data, status, version, pa_version, updated_at';
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export function Review({ me }: { me: Me }) {
  const [kind, setKind] = useState<Kind | ''>('');
  const [lesson, setLesson] = useState('');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [queue, setQueue] = useState<Item[]>([]);
  const [reviews, setReviews] = useState<FieldReview[]>([]);
  const [i, setI] = useState(0);
  const [flag, setFlag] = useState<{ field: ReviewField; comment: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState(0);
  const started = useRef(Date.now());
  const religious = me.roles.includes('religious_reviewer');

  useEffect(() => { supabase.from('lessons').select('id, legacy_n, title, sort_order').order('sort_order').then(({ data }) => setLessons((data as Lesson[]) ?? [])); }, []);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    let ids: string[] | null = null;
    if (lesson) {
      const { data } = await supabase.from('lesson_items').select('item_id, sort_order').eq('lesson_id', lesson).order('sort_order');
      ids = (data ?? []).map(d => d.item_id as string);
    }
    let query = supabase.from('items').select(COLS).eq('status', 'in_review');
    if (ids) query = query.in('id', ids);
    if (kind) query = query.eq('kind', kind);
    const { data, error } = await query.order('updated_at').order('legacy_id').limit(300);
    if (error) { setError(error.message); setBusy(false); return; }
    let list = (data as unknown as Item[]) ?? [];
    if (ids) { const pos = new Map(ids.map((id, n) => [id, n])); list = [...list].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)); }
    const rs: FieldReview[] = [];
    for (const part of chunk(list.map(x => x.id), 100)) {
      const r = await supabase.from('item_field_reviews').select('*').in('item_id', part);
      if (r.data) rs.push(...(r.data as FieldReview[]));
    }
    setQueue(list); setReviews(rs); setI(0); setFlag(null); setBusy(false);
  }, [kind, lesson]);
  useEffect(() => { load(); }, [load]);

  const item = queue[i];
  const latest = useMemo(() => (item ? latestByField(reviews, item) : {}), [reviews, item]);
  const todo = fieldsToApprove(latest);

  const leave = (id: string) => { setQueue(q => q.filter(x => x.id !== id)); setI(n => Math.min(n, Math.max(0, queue.length - 2))); setDone(d => d + 1); };

  const submit = async (rows: { field: ReviewField; verdict: 'ok' | 'change'; comment?: string }[]) => {
    if (!item || busy) return;
    setBusy(true); setError(''); setNote('');
    const { data, error } = await supabase.from('item_field_reviews')
      .insert(rows.map(r => ({ item_id: item.id, field: r.field, verdict: r.verdict, comment: r.comment ?? '', reviewer_id: me.id, item_version: item.version }))).select('*');
    if (error) { setError(error.message); setBusy(false); return; }
    setReviews(rs => rs.concat(data as FieldReview[]));
    const { data: now } = await supabase.from('items').select('status').eq('id', item.id).single();
    setBusy(false); setFlag(null);
    if (now && now.status !== 'in_review') { setNote(`${item.en} → ${STATUS_LABEL[now.status as Item['status']]}`); leave(item.id); }
    else { setNote(`${item.en}: your ✓ is saved. Still needs ${needsReligiousReview(item) && !religious ? 'a religious reviewer' : 'the remaining fields'}.`); setDone(d => d + 1); setI(n => Math.min(n + 1, queue.length - 1)); }
  };
  const approve = () => { if (todo.length) submit(todo.map(field => ({ field, verdict: 'ok' as const }))); else if (religious) submit([{ field: 'cultural_fit', verdict: 'ok' }]); else setI(n => Math.min(n + 1, queue.length - 1)); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') { if (e.key === 'Escape') setFlag(null); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'a' || k === 'enter') { e.preventDefault(); approve(); }
      else if (k === 'f') { e.preventDefault(); setFlag({ field: 'pa', comment: '' }); }
      else if (k === 'j' || k === 'arrowright') setI(n => Math.min(n + 1, queue.length - 1));
      else if (k === 'k' || k === 'arrowleft') setI(n => Math.max(n - 1, 0));
      else if (k === 'escape') setFlag(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const mins = (Date.now() - started.current) / 60000;
  const rate = done >= 5 && mins > 1 ? Math.round(done / (mins / 60)) : null;

  return (
    <div className="stack">
      <div className="filters">
        <select value={kind} onChange={e => setKind(e.target.value as Kind | '')}><option value="">All kinds</option>{KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}s</option>)}</select>
        <select value={lesson} onChange={e => setLesson(e.target.value)}><option value="">All lessons</option>{lessons.map(l => <option key={l.id} value={l.id}>{l.title || 'Lesson ' + l.legacy_n}</option>)}</select>
        <span className="muted">{busy && !item ? 'Loading…' : `${queue.length} waiting · ${done} done this session${rate ? ` · ${rate}/hour` : ''}`}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {note && <p className="muted">{note}</p>}

      {!item && !busy && (
        <div className="card empty"><h2>Nothing waiting for review</h2><p className="muted">Cards appear here when an editor sends them to review (Cards → select → Send to review).</p></div>
      )}

      {item && (
        <div className="card review">
          <div className="muted">{i + 1} of {queue.length} · {KIND_LABEL[item.kind]} · {item.legacy_id} · v{item.version}
            {needsReligiousReview(item) && <span className="tag">needs religious reviewer</span>}</div>
          <div className="pa huge" lang="pa">{item.pa}</div>
          <div className="rom">{item.rom}</div>
          <div className="en">{item.en}</div>
          <div className="actions center-row"><Hear item={item} auto /></div>
          <Details item={item} />
          {(item.kind === 'letter' || item.kind === 'vocab' || item.kind === 'phrase') && (
            <Pronunciation item={item} me={me} onSaved={data => setQueue(q => q.map(x => (x.id === item.id ? { ...x, data } : x)))} />
          )}

          <ul className="checks row">
            {FIELDS.map(x => { const r = latest[x.key]; return (
              <li key={x.key} className={r ? r.verdict : 'none'} title={x.hint}><b>{r ? (r.verdict === 'ok' ? '✓' : '✎') : '○'}</b> {x.label}{r?.comment && <em> — {r.comment}</em>}</li>
            ); })}
          </ul>

          {flag ? (
            <form className="flag" onSubmit={e => { e.preventDefault(); if (flag.comment.trim()) submit([{ field: flag.field, verdict: 'change', comment: flag.comment.trim() }]); }}>
              <label>What needs changing?
                <select value={flag.field} onChange={e => setFlag({ ...flag, field: e.target.value as ReviewField })}>{FIELDS.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
              <label>Correction or comment<textarea rows={2} autoFocus value={flag.comment} onChange={e => setFlag({ ...flag, comment: e.target.value })} placeholder="Type the correct spelling or explain" lang="pa" /></label>
              <div className="actions"><button className="primary" disabled={busy || !flag.comment.trim()}>Request change</button><button type="button" onClick={() => setFlag(null)}>Cancel</button></div>
            </form>
          ) : (
            <div className="actions big">
              <button className="primary" disabled={busy} onClick={approve}>✓ All correct <kbd>A</kbd></button>
              <button disabled={busy} onClick={() => setFlag({ field: 'pa', comment: '' })}>✎ Needs a change <kbd>F</kbd></button>
              <button disabled={i === 0} onClick={() => setI(n => n - 1)}>← <kbd>K</kbd></button>
              <button disabled={i >= queue.length - 1} onClick={() => setI(n => n + 1)}>Skip → <kbd>J</kbd></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Line { pa?: string; rom?: string; en?: string }
function Details({ item }: { item: Item }) {
  const d = item.data as { name?: string; sound?: string; words?: (Line & { emoji?: string })[]; gloss?: string[]; pa?: string[]; reply?: Line; wrong?: Line[] | string[] };
  return (
    <div className="details">
      {item.pa_alts.length > 0 && <p><span className="muted">Also accepted:</span> <span className="pa" lang="pa">{item.pa_alts.join(' · ')}</span></p>}
      {item.rom_alts.length > 0 && <p><span className="muted">Also accepted (sounds-like):</span> {item.rom_alts.join(' · ')}</p>}
      {item.note && <p><span className="muted">Note:</span> {item.note}</p>}
      {item.kind === 'letter' && <>
        <p><span className="muted">Name:</span> <span className="pa" lang="pa">{d.name}</span> · <span className="muted">Sound:</span> {d.sound}</p>
        {d.words?.map((w, n) => <p key={n}>{w.emoji} <span className="pa" lang="pa">{w.pa}</span> · {w.rom} · {w.en}</p>)}
      </>}
      {item.kind === 'sentence' && d.gloss && d.pa && (
        <p className="gloss">{d.pa.map((t, n) => <span key={n}><span className="pa" lang="pa">{t}</span><small>{d.gloss![n]}</small></span>)}</p>
      )}
      {item.kind === 'conversation' && d.reply && <>
        <p><span className="muted">Best reply:</span> <span className="pa" lang="pa">{d.reply.pa}</span> · {d.reply.rom} · {d.reply.en}</p>
        {(d.wrong as Line[] | undefined)?.map((w, n) => <p key={n}><span className="muted">Wrong option:</span> <span className="pa" lang="pa">{w.pa}</span> · {w.en}</p>)}
      </>}
    </div>
  );
}
