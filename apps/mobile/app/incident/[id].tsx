import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import {
  getFieldIncident, getIncidentUpdates, listIncidentAttachments, subscribeIncidentTimeline, type FieldIncident,
} from '@criticom/api';
import type { Database, IncidentStatus } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { callView, isPoliceCall, MAX_PHOTOS, photosRemaining, reportPathFor } from '@/lib/response';
import { openDirections } from '@/lib/navigate';
import { useSync } from '@/lib/sync';
import { useFeature } from '@/lib/features';
import { retainAttachment } from '@/lib/outbox';
import { colors, radius, severityColor, space, timeAgo, type, makeStyles } from '@/lib/theme';
import {
  Banner, Button, Card, EmptyState, Input, KeyValue, Muted, SectionLabel,
  SeverityPill, StatusBadge, Title,
} from '@/components/ui';

type Update = Database['public']['Tables']['incident_updates']['Row'];

/** Strips the zero-width outbox replay marker before anything is displayed. */
const clean = (message: string) => message.replace(/​[\w-]+$/, '');

export default function IncidentDetailScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, silo } = useAuth();
  const { onDuty } = useDuty();
  const { enqueue, pending } = useSync();
  const [photosFiled, setPhotosFiled] = useState(0);
  const voiceOn = useFeature('mobile.voice_notes');
  const [incident, setIncident] = useState<FieldIncident | null>(null);
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
    const [inc, upd, files] = await Promise.all([
      getFieldIncident(sb, id).catch(() => null),
      getIncidentUpdates(sb, id).catch(() => []),
      listIncidentAttachments(sb, id).catch(() => []),
    ]);
    setIncident(inc);
    setUpdates(upd);
    setPhotosFiled(files.filter((a) => a.kind === 'image').length);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
    if (!id) return;
    // Every status change and filed photo writes a timeline entry, so the
    // timeline doubles as the signal to refresh the call itself.
    const off = subscribeIncidentTimeline(getSupabase(), id, (u) => {
      setUpdates((cur) => (cur.some((x) => x.id === u.id) ? cur : [u, ...cur]));
      void getFieldIncident(getSupabase(), id).then(setIncident).catch(() => {});
    });
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
      photos: forThis.filter((e) => e.op.kind === 'evidence' && e.op.mediaKind === 'image').length,
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

  const advance = async (which: 'action' | 'secondary' = 'action') => {
    if (!incident || !session) return;
    const current = callView(incident, { userId: session.user.id, silo, onDuty }, queued.status);
    const action = which === 'secondary' ? current.secondary : current.action;
    if (!action) return;
    if (action.kind === 'report') { router.push(reportPathFor(incident.id, silo) as never); return; }
    setBusy('status');
    try {
      if (action.kind === 'respond' && onDuty === false) {
        notify('You are off duty. Go on duty to respond to incidents.');
        return;
      }
      // Queued, not sent; the server decides lead or backup and tells dispatch.
      await enqueue({
        kind: 'incident_status',
        incidentId: incident.id,
        status: action.kind === 'respond' ? 'En Route' : action.status,
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
    if (photosRemaining(photosFiled, queued.photos) === 0) {
      notify(`This case file already holds ${MAX_PHOTOS} photos — the maximum.`);
      return;
    }
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
    if (!openDirections(incident)) notify('No location recorded for this incident.');
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
  // Lead or backup, assigned or open — the same rules as the Calls list (0042).
  const view = callView(incident, { userId: session?.user.id ?? '', silo, onDuty }, queued.status);
  const status = view.role === 'lead' && queued.status ? queued.status : incident.status;
  const mine = view.role !== null;
  const action = view.action;
  const closed = status === 'Resolved' || status === 'Closed';
  const canCapture = !closed && (mine || !isPoliceCall(incident));
  const photosLeft = photosRemaining(photosFiled, queued.photos);

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
          {incident.dispatched_by ? <KeyValue label="Dispatched by" value={incident.dispatched_by} /> : null}
          {incident.assigned_to_name ? (
            <KeyValue
              label="Assigned to"
              value={incident.assigned_to === session?.user.id ? 'You' : incident.assigned_to_name}
            />
          ) : null}
          {view.lead ? (
            <KeyValue
              label="Lead"
              value={`${view.lead.user_id === session?.user.id ? 'You' : (view.lead.name ?? 'Officer')} · ${view.lead.status}`}
            />
          ) : null}
          {view.backups.length ? (
            <KeyValue
              label="Backup"
              value={view.backups.map((b) => `${b.user_id === session?.user.id ? 'You' : (b.name ?? 'Officer')} (${b.status})`).join(', ')}
            />
          ) : null}
        </View>

        {incident.report_filed_at ? (
          <View style={styles.filed}>
            <Ionicons name="lock-closed" size={14} color={colors.low} />
            <Text style={styles.filedText}>Report filed {timeAgo(incident.report_filed_at)} — incident resolved and on record.</Text>
          </View>
        ) : null}

        {action ? (
          <View style={{ marginTop: space.md }}>
            {view.blocked ? (
              <Text style={styles.blocked}>{view.blocked}</Text>
            ) : action.kind === 'respond' ? (
              <Text style={styles.viewOnly}>
                {action.asLead ? 'You will lead this incident.' : 'You will join as backup.'} Dispatch is told at once.
              </Text>
            ) : null}
            <Button
              label={action.kind === 'respond' ? 'Responding' : action.label}
              icon={action.kind === 'report' ? 'document-text' : action.kind === 'respond' ? 'car-sport' : 'arrow-forward-circle'}
              variant={action.kind === 'report' ? 'success' : 'primary'}
              size="lg"
              busy={busy === 'status'}
              disabled={Boolean(view.blocked)}
              onPress={() => void advance()}
            />
            {view.secondary ? (
              <View style={{ marginTop: space.sm }}>
                <Button
                  label={view.secondary.label}
                  icon="medkit-outline"
                  variant="outline"
                  busy={busy === 'status'}
                  disabled={Boolean(view.blocked)}
                  onPress={() => void advance('secondary')}
                />
              </View>
            ) : null}
          </View>
        ) : view.note && !closed ? (
          <Text style={styles.viewOnly}>{view.note}</Text>
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

      {/* Evidence — captured while the call is worked; permanent once filed. */}
      <SectionLabel>Scene evidence</SectionLabel>
      {canCapture ? (
      <Card accent={recording ? colors.critical : undefined}>
        <Muted>
          Photos and voice notes are stored on the phone first and filed into the case
          the moment there is signal — capture them whether or not you have coverage.
          Filed evidence cannot be deleted.
        </Muted>

        <Text style={styles.photoCount}>
          Photos {MAX_PHOTOS - photosLeft}/{MAX_PHOTOS}{photosLeft === 0 ? ' — limit reached' : ''}
        </Text>

        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button label="Camera" icon="camera" busy={busy === 'upload'} disabled={photosLeft === 0} onPress={() => void capture('camera')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Library" icon="images-outline" variant="outline" busy={busy === 'upload'} disabled={photosLeft === 0} onPress={() => void capture('library')} />
          </View>
        </View>

        {/* Video evidence is planned; the control is shown so crews know it is coming. */}
        <View style={{ marginTop: space.sm }}>
          <Button label="Video · coming soon" icon="videocam-outline" variant="outline" disabled />
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
      ) : (
        <Card>
          <Muted>
            {closed
              ? `The case file is closed. ${photosFiled} photo${photosFiled === 1 ? '' : 's'} on record.`
              : 'Evidence is captured by the crew working this incident.'}
          </Muted>
        </Card>
      )}

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

const useStyles = makeStyles(() => StyleSheet.create({
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
  photoCount: { ...type.small, fontSize: 12, color: colors.muted, fontWeight: '700', marginTop: space.md },
  blocked: { ...type.small, fontSize: 12, color: colors.medium, fontWeight: '700', marginBottom: space.sm },
  viewOnly: { ...type.small, fontSize: 12, color: colors.muted, marginTop: space.md },
  filed: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md,
    padding: space.sm, borderRadius: radius.md, backgroundColor: colors.lowSoft,
  },
  filedText: { ...type.small, fontSize: 12, color: colors.low, fontWeight: '700', flexShrink: 1 },

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
}));
