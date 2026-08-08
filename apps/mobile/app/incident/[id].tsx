import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import {
  getIncident, getIncidentUpdates, subscribeIncidentTimeline,
} from '@criticom/api';
import type { Database, IncidentStatus } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useSync } from '@/lib/sync';
import { useFeature } from '@/lib/features';
import { retainAttachment } from '@/lib/outbox';
import {
  colors, radius, severityColor, space, timeAgo, type,
} from '@/lib/theme';
import {
  Banner, Button, Card, EmptyState, Input, KeyValue, Muted, SectionLabel,
  SeverityPill, StatusBadge, Title,
} from '@/components/ui';

type Incident = Database['public']['Tables']['incidents']['Row'];
type Update = Database['public']['Tables']['incident_updates']['Row'];

/** Mirrors the ladder on the incidents list — one forward step at a time. */
const NEXT: Partial<Record<IncidentStatus, IncidentStatus>> = {
  Dispatched: 'En Route',
  'En Route': 'Arrived',
  Arrived: 'On Scene',
  'On Scene': 'Transporting',
  Transporting: 'Resolved',
};

/** Strips the zero-width outbox replay marker before anything is displayed. */
const clean = (message: string) => message.replace(/​[\w-]+$/, '');

export default function IncidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { enqueue, pending } = useSync();
  const voiceOn = useFeature('mobile.voice_notes');
  const [incident, setIncident] = useState<Incident | null>(null);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'error' | 'success'>('error');
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);

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

  // A recording still running when the screen unmounts would hold the mic and
  // leave a half-written file behind.
  useEffect(() => () => { void recordingRef.current?.stopAndUnloadAsync().catch(() => {}); }, []);

  const notify = (text: string, tone: 'error' | 'success' = 'error') => {
    setMessageTone(tone);
    setMessage(text);
  };

  /** Work this screen has accepted but not yet delivered. */
  const queued = useMemo(() => {
    const forThis = pending.filter((e) => {
      const op = e.op;
      return ('incidentId' in op) && op.incidentId === id;
    });
    const status = forThis.find((e) => e.op.kind === 'incident_status');
    return {
      status: status?.op.kind === 'incident_status' ? (status.op.status as IncidentStatus) : null,
      notes: forThis.filter((e) => e.op.kind === 'incident_note').length,
      media: forThis.filter((e) => e.op.kind === 'evidence').length,
    };
  }, [pending, id]);

  const postUpdate = async () => {
    if (!incident || !note.trim()) return;
    setBusy('note');
    try {
      await enqueue({
        kind: 'incident_note',
        incidentId: incident.id,
        silo: incident.silo,
        message: note.trim(),
      });
      setNote('');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const advance = async () => {
    if (!incident) return;
    const current = queued.status ?? incident.status;
    const next = NEXT[current];
    if (!next) return;
    setBusy('status');
    try {
      await enqueue({
        kind: 'incident_status',
        incidentId: incident.id,
        status: next,
        incidentNumber: incident.incident_number,
      });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const capture = async (source: 'camera' | 'library') => {
    if (!incident) return;
    setMessage(null);
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { notify('Camera permission denied.'); return; }
    }
    const picker = source === 'camera'
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;
    const result = await picker({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;

    setBusy('upload');
    try {
      const asset = result.assets[0];
      const filename = asset.fileName ?? `evidence-${Date.now()}.jpg`;
      // Copy out of the OS cache before queueing: a photo of a scene that has
      // since been cleared cannot be retaken.
      const localUri = await retainAttachment(asset.uri, filename);
      await enqueue({
        kind: 'evidence',
        incidentId: incident.id,
        silo: incident.silo,
        localUri,
        filename,
        mimeType: asset.mimeType ?? 'image/jpeg',
        mediaKind: 'image',
      });
      notify('Photo saved to the case file.', 'success');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const startRecording = async () => {
    setMessage(null);
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { notify('Microphone permission denied.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = rec;
      setRecording(rec);
      setRecordingSince(Date.now());
    } catch (e) {
      notify(`Could not start recording: ${(e as Error).message}`);
    }
  };

  const stopRecording = async () => {
    const rec = recordingRef.current;
    if (!rec || !incident) return;
    setBusy('upload');
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      recordingRef.current = null;
      setRecording(null);
      setRecordingSince(null);
      if (!uri) { notify('The recording produced no audio.'); return; }

      const filename = `voice-note-${Date.now()}.${Platform.OS === 'ios' ? 'm4a' : 'm4a'}`;
      const localUri = await retainAttachment(uri, filename);
      await enqueue({
        kind: 'evidence',
        incidentId: incident.id,
        silo: incident.silo,
        localUri,
        filename,
        mimeType: 'audio/m4a',
        mediaKind: 'audio',
      });
      notify('Voice note saved to the case file.', 'success');
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
  const status = queued.status ?? incident.status;
  const next = NEXT[status];

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

        <View style={styles.statusRow}>
          <StatusBadge status={status} />
          {queued.status ? (
            <View style={styles.queuedChip}>
              <Ionicons name="time-outline" size={11} color={colors.medium} />
              <Text style={styles.queuedText}>Waiting to send</Text>
            </View>
          ) : null}
        </View>

        {incident.call_description ? (
          <Text style={styles.desc}>{incident.call_description}</Text>
        ) : null}

        <View style={{ marginTop: space.sm }}>
          <KeyValue label="Caller" value={incident.caller_name || '—'} />
          <KeyValue label="Contact" value={incident.caller_number || '—'} />
        </View>

        {next ? (
          <View style={{ marginTop: space.md }}>
            <Button
              label={`Mark ${next}`}
              icon="arrow-forward-circle"
              size="lg"
              busy={busy === 'status'}
              onPress={() => void advance()}
            />
          </View>
        ) : null}

        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button label="Navigate" icon="navigate" variant="outline" onPress={navigateToScene} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Call caller" icon="call" variant="outline" onPress={callCaller} />
          </View>
        </View>
      </Card>

      {/* Evidence */}
      <SectionLabel>Scene evidence</SectionLabel>
      <Card accent={recording ? colors.critical : undefined}>
        <Muted>
          Photos and voice notes are stored on the phone first and filed into the case
          the moment there is signal — capture them whether or not you have coverage.
        </Muted>

        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button label="Camera" icon="camera" busy={busy === 'upload'} onPress={() => void capture('camera')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Library" icon="images-outline" variant="outline" busy={busy === 'upload'} onPress={() => void capture('library')} />
          </View>
        </View>

        {voiceOn ? (
          <View style={{ marginTop: space.sm }}>
            {recording ? (
              <Pressable
                onPress={() => void stopRecording()}
                accessibilityRole="button"
                accessibilityLabel="Stop recording and file the voice note"
                style={({ pressed }) => [styles.recording, pressed && { opacity: 0.85 }]}
              >
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>
                  Recording{recordingSince ? ` · ${Math.floor((Date.now() - recordingSince) / 1000)}s` : ''} — tap to stop
                </Text>
                <Ionicons name="stop-circle" size={20} color={colors.critical} />
              </Pressable>
            ) : (
              <Button
                label="Record voice note"
                icon="mic-outline"
                variant="subtle"
                disabled={busy === 'upload'}
                onPress={() => void startRecording()}
              />
            )}
          </View>
        ) : null}

        {queued.media > 0 ? (
          <Text style={styles.queuedNote}>
            {queued.media} attachment{queued.media === 1 ? '' : 's'} waiting to upload.
          </Text>
        ) : null}
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

        {queued.notes > 0 ? (
          <Text style={styles.queuedNote}>
            {queued.notes} update{queued.notes === 1 ? '' : 's'} waiting to send.
          </Text>
        ) : null}

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
                <Text style={styles.updateText}>{clean(u.message)}</Text>
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

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  queuedChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  queuedText: { ...type.small, fontSize: 11, color: colors.medium, fontWeight: '700' },
  queuedNote: { ...type.small, fontSize: 12, color: colors.medium, marginTop: space.md },

  recording: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    minHeight: 48, paddingHorizontal: space.md,
    borderRadius: radius.md, borderWidth: 1,
    borderColor: `${colors.critical}88`, backgroundColor: colors.criticalSoft,
  },
  recordingDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.critical },
  recordingText: { flex: 1, color: colors.critical, fontWeight: '700', fontSize: 14 },

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
