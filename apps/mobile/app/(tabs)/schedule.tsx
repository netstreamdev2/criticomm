import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getMySchedule, inclusiveDays, type MySchedule } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useDept } from '@/lib/branding';
import { DeptHeader } from '@/components/dept-badge';
import { colors, radius, space, type } from '@/lib/theme';
import { Banner, Card, EmptyState, Muted, SectionLabel, Title } from '@/components/ui';

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

const STATUS_COLOUR: Record<string, string> = {
  Approved: colors.low,
  Rejected: colors.critical,
  Pending: colors.medium,
};

/** "When am I working?" — the crew's own roster, leave and endorsements. */
export default function ScheduleScreen() {
  const { session, silo, fullName, role } = useAuth();
  const dept = useDept();
  const [schedule, setSchedule] = useState<MySchedule | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      setSchedule(await getMySchedule(getSupabase(), { userId: session.user.id, silo }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [session, silo]);

  useEffect(() => { void load(); }, [load]);

  const upcoming = (schedule?.duties ?? []).filter((d) => d !== schedule?.onDutyNow);
  const balances = (schedule?.balances ?? []).filter((b) => b.entitlement > 0);

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.accent}
          colors={[colors.accent]}
          progressBackgroundColor={colors.bgCard}
          onRefresh={() => {
            setRefreshing(true);
            void load().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}

      {/* Who and where */}
      <Card style={{ borderLeftWidth: 3, borderLeftColor: dept.primary_color }}>
        <DeptHeader dept={dept} />
        <View style={styles.identity}>
          <Text style={styles.name}>{fullName}</Text>
          <Muted>{role}</Muted>
        </View>
      </Card>

      {/* On duty now */}
      <SectionLabel>Right now</SectionLabel>
      {schedule?.onDutyNow ? (
        <Card accent={colors.low}>
          <View style={styles.rowGap}>
            <Ionicons name="radio" size={18} color={colors.low} />
            <Title>{schedule.onDutyNow.shiftName}</Title>
          </View>
          <Muted>
            {schedule.onDutyNow.startTime ? `${timeLabel(schedule.onDutyNow.startTime)}–` : ''}
            {schedule.onDutyNow.endTime ? timeLabel(schedule.onDutyNow.endTime) : ''}
            {' · '}{schedule.onDutyNow.station}
          </Muted>
          <View style={styles.chips}>
            {schedule.onDutyNow.callSign ? <Chip icon="id-card-outline" text={schedule.onDutyNow.callSign} /> : null}
            {schedule.onDutyNow.vehicle ? <Chip icon="car-sport-outline" text={schedule.onDutyNow.vehicle} /> : null}
            {schedule.onDutyNow.sector ? <Chip icon="map-outline" text={schedule.onDutyNow.sector} /> : null}
          </View>
          {schedule.onDutyNow.specialInstructions ? (
            <Text style={styles.instructions}>{schedule.onDutyNow.specialInstructions}</Text>
          ) : null}
        </Card>
      ) : (
        <Card tight>
          <Muted>Not on a scheduled duty right now.</Muted>
        </Card>
      )}

      {/* Upcoming duties */}
      <SectionLabel>Upcoming duties ({upcoming.length})</SectionLabel>
      {upcoming.length === 0 ? (
        <Card tight>
          <Muted>Nothing rostered in the next 30 days — your supervisor allocates duty from the roster board.</Muted>
        </Card>
      ) : upcoming.map((d) => (
        <Card key={d.rosterId} tight>
          <View style={styles.dutyRow}>
            <View style={styles.dateBlock}>
              <Text style={styles.dateDay}>
                {d.startTime ? new Date(d.startTime).getDate() : '—'}
              </Text>
              <Text style={styles.dateMonth}>
                {d.startTime
                  ? new Date(d.startTime).toLocaleDateString('en-ZA', { month: 'short' }).toUpperCase()
                  : ''}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.dutyName} numberOfLines={1}>{d.shiftName}</Text>
              <Muted>
                {d.startTime ? `${dayLabel(d.startTime)} · ${timeLabel(d.startTime)}` : 'Unscheduled'}
                {d.endTime ? `–${timeLabel(d.endTime)}` : ''}
              </Muted>
              <Muted>{d.activityType} · {d.station}</Muted>
              {d.callSign || d.vehicle ? (
                <View style={styles.chips}>
                  {d.callSign ? <Chip icon="id-card-outline" text={d.callSign} /> : null}
                  {d.vehicle ? <Chip icon="car-sport-outline" text={d.vehicle} /> : null}
                </View>
              ) : null}
            </View>
          </View>
        </Card>
      ))}

      {/* Leave balances */}
      {balances.length > 0 ? (
        <>
          <SectionLabel>Leave balances</SectionLabel>
          <Card>
            {balances.map((b, i) => {
              const used = Math.min(1, (b.taken + b.pending) / b.entitlement);
              return (
                <View key={b.type} style={[styles.balanceRow, i > 0 && styles.balanceDivider]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.balanceType}>{b.type}</Text>
                    <Muted>{b.taken} taken{b.pending > 0 ? ` · ${b.pending} pending` : ''}</Muted>
                    <View style={styles.track}>
                      <View
                        style={[
                          styles.fill,
                          {
                            width: `${used * 100}%`,
                            backgroundColor: used >= 0.9 ? colors.critical : used >= 0.65 ? colors.medium : colors.low,
                          },
                        ]}
                      />
                    </View>
                  </View>
                  <Text style={styles.balanceRemaining}>
                    {b.remaining}
                    <Text style={styles.balanceOf}> / {b.entitlement}</Text>
                  </Text>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      {/* Leave requests */}
      <SectionLabel>My leave</SectionLabel>
      {(schedule?.leave ?? []).length === 0 ? (
        <Card tight><Muted>No upcoming leave.</Muted></Card>
      ) : schedule!.leave.map((l) => (
        <Card key={l.id} tight accent={STATUS_COLOUR[l.status] ?? colors.border}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.dutyName}>{l.absence ?? 'Leave'}</Text>
              <Muted>
                {l.eff_from} → {l.eff_to} · {inclusiveDays(l.eff_from, l.eff_to)} day
                {inclusiveDays(l.eff_from, l.eff_to) === 1 ? '' : 's'}
              </Muted>
              {l.approved_by ? <Muted>Decided by {l.approved_by}</Muted> : null}
            </View>
            <Text style={[styles.status, { color: STATUS_COLOUR[l.status] ?? colors.muted }]}>
              {l.status}
            </Text>
          </View>
        </Card>
      ))}

      {/* Endorsements */}
      {(schedule?.endorsements ?? []).length > 0 ? (
        <>
          <SectionLabel>Endorsements</SectionLabel>
          {schedule!.endorsements.map((e) => (
            <Card key={e.id} tight>
              <Text style={styles.dutyName}>{e.type}</Text>
              <Muted>{e.start_date}{e.end_date ? ` → ${e.end_date}` : ''}</Muted>
              {e.details ? <Text style={styles.instructions}>{e.details}</Text> : null}
            </Card>
          ))}
        </>
      ) : null}

      {!schedule && !error ? (
        <EmptyState icon="calendar-outline" title="Loading your schedule…" />
      ) : null}
    </ScrollView>
  );
}

function Chip({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={11} color={colors.muted} />
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  identity: { marginTop: space.md, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  name: { ...type.bodyStrong, color: colors.text },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: space.md },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.bgElevated, borderRadius: radius.sm,
    paddingHorizontal: space.sm, paddingVertical: 3,
  },
  chipText: { ...type.small, fontSize: 11, color: colors.textDim },

  instructions: {
    ...type.small, color: colors.medium, marginTop: space.sm, fontStyle: 'italic', lineHeight: 18,
  },

  dutyRow: { flexDirection: 'row', gap: space.md },
  dateBlock: {
    width: 46, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgElevated, borderRadius: radius.md, paddingVertical: space.sm,
  },
  dateDay: { color: colors.text, fontSize: 18, fontWeight: '800' },
  dateMonth: { ...type.label, fontSize: 9, color: colors.muted },
  dutyName: { ...type.bodyStrong, color: colors.text },

  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  balanceDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  balanceType: { ...type.bodyStrong, color: colors.text },
  balanceRemaining: { color: colors.text, fontSize: 20, fontWeight: '800' },
  balanceOf: { ...type.small, color: colors.muted, fontWeight: '400' },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.bgElevated, overflow: 'hidden', marginTop: 6 },
  fill: { height: '100%', borderRadius: 3 },

  status: { ...type.small, fontWeight: '700' },
});
