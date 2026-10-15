import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { getShiftInspectionFolder, recordShiftDocuments } from '@criticom/api';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { uploadShiftPhoto } from '@/lib/shift-files';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { paper } from '@/components/shift-form';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

type DocumentsRow = Database['public']['Tables']['shift_identity_documents']['Row'];
type Kind = 'licence' | 'id';

const LABEL: Record<Kind, { title: string; hint: string; icon: keyof typeof Ionicons.glyphMap }> = {
  licence: { title: tx('Driver’s licence'), hint: tx('Scan the front of the card'), icon: 'card-outline' },
  id: { title: tx('ID document'), hint: tx('Take a photo or upload one'), icon: 'person-circle-outline' },
};

function saDay() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * Optional: the officer's driver's licence and ID on today's shift record.
 * Each photo is saved the moment it is taken; nothing here holds up the shift.
 */
export function ShiftDocuments({ initial }: { initial: DocumentsRow | null }) {
  const { t } = useT();
  const styles = useStyles();
  const [saved, setSaved] = useState<Record<Kind, boolean>>({
    licence: Boolean(initial?.licence_path), id: Boolean(initial?.id_document_path),
  });
  const [preview, setPreview] = useState<Partial<Record<Kind, string>>>({});
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const capture = async (kind: Kind, source: 'camera' | 'library') => {
    setError(null);
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') { setError(t('Allow camera access to scan the card.')); return; }
    }
    const launch = source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    // A card-shaped crop for the licence, so the scan is the card and nothing else.
    const result = await launch({
      mediaTypes: ['images'], quality: 0.7,
      ...(kind === 'licence' ? { allowsEditing: true, aspect: [16, 10] as [number, number] } : {}),
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setBusy(kind);
    try {
      const sb = getSupabase();
      const folder = await getShiftInspectionFolder(sb, `shift-docs-${saDay()}`);
      const path = await uploadShiftPhoto(sb, folder, uri, `${kind}-${Date.now()}`);
      await recordShiftDocuments(sb, kind === 'licence' ? { licencePath: path } : { idDocumentPath: path });
      setSaved((s) => ({ ...s, [kind]: true }));
      setPreview((p) => ({ ...p, [kind]: uri }));
    } catch (e) {
      setError((e as { message?: string })?.message ?? t('The photo was not saved. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const start = (kind: Kind) => {
    if (kind === 'licence') { void capture('licence', 'camera'); return; }
    Alert.alert(t('ID document'), undefined, [
      { text: t('Take photo'), onPress: () => void capture('id', 'camera') },
      { text: t('Choose from library'), onPress: () => void capture('id', 'library') },
      { text: t('Cancel'), style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t('Licence and ID')}{' '}<Text style={styles.optional}>{t('(optional)')}</Text></Text>
      {(['licence', 'id'] as const).map((kind) => {
        const l = LABEL[kind];
        const done = saved[kind];
        return (
          <Pressable
            key={kind}
            onPress={() => start(kind)}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel={done ? t('Replace {document}', { document: t(l.title) }) : t('Add {document}', { document: t(l.title) })}
            style={[styles.row, done && styles.rowDone]}
          >
            {preview[kind] ? (
              <Image source={{ uri: preview[kind] }} style={styles.thumb} />
            ) : (
              <View style={styles.icon}><Ionicons name={l.icon} size={22} color={done ? paper.green : paper.blue} /></View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{t(l.title)}</Text>
              <Text style={styles.rowHint}>{done ? t('Saved to today’s record · tap to replace') : t(l.hint)}</Text>
            </View>
            {busy === kind ? (
              <ActivityIndicator color={paper.blue} />
            ) : (
              <Ionicons name={done ? 'checkmark-circle' : kind === 'licence' ? 'scan-outline' : 'cloud-upload-outline'} size={22} color={done ? paper.green : paper.blue} />
            )}
          </Pressable>
        );
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  box: {
    alignSelf: 'stretch', marginTop: space.lg, gap: space.sm, padding: space.md,
    borderRadius: 12, borderWidth: 1, borderColor: paper.line, backgroundColor: paper.field,
  },
  title: { color: paper.ink, fontWeight: '800', fontSize: 15 },
  optional: { color: paper.muted, fontWeight: '600', fontSize: 13 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: paper.lineStrong, backgroundColor: paper.sheet,
  },
  rowDone: { borderColor: paper.green },
  icon: { width: 44, height: 30, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 44, height: 30, borderRadius: 4 },
  rowTitle: { color: paper.ink, fontWeight: '700', fontSize: 14 },
  rowHint: { color: paper.muted, fontSize: 12, marginTop: 2 },
  error: { color: colors.critical, fontSize: 13 },
}));
