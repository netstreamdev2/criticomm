import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getFireInspection, type FireSiteInspection } from '@criticom/api';
import { FIRE_INSPECTION_ITEMS, daysWords } from '@criticom/db/fire-inspection';
import { getSupabase } from '@/lib/supabase';
import { colors, space, makeStyles } from '@/lib/theme';
import { Button, Card, EmptyState, KeyValue, Muted, SectionLabel, Title } from '@/components/ui';
import { useT } from '@/lib/i18n';

const OUTCOME_TONE = (): Record<string, string> => ({
  Compliant: colors.low, 'Compliance notice': colors.high, Instruction: colors.critical,
});

/** A filed site inspection, as it is on record (0106): read only. */
export default function InspectionScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [row, setRow] = useState<FireSiteInspection | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setRow(await getFireInspection(getSupabase(), id).catch(() => null));
    setLoading(false);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  if (!row) {
    return (
      <View style={[styles.center, { paddingHorizontal: space.lg }]}>
        <EmptyState icon="alert-circle-outline" title={t('Inspection not available')} body={t('It may not have reached the server yet.')} />
      </View>
    );
  }

  const outcome = row.outcome ?? (row.result === 'PASS' ? 'Compliant' : 'Compliance notice');
  const tone = OUTCOME_TONE()[outcome] ?? colors.medium;
  const passed = FIRE_INSPECTION_ITEMS.filter((i) => row.checklist?.[i.key] === 'yes').length;
  const notApplicable = FIRE_INSPECTION_ITEMS.filter((i) => row.checklist?.[i.key] === 'na').length;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <Card accent={tone}>
        <Text style={styles.ref}>{row.inspection_ref}</Text>
        <Title>{row.business_name}</Title>
        <Muted>{row.address}</Muted>
        <Text style={[styles.outcome, { color: tone }]}>{t(outcome)}</Text>
        <View style={{ marginTop: space.md }}>
          <KeyValue label={t('Inspected')} value={new Date(row.inspected_at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} />
          <KeyValue label={t('Inspector')} value={row.inspector_name ?? '—'} />
          {row.kind ? <KeyValue label={t('Why')} value={t(row.kind)} /> : null}
          {row.person_in_charge ? <KeyValue label={t('Person in charge')} value={row.person_in_charge} /> : null}
          {row.served ? <KeyValue label={t('Notice')} value={t(row.served)} /> : null}
          {row.comply_by ? <KeyValue label={t('Put right by')} value={row.comply_by} /> : null}
          {row.reinspect_on ? <KeyValue label={t('Back to check on')} value={row.reinspect_on} /> : null}
        </View>
        {row.repeat_failure ? <Text style={styles.repeat}>{t('A fault on the last notice was still there.')}</Text> : null}
      </Card>

      {row.instruction ? (
        <Card accent={colors.critical}>
          <Title>{t(row.instruction)}</Title>
          <Muted>{row.instruction_reason}</Muted>
        </Card>
      ) : null}

      {row.notice_items.length ? (
        <>
          <SectionLabel>{t('Faults to put right')}</SectionLabel>
          <Card>
            {row.notice_items.map((n, i) => (
              <View key={n.key} style={[styles.item, i > 0 && styles.divider]}>
                <Text style={styles.itemLabel}>{t(n.label)}</Text>
                <Text style={styles.itemSub}>{n.section} · {t(n.remedy)}</Text>
                <Text style={styles.itemDays}>{t(daysWords(n.days))}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {Object.keys(row.checklist ?? {}).length ? (
        <Muted>{t('{passed} checks passed, {na} not applicable.', { passed, na: notApplicable })}</Muted>
      ) : null}
      {row.notes ? (
        <>
          <SectionLabel>{t('Notes')}</SectionLabel>
          <Card><Text style={styles.notes}>{row.notes}</Text></Card>
        </>
      ) : null}

      {row.premises_id && outcome !== 'Compliant' ? (
        <Button label={t('Re-inspect this site')} icon="refresh" onPress={() => router.push({ pathname: '/inspection/new', params: { premises: row.premises_id as string } })} />
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'], gap: space.md },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  ref: { color: colors.accent, fontSize: 12, fontFamily: 'monospace', fontWeight: '700', marginBottom: 4 },
  outcome: { fontSize: 16, fontWeight: '900', marginTop: space.sm },
  repeat: { color: colors.critical, fontWeight: '800', marginTop: space.md },
  item: { paddingVertical: space.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  itemLabel: { color: colors.text, fontSize: 15, fontWeight: '800' },
  itemSub: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  itemDays: { color: colors.high, fontSize: 13, fontWeight: '800', marginTop: 4 },
  notes: { color: colors.text, fontSize: 14, lineHeight: 20 },
}));
