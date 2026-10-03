import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FieldIncident } from '@criticom/api';
import type { CallView } from '@/lib/response';
import { colors, radius, severityColor, severityTint, space, timeAgo, type, makeStyles } from '@/lib/theme';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button, SeverityPill, StatusBadge } from '@/components/ui';

const formatDistance = (km: number) =>
  km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;

/** Who holds the call, in one line, from this officer's point of view. */
function assignmentLine(v: CallView, dispatchedBy: string | null) {
  if (v.ownSos) return { icon: 'alert-circle' as const, tone: colors.critical, text: 'Your SOS — dispatch is sending help to you' };
  if (v.role === 'lead') return { icon: 'star' as const, tone: colors.accent, text: 'You are leading this incident' };
  if (v.role === 'backup') {
    return { icon: 'people' as const, tone: colors.accent, text: `You are backup · lead: ${v.lead?.name ?? 'not yet responding'}` };
  }
  switch (v.assignment.kind) {
    case 'you':
      return { icon: 'person' as const, tone: colors.accent, text: `Assigned to you${dispatchedBy ? ` by ${dispatchedBy}` : ''}` };
    case 'other':
      return v.lead
        ? { icon: 'person' as const, tone: colors.textDim, text: `Led by ${v.assignment.name}` }
        : { icon: 'person' as const, tone: colors.textDim, text: `Assigned to ${v.assignment.name} — not responding yet` };
    default:
      return { icon: 'radio' as const, tone: colors.low, text: 'Sent to all on duty — the first to respond leads' };
  }
}

/**
 * The swipe-up drawer for one incident: what it is, where, who holds it, who is
 * responding — and the one thing this officer can do next.
 */
