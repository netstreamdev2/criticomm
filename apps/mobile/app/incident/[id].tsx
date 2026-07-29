import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import {
  addIncidentUpdate, getIncident, getIncidentUpdates, subscribeIncidentTimeline,
  uploadIncidentEvidence,
} from '@criticom/api';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import {
  colors, radius, severityColor, space, timeAgo, type,
} from '@/lib/theme';
import {
  Banner, Button, Card, EmptyState, Input, KeyValue, Muted, SectionLabel,
  SeverityPill, StatusBadge, Title,
} from '@/components/ui';

type Incident = Database['public']['Tables']['incidents']['Row'];
type Update = Database['public']['Tables']['incident_updates']['Row'];

export default function IncidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'error' | 'success'>('error');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const sb = getSupabase();
    const [inc, upd] = await Promise.all([
      getIncident(sb, id).catch(() => null),
      getIncidentUpdates(sb, id).catch(() => []),
    ]);
    setIncident(inc);
    setUpdates(upd);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
    if (!id) return;
    const off = subscribeIncidentTimeline(getSupabase(), id, (u) =>
      setUpdates((cur) => [u, ...cur]),
    );
    return off;
  }, [id, load]);

  const notify = (text: string, tone: 'error' | 'success' = 'error') => {
    setMessageTone(tone);
    setMessage(text);
  };

  const postUpdate = async () => {
    if (!incident || !note.trim()) return;
    setBusy('note');
    try {
      await addIncidentUpdate(getSupabase(), {
        incident_id: incident.id, silo: incident.silo, message: note.trim(),
      });
      setNote('');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const capture = async (source: 'camera' | 'library') => {
    if (!incident) return;
    setMessage(null);
    const picker = source === 'camera'
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { notify('Camera permission denied.'); return; }
    }
    const result = await picker({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;

    setBusy('upload');
    try {
      const asset = result.assets[0];
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const filename = asset.fileName ?? `evidence-${Date.now()}.jpg`;
      await uploadIncidentEvidence(getSupabase(), {
        incident_id: incident.id,
        silo: incident.silo,
        file: new File([blob], filename, { type: asset.mimeType ?? 'image/jpeg' }),
        filename,
        kind: 'image',
      });
      await addIncidentUpdate(getSupabase(), {
        incident_id: incident.id, silo: incident.silo,
        message: `📷 Evidence photo uploaded from mobile (${filename})`,
      });
      notify('Evidence uploaded to the case file.', 'success');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** Hands the scene coordinates (or address) to the phone's map app. */
  const navigateToScene = () => {
    if (!incident) return;
    const { location_lat: lat, location_lng: lng, location_address: address } = incident;
    const query = lat && lng ? `${lat},${lng}` : address;
    if (!query) { notify('No location recorded for this incident.'); return; }
    const url = Platform.select({
      ios: `maps://?daddr=${encodeURIComponent(query)}`,
      default: `geo:0,0?q=${encodeURIComponent(query)}`,
    });
    void Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`));
  };

  const callCaller = () => {
    if (!incident?.caller_number) { notify('No caller number recorded.'); return; }
    void Linking.openURL(`tel:${incident.caller_number.replace(/\s/g, '')}`);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Muted>Loading incident…</Muted>
      </View>
    );
  }

  if (!incident) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState
          icon="alert-circle-outline"
          title="Incident not available"
          body="It may have been closed, reassigned, or you no longer have access to this silo."
        />
      </View>
    );
  }

  const sev = severityColor(incident.incident_severity);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {message ? (
        <Banner tone={messageTone} onDismiss={() => setMessage(null)}>{message}</Banner>
      ) : null}

      {/* Overview */}
      <Card accent={sev}>
        <View style={styles.rowBetween}>
          <Text style={styles.number}>{incident.incident_number}</Text>
          <SeverityPill severity={incident.incident_severity} />
        </View>
        <Title>{incident.incident_type}</Title>

        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText}>{incident.location_address}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={14} color={colors.muted} />
          <Text style={styles.metaText}>Reported {timeAgo(incident.incident_created_at)}</Text>
        </View>

        <View style={{ marginTop: space.md }}>
          <StatusBadge status={incident.status} />
        </View>

        {incident.call_description ? (
          <Text style={styles.desc}>{incident.call_description}</Text>
        ) : null}

        <View style={{ marginTop: space.sm }}>
          <KeyValue label="Caller" value={incident.caller_name || '—'} />
          <KeyValue label="Contact" value={incident.caller_number || '—'} />
        </View>

        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button label="Navigate" icon="navigate" onPress={navigateToScene} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Call caller" icon="call" variant="outline" onPress={callCaller} />
          </View>
        </View>
      </Card>

      {/* Evidence */}
      <SectionLabel>Scene evidence</SectionLabel>
      <Card>
        <Muted>Photos upload straight into the incident-media bucket and the case file.</Muted>
        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button label="Camera" icon="camera" busy={busy === 'upload'} onPress={() => void capture('camera')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Library" icon="images-outline" variant="outline" busy={busy === 'upload'} onPress={() => void capture('library')} />
          </View>
        </View>
      </Card>

      {/* Timeline */}
      <SectionLabel>Updates ({updates.length})</SectionLabel>
      <Card>
        <View style={styles.noteRow}>
          <View style={{ flex: 1 }}>
            <Input
              placeholder="Add an update…"
              value={note}
              onChangeText={setNote}
              onSubmitEditing={() => void postUpdate()}
              returnKeyType="send"
            />
          </View>
          <Button
            label="Post"
            icon="send"
            busy={busy === 'note'}
            disabled={!note.trim()}
            onPress={() => void postUpdate()}
          />
        </View>

        <View style={{ marginTop: space.lg }}>
          {updates.length === 0 ? (
            <Muted>No updates logged yet — the first entry appears here in real time.</Muted>
          ) : null}
          {updates.map((u, i) => (
            <View key={u.id} style={styles.timelineRow}>
              <View style={styles.timelineGutter}>
                <View style={styles.timelineDot} />
                {i < updates.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineBody}>
                <Text style={styles.updateText}>{u.message}</Text>
                <Text style={styles.updateMeta}>
                  {u.created_by_name ?? 'System'} · {timeAgo(u.timestamp)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: space.md,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  number: { ...type.mono, color: colors.accent, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  metaText: { ...type.small, color: colors.muted, flexShrink: 1 },
  desc: { color: colors.textDim, marginVertical: space.md, lineHeight: 21, fontSize: 14 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  noteRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },

  timelineRow: { flexDirection: 'row', gap: space.md },
  timelineGutter: { alignItems: 'center', width: 12 },
  timelineDot: {
    width: 9, height: 9, borderRadius: 5, marginTop: 5,
    backgroundColor: colors.accent,
  },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 3 },
  timelineBody: { flex: 1, paddingBottom: space.lg },
  updateText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  updateMeta: { ...type.small, fontSize: 12, color: colors.muted, marginTop: 3 },
});
