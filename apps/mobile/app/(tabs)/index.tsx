import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { countUnreadAlerts, getMyPersonnel, listMyAssignedIncidents } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { useSync } from '@/lib/sync';
import { useFeatures } from '@/lib/features';
import { homeModules } from '@/lib/modules';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Card } from '@/components/ui';
import { PoliceHome } from '@/components/police-home';
import { FireHome } from '@/components/fire-home';
import { EmsHome } from '@/components/ems-home';
import { DisasterHome } from '@/components/disaster-home';
import { DoctorHome } from '@/components/doctor-home';
import { HomeHeader } from '@/components/home-header';

/**
 * Home — the modular front door.
 *
 * The app's shape is the module registry filtered by this tenant's feature
 * flags, so what appears here is what the organisation has switched on —
 * nothing else exists, rather than existing greyed-out. Above the grid, the
 * three states a crew member actually checks between calls: am I cleared for
 * duty, what is assigned to me, and did everything I did reach the server.
 */
/**
 * Police (and Ethekwini field officers, who work from the Metro Police
 * armoury and fleet), Fire, EMS and Disaster get the minimal responder home;
 * other services keep the module grid.
 */
export default function HomeScreen() {
  const { silo, role } = useAuth();
  if (role === 'Doctor') return <DoctorHome />;
  if (silo === 'MetroFire') return <FireHome />;
  if (silo === 'Medical') return <EmsHome />;
  if (silo === 'EthekwiniDisaster') return <DisasterHome />;
  return silo === 'MetroPolice' || silo === 'Ethekwini' ? <PoliceHome /> : <ModuleHome />;
}

function ModuleHome() {
  const styles = useStyles();
  const router = useRouter();
  const { session, silo } = useAuth();
  const { shiftStarted } = useDuty();
  const { pending, failed, online } = useSync();
  const { enabled } = useFeatures();

  const [assigned, setAssigned] = useState<number | null>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    const sb = getSupabase();
    // Each figure independently: a failed count renders as a dash, not an error.
    void getMyPersonnel(sb, session.user.id)
      .then((me) => listMyAssignedIncidents(sb, me?.assigned_apparatus_id ?? null))
      .then((rows) => setAssigned(rows.length))
      .catch(() => setAssigned(null));
    void countUnreadAlerts(sb).then(setUnread).catch(() => setUnread(null));
  }, [session]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const undelivered = pending.length + failed.length;
  const modules = homeModules(enabled, silo);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.bgCard}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <HomeHeader />

      {/* The three states that matter between calls */}
      <View style={styles.statusRow}>
        <Pressable
          style={[styles.status, shiftStarted === false && styles.statusWarn]}
          onPress={() => router.push('/(tabs)/shift')}
        >
          <Ionicons
            name={shiftStarted === false ? 'alert-circle' : 'shield-checkmark'}
            size={16}
            color={shiftStarted === false ? colors.medium : colors.low}
          />
          <Text style={styles.statusLabel}>
            {shiftStarted === false ? 'Shift not started' : 'Cleared for duty'}
          </Text>
        </Pressable>

        <Pressable style={styles.status} onPress={() => router.push('/(tabs)/incidents')}>
          <Ionicons name="radio" size={16} color={colors.accent} />
          <Text style={styles.statusLabel}>
            {assigned === null ? '—' : assigned} assigned
          </Text>
        </Pressable>

        <View style={[styles.status, failed.length > 0 && styles.statusBad, !online && styles.statusWarn]}>
          <Ionicons
            name={failed.length > 0 ? 'warning' : online ? 'cloud-done' : 'cloud-offline'}
            size={16}
            color={failed.length > 0 ? colors.critical : online ? colors.low : colors.medium}
          />
          <Text style={styles.statusLabel}>
            {failed.length > 0
              ? `${failed.length} failed`
              : undelivered > 0 ? `${undelivered} sending` : online ? 'Synced' : 'Offline'}
          </Text>
        </View>
      </View>

      {/* Module grid — the tenant's enabled shape */}
      <View style={styles.grid}>
        {modules.map((m) => {
          const badge = m.key === 'alerts' && unread ? unread : null;
          return (
            <Pressable
              key={m.key}
              accessibilityRole="button"
              accessibilityLabel={m.title}
              onPress={() => router.push(m.href as never)}
              style={({ pressed }) => [styles.cardWrap, pressed && { opacity: 0.85 }]}
            >
              <Card tight style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={styles.cardIcon}>
                    <Ionicons name={m.icon} size={20} color={colors.accent} />
                  </View>
                  {badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.cardTitle}>{m.title}</Text>
                <Text style={styles.cardBlurb} numberOfLines={2}>{m.blurb}</Text>
              </Card>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.footer}>
        {silo} · modules are set by your organisation
      </Text>
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },

  statusRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.xl },
  status: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, minHeight: 44,
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: space.sm,
  },
  statusWarn: { borderColor: `${colors.medium}66`, backgroundColor: colors.mediumSoft },
  statusBad: { borderColor: `${colors.critical}66`, backgroundColor: colors.criticalSoft },
  statusLabel: { ...type.small, fontSize: 12, color: colors.text, fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cardWrap: { width: '48.2%', flexGrow: 1 },
  card: { minHeight: 118, marginBottom: 0 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardIcon: {
    width: 38, height: 38, borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  cardTitle: { ...type.bodyStrong, color: colors.text, marginTop: space.sm },
  cardBlurb: { ...type.small, fontSize: 12, color: colors.muted, marginTop: 2, lineHeight: 16 },

  footer: {
    ...type.small, fontSize: 11, color: colors.muted,
    textAlign: 'center', marginTop: space.xl,
  },
}));
