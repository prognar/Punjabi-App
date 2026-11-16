import { useCallback, useEffect, useState } from 'react';
import type { Me } from '../App';
import { FIELDS, canEdit, isAdmin, latestByField, needsReligiousReview, searchFilter } from '../lib/review';
import { supabase } from '../supabase';
import { KINDS, KIND_LABEL, STATUSES, STATUS_LABEL, type FieldReview, type Item, type Kind, type Lesson, type Status } from '../types';

const PAGE = 50;
const COLS = 'id, legacy_id, kind, en, pa, rom, pa_alts, rom_alts, note, category, phrase_group, tags, source, data, status, version, updated_at';

export function Items({ me }: { me: Me }) {
  const [kind, setKind] = useState<Kind | ''>('');
  const [status, setStatus] = useState<Status | ''>('');
  const [lesson, setLesson] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [rows, setRows] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Item | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const edit = canEdit(me.roles);

  useEffect(() => { supabase.from('lessons').select('id, legacy_n, title, sort_order').order('sort_order').then(({ data }) => setLessons((data as Lesson[]) ?? [])); }, []);

  const load = useCallback(async () => {
    setBusy(true);
    let ids: string[] | null = null;
    if (lesson) {
      const { data } = await supabase.from('lesson_items').select('item_id, sort_order').eq('lesson_id', lesson).order('sort_order');
      ids = (data ?? []).map(d => d.item_id as string);
    }
    let query = supabase.from('items').select(COLS, { count: 'exact' });
    if (ids) query = query.in('id', ids);
    if (kind) query = query.eq('kind', kind);
    if (status) query = query.eq('status', status);
    const f = searchFilter(q);
    if (f) query = query.or(f);
    const { data, count, error } = await query.order('kind').order('legacy_id').range(page * PAGE, page * PAGE + PAGE - 1);
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    let list = (data as unknown as Item[]) ?? [];
    if (ids) { const pos = new Map(ids.map((id, i) => [id, i])); list = [...list].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)); }
    setRows(list); setTotal(count ?? 0);
  }, [kind, status, lesson, q, page]);
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { setPage(0); setPicked(new Set()); }, [kind, status, lesson, q]);

  /** Sends draft / changes-requested cards to review. The database refuses any other transition for editors. */
  const sendToReview = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    const { data, error } = await supabase.from('items').update({ status: 'in_review' }).in('id', ids).in('status', ['draft', 'changes_requested']).select('id');
    setBusy(false);
    setMsg(error ? error.message : `${data?.length ?? 0} card${data?.length === 1 ? '' : 's'} sent to review`);
    setPicked(new Set()); load();
  };
  const sendLesson = async () => {
    const { data } = await supabase.from('lesson_items').select('item_id').eq('lesson_id', lesson);
    await sendToReview((data ?? []).map(d => d.item_id as string));
  };

  const toggle = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sendable = rows.filter(r => r.status === 'draft' || r.status === 'changes_requested');
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="stack">
      <div className="filters">
        <input type="search" placeholder="Search English, Gurmukhi, id…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={kind} onChange={e => setKind(e.target.value as Kind | '')}><option value="">All kinds</option>{KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}s</option>)}</select>
        <select value={status} onChange={e => setStatus(e.target.value as Status | '')}><option value="">Any status</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        <select value={lesson} onChange={e => setLesson(e.target.value)}><option value="">All lessons</option>{lessons.map(l => <option key={l.id} value={l.id}>{l.title || 'Lesson ' + l.legacy_n}</option>)}</select>
        <span className="muted">{busy ? 'Loading…' : `${total} cards`}</span>
      </div>

      {edit && (
        <div className="actions">
          <button disabled={!picked.size || busy} onClick={() => sendToReview([...picked])}>Send {picked.size || ''} selected to review</button>
          {lesson && <button disabled={busy} onClick={sendLesson}>Send this whole lesson to review</button>}
          {msg && <span className="muted">{msg}</span>}
        </div>
      )}

      <div className="card flush">
        <table className="rows">
          <thead><tr>
            {edit && <th><input type="checkbox" aria-label="Select all sendable" checked={sendable.length > 0 && sendable.every(r => picked.has(r.id))}
              onChange={e => setPicked(e.target.checked ? new Set(sendable.map(r => r.id)) : new Set())} /></th>}
            <th>Gurmukhi</th><th>Sounds-like</th><th>English</th><th>Kind</th><th>Status</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} onClick={() => setOpen(r)}>
                {edit && <td onClick={e => e.stopPropagation()}>
                  <input type="checkbox" aria-label={'Select ' + r.en} disabled={r.status !== 'draft' && r.status !== 'changes_requested'} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>}
                <td className="pa">{r.pa}</td><td>{r.rom}</td><td>{r.en}{needsReligiousReview(r) && <span className="tag">gurdwara</span>}</td>
                <td>{KIND_LABEL[r.kind]}</td><td><span className={'status ' + r.status}>{STATUS_LABEL[r.status]}</span></td>
              </tr>
            ))}
            {!rows.length && !busy && <tr><td colSpan={6} className="muted">No cards match.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Previous</button>
        <span className="muted">Page {page + 1} of {pages}</span>
        <button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Next →</button>
      </div>

      {open && <Editor item={open} me={me} onClose={changed => { setOpen(null); if (changed) load(); }} />}
    </div>
  );
}

