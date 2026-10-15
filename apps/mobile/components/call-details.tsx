import { StyleSheet, Text, View } from 'react-native';
import { DETAIL_FIELDS, QUESTION_PREFIX, catalogueType, sapsCategories, type IncidentDetails } from '@criticom/db';
import { callChannelText, readPatients } from '@criticom/db/call-facts';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { useT } from '@/lib/i18n';

/**
 * What the call taker filled in for the type (0077), as the console shows it
 * (apps/web/components/call-details.tsx): the code, the SAPS category it may
 * fall under, and each detail ("What was taken: Cellphone, TV"). Nothing
 * shows for a call with none, or before 0077 is run.
 */
export function CallDetails({ incident }: {
  incident: {
    incident_type: string; incident_code?: string | null; details?: unknown;
    call_channel?: string | null; call_channel_other?: string | null; patients?: unknown;
  };
}) {
  const { t } = useT();
  const styles = useStyles();
  const details = (incident.details && typeof incident.details === 'object' ? incident.details : {}) as IncidentDetails;
  const order = catalogueType(incident.incident_type)?.details ?? [];
  const keys = [...order.filter((k) => k in details), ...Object.keys(details).filter((k) => !order.includes(k))];
  const lines = keys
    .map((k) => ({
      key: k,
      label: k.startsWith(QUESTION_PREFIX) ? k.slice(QUESTION_PREFIX.length) : DETAIL_FIELDS[k]?.label,
      value: details[k],
    }))
    .filter((l): l is { key: string; label: string; value: string | string[] } => Boolean(l.label) && l.value !== undefined);
  const saps = sapsCategories(incident.incident_type, details);
  // Each patient's own severity, apart from the incident's, and how the call came in (0080).
  const patients = readPatients(incident.patients);
  const channel = callChannelText(incident.call_channel, incident.call_channel_other);
  if (!lines.length && !incident.incident_code && !saps.length && !patients.length && !channel) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        {incident.incident_code ? <Text style={[styles.chip, styles.code]}>{incident.incident_code}</Text> : null}
        {/* The official SAPS names, as SAPS writes them. */}
        {saps.length ? <Text style={styles.chip}>{`${t('SAPS')}: ${saps.join(` ${t('or')} `)}`}</Text> : null}
      </View>
      {patients.length ? (
        <View style={styles.line}>
          <Text style={styles.label}>{t('PATIENTS')}</Text>
          {patients.map((p, i) => (
            <Text key={`${p.name ?? 'patient'}-${i}`} style={styles.value}>
              {`${p.caller ? (p.name ? t('{name} (the caller)', { name: p.name }) : t('The caller')) : p.name ?? t('Name not given')} · ${t(p.severity)}`}
            </Text>
          ))}
        </View>
      ) : null}
      {lines.map((l) => (
        <View key={l.key} style={styles.line}>
          <Text style={styles.label}>{t(l.label).toUpperCase()}</Text>
          <Text style={styles.value}>{Array.isArray(l.value) ? l.value.map((v) => t(v)).join(', ') : t(l.value)}</Text>
        </View>
      ))}
      {channel ? (
        <View style={styles.line}>
          <Text style={styles.label}>{t('HOW THE CALL CAME IN')}</Text>
          <Text style={styles.value}>{incident.call_channel === 'Other' ? channel : t(channel)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  wrap: { gap: space.sm, marginBottom: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, overflow: 'hidden',
    paddingHorizontal: space.md, paddingVertical: 3, backgroundColor: colors.bgSoft,
    color: colors.textDim, fontSize: 12, fontWeight: '600',
  },
  code: { color: colors.text, fontWeight: '800', letterSpacing: 0.5 },
  line: { gap: 2 },
  label: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  value: { color: colors.text, fontSize: 14, lineHeight: 20 },
}));
