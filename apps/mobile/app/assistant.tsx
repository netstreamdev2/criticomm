import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { callApi } from '@/lib/api-host';
import { useAuth } from '@/lib/auth';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Banner, Button, Input, Muted } from '@/components/ui';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';
import { CritiHead } from '@/components/criti-head';

/**
 * Criti on the phone, for the person holding it (2026-10-23).
 *
 * Criti reads their own day on the server, with their own sign-in: duty,
 * today's shift and the next two weeks, leave left, their calls (the one on
 * screen first), kit, messages and certificates, and answers in plain words
 * in the app's language. It explains and offers buttons that open the right
 * screen; it never does the work (no responding, on scene, report, fine or
 * leave). Opened from the Criti button on any screen, it knows which screen.
 *
 * The conversation stays while the app is open, so stepping out to look at
 * something and coming back keeps the thread.
 */

type Open = { label: string; href: string };
type Message = { role: 'user' | 'assistant'; text: string; open?: Open[] };

const FALLBACK = [
  tx('Explain my shift in easy words'),
  tx('When is my next day off?'),
  tx('How much leave do I have left?'),
  tx('How does on scene by GPS work?'),
];

// The thread, kept for this person while the app runs.
let kept: { userId: string; messages: Message[] } | null = null;

export default function AssistantScreen() {
  const { t, lang } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const params = useLocalSearchParams<{ from?: string; incident?: string }>();
  const screen = params.from ?? '';
  const [messages, setMessages] = useState<Message[]>(kept?.userId === userId ? kept.messages : []);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);

  useEffect(() => { kept = { userId, messages }; }, [userId, messages]);

  // The first questions, made for this person and this screen.
  useEffect(() => {
    let alive = true;
    void callApi<{ suggestions?: string[] }>('/api/criti/field', { mode: 'hello', screen, incidentId: params.incident, lang })
      .then((r) => { if (alive) setSuggestions(r.suggestions?.length ? r.suggestions : FALLBACK); })
      .catch(() => { if (alive) setSuggestions(FALLBACK); });
    return () => { alive = false; };
  }, [screen, params.incident, lang]);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const next: Message[] = [...messages, { role: 'user', text: question }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const res = await callApi<{ reply: string; open?: Open[] }>('/api/criti/field', {
        messages: next.map((m) => ({ role: m.role, text: m.text })),
        screen,
        incidentId: params.incident,
        lang,
      });
      setMessages([...next, { role: 'assistant', text: res.reply, open: res.open ?? [] }]);
    } catch (e) {
      setError((e as Error).message);
      // The question goes back in the box: no retyping with one hand.
      setMessages(messages);
      setInput(question);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    }
  }, [messages, busy, screen, params.incident, lang]);

  const startOver = () => { setMessages([]); setError(null); };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}
    >
      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.thread, messages.length === 0 && { flexGrow: 1 }]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
      >
        {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}

        {messages.length === 0 ? (
          <View style={styles.hello}>
            <View style={styles.helloHead}><CritiHead size={44} /></View>
            <Text style={styles.helloTitle}>{t('Hi, I am Criti')}</Text>
            <Muted style={{ textAlign: 'center' }}>
              {t('I know your shift, your calls, your leave and your kit. Ask me anything about your work, in your own words. I explain and show you where to go; you do the work.')}
            </Muted>
            <View style={styles.chips}>
              {suggestions === null ? <ActivityIndicator color={colors.accent} /> : suggestions.map((s) => (
                <Pressable key={s} onPress={() => void send(t(s))} style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.chipText}>{t(s)}</Text>
                </Pressable>
              ))}
            </View>
            <Muted style={styles.tip}>{t('Tip: tap the microphone on your keyboard to speak instead of typing.')}</Muted>
          </View>
        ) : null}

        {messages.map((m, i) => (
          <View key={`${i}-${m.text.slice(0, 12)}`} style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleBot]}>
            {m.role === 'assistant' ? (
              <View style={styles.botHead}>
                <CritiHead size={16} />
                <Text style={styles.botName}>{t('CRITI')}</Text>
              </View>
            ) : null}
            <Text style={m.role === 'user' ? styles.userText : styles.botText}>{m.text}</Text>
            {m.open?.length ? (
              <View style={styles.opens}>
                {m.open.map((o) => (
                  <Pressable key={o.href} onPress={() => router.push(o.href as never)} style={({ pressed }) => [styles.open, pressed && { opacity: 0.7 }]}>
                    <Text style={styles.openText}>{t(o.label)}</Text>
                    <Ionicons name="arrow-forward" size={14} color={colors.accent} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        {busy ? (
          <View style={[styles.bubble, styles.bubbleBot, styles.thinking]}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Muted>{t('Looking at your day…')}</Muted>
          </View>
        ) : null}

        {messages.length > 0 && !busy ? (
          <Pressable onPress={startOver} hitSlop={8} style={{ alignSelf: 'center', marginTop: space.sm }}>
            <Text style={styles.link}>{t('Start a new question')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={styles.composer}>
        <View style={{ flex: 1 }}>
          <Input
            placeholder={t('Ask about your shift, calls, leave or the app…')}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => void send(input)}
            returnKeyType="send"
            multiline
          />
        </View>
        <Button label={t('Send')} icon="send" busy={busy} disabled={!input.trim()} onPress={() => void send(input)} />
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  thread: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },
  hello: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.sm },
  helloHead: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: `${colors.accent}55`,
  },
  helloTitle: { color: colors.text, fontSize: 22, fontWeight: '900' },
  chips: { alignSelf: 'stretch', gap: space.sm, marginTop: space.sm },
  chip: {
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.panel,
    paddingHorizontal: space.md, paddingVertical: space.md,
  },
  chipText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  tip: { fontSize: 12, textAlign: 'center', marginTop: space.sm },

  bubble: { maxWidth: '88%', borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: space.md - 2, borderWidth: 1 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.accentSoft, borderColor: `${colors.accent}55`, borderBottomRightRadius: radius.sm },
  bubbleBot: { alignSelf: 'flex-start', backgroundColor: colors.bgCard, borderColor: colors.border, borderBottomLeftRadius: radius.sm },
  botHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  botName: { ...type.label, fontSize: 9, color: colors.accent },
  userText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  botText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  opens: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  open: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, borderWidth: 1,
    borderColor: `${colors.accent}66`, paddingHorizontal: space.md, paddingVertical: 8,
  },
  openText: { color: colors.accent, fontWeight: '800', fontSize: 13 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  link: { color: colors.accent, fontWeight: '700' },

  composer: {
    flexDirection: 'row', gap: space.sm, alignItems: 'flex-end', padding: space.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bgSoft,
  },
}));