export function IncidentSheet({
  incident, view, status, queued, km, busy, onClose, onAction, onOpenFull,
}: {
  incident: FieldIncident | null;
  view: CallView | null;
  /** The call's status, including a change still queued on this phone. */
  status: string;
  queued: boolean;
  km: number | null;
  busy: boolean;
  onClose: () => void;
  onAction: () => void;
  onOpenFull: () => void;
}) {
  const styles = useStyles();
  if (!incident || !view) return <BottomSheet visible={false} onClose={onClose}>{null}</BottomSheet>;

  const sev = severityColor(incident.incident_severity);
  const who = assignmentLine(view, incident.dispatched_by);
  const responders = [...(view.lead ? [view.lead] : []), ...view.backups];

  const navigate = () => {
    const { location_lat: lat, location_lng: lng, location_address: address } = incident;
    const query = lat && lng ? `${lat},${lng}` : address;
    if (!query) return;
    const url = Platform.select({
      ios: `maps://?daddr=${encodeURIComponent(query)}`,
      default: `geo:0,0?q=${encodeURIComponent(query)}`,
    });
    void Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`));
  };

  const action = view.action;
  const actionLabel = !action ? null
    : action.kind === 'report' ? 'File incident report'
      : action.kind === 'respond' ? 'Responding'
        : action.label;

  return (
    <BottomSheet
      visible
      onClose={onClose}
      header={(
        <View style={styles.header}>
          <View style={[styles.sevBar, { backgroundColor: sev }]} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={styles.rowBetween}>
              <Text style={styles.number}>{incident.incident_number}</Text>
              <SeverityPill severity={incident.incident_severity} />
            </View>
            <Text style={styles.title} numberOfLines={2}>{incident.incident_type}</Text>
            <View style={styles.statusRow}>
              <StatusBadge status={status} />
              {queued ? (
                <View style={styles.queuedChip}>
                  <Ionicons name="time-outline" size={11} color={colors.medium} />
                  <Text style={styles.queuedText}>Waiting to send</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      )}
      footer={(
        <View style={{ gap: space.sm }}>
          {view.blocked ? <Text style={styles.blocked}>{view.blocked}</Text> : null}
          {view.note && !action ? <Text style={styles.note}>{view.note}</Text> : null}
          {action && actionLabel ? (
            <View>
              <Button
                label={actionLabel}
                icon={action.kind === 'report' ? 'document-text' : action.kind === 'respond' ? 'car-sport' : 'arrow-forward-circle'}
                variant={action.kind === 'report' ? 'success' : 'primary'}
                size="lg"
                busy={busy}
                disabled={Boolean(view.blocked)}
                onPress={onAction}
              />
              {action.kind === 'respond' ? (
                <Text style={styles.respondHint}>
                  {action.asLead ? 'You will lead this incident.' : 'You will join as backup.'} Dispatch is told at once.
                </Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Button label="Navigate" icon="navigate" variant="outline" onPress={navigate} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Full details" icon="open-outline" variant="outline" onPress={onOpenFull} />
            </View>
          </View>
        </View>
      )}
    >
      <View style={styles.content}>
        {incident.incident_severity === 'Critical' ? (
          <View style={[styles.urgent, { backgroundColor: severityTint(incident.incident_severity) }]}>
            <Ionicons name="warning" size={14} color={sev} />
            <Text style={[styles.urgentText, { color: sev }]}>Priority 1 — respond immediately</Text>
          </View>
        ) : null}

        <View style={[styles.who, { borderColor: `${who.tone}55` }]}>
          <Ionicons name={who.icon} size={16} color={who.tone} />
          <Text style={[styles.whoText, { color: who.tone }]}>{who.text}</Text>
        </View>

        <View style={styles.meta}>
          <Ionicons name="location-outline" size={15} color={colors.muted} />
          <Text style={styles.metaText}>{incident.location_address}</Text>
          {km !== null ? <Text style={styles.distance}>{formatDistance(km)}</Text> : null}
        </View>
        <View style={styles.meta}>
          <Ionicons name="radio-outline" size={15} color={colors.muted} />
          <Text style={styles.metaText}>
            Sent {timeAgo(incident.dispatch_time ?? incident.incident_created_at)}
            {incident.dispatched_by ? ` by ${incident.dispatched_by}` : ''}
          </Text>
        </View>
        {incident.caller_name ? (
          <View style={styles.meta}>
            <Ionicons name="call-outline" size={15} color={colors.muted} />
            <Text style={styles.metaText}>Caller: {incident.caller_name}</Text>
          </View>
        ) : null}

        {incident.call_description ? (
          <>
            <Text style={styles.section}>DESCRIPTION</Text>
            <Text style={styles.desc}>{incident.call_description}</Text>
          </>
        ) : null}

        <Text style={styles.section}>RESPONDING ({responders.length})</Text>
        {responders.length === 0 ? (
          <Text style={styles.empty}>Nobody yet.</Text>
        ) : responders.map((r) => (
          <View key={r.user_id} style={styles.responder}>
            <View style={[styles.roleTag, r.role === 'lead' && styles.roleLead]}>
              <Text style={[styles.roleText, r.role === 'lead' && { color: '#fff' }]}>
                {r.role === 'lead' ? 'LEAD' : 'BACKUP'}
              </Text>
            </View>
            <Text style={styles.responderName} numberOfLines={1}>{r.name ?? 'Officer'}</Text>
            <StatusBadge status={r.status} />
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  header: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.sm },
  sevBar: { width: 4, borderRadius: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  number: { ...type.mono, color: colors.accent },
  title: { ...type.h1, color: colors.text, marginTop: 4 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  queuedChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  queuedText: { ...type.small, fontSize: 11, color: colors.medium, fontWeight: '700' },

  content: { paddingHorizontal: space.lg, paddingTop: space.sm },
  urgent: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.sm, marginBottom: space.md,
  },
  urgentText: { fontSize: 12, fontWeight: '800' },
  who: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: space.md, paddingVertical: space.sm, marginBottom: space.md, backgroundColor: colors.bgCard,
  },
  whoText: { ...type.small, fontWeight: '700', flexShrink: 1 },
  meta: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
  metaText: { ...type.small, color: colors.textDim, flexShrink: 1, flex: 1 },
  distance: { ...type.small, color: colors.accent, fontWeight: '800' },
  section: { ...type.label, fontSize: 10, color: colors.muted, marginTop: space.lg, marginBottom: 6 },
  desc: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  empty: { ...type.small, color: colors.muted },
  responder: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  roleTag: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: colors.borderStrong,
  },
  roleLead: { backgroundColor: colors.accent, borderColor: colors.accent },
  roleText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.8, color: colors.textDim },
  responderName: { ...type.small, color: colors.text, fontWeight: '700', flex: 1 },

  blocked: { ...type.small, color: colors.medium, fontWeight: '700', textAlign: 'center' },
  note: { ...type.small, color: colors.muted, textAlign: 'center' },
  respondHint: { ...type.small, fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 6 },
  row2: { flexDirection: 'row', gap: space.sm },
}));
