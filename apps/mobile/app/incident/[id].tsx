import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import {
  getFieldIncident, getIncidentUpdates, listIncidentAttachments, noteText, subscribeIncidentTimeline, type FieldIncident,
} from '@criticom/api';
import type { Database, IncidentStatus } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDuty } from '@/lib/duty';
import { assessmentPathFor, callView, isPoliceCall, MAX_PHOTOS, photosRemaining, reportPathFor } from '@/lib/response';
import { departmentOf, personTitle, wordsIn } from '@/lib/department';
import { openDirections } from '@/lib/navigate';
import { useSync } from '@/lib/sync';
import { useFeature } from '@/lib/features';
import { retainAttachment } from '@/lib/outbox';
import { OnRecord } from '@/components/on-record';
import { ArrivalStrip } from '@/components/arrival-strip';
import { confirmAccept } from '@/lib/accept';
import { colors, radius, severityColor, space, timeAgo, type, makeStyles } from '@/lib/theme';
import {
  Banner, Button, Card, EmptyState, Input, KeyValue, Muted, SectionLabel,
  SeverityPill, StatusBadge, Title,
} from '@/components/ui';
import { useT } from '@/lib/i18n';
import { CallDetails } from '@/components/call-details';

type Update = Database['public']['Tables']['incident_updates']['Row'];

