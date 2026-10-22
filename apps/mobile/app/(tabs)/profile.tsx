import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getMyPersonnel, getMyShiftKit, toggleDuty } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useNotifications, type PushStatus } from '@/lib/notifications';
import { useSignOut } from '@/lib/sign-out';
import { useSync } from '@/lib/sync';
import { useFeatures } from '@/lib/features';
import { useOpenCall } from '@/lib/open-call';
import { useDuty } from '@/lib/duty';
import { useDept } from '@/lib/branding';
import { useRouteStatus } from '@/lib/tracker';
import { errorWords } from '@/lib/offline-cache-policy';
import { roleName } from '@criticom/db';
import { tx } from '@criticom/db/i18n';
import { departmentOf, wordsIn } from '@/lib/department';
import { DeptBadge } from '@/components/dept-badge';
import { colors, radius, space, type, makeStyles } from '@/lib/theme';
import { Banner, Button, Card, KeyValue, Muted, SectionLabel, Title } from '@/components/ui';
import { CritiHead } from '@/components/criti-head';
import { WorkLinks } from '@/components/work-links';
import { OrgMark } from '@/components/org-mark';
import { LanguagePicker } from '@/components/language-picker';
import { useT } from '@/lib/i18n';

/**
 * Push status in plain words. A supervisor checking a handset before a shift
 * needs to know whether it will ring, and if not, whether that is fixable here
 * (permission) or a build/hardware fact (no FCM, emulator) — "push unavailable"
 * on its own sends people to the wrong place.
 */
const PUSH_COPY: Record<PushStatus, { heading: string; detail: string }> = {
  checking: {
    heading: tx('Checking push…'),
    detail: tx('Registering this handset for dispatch notifications.'),
  },
  enabled: {
    heading: tx('Push enabled'),
    detail: tx('Incidents routed to your department reach this phone even when the screen is locked. High and Critical incidents open a full-screen alert you must acknowledge.'),
  },
  denied: {
    heading: tx('Notifications blocked'),
    detail: tx('This phone will not ring for a dispatch. Turn notifications on for HikTech in the device settings. Alerts still arrive instantly while the app is open.'),
  },
  unsupported: {
    heading: tx('Push not in this build'),
    detail: tx('This build has no push service configured, so alerts arrive only while the app is open. Report it to your system administrator before carrying this handset on shift.'),
  },
  simulator: {
    heading: tx('Push unavailable on this device'),
    detail: tx('Emulators and simulators cannot register for push. Alerts still arrive while the app is open.'),
  },
  error: {
    heading: tx('Push registration failed'),
    detail: tx('This phone could not be registered for dispatch notifications. Alerts still arrive while the app is open — report this so the handset can be checked.'),
  },
};

