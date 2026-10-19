import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { channelTone, listTalkChannels, talkChannelsToOffer, type TalkChannel } from '@criticom/api';
import { GLOBAL_ROLES, type UserRole } from '@criticom/db';
import type { TalkPass, TalkSession, TalkState } from '@criticom/api/talk';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { askMicrophone, liveKitNative, startTalkAudio, stopTalkAudio } from '@/lib/talk-native';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Banner, EmptyState } from '@/components/ui';
import { useT } from '@/lib/i18n';

/**
 * HikTech Talk on the phone: hold the big button to talk to dispatch and
 * your team, let go to listen. Who may join and speak is the database's
 * decision (talk_pass, 0083); every transmission is logged.
 */
export default function TalkScreen() {
  const { t } = useT();
  const styles = useStyles();
  const { session, role, silo } = useAuth();
  const params = useLocalSearchParams<{ channel?: string }>();
  const [channels, setChannels] = useState<TalkChannel[] | null>(null);
  const [channel, setChannel] = useState<string | null>(params.channel ?? null);
  const [state, setState] = useState<TalkState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const talk = useRef<TalkSession | null>(null);
  const holding = useRef(false);
  // The words change when the translations load; joining must not start again for that.
  const tRef = useRef(t);
  tRef.current = t;
  const available = Boolean(liveKitNative());

  // The talk groups I may join; a call's own channel when opened from a call.
  useEffect(() => {
    if (!session) return;
    const wanted = params.channel
      ? [params.channel]
      : talkChannelsToOffer({ silo, seesAll: GLOBAL_ROLES.includes(role as UserRole) });
    listTalkChannels(getSupabase(), wanted)
      .then((list) => {
        setChannels(list);
        setChannel((c) => c && list.some((x) => x.channel === c) ? c : list[0]?.channel ?? null);
      })
      .catch((e) => setProblem((e as Error).message));
  }, [session, silo, role, params.channel]);

  // Join the chosen group; leave when the screen closes or the group changes.
  useEffect(() => {
    if (!available || !channel) return;
    let cancelled = false;
    void (async () => {
      console.log('[talk] opening', channel);
      if (!(await askMicrophone())) setProblem(tRef.current('Allow the microphone to talk. You can still listen.'));
      // The audio session must not hold up joining: a few seconds at most.
      await Promise.race([
        startTalkAudio().then(() => console.log('[talk] audio session started')),
        new Promise((r) => setTimeout(r, 3000)),
      ]).catch((e) => console.log('[talk] audio session failed', String(e)));
      if (cancelled) return;
      const { TalkSession: Session } = require('@criticom/api/talk') as typeof import('@criticom/api/talk');
      const supabase = getSupabase();
      const s = new Session(channel, {
        getPass: async (c) => {
          const { data, error } = await supabase.rpc('talk_pass', { p_channel: c });
          if (error) throw new Error(error.message);
          return data as TalkPass;
        },
        logTalk: async (c, startedAt, endedAt) => {
          await supabase.rpc('log_talk', { p_channel: c, p_started_at: startedAt.toISOString(), p_ended_at: endedAt.toISOString() });
        },
        log: (m) => console.log(m),
        cue: (kind) => {
          if (kind === 'start') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          else if (kind === 'end') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          else if (kind === 'incoming') void Haptics.selectionAsync();
          else void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        },
      }, (st) => { if (!cancelled) setState(st); });
      talk.current = s;
      await s.connect().catch((e) => console.log('[talk] connect threw', String(e), (e as Error)?.stack ?? ''));
    })();
    return () => {
      cancelled = true;
      const s = talk.current;
      talk.current = null;
      void s?.close().finally(() => { void stopTalkAudio(); });
    };
  }, [available, channel]);

  const press = useCallback(async () => {
    if (holding.current || !talk.current) return;
    holding.current = true;
    const r = await talk.current.press();
    if (r === 'busy') {
      setBusy(true);
      setTimeout(() => setBusy(false), 900);
    }
    if (!holding.current) await talk.current.release();
  }, []);
  const release = useCallback(async () => {
    holding.current = false;
    await talk.current?.release();
  }, []);

  if (!available) {
    return (
      <View style={styles.center}>
        <EmptyState
          icon="radio-outline"
          title={t('Talk needs the new app')}
          body={t('This version of the app cannot carry voice yet. Install the latest HikTech app from your administrator.')}
        />
      </View>
    );
  }
  if (channels === null) return <View style={styles.center}><ActivityIndicator color={colors.text} /></View>;
  if (channels.length === 0) {
    return (
      <View style={styles.center}>
        <EmptyState icon="radio-outline" title={t('No talk group')} body={problem ?? t('Talk is not set up for you yet. Ask your administrator.')} />
      </View>
    );
  }

  const tone = channel ? channelTone(channel) : colors.primary;
  const s = state;
  const ready = s?.status === 'ready';
  const onAir = Boolean(s?.transmitting);
  const other = s?.talking && !s.talking.me ? s.talking : null;
  const canSpeak = Boolean(s?.canSpeak);
  const label = onAir ? t('ON AIR') : busy ? t('BUSY') : canSpeak ? t('HOLD TO TALK') : t('LISTEN ONLY');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {problem ? <Banner tone="info">{problem}</Banner> : null}

      {channels.length > 1 ? (
        <View style={styles.chips}>
          {channels.map((c) => {
            const on = c.channel === channel;
            const ct = channelTone(c.channel);
            return (
              <Pressable
                key={c.channel}
                onPress={() => setChannel(c.channel)}
                style={[styles.chip, { borderColor: on ? ct : `${ct}55`, backgroundColor: on ? `${ct}33` : 'transparent' }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, on && { color: ct }]}>{c.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={[styles.statusCard, { borderColor: other ? colors.low : onAir ? colors.primary : colors.border }]}>
        {!s || s.status === 'connecting' ? (
          <>
            <Text style={styles.statusText}>{t('Joining…')}</Text>
            {s?.step ? <Text style={styles.statusSub}>{s.step}</Text> : null}
          </>
        ) : s.status === 'reconnecting' || s.status === 'error' ? (
          <>
            <Text style={[styles.statusText, { color: colors.medium }]}>{s.error ?? t('Reconnecting…')}</Text>
            <Text style={styles.statusSub}>{s.step}</Text>
          </>
        ) : other ? (
          <Text style={styles.statusText}><Text style={{ color: colors.low, fontWeight: '800' }}>{other.name}</Text> {t('is talking')}</Text>
        ) : onAir ? (
          <Text style={[styles.statusText, { color: colors.primary }]}>{t('You are on the air. Let go to listen.')}</Text>
        ) : (
          <Text style={styles.statusText}>{t('Channel clear')}</Text>
        )}
        {ready ? <Text style={styles.statusSub}>{s?.name} · {t('{n} listening', { n: Math.max(0, (s?.people.length ?? 1) - 1) })}</Text> : null}
      </View>

      <Pressable
        onPressIn={() => void press()}
        onPressOut={() => void release()}
        disabled={!ready || !canSpeak}
        accessibilityRole="button"
        accessibilityLabel={t('Hold to talk')}
        style={[
          styles.ptt,
          { backgroundColor: onAir ? colors.primary : busy ? colors.textDim : tone, borderColor: onAir ? '#fecaca' : '#ffffff33' },
          (!ready || !canSpeak) && { opacity: 0.45 },
          onAir && { transform: [{ scale: 1.05 }] },
        ]}
      >
        <Ionicons name={canSpeak ? 'mic' : 'mic-off'} size={54} color="#fff" />
        <Text style={styles.pttText}>{label}</Text>
        {onAir && s?.secondsLeft ? <Text style={styles.pttSub}>{s.secondsLeft}s</Text> : null}
      </Pressable>

      {s?.people.length ? (
        <View style={styles.people}>
          {s.people.map((p) => (
            <View key={p.identity} style={[styles.person, p.talking && { borderColor: colors.low }]}>
              <View style={[styles.dot, { backgroundColor: p.talking ? colors.low : colors.textDim }]} />
              <Text style={styles.personText} numberOfLines={1}>{p.name}{p.me ? ` (${t('you')})` : ''}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, backgroundColor: colors.bg },
  container: { padding: space.lg, gap: space.lg, alignItems: 'stretch', backgroundColor: colors.bg, flexGrow: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 8 },
  chipText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  statusCard: { borderWidth: 2, borderRadius: radius.lg, padding: space.md, backgroundColor: colors.bgCard, minHeight: 72, justifyContent: 'center' },
  statusText: { ...type.h2, color: colors.text, textAlign: 'center' },
  statusSub: { ...type.small, color: colors.textDim, textAlign: 'center', marginTop: 4 },
  ptt: {
    alignSelf: 'center', width: 230, height: 230, borderRadius: 115, borderWidth: 6,
    alignItems: 'center', justifyContent: 'center', gap: 6, marginVertical: space.lg,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 14,
  },
  pttText: { color: '#fff', fontWeight: '900', fontSize: 18, letterSpacing: 1 },
  pttSub: { color: '#fff', fontWeight: '700', fontSize: 14, opacity: 0.9 },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  person: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6, maxWidth: '100%' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  personText: { color: colors.text, fontSize: 13, flexShrink: 1 },
}));