const splitAlts = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);

function Editor({ item, me, onClose }: { item: Item; me: Me; onClose: (changed: boolean) => void }) {
  const edit = canEdit(me.roles);
  const [f, setF] = useState({ en: item.en, pa: item.pa, rom: item.rom, pa_alts: item.pa_alts.join('\n'), rom_alts: item.rom_alts.join('\n'), note: item.note });
  const [cur, setCur] = useState(item);
  const [reviews, setReviews] = useState<FieldReview[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    supabase.from('item_field_reviews').select('*').eq('item_id', item.id).order('at').then(({ data }) => setReviews((data as FieldReview[]) ?? []));
  }, [item.id]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(changed); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [changed, onClose]);

  const dirty = f.en !== cur.en || f.pa !== cur.pa || f.rom !== cur.rom || f.note !== cur.note || f.pa_alts !== cur.pa_alts.join('\n') || f.rom_alts !== cur.rom_alts.join('\n');
  const approved = ['approved_text', 'recording', 'approved_audio', 'ready', 'published'].includes(cur.status);

  const run = async (patch: Partial<Item>) => {
    setBusy(true); setError('');
    const { data, error } = await supabase.from('items').update(patch).eq('id', cur.id).select(COLS).single();
    setBusy(false);
    if (error) { setError(error.message); return; }
    setCur(data as unknown as Item); setChanged(true);
  };
  const save = () => run({ en: f.en.trim(), pa: f.pa.trim(), rom: f.rom.trim(), note: f.note.trim(), pa_alts: splitAlts(f.pa_alts), rom_alts: splitAlts(f.rom_alts) });
  const latest = latestByField(reviews, cur);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }));

  return (
    <div className="overlay" onClick={() => onClose(changed)}>
      <aside className="drawer" role="dialog" aria-label="Card" onClick={e => e.stopPropagation()}>
        <div className="drawer-head">
          <div><span className={'status ' + cur.status}>{STATUS_LABEL[cur.status]}</span> <span className="muted">{KIND_LABEL[cur.kind]} · {cur.legacy_id} · v{cur.version} · {cur.source}</span></div>
          <button className="link" onClick={() => onClose(changed)}>Close</button>
        </div>
        <label>Gurmukhi<input className="pa big" value={f.pa} onChange={set('pa')} readOnly={!edit} lang="pa" /></label>
        <label>Sounds-like<input value={f.rom} onChange={set('rom')} readOnly={!edit} /></label>
        <label>English<input value={f.en} onChange={set('en')} readOnly={!edit} /></label>
        <div className="two">
          <label>Also accepted (Gurmukhi, one per line)<textarea className="pa" rows={3} value={f.pa_alts} onChange={set('pa_alts')} readOnly={!edit} lang="pa" /></label>
          <label>Also accepted (sounds-like, one per line)<textarea rows={3} value={f.rom_alts} onChange={set('rom_alts')} readOnly={!edit} /></label>
        </div>
        <label>Note (gender, register, usage)<textarea rows={2} value={f.note} onChange={set('note')} readOnly={!edit} /></label>
        {cur.category && <p className="muted">Category: {cur.category}{cur.phrase_group ? ' · Group: ' + cur.phrase_group : ''}{cur.tags.length ? ' · Tags: ' + cur.tags.join(', ') : ''}</p>}
        {error && <p className="error">{error}</p>}
        {edit && (
          <div className="actions">
            <button className="primary" disabled={!dirty || busy} onClick={save}>Save</button>
            {(cur.status === 'draft' || cur.status === 'changes_requested') && <button disabled={busy || dirty} onClick={() => run({ status: 'in_review' })}>Send to review</button>}
            {cur.status === 'in_review' && <button disabled={busy} onClick={() => run({ status: 'draft' })}>Pull back to draft</button>}
            {isAdmin(me.roles) && cur.status !== 'retired' && <button disabled={busy} onClick={() => { if (confirm('Retire this card? It is hidden from learners but never deleted.')) run({ status: 'retired' }); }}>Retire</button>}
            {isAdmin(me.roles) && cur.status === 'retired' && <button disabled={busy} onClick={() => run({ status: 'draft' })}>Restore as draft</button>}
          </div>
        )}
        {edit && dirty && approved && <p className="warn">This card is approved. Saving a change sends it back to review.</p>}

        <h3>Review at version {cur.version}</h3>
        <ul className="checks">
          {FIELDS.map(x => { const r = latest[x.key]; return (
            <li key={x.key} className={r ? r.verdict : 'none'}>
              <b>{r ? (r.verdict === 'ok' ? '✓' : '✎') : '○'}</b> {x.label}
              {r?.comment && <em> — {r.comment}</em>}
            </li>
          ); })}
        </ul>
      </aside>
    </div>
  );
}
