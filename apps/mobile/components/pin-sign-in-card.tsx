import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { mySignInPin, type MySignInPin } from '@criticom/api';
import type { UserRole } from '@criticom/db/types';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { errorWords } from '@/lib/offline-cache-policy';
import { registerThisDevice, removeThisDevice, useRegisteredDevice } from '@/lib/pin-sign-in';
import { useRadioId } from '@/lib/presence';
import { colors, space, type, makeStyles } from '@/lib/theme';
import { Banner, Button, Card, Input, Muted, SectionLabel } from '@/components/ui';
import { useT } from '@/lib/i18n';

/** Who registers devices for PIN sign-in: the database's can_manage_sign_in() (0108). */
const MANAGERS: UserRole[] = ['SystemAdmin', 'SuperAdmin', 'SystemController', 'Admin', 'System', 'Supervisor', 'Captain', 'FireChief'];

/**
 * Profile: the officer's sign-in PIN (choose or change it), and — for a
 * supervisor — registering the device they hold for PIN sign-in, or taking
 * it out again (0108).
 */
export function PinSignInCard() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { role } = useAuth();
  const radioId = useRadioId();
  const { device, refresh } = useRegisteredDevice();
  const [mine, setMine] = useState<MySignInPin | null>(null);
  const [noSignal, setNoSignal] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const manages = MANAGERS.includes(role);

  const load = useCallback(() => {
    void mySignInPin(getSupabase())
      .then((m) => { setMine(m); setNoSignal(false); })
      .catch(() => setNoSignal(true));
  }, []);
  // Fresh each time Profile opens: the PIN may have just been chosen.
  useFocusEffect(load);
  useEffect(() => { void refresh(); }, [refresh]);

  const register = async () => {
    const name = label.trim() || radioId || '';
    if (!name) { setMessage({ tone: 'error', text: t('Give the device a name, such as the number written on the radio.') }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const d = await registerThisDevice(name);
      await refresh();
      setLabel('');
      setMessage({ tone: 'success', text: t('{device} is registered. Officers can now sign in on it with their PIN.', { device: d.label }) });
    } catch (e) {
      setMessage({ tone: 'error', text: t(errorWords(e)) });
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    Alert.alert(
      t('Remove this device from PIN sign-in?'),
      t('Nobody can sign in on it with a PIN until it is registered again, and every sign-in made on it ends.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Remove'),
          style: 'destructive',
          onPress: () => void (async () => {
            setBusy(true);
            setMessage(null);
            try {
              await removeThisDevice('Removed on the device');
              await refresh();
              setMessage({ tone: 'success', text: t('This device no longer signs anyone in with a PIN.') });
            } catch (e) {
              setMessage({ tone: 'error', text: t(errorWords(e)) });
            } finally {
              setBusy(false);
            }
          })(),
        },
      ],
    );
  };

  const pinState = noSignal
    ? t('Needs signal to check.')
    : !mine
      ? '…'
      : mine.locked
        ? t('Locked after 5 wrong tries. Choose a new PIN, or ask your supervisor to unlock it.')
        : mine.hasPin
          ? t('Set. Use it on any registered radio or phone.')
          : t('Not set yet.');

  return (
    <>
      <SectionLabel>{t('Sign-in PIN')}</SectionLabel>
      <Card accent={mine?.locked ? colors.critical : mine?.hasPin ? colors.low : colors.border}>
        {message ? <View style={{ marginBottom: space.sm }}><Banner tone={message.tone} onDismiss={() => setMessage(null)}>{message.text}</Banner></View> : null}
        <View style={styles.row}>
          <Ionicons name="keypad-outline" size={18} color={colors.accent} />
          <Text style={styles.state}>{pinState}</Text>
        </View>
        <View style={{ marginTop: space.md }}>
          <Button
            label={mine?.hasPin && !mine.locked ? t('Change PIN') : t('Choose a PIN')}
            icon="keypad"
            variant="outline"
            disabled={noSignal}
            onPress={() => router.push({ pathname: '/pin-setup', params: { change: '1' } })}
          />
        </View>

        <View style={styles.divider} />
        {device ? (
          <>
            <View style={styles.row}>
              <Ionicons name="checkmark-circle" size={18} color={colors.low} />
              <Text style={styles.state}>{t('This device is registered for PIN sign-in: {device}', { device: device.label })}</Text>
            </View>
            {manages ? (
              <View style={{ marginTop: space.md }}>
                <Button label={t('Remove this device from PIN sign-in')} icon="close-circle-outline" variant="subtle" busy={busy} onPress={remove} />
              </View>
            ) : null}
          </>
        ) : manages ? (
          <>
            <Text style={styles.state}>{t('PIN sign-in on this device')}</Text>
            <Muted style={{ marginTop: 4 }}>
              {t('Register this radio or phone so officers can sign in on it with their PIN. Do this on each device the station shares.')}
            </Muted>
            <View style={{ marginTop: space.md, gap: space.sm }}>
              <Input
                label={t('Device name')}
                placeholder={radioId ? t('e.g. RD-0014, or {id}', { id: radioId }) : t('e.g. RD-0014')}
                autoCapitalize="characters"
                value={label}
                onChangeText={setLabel}
              />
              <Button label={t('Register this device')} icon="shield-checkmark-outline" busy={busy} disabled={noSignal} onPress={() => void register()} />
            </View>
          </>
        ) : (
          <Muted>{t('This device is not registered for PIN sign-in. Your supervisor registers shared radios and phones.')}</Muted>
        )}
      </Card>
    </>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  state: { ...type.bodyStrong, color: colors.text, flexShrink: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.md },
}));
