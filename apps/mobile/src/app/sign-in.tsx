import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Screen } from '@/components/ui';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/theme';

export default function SignIn() {
  const { session } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'in' | 'up' | null>(null);
  const [msg, setMsg] = useState('');
  if (session) return <Redirect href="/" />;

  const valid = /\S+@\S+\.\S+/.test(email.trim()) && password.length >= 6;
  const signIn = async () => {
    setBusy('in'); setMsg('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setMsg(error.message);
    setBusy(null);
  };
  const signUp = async () => {
    setBusy('up'); setMsg('');
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) setMsg(error.message);
    else if (!data.session) setMsg('Account created. Open the confirmation email we sent, then come back and sign in.');
    setBusy(null);
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.wrap}>
        <Text style={s.logo}>ਪੰਜਾਬੀ</Text>
        <Text style={s.title}>Learn Punjabi</Text>
        <Text style={s.sub}>A parent or adult account. Add up to 6 learners after you sign in.</Text>
        <View style={s.form}>
          <TextInput style={s.input} placeholder="Email" placeholderTextColor={C.muted} autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <TextInput style={s.input} placeholder="Password (6+ characters)" placeholderTextColor={C.muted} secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} />
          {!!msg && <Text style={s.msg}>{msg}</Text>}
          <Button title="Sign in" onPress={signIn} disabled={!valid || busy === 'up'} busy={busy === 'in'} />
          <Button title="Create account" kind="plain" onPress={signUp} disabled={!valid || busy === 'in'} busy={busy === 'up'} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center' },
  logo: { fontSize: 64, textAlign: 'center', color: C.accent },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', color: C.ink, marginTop: 4 },
  sub: { fontSize: 15, textAlign: 'center', color: C.muted, marginTop: 8, marginBottom: 24 },
  form: { gap: 12 },
  input: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, minHeight: 52, fontSize: 17, color: C.ink },
  msg: { color: C.bad, fontSize: 15 }
});
