import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { callApi } from '@/lib/api-host';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Banner, Button, EmptyState, Input, Muted } from '@/components/ui';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';
import { CritiHead } from '@/components/criti-head';

/**
 * Criti on the phone.
 *
 * The same assistant as the console's dock, reached over the web API so the
 * model key stays server-side and the board it reads is scoped by the caller's
 * own RLS. What changes on mobile is the framing: a crew member asks about
 * their own calls and their own shift, one-handed, so the suggestions are field
 * questions rather than control-room ones.
 */

type Message = { role: 'user' | 'assistant'; text: string };

const SUGGESTIONS = [
  tx('What are my open incidents?'),
  tx('Who else is on duty in my department?'),
  tx('What is the status of the last incident I attended?'),
  tx('When is my next shift?'),
];

export default function AssistantScreen() {
  const { t } = useT();
  const styles = useStyles();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;

    const next: Message[] = [...messages, { role: 'user', text: question }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError(null);

    try {
      const res = await callApi<{ reply: string }>('/api/chat', {
        messages: next.map((m) => ({ role: m.role, text: m.text })),
        page: 'mobile',
      });
      setMessages([...next, { role: 'assistant', text: res.reply }]);
    } catch (e) {
      setError((e as Error).message);
      // Drop the unanswered question back into the box so a retry does not mean
      // retyping it with one hand in a vehicle.
      setMessages(messages);
      setInput(question);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    }
  }, [messages, busy]);

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
          <EmptyState
            iconNode={<CritiHead size={30} />}
            title={t('Ask Criti')}
            body={t('Criti can see the same board you can — your incidents, your crew, your shift. It cannot see another department\'s records.')}
            action={
              <View style={{ gap: space.sm }}>
                {SUGGESTIONS.map((s) => (
                  <Button key={s} label={t(s)} variant="subtle" size="sm" onPress={() => void send(t(s))} />
                ))}
              </View>
            }
          />
        ) : null}

        {messages.map((m, i) => (
          <View
            key={`${i}-${m.text.slice(0, 12)}`}
            style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleBot]}
          >
            {m.role === 'assistant' ? (
              <View style={styles.botHead}>
                <CritiHead size={16} />
                <Text style={styles.botName}>{t('CRITI')}</Text>
              </View>
            ) : null}
            <Text style={m.role === 'user' ? styles.userText : styles.botText}>{m.text}</Text>
          </View>
        ))}

        {busy ? (
          <View style={[styles.bubble, styles.bubbleBot, styles.thinking]}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Muted>{t('Reading the board…')}</Muted>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.composer}>
        <View style={{ flex: 1 }}>
          <Input
            placeholder={t('Ask about your incidents, crew or shift…')}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => void send(input)}
            returnKeyType="send"
            multiline
          />
        </View>
        <Button
          label={t('Send')}
          icon="send"
          busy={busy}
          disabled={!input.trim()}
          onPress={() => void send(input)}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  thread: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },

  bubble: {
    maxWidth: '88%',
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.md - 2,
    borderWidth: 1,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accentSoft,
    borderColor: `${colors.accent}55`,
    borderBottomRightRadius: radius.sm,
  },
  bubbleBot: {
    alignSelf: 'flex-start',
    backgroundColor: colors.bgCard,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  botHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  botName: { ...type.label, fontSize: 9, color: colors.accent },
  userText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  botText: { color: colors.textDim, fontSize: 14, lineHeight: 21 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  composer: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-end',
    padding: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bgSoft,
  },
}));
