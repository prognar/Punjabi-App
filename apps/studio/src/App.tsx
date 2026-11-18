import type { Session } from '@supabase/supabase-js';
import { useEffect, useState, type FormEvent } from 'react';
import { canRecord, canReview } from './lib/review';
import { Audio } from './pages/Audio';
import { Dashboard } from './pages/Dashboard';
import { Items } from './pages/Items';
import { Review } from './pages/Review';
import { supabase } from './supabase';
import type { Role } from './types';

export interface Me { id: string; email: string; name: string; roles: Role[] }
type Tab = 'dashboard' | 'items' | 'review' | 'audio';
const TABS: { key: Tab; label: string }[] = [{ key: 'dashboard', label: 'Dashboard' }, { key: 'items', label: 'Cards' }, { key: 'review', label: 'Review' }, { key: 'audio', label: 'Audio' }];
const tabFromHash = (): Tab => (TABS.find(t => '#' + t.key === location.hash)?.key ?? 'dashboard');

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(tabFromHash);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('hashchange', onHash); };
  }, []);

  const uid = session?.user.id;
  useEffect(() => {
    if (!uid) { setMe(session === null ? null : undefined); return; }
    let live = true;
    supabase.from('studio_users').select('roles, display_name').eq('id', uid).maybeSingle().then(({ data }) => {
      if (live) setMe({ id: uid, email: session!.user.email ?? '', name: data?.display_name || session!.user.email || '', roles: (data?.roles as Role[]) ?? [] });
    });
    return () => { live = false; };
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined || (session && me === undefined)) return <div className="center muted">Loading…</div>;
  if (!session || !me) return <Login />;
  if (!me.roles.length) return (
    <div className="center">
      <div className="card narrow">
        <h1>No Studio access yet</h1>
        <p>{me.email} is signed in but has no Studio role. Ask the owner to add you.</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  );

  return (
    <>
      <header className="top">
        <strong className="brand">ਪੰਜਾਬੀ Content Studio</strong>
        <nav>
          {TABS.filter(t => (t.key !== 'review' || canReview(me.roles)) && (t.key !== 'audio' || canReview(me.roles) || canRecord(me.roles))).map(t => (
            <a key={t.key} href={'#' + t.key} className={tab === t.key ? 'on' : ''}>{t.label}</a>
          ))}
        </nav>
        <span className="who">{me.name} · {me.roles.join(', ').replace(/_/g, ' ')}</span>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <main>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'items' && <Items me={me} />}
        {tab === 'review' && <Review me={me} />}
        {tab === 'audio' && <Audio me={me} />}
      </main>
    </>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setBusy(false);
  };
  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h1>ਪੰਜਾਬੀ Content Studio</h1>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
