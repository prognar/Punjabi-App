import { buildQuestion, engine as E, fallbackExercise, type Card, type HistoryEntry, type Item, type Question } from '@punjabi-app/core';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bar, Button, Screen } from '@/components/ui';
import { prefetch, sayItem, sayText, stop } from '@/lib/audio';
import { model } from '@/lib/content';
import { useStore } from '@/lib/store';
import { commit } from '@/lib/sync';
import { C } from '@/lib/theme';


interface Summary { right: number; total: number; xp: number; unlocked: boolean; synced: boolean }

export default function Session() {
  const { learner, progress: pr, profile, bump } = useStore();
  const router = useRouter();
  const queue = useRef<Card[] | null>(null);
  const changed = useRef(new Set<string>());
  const answers = useRef<{ h: HistoryEntry; ms?: number }[]>([]);
  const shownAt = useRef(Date.now());
  const xpStart = useRef(0);
  const [pos, setPos] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [saving, setSaving] = useState(false);

  // build the session once
  if (!queue.current && pr && profile) {
    E.weeklyUnlock(pr, profile, model.lessons);
    queue.current = E.buildSession(pr, profile, model, 'all').queue;
    prefetch([...new Set(queue.current.map(c => c.id))].map(id => model.items[id]));
    xpStart.current = E.xpToday(pr);
  }
  const q = queue.current ?? [];
  const card: Card | undefined = q[pos];
  const item: Item | undefined = card && model.items[card.id];
  const ex = card && item ? fallbackExercise(card.ex, item) : undefined;
  const question: Question | null = useMemo(() => (item && ex && ex !== 'intro' ? buildQuestion(model, ex, item) : null), [pos, item, ex]); // eslint-disable-line react-hooks/exhaustive-deps

  /** the word-letter prompt is a picture word, not the card itself */
  function hearPrompt() {
    if (!item || !question?.prompt.speak) return;
    if (question.ex === 'word-letter') sayText(question.prompt.speak, question.prompt.sub ?? '');
    else sayItem(item);
  }

  useEffect(() => {
    shownAt.current = Date.now();
    if (!item || !ex) return;
    if (ex === 'intro') sayItem(item);
    else if (question?.prompt.speak) hearPrompt();
  }, [pos]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(async (done: boolean) => {
    if (!learner || !pr || saving) return;
    setSaving(true); stop();
    const unlocked = done ? E.maybeAdvance(pr, model.lessons) : false;
    E.touchStreak(pr);
    const synced = await commit(learner, pr, [...changed.current], answers.current);
    bump();
    if (!done) { router.back(); return; }
    setSummary({ right: answers.current.filter(a => a.h.ok).length, total: answers.current.length, xp: E.xpToday(pr) - xpStart.current, unlocked, synced });
    setSaving(false);
  }, [learner, pr, saving, bump, router]);

  const leave = useCallback(() => {
    if (summary) { router.back(); return true; }
    Alert.alert('Stop practicing?', 'Your answers so far are saved.', [{ text: 'Keep going', style: 'cancel' }, { text: 'Stop', onPress: () => finish(false) }]);
    return true;
  }, [summary, finish, router]);
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', leave); return () => sub.remove(); }, [leave]);

  if (!learner || !pr || !profile) return <Redirect href="/" />;

  const next = () => { setPicked(null); if (pos + 1 >= q.length) finish(true); else setPos(pos + 1); };

  const gotIt = () => { if (!card) return; E.markIntroduced(pr, card.id); changed.current.add(card.id); next(); };
  const choose = (id: string) => {
    if (picked || !card || !question || !ex) return;
    const ok = id === question.answerId;
    setPicked(id);
    E.record(pr, card.id, ok, ex, card.review, { soft: card.reinforce || card.retry });
    changed.current.add(card.id);
    answers.current.push({ h: pr.history[pr.history.length - 1], ms: Date.now() - shownAt.current });
    if (!ok) E.requeueMiss(q, pos, card, model);
    if (item && item.kind !== 'letter') sayItem(item);
  };

  if (summary) {
    return (
      <Screen>
        <View style={s.center}>
          <Text style={s.emoji}>{summary.unlocked ? '🎉' : '👏'}</Text>
          <Text style={s.title}>{summary.unlocked ? `Lesson ${pr.unlocked} unlocked!` : 'Nice work!'}</Text>
          <Text style={s.sub}>{summary.right} of {summary.total} correct · +{summary.xp} XP</Text>
          {!summary.synced && <Text style={s.note}>Saved on this phone. It will sync when you're back online.</Text>}
        </View>
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }
  if (!card || !item) {
    return <Screen><View style={s.center}><Text style={s.title}>Nothing to practice right now</Text><Text style={s.sub}>Come back later for review.</Text></View><Button title="Back" onPress={() => router.back()} /></Screen>;
  }

  const ok = picked ? picked === question?.answerId : null;
  return (
    <Screen>
      <View style={s.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Stop practicing" hitSlop={12} onPress={leave} style={s.close}><Text style={s.closeX}>✕</Text></Pressable>
        <View style={{ flex: 1 }}><Bar value={pos / q.length} /></View>
      </View>

      {ex === 'intro' ? (
        <>
          <ScrollView contentContainerStyle={s.body}>
            <Text style={s.instruction}>New {item.kind === 'letter' ? 'letter' : item.kind === 'vocab' ? 'word' : 'phrase'}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Hear it" onPress={() => sayItem(item)} style={s.promptCard}>
              <Text style={[s.pa, item.kind === 'letter' && s.glyph]}>{item.kind === 'letter' ? item.glyph : item.paAnswers[0]}</Text>
              <Text style={s.rom}>{item.kind === 'letter' ? item.rom : item.romAnswers[0]}</Text>
              <Text style={s.en}>{item.kind === 'letter' ? `sounds like ${item.sound}` : item.en}</Text>
              <Text style={s.hear}>🔊 tap to hear</Text>
            </Pressable>
            {item.kind === 'phrase' && (
              <Pressable accessibilityRole="button" accessibilityLabel="Hear it slowly" onPress={() => sayItem(item, true)} style={s.slowBtn}><Text style={s.slowText}>🐢 slowly</Text></Pressable>
            )}
            {item.kind === 'letter' && item.words?.map(w => (
              <Pressable key={w.pa} accessibilityRole="button" onPress={() => sayText(w.pa, w.rom)} style={s.wordRow}>
                <Text style={s.wordEmoji}>{w.emoji}</Text><Text style={s.wordPa}>{w.pa}</Text><Text style={s.wordEn}>{w.rom} · {w.en}</Text>
              </Pressable>
            ))}
            {!!item.note && <Text style={s.note}>{item.note}</Text>}
          </ScrollView>
          <Button title="Got it" onPress={gotIt} />
        </>
      ) : question ? (
        <>
          <ScrollView contentContainerStyle={s.body}>
            <Text style={s.instruction}>{question.instruction}</Text>
            <Pressable accessibilityRole={question.prompt.speak ? 'button' : 'text'} disabled={!question.prompt.speak} onPress={hearPrompt} style={s.promptCard}>
              {!!question.prompt.emoji && <Text style={s.emoji}>{question.prompt.emoji}</Text>}
              <Text style={question.prompt.gurmukhi ? [s.pa, item.kind === 'letter' && s.glyph] : s.promptEn}>{question.prompt.text}</Text>
              {!!question.prompt.sub && profile.settings.showRoman && <Text style={s.rom}>{question.prompt.sub}</Text>}
              {!!question.prompt.speak && <Text style={s.hear}>🔊 tap to hear</Text>}
            </Pressable>
            <View style={s.choices}>
              {question.choices.map(c => {
                const isAnswer = c.id === question.answerId, isPicked = c.id === picked;
                return (
                  <Pressable key={c.id} accessibilityRole="button" disabled={!!picked} onPress={() => choose(c.id)}
                    style={[s.choice, picked && isAnswer && s.choiceOk, picked && isPicked && !isAnswer && s.choiceBad]}>
                    <Text style={c.gurmukhi ? s.choicePa : s.choiceEn}>{c.label}</Text>
                    {!!c.sub && profile.settings.showRoman && <Text style={s.choiceSub}>{c.sub}</Text>}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          {picked && (
            <View style={[s.feedback, ok ? s.feedbackOk : s.feedbackBad]}>
              <Text style={[s.feedbackText, { color: ok ? C.ok : C.bad }]}>{ok ? 'Correct!' : 'Not quite'}</Text>
              {!ok && <Text style={s.feedbackSub}>{item.kind === 'letter' ? `${item.glyph}  ${item.rom}` : `${item.paAnswers[0]}  ·  ${item.romAnswers[0]}  ·  ${item.en}`}</Text>}
              <Button title="Continue" kind={ok ? 'ok' : 'bad'} onPress={next} busy={saving} />
            </View>
          )}
        </>
      ) : (
        <View style={s.center}><Button title="Skip" kind="plain" onPress={next} /></View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, closeX: { fontSize: 22, color: C.muted },
  body: { gap: 14, paddingBottom: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  instruction: { fontSize: 20, fontWeight: '800', color: C.ink },
  promptCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 22, alignItems: 'center', gap: 6 },
  pa: { fontSize: 44, lineHeight: 64, color: C.ink, textAlign: 'center' }, glyph: { fontSize: 96, lineHeight: 130 },
  promptEn: { fontSize: 30, fontWeight: '700', color: C.ink, textAlign: 'center' },
  rom: { fontSize: 20, color: C.accent, textAlign: 'center' }, en: { fontSize: 20, color: C.ink, textAlign: 'center' },
  hear: { fontSize: 13, color: C.muted, marginTop: 4 },
  slowBtn: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 18, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, justifyContent: 'center' },
  slowText: { fontSize: 16, color: C.ink },
  wordRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12, minHeight: 56 },
  wordEmoji: { fontSize: 28 }, wordPa: { fontSize: 24, color: C.ink }, wordEn: { fontSize: 15, color: C.muted, flex: 1 },
  choices: { gap: 10 },
  choice: { backgroundColor: C.card, borderWidth: 2, borderColor: C.line, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16, minHeight: 64, alignItems: 'center', justifyContent: 'center' },
  choiceOk: { borderColor: C.ok, backgroundColor: C.okSoft }, choiceBad: { borderColor: C.bad, backgroundColor: C.badSoft },
  choicePa: { fontSize: 28, lineHeight: 42, color: C.ink, textAlign: 'center' }, choiceEn: { fontSize: 19, fontWeight: '600', color: C.ink, textAlign: 'center' },
  choiceSub: { fontSize: 14, color: C.muted },
  feedback: { borderRadius: 16, padding: 14, gap: 8 }, feedbackOk: { backgroundColor: C.okSoft }, feedbackBad: { backgroundColor: C.badSoft },
  feedbackText: { fontSize: 20, fontWeight: '800' }, feedbackSub: { fontSize: 17, color: C.ink },
  emoji: { fontSize: 56 }, title: { fontSize: 26, fontWeight: '800', color: C.ink, textAlign: 'center' }, sub: { fontSize: 17, color: C.muted, textAlign: 'center' },
  note: { fontSize: 14, color: C.muted, textAlign: 'center' }
});
