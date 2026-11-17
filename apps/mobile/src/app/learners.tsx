import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Screen } from '@/components/ui';
import { useStore } from '@/lib/store';
import type { Learner } from '@/lib/sync';
import { C } from '@/lib/theme';

const AVATARS = ['🦁', '🐯', '🦚', '🐘', '🦊', '🐼', '🦄', '🌟'];

export default function Learners() {
  const { session, learners, selectLearner, addLearner, signOut } = useStore();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'kid' | 'adult'>('kid');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!session) return <Redirect href="/sign-in" />;

  const pick = async (l: Learner) => { setBusy(l.id); await selectLearner(l); setBusy(''); router.replace('/home'); };
  const add = async () => {
    setBusy('add'); setError('');
    try { await addLearner(name.trim(), type, avatar); router.replace('/home'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not add the learner'); }
    setBusy('');
  };
  const showForm = adding || learners.length === 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{learners.length ? "Who's learning?" : 'Add your first learner'}</Text>
        {learners.map(l => (
          <Pressable key={l.id} accessibilityRole="button" style={s.row} disabled={!!busy} onPress={() => pick(l)}>
            <Text style={s.avatar}>{l.avatar}</Text>
            <View style={{ flex: 1 }}><Text style={s.name}>{l.name}</Text><Text style={s.meta}>{l.type === 'kid' ? 'Kid' : 'Adult'} · Lesson {l.unlocked}</Text></View>
            <Text style={s.meta}>{busy === l.id ? 'Loading…' : '›'}</Text>
          </Pressable>
        ))}

        {showForm ? (
          <View style={s.form}>
            <TextInput style={s.input} placeholder="Name" placeholderTextColor={C.muted} value={name} onChangeText={setName} maxLength={24} />
            <View style={s.seg}>
              {(['kid', 'adult'] as const).map(t => (
                <Pressable key={t} accessibilityRole="button" accessibilityState={{ selected: type === t }} style={[s.segBtn, type === t && s.segOn]} onPress={() => setType(t)}>
                  <Text style={[s.segText, type === t && { color: C.accentInk }]}>{t === 'kid' ? 'Kid' : 'Adult'}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.avatars}>
              {AVATARS.map(a => (
                <Pressable key={a} accessibilityRole="button" accessibilityLabel={'Avatar ' + a} style={[s.avatarBtn, avatar === a && s.avatarOn]} onPress={() => setAvatar(a)}><Text style={s.avatar}>{a}</Text></Pressable>
              ))}
            </View>
            {!!error && <Text style={s.error}>{error}</Text>}
            <Button title="Add learner" onPress={add} disabled={!name.trim()} busy={busy === 'add'} />
            {learners.length > 0 && <Button title="Cancel" kind="plain" onPress={() => setAdding(false)} />}
          </View>
        ) : (
          learners.length < 6 && <Button title="+ Add a learner" kind="plain" onPress={() => setAdding(true)} />
        )}
        <Pressable accessibilityRole="button" onPress={signOut} style={{ padding: 12 }}><Text style={s.link}>Sign out ({session.user.email})</Text></Pressable>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 12, paddingVertical: 24 },
  title: { fontSize: 26, fontWeight: '800', color: C.ink, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16 },
  avatar: { fontSize: 32 }, name: { fontSize: 19, fontWeight: '700', color: C.ink }, meta: { fontSize: 14, color: C.muted },
  form: { gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, minHeight: 52, fontSize: 17, color: C.ink, backgroundColor: C.bg },
  seg: { flexDirection: 'row', gap: 8 }, segBtn: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: C.accent, borderColor: C.accent }, segText: { fontSize: 16, fontWeight: '700', color: C.ink },
  avatars: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, avatarBtn: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  avatarOn: { borderColor: C.accent, backgroundColor: C.accentSoft },
  error: { color: C.bad, fontSize: 15 }, link: { color: C.accent, fontSize: 15, textAlign: 'center' }
});
