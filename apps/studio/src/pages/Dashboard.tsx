import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { KINDS, KIND_LABEL, STATUSES, STATUS_LABEL, type LessonQuality, type StatusCount } from '../types';

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function Dashboard() {
  const [counts, setCounts] = useState<StatusCount[]>([]);
  const [lessons, setLessons] = useState<LessonQuality[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [c, l] = await Promise.all([
        supabase.from('item_status_counts').select('*'),
        supabase.from('lesson_quality').select('*').order('sort_order')
      ]);
      if (c.error || l.error) { setError((c.error || l.error)!.message); return; }
      setCounts(c.data as StatusCount[]); setLessons(l.data as LessonQuality[]);
    })();
  }, []);

  const n = (kind: string, status: string) => counts.find(x => x.kind === kind && x.status === status)?.n ?? 0;
  const shown = STATUSES.filter(s => counts.some(c => c.status === s && c.n > 0));
  const launch = lessons.filter(l => (l.legacy_n ?? 99) <= 20);
  const launchTotal = launch.reduce((a, l) => a + l.total, 0);

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      <section className="card">
        <h2>Launch gate: lessons 1–20</h2>
        <div className="tiles">
          <div><b>{pct(launch.reduce((a, l) => a + l.text_approved, 0), launchTotal)}%</b><span>text verified</span></div>
          <div><b>{pct(launch.reduce((a, l) => a + l.ready, 0), launchTotal)}%</b><span>verified and recorded</span></div>
          <div><b>{launch.reduce((a, l) => a + l.in_review, 0)}</b><span>waiting for review</span></div>
          <div><b>{launch.reduce((a, l) => a + l.changes_requested, 0)}</b><span>changes requested</span></div>
        </div>
      </section>

      <section className="card">
        <h2>All content by status</h2>
        <table>
          <thead><tr><th>Kind</th>{shown.map(s => <th key={s} className="num">{STATUS_LABEL[s]}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>
            {KINDS.map(k => (
              <tr key={k}><td>{KIND_LABEL[k]}s</td>{shown.map(s => <td key={s} className="num">{n(k, s) || '·'}</td>)}
                <td className="num"><b>{STATUSES.reduce((a, s) => a + n(k, s), 0)}</b></td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Lessons (letters, words and phrases)</h2>
        <table>
          <thead><tr><th>Lesson</th><th className="num">Cards</th><th>Text verified</th><th>Verified and recorded</th><th className="num">In review</th><th className="num">Changes</th></tr></thead>
          <tbody>
            {lessons.map(l => (
              <tr key={l.lesson_id}>
                <td>{l.title || 'Lesson ' + l.legacy_n}</td><td className="num">{l.total}</td>
                <td><Bar value={l.text_approved} total={l.total} /></td><td><Bar value={l.ready} total={l.total} /></td>
                <td className="num">{l.in_review || '·'}</td><td className="num">{l.changes_requested || '·'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Bar({ value, total }: { value: number; total: number }) {
  return <div className="bar" title={`${value} of ${total}`}><i style={{ width: pct(value, total) + '%' }} /><span>{value}/{total}</span></div>;
}
