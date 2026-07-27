import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  addIncidentUpdate, getIncident, getIncidentUpdates, subscribeIncidentTimeline,
  uploadIncidentEvidence,
} from '@criticom/api';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { Button, Card, Input, Muted, SeverityPill, StatusBadge, Title } from '@/components/ui';

type Incident = Database['public']['Tables']['incidents']['Row'];
type Update = Database['public']['Tables']['incident_updates']['Row'];

export default function IncidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const sb = getSupabase();
    const [inc, upd] = await Promise.all([
      getIncident(sb, id).catch(() => null),
      getIncidentUpdates(sb, id).catch(() => []),
    ]);
    setIncident(inc);
    setUpdates(upd);
  }, [id]);

  useEffect(() => {
    void load();
    if (!id) return;
    const off = subscribeIncidentTimeline(getSupabase(), id, (u) =>
      setUpdates((cur) => [u, ...cur]),
    );
    return off;
  }, [id, load]);

  const postUpdate = async () => {
    if (!incident || !note.trim()) return;
    setBusy('note');
    try {
      await addIncidentUpdate(getSupabase(), {
        incident_id: incident.id, silo: incident.silo, message: note.trim(),
      });
      setNote('');
    } catch (e) {
      setMessage((e as Error).message);
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
      if (status !== 'granted') { setMessage('Camera permission denied.'); return; }
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
      setMessage('✓ Evidence uploaded.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!incident) {
    return (
      <View style={styles.center}>
        <Muted>Loading incident…</Muted>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.number}>{incident.incident_number}</Text>
          <SeverityPill severity={incident.incident_severity} />
        </View>
        <Title>{incident.incident_type}</Title>
        <Muted>{incident.location_address}</Muted>
        <View style={{ marginTop: 8 }}>
          <StatusBadge status={incident.status} />
        </View>
        <Text style={styles.desc}>{incident.call_description}</Text>
        <Muted>Caller: {incident.caller_name} · {incident.caller_number}</Muted>
      </Card>

      <Card>
        <Title>Scene evidence</Title>
        <Muted>Photos upload straight into the incident-media bucket and the case file.</Muted>
        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button label="📷 Camera" busy={busy === 'upload'} onPress={() => void capture('camera')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="🖼 Library" variant="outline" busy={busy === 'upload'} onPress={() => void capture('library')} />
          </View>
        </View>
        {message && <Text style={styles.message}>{message}</Text>}
      </Card>

      <Card>
        <Title>Updates ({updates.length})</Title>
        <View style={styles.noteRow}>
          <Input
            placeholder="Add an update…"
            value={note}
            onChangeText={setNote}
            style={{ flex: 1 }}
            onSubmitEditing={() => void postUpdate()}
          />
          <Button label="Post" busy={busy === 'note'} onPress={() => void postUpdate()} />
        </View>
        <View style={{ marginTop: 12, gap: 8 }}>
          {updates.length === 0 && <Muted>No updates logged.</Muted>}
          {updates.map((u) => (
            <View key={u.id} style={styles.update}>
              <Text style={styles.updateText}>{u.message}</Text>
              <Muted>
                {u.created_by_name ?? 'System'} · {new Date(u.timestamp).toLocaleString()}
              </Muted>
            </View>
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 32 },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  number: { color: colors.accent, fontFamily: 'monospace', fontSize: 13, marginBottom: 6 },
  desc: { color: colors.text, marginVertical: 10, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  message: { color: colors.muted, marginTop: 10, fontSize: 13 },
  noteRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  update: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: 10, backgroundColor: colors.bgSoft,
  },
  updateText: { color: colors.text, marginBottom: 4 },
});