export default function ProfileScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { session, fullName, role, silo } = useAuth();
  const { pushEnabled, pushStatus } = useNotifications();
  const signOut = useSignOut();
  const { pending, failed, online } = useSync();
  const route = useRouteStatus();
  const { enabled: featureOn } = useFeatures();
  const dept = useDept();
  const words = wordsIn(silo, t);
  const police = departmentOf(silo) === 'police';
  const { refresh: refreshOpenCall } = useOpenCall();
  const [onDuty, setOnDuty] = useState(false);
  const [unit, setUnit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initials = fullName.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const load = useCallback(async () => {
    if (!session) return;
    const me = await getMyPersonnel(getSupabase(), session.user.id).catch(() => null);
    if (me) {
      setOnDuty(me.is_on_duty);
      const apparatus = (me as { apparatus?: { unit_number?: string; name?: string } }).apparatus;
      setUnit(apparatus?.unit_number ? `${apparatus.unit_number} — ${apparatus.name ?? ''}` : null);
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  // Follow duty changes made elsewhere (the Shift tab, the server) live.
  const { onDuty: liveOnDuty } = useDuty();
  useEffect(() => {
    if (liveOnDuty !== null) setOnDuty(liveOnDuty);
  }, [liveOnDuty]);

  /**
   * An officer on a call stays on duty and signed in until its report is
   * filed — leaving would strand the call with no unit. The server holds the
   * same line (migration 0039); this says so before anything is attempted.
   */
  const stillOnCall = async (action: string) => {
    const open = await refreshOpenCall();
    if (!open) return false;
    Alert.alert(
      t('You are on {incident_number}', { incident_number: open.incident_number }),
      t('File its {report} before you {action}.', { report: words.report, action }),
      [
        { text: t('OK'), style: 'cancel' },
        { text: t('Open incident'), onPress: () => router.push(`/incident/${open.id}`) },
      ],
    );
    return true;
  };

  const flipDuty = async (value: boolean) => {
    if (!value && (await stillOnCall(t('go off duty')))) return;
    setOnDuty(value);
    setError(null);
    try {
      await toggleDuty(getSupabase(), { onDuty: value });
    } catch (e) {
      setOnDuty(!value);
      setError(errorWords(e));
    }
  };

  const confirmSignOut = async () => {
    if (await stillOnCall(t('sign out'))) return;
    // A firearm still booked out is handed back before the officer leaves: the
    // end of shift does that. Signing out anyway tells command (0051). Only
    // police draw firearms.
    const kit = police ? await getMyShiftKit(getSupabase()).catch(() => null) : null;
    if (kit?.firearm) {
      Alert.alert(
        t('Firearm still booked out'),
        t('{make} {model} ({serial_number}) is booked out to you. Hand it back with End shift before you sign out.', { make: kit.firearm.make, model: kit.firearm.model, serial_number: kit.firearm.serial_number }),
        [
          { text: t('Cancel'), style: 'cancel' },
          { text: t('End shift'), onPress: () => router.push('/end-shift') },
          { text: t('Sign out anyway'), style: 'destructive', onPress: () => void signOut() },
        ],
      );
      return;
    }
    const undelivered = pending.length + failed.length;
    // Undelivered work is held against the account that captured it, so it is
    // not lost — but the next person to carry this handset cannot send it, and
    // it will sit until this officer signs in again. Say so plainly rather than
    // letting them find out at the inquiry.
    const warning = undelivered > 0
      ? `\n\n${undelivered === 1 ? t('1 update has not reached the server yet.') : t('{n} updates have not reached the server yet.', { n: undelivered })} ${
          online
            ? t('Give it a moment and check the sync tray before signing out.')
            : t('It stays on this phone under your account and sends the next time you sign in with signal.')
        }`
      : '';

    Alert.alert(
      t('Sign out?'),
      `${words.unit ? t('Your {unit} will be released and your duty status cleared.', { unit: words.unit }) : t('Your duty status will be cleared.')}${warning}`,
      [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Sign out'), style: 'destructive', onPress: () => void signOut() },
      ],
    );
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      {/* Identity — badged to the responder's own service */}
      <Card accent={dept.primary_color}>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || '—'}</Text>
            <View style={[styles.avatarStatus, { backgroundColor: onDuty ? colors.low : colors.muted }]} />
          </View>
          <View style={{ flex: 1 }}>
            <Title>{fullName}</Title>
            <Muted>{roleName(role)}</Muted>
          </View>
          <DeptBadge dept={dept} size={40} />
        </View>
        <Muted style={{ marginTop: space.sm }}>{dept.official_name}</Muted>
        <View style={{ marginTop: space.md }}>
          <KeyValue label={t('Assigned unit')} value={unit ?? 'None'} />
          <KeyValue label={t('Account')} value={session?.user.email ?? '—'} />
        </View>
      </Card>

      {/* Duty */}
      <SectionLabel>{t('Duty status')}</SectionLabel>
      <Card accent={onDuty ? colors.low : colors.border}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: space.md }}>
            <View style={styles.dutyHeading}>
              <View style={[styles.dutyDot, { backgroundColor: onDuty ? colors.low : colors.muted }]} />
              <Title>{onDuty ? t('On duty') : t('Off duty')}</Title>
            </View>
            <Muted>
              {!onDuty
                ? t('Going on duty shares your route with dispatch.')
                : route.mode === 'denied'
                  ? t('Location is off. Dispatch cannot see where you are.')
                  : route.waiting > 0 && !online
                    ? t('No signal. Your route is kept on this phone and sends when signal returns.')
                    : route.lastFixAt
                      ? t('Last position {time}', { time: new Date(route.lastFixAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) })
                      : t('Finding your position…')}
            </Muted>
          </View>
          <Switch
            value={onDuty}
            onValueChange={(v) => void flipDuty(v)}
            trackColor={{ true: colors.low, false: colors.borderStrong }}
            thumbColor="#fff"
            accessibilityLabel={t('Toggle duty status')}
          />
        </View>
        {onDuty && route.mode !== 'denied' ? (
          <View style={styles.gpsNote}>
            <Ionicons name="navigate" size={13} color={colors.low} />
            <Text style={styles.gpsText}>
              {route.mode === 'foreground' ? t('Dispatch sees your route while the app is open') : t('Dispatch sees your route')}
            </Text>
          </View>
        ) : null}
        {error ? <View style={{ marginTop: space.md }}><Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner></View> : null}
        <View style={styles.endShift}>
          <Button label={t('End shift')} icon="moon-outline" variant="subtle" onPress={() => router.push('/end-shift')} />
          <Muted style={{ marginTop: space.xs }}>
            {police ? t('Hand back your firearm and vehicle, then go off duty.')
              : words.unit ? t('Hand back your {unit}, then go off duty.', { unit: words.unit }) : t('End your shift and go off duty.')}
          </Muted>
        </View>
      </Card>

      {/* Alerts */}
      {/* My work: one clear button per section, each opening its own page */}
      <SectionLabel>{t('My work')}</SectionLabel>
      <WorkLinks />

      <SectionLabel>{t('Dispatch alerts')}</SectionLabel>
      <Card accent={pushEnabled ? colors.accent : colors.medium}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1, paddingRight: space.md }}>
            <View style={styles.dutyHeading}>
              <Ionicons
                name={pushEnabled ? 'notifications' : 'notifications-off-outline'}
                size={17}
                color={pushEnabled ? colors.accent : colors.medium}
              />
              <Title>{t(PUSH_COPY[pushStatus].heading)}</Title>
            </View>
            <Muted>{t(PUSH_COPY[pushStatus].detail)}</Muted>
          </View>
        </View>
      </Card>

      {/* Sync */}
      <SectionLabel>{t('Delivery')}</SectionLabel>
      <Card accent={failed.length > 0 ? colors.critical : online ? colors.low : colors.medium}>
        <View style={styles.dutyHeading}>
          <Ionicons
            name={failed.length > 0 ? 'warning' : online ? 'cloud-done-outline' : 'cloud-offline-outline'}
            size={17}
            color={failed.length > 0 ? colors.critical : online ? colors.low : colors.medium}
          />
          <Title>
            {failed.length > 0
              ? t('{length} not sent', { length: failed.length })
              : pending.length > 0
                ? t('{length} waiting to send', { length: pending.length })
                : online ? t('Everything delivered') : t('Offline')}
          </Title>
        </View>
        <Muted>
          {failed.length > 0
            ? t('Some updates could not be delivered. Open the sync tray at the bottom of the screen to retry or review them.')
            : pending.length > 0
              ? t('Updates you captured are stored on this phone and send themselves as soon as there is signal.')
              : online
                ? t('Status changes, notes and {media} are reaching the server as you capture them.', { media: words.media })
                : t('Anything you capture is stored on this phone and sends itself when signal returns.')}
        </Muted>
      </Card>

      {/* Self-service */}
      <SectionLabel>{t('Self-service')}</SectionLabel>
      <Card>
        <View style={{ gap: space.sm }}>
          {featureOn('mobile.assistant') ? (
            <Button
              label={t('Ask Criti')}
              iconNode={<CritiHead size={18} />}
              variant="subtle"
              onPress={() => router.push('/assistant')}
            />
          ) : null}
        </View>
      </Card>

      {/* Language */}
      <SectionLabel>{t('Language')}</SectionLabel>
      <Card>
        <LanguagePicker />
      </Card>

      {/* Account */}
      <SectionLabel>{t('Account')}</SectionLabel>
      <Card>
        <Muted>
          {police
            ? t('Signing out frees your vehicle and clears duty status. At the end of a shift, use End shift first so your firearm is handed back.')
            : words.unit
              ? t('Signing out frees your {unit} and clears duty status. At the end of a shift, use End shift first.', { unit: words.unit })
              : t('Signing out clears your duty status. At the end of a shift, use End shift first.')}
        </Muted>
        <View style={{ marginTop: space.md }}>
          <Button label={t('Sign out')} icon="log-out-outline" variant="danger" onPress={() => void confirmSignOut()} />
        </View>
      </Card>

      <OrgMark align="center" size={26} style={{ marginTop: space.xl }} />
      <Text style={styles.version}>{t('HikTech Responder · {official_name}', { official_name: dept.official_name })}</Text>
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: {
    width: 52, height: 52, borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontSize: 18, fontWeight: '800' },
  avatarStatus: {
    position: 'absolute', right: -1, bottom: -1,
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: colors.bgCard,
  },

  dutyHeading: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dutyDot: { width: 8, height: 8, borderRadius: 4 },
  gpsNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: space.md, paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  gpsText: { ...type.small, color: colors.low, fontWeight: '600' },
  endShift: {
    marginTop: space.md, paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },

  version: {
    ...type.small, fontSize: 11, color: colors.muted,
    textAlign: 'center', marginTop: space.lg,
  },
}));
