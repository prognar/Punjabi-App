import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '@/lib/theme';

export function Screen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <SafeAreaView style={[s.screen, style]}>{children}</SafeAreaView>;
}
export function Button({ title, onPress, kind = 'primary', disabled, busy }: { title: string; onPress: () => void; kind?: 'primary' | 'plain' | 'ok' | 'bad'; disabled?: boolean; busy?: boolean }) {
  const bg = kind === 'primary' ? C.accent : kind === 'ok' ? C.ok : kind === 'bad' ? C.bad : C.card;
  return (
    <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 }, kind === 'plain' && s.btnPlain]}>
      {busy ? <ActivityIndicator color={kind === 'plain' ? C.accent : C.accentInk} /> : <Text style={[s.btnText, kind === 'plain' && { color: C.ink }]}>{title}</Text>}
    </Pressable>
  );
}
export function Bar({ value, color = C.accent }: { value: number; color?: string }) {
  return <View style={s.bar}><View style={[s.barFill, { width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color }]} /></View>;
}
export function Loading() { return <Screen style={{ alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={C.accent} /></Screen>; }

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg, padding: 20 },
  btn: { minHeight: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnPlain: { borderWidth: 1, borderColor: C.line },
  btnText: { color: C.accentInk, fontSize: 18, fontWeight: '700' },
  bar: { height: 12, borderRadius: 6, backgroundColor: C.line, overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 6 }
});
