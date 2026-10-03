import { StyleSheet, Text, View } from 'react-native';
import {
  SECTION_ORDER, TOTAL_ITEMS, countItems, faultLabels, sectionKeys, type ItemMap,
} from '@/lib/inspection-187c';
import { StatusPill } from '@/components/shift-inspection';
import { PaperButton, Sheet, Stat, paper } from '@/components/shift-form';
import { makeStyles } from '@/lib/theme';

/**
 * The electronic inspection report, as the officer will file it. Shown before
 * Submit & Finalise so they read what they are signing for.
 */
export function ReportPreview({
  inspectionRef, ndm, mileage, shift, date, inspector, unit, items, passed, faultRemarks,
  onBack, onSubmit, busy,
}: {
  inspectionRef: string;
  ndm: string;
  mileage: string;
  shift: string;
  date: string;
  inspector: string;
  unit: string;
  items: ItemMap;
  /** Essential checks all Yes — the vehicle can go on duty. */
  passed: boolean;
  faultRemarks: string;
  onBack: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const styles = useStyles();
  const counts = countItems(items);
  const pct = Math.round((counts.done / TOTAL_ITEMS) * 100);

  return (
    <Sheet>
      <View style={styles.topbar}>
        <View style={styles.topIcon}><Text>📋</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>Electronic Inspection Report</Text>
          <Text style={styles.topRef}>{inspectionRef}</Text>
        </View>
      </View>

      <View style={styles.band}>
        <View style={styles.bandCircle} />
        <Text style={styles.bandRef}>{inspectionRef}</Text>
        <Text style={styles.bandTitle}>DMPS <Text style={{ color: paper.blue }}>187(c)</Text></Text>
        <Text style={styles.bandSub}>VEHICLE INSPECTION REPORT · ELECTRONIC RECORD</Text>
        <View style={styles.bandGrid}>
          <Fact label="NDM number" value={ndm} />
          <Fact label="Mileage" value={`${mileage} km`} />
          <Fact label="Shift" value={shift} />
          <Fact label="Date" value={date} />
          <Fact label="Unit" value={unit} />
          <Fact label="Inspector" value={inspector} />
        </View>
        <View style={[styles.badge, { backgroundColor: passed ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', borderColor: passed ? '#10b98155' : '#ef444455' }]}>
          <Text style={[styles.badgeText, { color: passed ? paper.green : paper.red }]}>
            ● {passed ? 'VEHICLE PASSED INSPECTION' : 'VEHICLE NOT CLEARED FOR DUTY'}
          </Text>
        </View>
      </View>

      <View style={{ padding: 14 }}>
        <View style={styles.completionRow}>
          <Text style={styles.mono}>Inspection Completion</Text>
          <Text style={styles.mono}>{counts.done}/{TOTAL_ITEMS} items · {pct}%</Text>
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${pct}%` }]} /></View>

        <View style={styles.stats}>
          <Stat value={TOTAL_ITEMS} label="TOTAL ITEMS" tone={paper.blue} />
          <Stat value={counts.ok} label="WORKING" tone={paper.green} />
          <Stat value={counts.fault} label="FAULTS" tone={paper.red} />
          <Stat value={counts.nil} label="NIL / N/A" tone={paper.faint} />
        </View>

        {counts.fault > 0 ? (
          <View style={[styles.note, { borderLeftColor: paper.red, backgroundColor: paper.redSoft }]}>
            <Text style={[styles.noteText, { color: paper.red }]}>
              × Faults: {faultLabels(items).join(', ')}
            </Text>
            {faultRemarks ? <Text style={styles.remarks}>{faultRemarks}</Text> : null}
          </View>
        ) : (
          <View style={[styles.note, { borderLeftColor: paper.green, backgroundColor: paper.greenSoft }]}>
            <Text style={[styles.noteText, { color: paper.green }]}>
              ✓ All inspected items are in working order — no faults detected.
            </Text>
          </View>
        )}

        <Text style={styles.detailHead}>INSPECTION DETAIL</Text>
        {SECTION_ORDER.map((s) => {
          const ok = sectionKeys(s).filter((k) => items[k] === 'ok').length;
          return (
            <View key={s.id} style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>{s.title.toUpperCase()}</Text>
                <Text style={styles.sectionCount}>{ok}/{s.items.length} OK</Text>
              </View>
              {s.items.map(([k, label]) => (
                <View key={k} style={styles.row}>
                  <Text style={styles.rowLabel}>{label}</Text>
                  <StatusPill status={items[`${s.id}.${k}`]} />
                </View>
              ))}
            </View>
          );
        })}
      </View>

      <View style={styles.actions}>
        <PaperButton label="← Back to Form" tone="outline" onPress={onBack} disabled={busy} style={{ flex: 1 }} />
        <PaperButton label="✓ Submit & Finalise" onPress={onSubmit} busy={busy} style={{ flex: 1.3 }} />
      </View>
    </Sheet>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.factValue}>{value || '—'}</Text>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  topbar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
    borderBottomWidth: 1, borderBottomColor: paper.line,
  },
  topIcon: {
    width: 36, height: 36, borderRadius: 9, backgroundColor: paper.blueSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  topTitle: { color: paper.ink, fontWeight: '800', fontSize: 15 },
  topRef: { color: paper.faint, fontFamily: 'monospace', fontSize: 11 },

  band: { backgroundColor: paper.head, padding: 18, overflow: 'hidden', borderBottomWidth: 1, borderBottomColor: paper.line },
  bandCircle: {
    position: 'absolute', right: -50, top: -40, width: 170, height: 170,
    borderRadius: 85, backgroundColor: 'rgba(59,130,246,0.10)',
  },
  bandRef: { color: paper.muted, fontFamily: 'monospace', fontSize: 10 },
  bandTitle: { color: paper.ink, fontWeight: '800', fontSize: 22, marginTop: 4 },
  bandSub: { color: paper.muted, fontSize: 10, letterSpacing: 1.5, marginTop: 2, fontFamily: 'monospace' },
  bandGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, rowGap: 12 },
  fact: { width: '50%', paddingRight: 8 },
  factLabel: { color: paper.muted, fontSize: 9, letterSpacing: 1.2, fontFamily: 'monospace' },
  factValue: { color: paper.ink, fontWeight: '700', fontSize: 14, marginTop: 2 },
  badge: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 14 },
  badgeText: { fontFamily: 'monospace', fontWeight: '800', fontSize: 11 },

  completionRow: { flexDirection: 'row', justifyContent: 'space-between' },
  mono: { color: paper.faint, fontFamily: 'monospace', fontSize: 11 },
  track: { height: 5, borderRadius: 3, backgroundColor: paper.line, marginTop: 6, marginBottom: 12, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: paper.blue },
  stats: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  note: { borderLeftWidth: 3, borderRadius: 8, padding: 12, marginBottom: 14 },
  noteText: { fontWeight: '700', fontSize: 14, lineHeight: 19 },
  remarks: { color: paper.inkDim, marginTop: 6, fontSize: 13, lineHeight: 18 },

  detailHead: { color: paper.blue, fontWeight: '800', letterSpacing: 1.5, fontSize: 11, marginBottom: 10 },
  section: { borderWidth: 1, borderColor: paper.line, borderRadius: 12, marginBottom: 10, overflow: 'hidden', backgroundColor: paper.sheet },
  sectionHead: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: paper.raised,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  sectionTitle: { color: paper.blue, fontWeight: '800', fontSize: 11, letterSpacing: 1.2 },
  sectionCount: { color: paper.faint, fontFamily: 'monospace', fontSize: 11 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: paper.line,
  },
  rowLabel: { color: paper.inkDim, fontSize: 14 },

  actions: {
    flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: paper.line,
  },
}));
