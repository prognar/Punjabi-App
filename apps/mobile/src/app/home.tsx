import { engine as E } from '@punjabi-app/core';
import { Redirect, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bar, Button, Screen } from '@/components/ui';
import { model } from '@/lib/content';
import { useStore } from '@/lib/store';
import { C } from '@/lib/theme';

export default function Home() {
  const { session, learner, progress: pr, profile, selectLearner } = useStore();
  const router = useRouter();
  if (!session) return <Redirect href="/sign-in" />;
  if (!learner || !pr || !profile) return <Redirect href="/learners" />;

  const L = model.lessons[pr.unlocked - 1] ?? model.lessons[model.lessons.length - 1];
  const stats = E.lessonStats(pr, L);
  const xp = E.xpToday(pr), goal = profile.settings.dailyGoal;
  const { streak } = E.touchStreak(pr);
  const known = E.knownCounts(pr, model);
  const started = Object.keys(pr.items).length > 0;

  return (
    <Screen>
      <ScrollView contentContainerStyle={s.wrap}>
        <View style={s.head}>
          <Pressable accessibilityRole="button" accessibilityLabel="Switch learner" style={s.who} onPress={async () => { await selectLearner(null); router.replace('/learners'); }}>
            <Text style={s.avatar}>{learner.avatar}</Text><Text style={s.name}>{learner.name}</Text><Text style={s.muted}>  switch</Text>
          </Pressable>
          <Text style={s.streak}>🔥 {streak}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.muted}>Lesson {L.n} of {model.lessons.length}</Text>
          <Text style={s.big}>{Math.round(stats.progress * 100)}% learned</Text>
          <Bar value={stats.progress} />
          <Text style={s.muted}>{stats.mastered} of {stats.total} cards mastered · next lesson opens at 80%{stats.lockTomorrow ? ` · ${stats.lockTomorrow} more count after another day` : ''}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.muted}>Today</Text>
          <Text style={s.big}>{xp} / {goal} XP</Text>
          <Bar value={xp / goal} color={C.gold} />
        </View>

        <View style={s.tiles}>
          <Tile n={known.letter} label="letters" /><Tile n={known.vocab} label="words" /><Tile n={known.phrase} label="phrases" />
        </View>

        <Button title={started ? 'Practice' : 'Start lesson 1'} onPress={() => router.push('/session')} />
      </ScrollView>
    </Screen>
  );
}
function Tile({ n, label }: { n: number; label: string }) {
  return <View style={s.tile}><Text style={s.tileN}>{n}</Text><Text style={s.muted}>{label}</Text></View>;
}

const s = StyleSheet.create({
  wrap: { gap: 14, paddingVertical: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  who: { flexDirection: 'row', alignItems: 'center', minHeight: 48 }, avatar: { fontSize: 30, marginRight: 8 }, name: { fontSize: 20, fontWeight: '800', color: C.ink },
  streak: { fontSize: 20, fontWeight: '800', color: C.ink },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 16, gap: 8 },
  big: { fontSize: 26, fontWeight: '800', color: C.ink }, muted: { fontSize: 14, color: C.muted },
  tiles: { flexDirection: 'row', gap: 10 }, tile: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 14, alignItems: 'center' },
  tileN: { fontSize: 24, fontWeight: '800', color: C.accent }
});
