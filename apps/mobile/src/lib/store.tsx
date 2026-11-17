import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { engine as E, type Profile, type Progress } from '@punjabi-app/core';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { createLearner, ensureAccount, fetchLearners, loadProgress, push, type Learner } from './sync';

interface Store {
  ready: boolean;
  session: Session | null;
  learners: Learner[];
  learner: Learner | null;
  /** Mutable engine state for the active learner. Call bump() after changing it so screens re-render. */
  progress: Progress | null;
  profile: Profile | null;
  version: number;
  bump: () => void;
  selectLearner: (l: Learner | null) => Promise<void>;
  addLearner: (name: string, type: 'kid' | 'adult', avatar: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const Ctx = createContext<Store | null>(null);
export const useStore = () => { const s = useContext(Ctx); if (!s) throw new Error('StoreProvider missing'); return s; };

const ACTIVE = 'active-learner';

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [learner, setLearner] = useState<Learner | null>(null);
  const progress = useRef<Progress | null>(null);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion(v => v + 1), []);

  const selectLearner = useCallback(async (l: Learner | null) => {
    if (!l) { progress.current = null; setLearner(null); await AsyncStorage.removeItem(ACTIVE); return; }
    const pr = await loadProgress(l);
    progress.current = pr; setLearner(l); setVersion(v => v + 1);
    await AsyncStorage.setItem(ACTIVE, l.id);
    push(l, pr); // send anything left over from an offline session
  }, []);

  const uid = session?.user.id;
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!uid) { setLearners([]); setLearner(null); progress.current = null; return; }
    let live = true;
    (async () => {
      try {
        await ensureAccount(uid);
        const list = await fetchLearners(uid);
        if (!live) return;
        setLearners(list);
        const active = await AsyncStorage.getItem(ACTIVE);
        const l = list.find(x => x.id === active);
        if (l) await selectLearner(l);
      } catch { /* offline at start: the learners screen shows a retry */ }
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, [uid, selectLearner]);

  const addLearner = useCallback(async (name: string, type: 'kid' | 'adult', avatar: string) => {
    if (!uid) return;
    const l = await createLearner(uid, name, type, avatar);
    setLearners(ls => ls.concat(l));
    await selectLearner(l);
  }, [uid, selectLearner]);

  const signOut = useCallback(async () => { await selectLearner(null); await supabase.auth.signOut(); }, [selectLearner]);

  const profile = useMemo<Profile | null>(() => learner && {
    id: learner.id, name: learner.name, avatar: learner.avatar, type: learner.type,
    // tracing and speech exercises are not in this build yet, so the engine is told not to schedule writing
    settings: { ...E.PROFILE_DEFAULTS[learner.type], ...(learner.settings as object), writing: false, speech: false }
  }, [learner]);

  const value: Store = { ready, session, learners, learner, progress: progress.current, profile, version, bump, selectLearner, addLearner, signOut };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
