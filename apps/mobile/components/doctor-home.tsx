import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { cleanupOnLogout, listHandovers } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Banner, Button, EmptyState, KeyValue, Muted } from '@/components/ui';
import { useT } from '@/lib/i18n';

type Handover = Awaited<ReturnType<typeof listHandovers>>[number];

const when = (iso: string) => new Date(iso).toLocaleString('en-ZA', {
  timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});

/**
 * The receiving doctor's app: the patients EMS handed over at the hospital,
 * newest first. Read only; the doctor signs on the crew's phone at handover.
 */
export function DoctorHome() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { fullName } = useAuth();
  const [rows, setRows] = useState<Handover[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listHandovers(getSupabase()));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((h) => [h.doctor_name, h.receiving_hosp, h.patient_status_at_handover, h.pcr?.patient_name, h.pcr?.report_number]
      .some((v) => (v ?? '').toLowerCase().includes(q)));
  }, [rows, query]);

  const renderRow = ({ item: h }: { item: Handover }) => {
    const open = openId === h.id;
    return (
      <Pressable
        onPress={() => setOpenId(open ? null : h.id)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
      >
        <View style={styles.rowTop}>
          <Text style={styles.patient} numberOfLines={1}>{h.pcr?.patient_name || t('Unknown Patient')}</Text>
          <Text style={styles.time}>{when(h.time_of_handover)}</Text>
        </View>
        <Text style={styles.sub} numberOfLines={1}>{h.receiving_hosp} · {h.doctor_name}</Text>
        <Text style={styles.status} numberOfLines={open ? undefined : 2}>{h.patient_status_at_handover ?? '—'}</Text>
        {open ? (
          <View style={styles.more}>
            <KeyValue label={t('Report')} value={h.pcr?.report_number ?? '—'} />
            <KeyValue label={t('Chief Complaint')} value={h.pcr?.chief_complaint ?? '—'} />
            <KeyValue label={t('Care Level')} value={h.pcr?.level_of_care ?? '—'} />
            <KeyValue label={t('Crew')} value={h.pcr?.paramedic_names ?? '—'} />
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={shown}
        keyExtractor={(h) => h.id}
        renderItem={renderRow}
        contentContainerStyle={[styles.list, shown.length === 0 && { flexGrow: 1 }]}
        ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.accent}
            colors={[colors.accent]}
            onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }}
          />
        )}
        ListHeaderComponent={(
          <View style={{ marginBottom: space.md, gap: space.sm }}>
            <Text style={styles.eyebrow}>{t('EMERGENCY MEDICAL SERVICES · DOCTOR')}</Text>
            <Text style={styles.title}>{t('Patient handovers')}</Text>
            <Muted>{fullName}</Muted>
            {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
            <View style={styles.search}>
              <Ionicons name="search" size={16} color={colors.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('Search patient, hospital or doctor')}
                placeholderTextColor={colors.muted}
                style={styles.searchInput}
                autoCorrect={false}
                accessibilityLabel={t('Search handovers')}
              />
            </View>
          </View>
        )}
        ListEmptyComponent={loading ? null : (
          <EmptyState icon="business-outline" title={query ? t('No handovers match') : t('No handovers yet')} body="" />
        )}
        ListFooterComponent={(
          <View style={{ marginTop: space.lg }}>
            <Button
              label={t('Sign out')}
              icon="log-out-outline"
              variant="outline"
              onPress={() => void (async () => {
                const sb = getSupabase();
                await cleanupOnLogout(sb).catch(() => {});
                await sb.auth.signOut();
                router.replace('/login');
              })()}
            />
          </View>
        )}
      />
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  list: { padding: space.lg, paddingBottom: space['3xl'] },
  eyebrow: { ...type.label, color: colors.accent },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 42, paddingHorizontal: space.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgCard,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 0 },
  row: {
    padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgCard, gap: 4,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  patient: { color: colors.text, fontSize: 15, fontWeight: '800', flex: 1 },
  time: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  sub: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  status: { color: colors.textDim, fontSize: 13 },
  more: { marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: colors.border },
}));
