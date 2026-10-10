import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { countAssignedToMeToday } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { wordsFor } from '@/lib/department';
import { useOpenCall } from '@/lib/open-call';
import { colors, radius, space, makeStyles, useTheme } from '@/lib/theme';

type Kpi = {
  key: string;
  label: string;
  /** Read out by screen readers; the strip itself has no room for it. */
  detail: string;
  value: number | null | undefined;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
};

/**
 * The home screen's figures, under the welcome — one slim strip, all live or
 * today: what is open now, what closed today, what this officer is
 * responding to now, and how many incidents dispatch assigned them today.
 */
export function HomeKpis({ live, closedToday }: { live?: number; closedToday?: number }) {
  const styles = useStyles();
  const { isDark } = useTheme();
  const { session, silo } = useAuth();
  const { calls, awaiting } = useOpenCall();
  const [assignedToday, setAssignedToday] = useState<number | null>(null);

  const loadAssigned = useCallback(() => {
    if (!session) return;
    void countAssignedToMeToday(getSupabase(), session.user.id).then(setAssignedToday).catch(() => {});
  }, [session]);

  // On every visit, and whenever a new assignment lands (the waiting list changes).
  useFocusEffect(loadAssigned);
  const waitingKey = awaiting.map((a) => a.id).join(',');
  useEffect(() => { loadAssigned(); }, [waitingKey, loadAssigned]);

  const kpis: Kpi[] = [
    { key: 'live', label: 'Live', detail: 'Open right now', value: live, icon: 'pulse', tone: '#ef4444' },
    { key: 'closed', label: 'Closed today', detail: 'Since midnight', value: closedToday, icon: 'checkmark-done', tone: '#22c55e' },
    { key: 'mine', label: 'Mine', detail: 'Incidents you are responding to', value: calls.length, icon: wordsFor(silo).movingIcon, tone: '#3b82f6' },
    {
      key: 'assigned', label: 'Assigned today',
      detail: awaiting.length ? `${awaiting.length} still waiting for your response` : 'Assigned to you since midnight',
      value: assignedToday, icon: 'person-add', tone: '#f59e0b',
    },
  ];

  return (
    <View style={styles.strip}>
      {kpis.map((k, i) => (
        <View
          key={k.key}
          style={[styles.cell, i > 0 && styles.divider]}
          accessible
          accessibilityLabel={`${k.label}: ${k.value ?? 'not available'}. ${k.detail}`}
        >
          <View style={[styles.accent, { backgroundColor: k.tone }]} />
          <View style={styles.top}>
            <Ionicons name={k.icon} size={13} color={k.tone} />
            <Text style={[styles.value, { textShadowColor: isDark ? `${k.tone}99` : 'transparent' }]}>
              {k.value === null || k.value === undefined ? '—' : k.value}
            </Text>
          </View>
          <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {k.label.toUpperCase()}
          </Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  strip: {
    flexDirection: 'row', marginBottom: space.lg, overflow: 'hidden',
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.panelBorder,
    backgroundColor: colors.panel,
  },
  cell: { flex: 1, alignItems: 'center', paddingTop: 9, paddingBottom: 8, paddingHorizontal: 4 },
  divider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider },
  accent: { position: 'absolute', top: 0, left: '25%', right: '25%', height: 2, borderRadius: 1, opacity: 0.9 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  value: {
    color: colors.text, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'],
    textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 },
  },
  label: { color: colors.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.9, marginTop: 1 },
}));
