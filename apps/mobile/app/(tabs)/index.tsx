import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  getMyPersonnel, listMyAssignedIncidents, subscribeIncidentUpdates, subscribeNewIncidents,
  updateResponderStatus,
} from '@criticom/api';
import type { Database, IncidentStatus } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { Button, Card, Muted, SeverityPill, StatusBadge, Title } from '@/components/ui';

type Incident = Database['public']['Tables']['incidents']['Row'];

const NEXT: Partial<Record<IncidentStatus, IncidentStatus>> = {
  Dispatched: 'En Route',
  'En Route': 'Arrived',
  Arrived: 'On Scene',
  'On Scene': 'Transporting',
  Transporting: 'Resolved',
};

export default function MyIncidentsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const sb = getSupabase();
      const me = await getMyPersonnel(sb, session.user.id);
      const rows = await listMyAssignedIncidents(sb, me?.assigned_apparatus_id ?? null);
      setIncidents(rows);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [session]);

  useEffect(() => {
    void load();
    const sb = getSupabase();
    const offNew = subscribeNewIncidents(sb, 'all', () => void load());
    const offUpd = subscribeIncidentUpdates(sb, 'all', () => void load());
    return () => { offNew(); offUpd(); };
  }, [load]);

  const advance = async (incident: Incident) => {
    const next = NEXT[incident.status];
    if (!next) return;
    setBusyId(incident.id);
    try {
      await updateResponderStatus(getSupabase(), { incident_id: incident.id, status: next });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.list}
      data={incidents}
      keyExtractor={(i) => i.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
      ListHeaderComponent={
        error ? <Text style={styles.error}>{error}</Text> : null
      }
      ListEmptyComponent={
        <Card>
          <Title>No incidents assigned</Title>
          <Muted>
            You'll get a live update here the moment dispatch assigns your unit.
            Complete your start-of-shift checks under the Shift tab.
          </Muted>
        </Card>
      }
      renderItem={({ item }) => {
        const next = NEXT[item.status];
        return (
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.number}>{item.incident_number}</Text>
              <SeverityPill severity={item.incident_severity} />
            </View>
            <Title>{item.incident_type}</Title>
            <Muted>{item.location_address}</Muted>
            <Text style={styles.desc} numberOfLines={3}>{item.call_description}</Text>
            <View style={[styles.rowBetween, { marginTop: 12 }]}>
              <StatusBadge status={item.status} />
            </View>
            <View style={styles.actions}>
              {next && (
                <View style={{ flex: 1 }}>
                  <Button
                    label={`Mark ${next}`}
                    busy={busyId === item.id}
                    onPress={() => void advance(item)}
                  />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Button
                  label="Details & evidence"
                  variant="outline"
                  onPress={() => router.push(`/incident/${item.id}`)}
                />
              </View>
            </View>
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  number: { color: colors.accent, fontFamily: 'monospace', fontSize: 13, marginBottom: 6 },
  desc: { color: colors.text, marginTop: 8, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  error: {
    color: colors.critical, backgroundColor: `${colors.critical}22`,
    borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13,
  },
});