/** A recording's length as a clock: 0:07, 1:42. */
const clockOf = (ms: number) => {
  const s = Math.floor(Math.max(ms, 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function IncidentDetailScreen() {
  const { t } = useT();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, silo } = useAuth();
  const { onDuty } = useDuty();
  const { enqueue, pending } = useSync();
  const words = wordsIn(silo, t);
  const police = departmentOf(silo) === 'police';
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
  // How long the recorder says it has recorded, updated twice a second.
  const [recordedMs, setRecordedMs] = useState(0);
  const [files, setFiles] = useState<Awaited<ReturnType<typeof listIncidentAttachments>>>([]);
  const recordingRef = useRef<Audio.Recording | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const sb = getSupabase();
    const [inc, upd, files] = await Promise.all([
      getFieldIncident(sb, id, silo).catch(() => null),
      getIncidentUpdates(sb, id).catch(() => []),
      listIncidentAttachments(sb, id).catch(() => []),
    ]);
    setIncident(inc);
    setUpdates(upd);
    setPhotosFiled(files.filter((a) => a.kind === 'image').length);
    setFiles(files);
    setLoading(false);
  }, [id, silo]);

  useEffect(() => {
    void load();
    if (!id) return;
    // Every status change and filed photo writes a timeline entry, so the
    // timeline doubles as the signal to refresh the call itself.
    const off = subscribeIncidentTimeline(getSupabase(), id, (u) => {
      setUpdates((cur) => (cur.some((x) => x.id === u.id) ? cur : [u, ...cur]));
      void getFieldIncident(getSupabase(), id, silo).then(setIncident).catch(() => {});
    });
    return off;
  }, [id, load, silo]);

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
    // The latest one pressed: En Route then On Scene in a dead zone is On Scene.
    const status = forThis.filter((e) => e.op.kind === 'incident_status')
      .reduce<(typeof forThis)[number] | undefined>((latest, e) => (!latest || e.occurredAt >= latest.occurredAt ? e : latest), undefined);
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

  const advance = async (which: 'action' | 'secondary' = 'action', reason?: string) => {
    if (!incident || !session) return;
    const current = callView(incident, { userId: session.user.id, silo, onDuty }, queued.status, t);
    const action = which === 'secondary' ? current.secondary : current.action;
    if (!action) return;
    if (action.kind === 'report') { router.push(reportPathFor(incident.id, silo) as never); return; }
    if (action.kind === 'assessment') { router.push(assessmentPathFor(incident.id) as never); return; }
    // On scene comes from the phone (0099); by hand only with a reason.
    if (action.kind === 'arriving' && !reason) return;
    if (action.kind === 'respond' && onDuty === false) {
      notify(t('You are off duty. Go on duty to respond to incidents.'));
      return;
    }
    if (action.kind === 'respond' && !(await confirmAccept(incident.incident_number, silo))) return;
    setBusy('status');
    try {
      // Queued, not sent; the server decides lead or backup and tells dispatch.
      await enqueue({
        kind: 'incident_status',
        incidentId: incident.id,
        status: action.kind === 'respond' ? 'En Route' : action.status,
        incidentNumber: incident.incident_number,
        ...(reason ? { reason } : {}),
        // The scene, so the phone can tell it has arrived with no signal.
        ...(action.kind === 'respond' && incident.location_lat && incident.location_lng
          ? { scene: { lat: incident.location_lat, lng: incident.location_lng } } : {}),
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
      notify(t('This {file} already holds {MAX_PHOTOS} photos — the maximum.', { file: words.file, MAX_PHOTOS }));
      return;
    }
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { notify(t('Camera permission denied.')); return; }
    }
    const picker = source === 'camera'
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;
    const result = await picker({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;

    setBusy('upload');
    try {
      const asset = result.assets[0];
      const filename = asset.fileName ?? `photo-${Date.now()}.jpg`;
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
      notify(t('Photo saved to the {file}.', { file: words.file }), 'success');
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
      if (!granted) { notify(t('Microphone permission denied.')); return; }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true, playsInSilentModeIOS: true, shouldDuckAndroid: true, staysActiveInBackground: false,
      });
      setRecordedMs(0);
      // The recorder reports its own length every half second: that drives
      // the clock on screen, and is the length filed with the note.
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
        (status) => { if (status.isRecording) setRecordedMs(status.durationMillis); },
        500,
      );
      recordingRef.current = rec;
      setRecording(rec);
    } catch (e) {
      notify(t('Could not start recording: {message}', { message: (e as Error).message }));
    }
  };

  const stopRecording = async () => {
    const rec = recordingRef.current;
    if (!rec || !incident) return;
    setBusy('upload');
    try {
      const final = await rec.stopAndUnloadAsync().catch(() => null);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      const ms = Math.max(final?.durationMillis ?? 0, recordedMs);
      recordingRef.current = null;
      setRecording(null);
      setRecordedMs(0);
      if (!uri) { notify(t('The recording produced no audio.')); return; }
      // A note under a second is a tap, not a recording: filing it would put
      // an empty clip on a case file that can never be deleted.
      if (ms < 1000) { notify(t('Nothing was recorded. Hold Record voice note, speak, then tap to stop.')); return; }

      // Phones record AAC in an MP4 container (.m4a), whose type is audio/mp4;
      // "audio/m4a" is not a real type and browsers refuse to play it. The web
      // build records with the browser's own recorder, which makes WebM.
      const web = Platform.OS === 'web';
      const filename = `voice-note-${Date.now()}.${web ? 'webm' : 'm4a'}`;
      const localUri = await retainAttachment(uri, filename);
      await enqueue({
        kind: 'evidence',
        incidentId: incident.id,
        silo: incident.silo,
        localUri,
        filename,
        mimeType: web ? 'audio/webm' : 'audio/mp4',
        mediaKind: 'audio',
        // The length goes on the record with the note.
        caption: `Voice note · ${clockOf(ms)}`,
      });
      notify(t('Voice note ({clockOf}) saved to the {file}.', { clockOf: clockOf(ms), file: words.file }), 'success');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /** Hands the scene coordinates (or address) to the phone's map app. */
  const navigateToScene = () => {
    if (!incident) return;
    if (incident.location_lat || incident.location_lng) { router.push(`/route/${incident.id}`); return; }
    if (!openDirections(incident)) notify(t('No location recorded for this incident.'));
  };

  const callCaller = () => {
    if (!incident?.caller_number) { notify(t('No caller number recorded.')); return; }
    void Linking.openURL(`tel:${incident.caller_number.replace(/\s/g, '')}`);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Muted>{t('Loading incident…')}</Muted>
      </View>
    );
  }

  if (!incident) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState
          icon="alert-circle-outline"
          title={t('Incident not available')}
          body={t('It may have been closed or reassigned, or it is not for your department.')}
        />
      </View>
    );
  }

  const sev = severityColor(incident.incident_severity);
  // Lead or backup, assigned or open — the same rules as the Calls list (0042).
  const view = callView(incident, { userId: session?.user.id ?? '', silo, onDuty }, queued.status, t);
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
          <Text style={styles.metaText}>{t('Reported {timeAgo}', { timeAgo: timeAgo(incident.incident_created_at) })}</Text>
        </View>

        <View style={styles.statusRow}>
          <StatusBadge status={status} />
          {queued.status ? (
            <View style={styles.queuedChip}>
              <Ionicons name="time-outline" size={11} color={colors.medium} />
              <Text style={styles.queuedText}>{t('Waiting to send')}</Text>
            </View>
          ) : null}
        </View>

        {incident.call_description ? (
          <Text style={styles.desc}>{incident.call_description}</Text>
        ) : null}
        <CallDetails incident={incident} />

        <View style={{ marginTop: space.sm }}>
          <KeyValue label={t('Caller')} value={incident.caller_name || '—'} />
          <KeyValue label={t('Contact')} value={incident.caller_number || '—'} />
          {incident.dispatched_by ? <KeyValue label={t('Dispatched by')} value={incident.dispatched_by} /> : null}
          {incident.assigned_to_name ? (
            <KeyValue
              label={t('Assigned to')}
              value={incident.assigned_to === session?.user.id ? t('You') : incident.assigned_to_name}
            />
          ) : null}
          {view.lead ? (
            <KeyValue
              label={t('Lead')}
              value={`${view.lead.user_id === session?.user.id ? t('You') : (view.lead.name ?? personTitle(silo, t))} · ${t(view.lead.status)}`}
            />
          ) : null}
          {view.backups.length ? (
            <KeyValue
              label={t('Backup')}
              value={view.backups.map((b) => `${b.user_id === session?.user.id ? t('You') : (b.name ?? personTitle(silo, t))} (${t(b.status)})`).join(', ')}
            />
          ) : null}
        </View>

        {incident.report_filed_at ? (
          <View style={styles.filed}>
            <Ionicons name="lock-closed" size={14} color={colors.low} />
            <Text style={styles.filedText}>{t('Report filed {timeAgo}. It is on record.', { timeAgo: timeAgo(incident.report_filed_at) })}</Text>
          </View>
        ) : null}

        {action ? (
          <View style={{ marginTop: space.md }}>
            {view.blocked ? (
              <Text style={styles.blocked}>{view.blocked}</Text>
            ) : action.kind === 'respond' ? (
              <Text style={styles.viewOnly}>
                {action.asLead ? t('You will lead this incident.') : t('You will join as backup.')}{' '}{t('Dispatch is told at once.')}
              </Text>
            ) : null}
            {action.kind === 'arriving' ? (
              // On the way (0099): the phone marks on scene; by hand only with a reason.
              <ArrivalStrip
                scene={incident.location_lat && incident.location_lng ? { lat: incident.location_lat, lng: incident.location_lng } : null}
                silo={silo}
                startDistanceM={incident.responders?.find((r) => r.user_id === session?.user.id)?.start_distance_m}
                busy={busy === 'status'}
                onMark={(reason) => void advance('action', reason)}
              />
            ) : (
              <Button
                label={action.label}
                icon={action.kind === 'report' ? 'document-text' : action.kind === 'assessment' ? 'clipboard' : action.kind === 'respond' ? 'checkmark-circle' : 'arrow-forward-circle'}
                variant={action.kind === 'report' ? 'success' : 'primary'}
                size="lg"
                busy={busy === 'status'}
                disabled={Boolean(view.blocked)}
                onPress={() => void advance()}
              />
            )}
            {view.secondary ? (
              <View style={{ marginTop: space.sm }}>
                <Button
                  label={view.secondary.label}
                  icon={view.secondary.kind === 'report' ? 'document-text-outline' : 'medkit-outline'}
                  variant="outline"
                  busy={busy === 'status'}
                  // Not disabled with the report: moving a patient never waits for the arrival.
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
            <Button label={t('Navigate')} icon="navigate" variant="outline" onPress={navigateToScene} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={t('Call caller')} icon="call" variant="outline" onPress={callCaller} />
          </View>
        </View>
        {/* The call's own talk group (0083): whoever works the call talks on it. */}
        <View style={{ marginTop: space.sm }}>
          <Button
            label={t('Talk on this call')}
            icon="radio-outline"
            variant="outline"
            onPress={() => router.push({ pathname: '/talk', params: { channel: `incident:${incident.id}` } })}
          />
        </View>
      </Card>

      {/* Photos and voice notes — captured while the call is worked; permanent once filed. */}
      <SectionLabel>{police ? t('Scene evidence') : t('Scene photos')}</SectionLabel>
      {canCapture ? (
      <Card accent={recording ? colors.critical : undefined}>
        <Muted>{t('Photos and voice notes are stored on the phone first and filed into the {file} the moment there is signal — capture them whether or not you have coverage. Filed {media} cannot be deleted.', { file: words.file, media: words.media })}</Muted>

        <Text style={styles.photoCount}>
          {t('Photos')}{' '}{MAX_PHOTOS - photosLeft}/{MAX_PHOTOS}{photosLeft === 0 ? t(' — limit reached') : ''}
        </Text>

        <View style={styles.actions}>
          <View style={{ flex: 1 }}>
            <Button label={t('Camera')} icon="camera" busy={busy === 'upload'} disabled={photosLeft === 0} onPress={() => void capture('camera')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={t('Library')} icon="images-outline" variant="outline" busy={busy === 'upload'} disabled={photosLeft === 0} onPress={() => void capture('library')} />
          </View>
        </View>

        {voiceOn ? (
          <View style={{ marginTop: space.sm }}>
            {recording ? (
              <Pressable
                onPress={() => void stopRecording()}
                accessibilityRole="button"
                accessibilityLabel={t('Stop recording and file the voice note')}
                style={({ pressed }) => [styles.recording, pressed && { opacity: 0.85 }]}
              >
                <View style={styles.recordingDot} />
                <Text style={styles.recordingText}>{t('Recording · {clockOf} — tap to stop', { clockOf: clockOf(recordedMs) })}</Text>
                <Ionicons name="stop-circle" size={20} color={colors.critical} />
              </Pressable>
            ) : (
              <Button
                label={t('Record voice note')}
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
            {queued.media === 1 ? t('1 attachment waiting to upload.') : t('{n} attachments waiting to upload.', { n: queued.media })}
          </Text>
        ) : null}
      </Card>
      ) : (
        <Card>
          <Muted>
            {closed
              ? `${police ? t('The case file is closed.') : t('The incident record is closed.')} ${photosFiled === 1 ? t('1 photo on record.') : t('{n} photos on record.', { n: photosFiled })}`
              : police ? t('Evidence is captured by the crew working this incident.') : t('Photos are taken by the crew working this incident.')}
          </Muted>
        </Card>
      )}

      {/* What is on record: reports and their forms, evidence to open or play, the PDF. */}
      <OnRecord incident={incident} updates={updates} files={files} />

      {/* Timeline */}
      <SectionLabel>{t('Updates ({length})', { length: updates.length })}</SectionLabel>
      <Card>
        <View style={styles.noteRow}>
          <View style={{ flex: 1 }}>
            <Input
              placeholder={t('Add an update…')}
              value={note}
              onChangeText={setNote}
              onSubmitEditing={() => void postUpdate()}
              returnKeyType="send"
            />
          </View>
          <Button
            label={t('Post')}
            icon="send"
            busy={busy === 'note'}
            disabled={!note.trim()}
            onPress={() => void postUpdate()}
          />
        </View>

        {queued.notes > 0 ? (
          <Text style={styles.queuedNote}>
            {queued.notes === 1 ? t('1 update waiting to send.') : t('{n} updates waiting to send.', { n: queued.notes })}
          </Text>
        ) : null}

        <View style={{ marginTop: space.lg }}>
          {updates.length === 0 ? (
            <Muted>{t('No updates logged yet — the first entry appears here in real time.')}</Muted>
          ) : null}
          {updates.map((u, i) => (
            <View key={u.id} style={styles.timelineRow}>
              <View style={styles.timelineGutter}>
                <View style={styles.timelineDot} />
                {i < updates.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineBody}>
                <Text style={styles.updateText}>{noteText(u.message)}</Text>
                <Text style={styles.updateMeta}>
                  {u.created_by_name ?? t('System')} · {timeAgo(u.timestamp)}
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
