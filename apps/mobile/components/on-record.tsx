import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import {
  getIncidentReport, getReportType, reportReadout, saDay, saTime, signIncidentMedia, type FieldIncident,
} from '@criticom/api';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { shareCasePdf } from '@/lib/case-pdf';
import { BottomSheet } from '@/components/bottom-sheet';
import { Banner, Button, Card, Muted, SectionLabel } from '@/components/ui';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { useT } from '@/lib/i18n';

type Attachment = Database['public']['Tables']['incident_attachments']['Row'];
type Update = { timestamp: string; created_by_name: string | null; message: string };
type Report = NonNullable<Awaited<ReturnType<typeof getIncidentReport>>>;
type Readout = ReturnType<typeof reportReadout>;
type Doc = { key: string; code: string; label: string; tone: string };

const CASE_TONE = '#3b82f6';
const stamp = (iso: string) => `${saDay(iso)} ${saTime(iso)}`;

/**
 * What is on record for a call, open or closed: its evidence (photos open
 * full screen, voice notes play, files open), the filed police report and
 * each of its forms (Arrest 12A, Crash CR1…), one tap each to read, and the
 * whole incident as a PDF to save or send. Everything is read with this
 * person's own access: what they may not see is simply not listed.
 */
export function OnRecord({ incident, updates, files }: { incident: FieldIncident; updates: Update[]; files: Attachment[] }) {
  const { t } = useT();
  const styles = useStyles();
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [report, setReport] = useState<Report | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paths = files.map((f) => f.storage_path).join('|');
  useEffect(() => {
    const list = paths ? paths.split('|') : [];
    if (!list.length) { setUrls(new Map()); return; }
    void signIncidentMedia(getSupabase(), list).then(setUrls).catch(() => setUrls(new Map()));
  }, [paths]);
  useEffect(() => {
    void getIncidentReport(getSupabase(), incident.id).then(setReport).catch(() => setReport(null));
  }, [incident.id, incident.report_filed_at]);

  const type = report ? getReportType(report.report_type) : null;
  const readout: Readout | null = useMemo(
    () => (report && type ? reportReadout(type, report as unknown as Record<string, unknown>) : null),
    [report, type],
  );
  const docs: Doc[] = type
    ? [{ key: 'case', code: t('Case'), label: t('Case report'), tone: CASE_TONE },
      ...(type.forms ?? []).map((f) => ({ key: f.id, code: f.code, label: f.label, tone: f.tone }))]
    : [];

  /* ── Voice notes ─────────────────────────────────────────────────── */
  const sound = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const stop = useCallback(async () => {
    const s = sound.current;
    sound.current = null;
    setPlaying(null);
    await s?.unloadAsync().catch(() => {});
  }, []);
  const play = async (id: string, uri: string) => {
    await stop();
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound: s } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      sound.current = s;
      setPlaying(id);
      s.setOnPlaybackStatusUpdate((st) => { if (st.isLoaded && st.didJustFinish) void stop(); });
    } catch {
      setError(t('That voice note could not be played. Check your signal.'));
    }
  };
  useEffect(() => () => { void sound.current?.unloadAsync(); }, []);

  const exportPdf = () => {
    setError(null);
    setPdfBusy(true);
    const filed = report && type && readout ? {
      title: t('Case report · {label}', { label: type.label }),
      filedBy: [report.officer_name, report.badge_number ? `#${report.badge_number}` : null, report.filed_at ? stamp(report.filed_at) : null].filter(Boolean).join(' · '),
      caseNumber: report.case_number ?? null,
      sections: [...readout.sections, ...(readout.extra.length ? [{ title: t('Other answers'), items: readout.extra }] : [])],
      narrative: report.officer_narrative ?? null,
    } : null;
    void shareCasePdf({
      incident,
      updates,
      report: filed,
      evidence: files.map((f) => ({ kind: f.kind, by: f.uploaded_by_name, at: f.created_at, caption: f.caption, url: urls.get(f.storage_path) ?? null })),
    })
      .catch((e: Error) => setError(e.message))
      .finally(() => setPdfBusy(false));
  };

  const photos = files.filter((f) => f.kind === 'image');
  const voices = files.filter((f) => f.kind === 'audio');
  const others = files.filter((f) => f.kind !== 'image' && f.kind !== 'audio');
  const shown = doc && readout
    ? readout.sections.filter((s) => (doc.key === 'case' ? !s.form : s.form === doc.key))
    : [];

  return (
    <>
      <SectionLabel>{t('On record')}</SectionLabel>
      <Card>
        {error ? <View style={{ marginBottom: space.sm }}><Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner></View> : null}

        {/* Reports: the case report and each form, one tap each. */}
        <Text style={styles.label}>{t('REPORTS')}</Text>
        {docs.length ? (
          <View style={styles.docs}>
            {docs.map((d) => (
              <Pressable
                key={d.key}
                onPress={() => setDoc(d)}
                accessibilityRole="button"
                accessibilityLabel={t('Open {label}', { label: d.label })}
                style={({ pressed }) => [styles.doc, { borderColor: `${d.tone}66`, backgroundColor: `${d.tone}14` }, pressed && { opacity: 0.8 }]}
              >
                <View style={[styles.docCode, { backgroundColor: d.tone }]}><Text style={styles.docCodeText}>{d.code}</Text></View>
                <Text style={styles.docLabel} numberOfLines={1}>{d.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        ) : (
          <Muted>{incident.report_filed_at ? t('The report is filed. Its forms show here once it has reached the server.') : t('No report filed yet.')}</Muted>
        )}

        {/* Evidence: photos, voice notes, files. */}
        <Text style={[styles.label, { marginTop: space.lg }]}>{t('EVIDENCE ({n})', { n: files.length })}</Text>
        {files.length === 0 ? <Muted>{t('No evidence on record.')}</Muted> : null}
        {photos.length ? (
          <View style={styles.photos}>
            {photos.map((p) => {
              const url = urls.get(p.storage_path);
              return (
                <Pressable key={p.id} onPress={() => url && setPhoto(url)} accessibilityRole="imagebutton" accessibilityLabel={t('Open photo')} style={styles.thumb}>
                  {url ? <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Ionicons name="image-outline" size={22} color={colors.muted} />}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {voices.map((v) => {
          const url = urls.get(v.storage_path);
          const on = playing === v.id;
          return (
            <Pressable
              key={v.id}
              disabled={!url}
              onPress={() => (on ? void stop() : url ? void play(v.id, url) : undefined)}
              accessibilityRole="button"
              accessibilityLabel={on ? t('Stop voice note') : t('Play voice note')}
              style={({ pressed }) => [styles.fileRow, on && { borderColor: colors.accent }, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name={on ? 'stop-circle' : 'play-circle'} size={30} color={colors.accent} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.fileTitle}>{on ? t('Playing…') : t('Voice note')}</Text>
                <Text style={styles.fileSub} numberOfLines={1}>{[v.uploaded_by_name, stamp(v.created_at)].filter(Boolean).join(' · ')}</Text>
              </View>
            </Pressable>
          );
        })}
        {others.map((f) => {
          const url = urls.get(f.storage_path);
          return (
            <Pressable
              key={f.id}
              disabled={!url}
              onPress={() => url && void Linking.openURL(url)}
              accessibilityRole="link"
              style={({ pressed }) => [styles.fileRow, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name={f.kind === 'video' ? 'videocam-outline' : 'document-attach-outline'} size={26} color={colors.accent} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.fileTitle} numberOfLines={1}>{f.caption ?? f.storage_path.split('/').pop()}</Text>
                <Text style={styles.fileSub} numberOfLines={1}>{[f.uploaded_by_name, stamp(f.created_at)].filter(Boolean).join(' · ')}</Text>
              </View>
              <Ionicons name="open-outline" size={18} color={colors.muted} />
            </Pressable>
          );
        })}

        <View style={{ marginTop: space.lg }}>
          <Button label={t('Full incident PDF')} icon="document-text-outline" variant="outline" busy={pdfBusy} onPress={exportPdf} />
        </View>
      </Card>

      {/* One report or form, read-only. */}
      <BottomSheet
        visible={Boolean(doc)}
        onClose={() => setDoc(null)}
        header={doc ? (
          <View style={styles.sheetHead}>
            <View style={[styles.docCode, { backgroundColor: doc.tone }]}><Text style={styles.docCodeText}>{doc.code}</Text></View>
            <Text style={styles.sheetTitle} numberOfLines={2}>{doc.label}</Text>
          </View>
        ) : null}
      >
        <View style={{ gap: space.md, paddingBottom: space.lg }}>
          {doc?.key === 'case' && report ? (
            <Muted>{[report.officer_name, report.badge_number ? `#${report.badge_number}` : null, report.filed_at ? stamp(report.filed_at) : null, report.case_number ? t('Case {n}', { n: report.case_number }) : null].filter(Boolean).join(' · ')}</Muted>
          ) : null}
          {shown.map((s) => (
            <View key={s.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{s.title.toUpperCase()}</Text>
              {s.items.map((it) => (
                <View key={it.label} style={styles.item}>
                  <Text style={styles.itemLabel}>{it.label}</Text>
                  <Text style={styles.itemValue}>{it.value}</Text>
                </View>
              ))}
            </View>
          ))}
          {doc?.key === 'case' && report?.officer_narrative ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('OFFICER NARRATIVE')}</Text>
              <Text style={styles.itemValue}>{report.officer_narrative}</Text>
            </View>
          ) : null}
          {doc && shown.length === 0 && !(doc.key === 'case' && report?.officer_narrative) ? <Muted>{t('Nothing was filled in on this form.')}</Muted> : null}
        </View>
      </BottomSheet>

      <PhotoViewer url={photo} onClose={() => setPhoto(null)} />
    </>
  );
}

/** A photo, full screen. */
function PhotoViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={Boolean(url)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <ScrollView maximumZoomScale={4} minimumZoomScale={1} centerContent contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          {url ? <Image source={{ uri: url }} style={{ width: '100%', aspectRatio: 3 / 4 }} resizeMode="contain" /> : null}
        </ScrollView>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('Close')}
          style={{ position: 'absolute', top: insets.top + 12, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  label: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: space.sm },
  docs: { gap: space.sm },
  doc: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 50, paddingHorizontal: space.sm, borderRadius: radius.md, borderWidth: 1 },
  docCode: { minWidth: 46, paddingHorizontal: 6, paddingVertical: 4, borderRadius: radius.sm, alignItems: 'center' },
  docCodeText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  docLabel: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm },
  thumb: { width: '31%', aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  fileRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, marginBottom: space.sm,
    paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bgSoft,
  },
  fileTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  fileSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  sheetTitle: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '800' },
  section: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.sm },
  sectionTitle: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  item: { gap: 2 },
  itemLabel: { color: colors.textDim, fontSize: 12 },
  itemValue: { color: colors.text, fontSize: 15 },
}));
