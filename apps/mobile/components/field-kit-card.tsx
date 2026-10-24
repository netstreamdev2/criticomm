import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { bookKit, hatPairing, kitNumber, listFreeHardHats, listMyKit, noKitRegister, openHatPairing, returnKit, type MyKit } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { bookThisDevice } from '@/lib/kit';
import { isHardHatDevice } from '@/lib/radio-keys';
import { Banner, Button, Card, Muted, Title } from '@/components/ui';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { useT } from '@/lib/i18n';

/**
 * My radio and hard hat (0101). The radio or smart hard hat this app runs on
 * books itself; a plain hard hat is taken by the number written on it, or
 * "No hard hat today". Or paired (0105): "Pair hard hat", then press any
 * button on the hard hat within 20 seconds. Handing back happens at the end of the shift; here it
 * can be done early (damaged or lost needs a word on what happened).
 */
export function FieldKitCard({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const styles = useStyles();
  const { session } = useAuth();
  const [mine, setMine] = useState<MyKit[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [noHat, setNoHat] = useState(false);
  const [number, setNumber] = useState('');
  const [free, setFree] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [giving, setGiving] = useState<{ bookingId: string; condition: 'damaged' | 'lost'; text: string } | null>(null);
  // Pairing a hard hat by its button (0105): seconds left, while waiting.
  const [pairLeft, setPairLeft] = useState<number | null>(null);
  const pairing = useRef<{ id: string; timer: ReturnType<typeof setInterval> } | null>(null);
  useEffect(() => () => { if (pairing.current) clearInterval(pairing.current.timer); }, []);

  const load = useCallback(async () => {
    if (!session) return;
    // This device first: a registered radio or hard hat books itself.
    const here = await bookThisDevice(session.user.id).catch(() => null);
    if (here?.taken_from) setNote(t('{no} was still booked to {name}. It is yours now.', { no: here.asset_no ?? '', name: here.taken_from }));
    try {
      setMine(await listMyKit(getSupabase(), session.user.id));
    } catch (e) {
      if (noKitRegister(e)) setMissing(true);
      else setMine((m) => m ?? []);
    }
  }, [session, t]);

  useEffect(() => { void load(); }, [load]);

  const hat = mine?.find((k) => k.kind === 'hard_hat') ?? null;
  const radio = mine?.find((k) => k.kind === 'radio') ?? null;
  const suggestions = useMemo(() => {
    const q = kitNumber(number);
    return (q ? free.filter((n) => n.includes(q)) : free).slice(0, 6);
  }, [free, number]);

  const openPicker = async () => {
    setPicking(true);
    setError(null);
    try {
      setFree((await listFreeHardHats(getSupabase())).map((k) => k.asset_no));
    } catch { /* typing the number still works */ }
  };

  const take = async (assetNo: string) => {
    if (!kitNumber(assetNo)) { setError(t('Enter the number written on the hard hat.')); return; }
    setBusy(true);
    setError(null);
    try {
      const b = await bookKit(getSupabase(), { kind: 'hard_hat', assetNo });
      if (b.taken_from) setNote(t('{no} was still booked to {name}. It is yours now.', { no: b.asset_no ?? '', name: b.taken_from }));
      setPicking(false);
      setNumber('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stopPairing = () => {
    if (pairing.current) clearInterval(pairing.current.timer);
    pairing.current = null;
    setPairLeft(null);
  };

  /** "Press any button on your hard hat": a 20-second window, asked every second and a half. */
  const pair = async () => {
    setError(null);
    setNote(null);
    stopPairing();
    try {
      const w = await openHatPairing(getSupabase());
      const until = Date.parse(w.expires_at);
      setPairLeft(20);
      const timer = setInterval(() => {
        const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        setPairLeft(left);
        void hatPairing(getSupabase(), w.id).then(async (r) => {
          if (pairing.current?.id !== w.id) return;
          if (r.state === 'paired') {
            stopPairing();
            setNote(t('Hard hat {no} is yours for this shift.', { no: r.asset_no ?? '' }));
            await load();
          } else if (r.state === 'clash') {
            stopPairing();
            setError(t('Two officers paired at the same moment. Press Pair hard hat again, then the button on your hard hat.'));
          } else if (r.state === 'expired' || left === 0) {
            stopPairing();
            setError(t('No hard hat answered. Press Pair hard hat again, or type the number on it.'));
          }
        }).catch(() => { /* no signal for a moment: asked again */ });
      }, 1500);
      pairing.current = { id: w.id, timer };
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handBack = async (bookingId: string, condition: 'fine' | 'damaged' | 'lost', text?: string) => {
    setBusy(true);
    setError(null);
    try {
      await returnKit(getSupabase(), bookingId, condition, text ?? null);
      setGiving(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (missing || mine === null) return null;

  const row = (k: MyKit) => (
    <View key={k.bookingId} style={styles.row}>
      <View style={[styles.icon, { backgroundColor: k.kind === 'hard_hat' ? '#f59e0b22' : `${colors.accent}22` }]}>
        <Ionicons name={k.kind === 'hard_hat' ? 'construct-outline' : 'radio-outline'} size={20} color={k.kind === 'hard_hat' ? '#f59e0b' : colors.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.number}>{k.assetNo}</Text>
        <Text style={styles.sub}>
          {k.kind === 'hard_hat' ? t('Your hard hat') : t('Your radio')}
          {k.how === 'device' ? ` · ${t('this device')}` : ''}
        </Text>
      </View>
      {!compact ? (
        <Pressable accessibilityRole="button" onPress={() => setGiving({ bookingId: k.bookingId, condition: 'damaged', text: '' })} hitSlop={8}>
          <Text style={styles.link}>{t('Problem?')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Card accent={colors.accent}>
      <Title>{t('Your radio and hard hat')}</Title>
      {radio ? row(radio) : null}
      {hat ? row(hat) : null}
      {!radio && !hat && noHat ? <Muted>{t('No hard hat today.')}</Muted> : null}
      {note ? <Banner tone="info" onDismiss={() => setNote(null)}>{note}</Banner> : null}

      {giving ? (
        <View style={styles.box}>
          <Text style={styles.label}>{t('What is wrong?')}</Text>
          <View style={styles.choices}>
            {(['damaged', 'lost'] as const).map((c) => (
              <Pressable key={c} onPress={() => setGiving({ ...giving, condition: c })}
                style={[styles.choice, giving.condition === c && styles.choiceOn]}>
                <Text style={styles.choiceText}>{c === 'damaged' ? t('Damaged') : t('Lost')}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput value={giving.text} onChangeText={(text) => setGiving({ ...giving, text })} placeholder={t('What happened')}
            placeholderTextColor={colors.muted} style={styles.input} maxLength={300} />
          <View style={styles.choices}>
            <Button label={t('Cancel')} variant="outline" onPress={() => setGiving(null)} style={{ flex: 1 }} />
            <Button label={t('Hand it in')} busy={busy} disabled={!giving.text.trim()} onPress={() => void handBack(giving.bookingId, giving.condition, giving.text.trim())} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}

      {!hat && !noHat && pairLeft !== null ? (
        <View style={styles.box}>
          <Text style={styles.pairTitle}>{t('Press any button on your hard hat now')}</Text>
          <Muted>{t('{n} seconds left', { n: pairLeft })}</Muted>
          <Button label={t('Cancel')} variant="outline" onPress={stopPairing} />
        </View>
      ) : !hat && !noHat ? (
        picking ? (
          <View style={styles.box}>
            <Text style={styles.label}>{t('Number on the hard hat')}</Text>
            <TextInput value={number} onChangeText={setNumber} placeholder="HH-0042" autoCapitalize="characters" autoCorrect={false}
              placeholderTextColor={colors.muted} style={[styles.input, styles.mono]} maxLength={24} onSubmitEditing={() => void take(number)} />
            {suggestions.length ? (
              <View style={styles.chips}>
                {suggestions.map((n) => (
                  <Pressable key={n} onPress={() => void take(n)} style={styles.chip}><Text style={styles.chipText}>{n}</Text></Pressable>
                ))}
              </View>
            ) : null}
            <View style={styles.choices}>
              <Button label={t('Cancel')} variant="outline" onPress={() => setPicking(false)} style={{ flex: 1 }} />
              <Button label={t('Take it')} icon="checkmark" busy={busy} onPress={() => void take(number)} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            {/* On the hard hat itself there is nothing to pair: it books itself. */}
            {!isHardHatDevice() ? (
              <Button label={t('Pair hard hat')} icon="link-outline" size="lg" onPress={() => void pair()} />
            ) : null}
            <View style={styles.choices}>
              <Button label={t('Type its number')} icon="keypad-outline" variant="outline" onPress={() => void openPicker()} style={{ flex: 1 }} />
              <Button label={t('No hard hat')} variant="outline" onPress={() => setNoHat(true)} style={{ flex: 1 }} />
            </View>
          </View>
        )
      ) : null}
      {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}
      {!compact && (radio || hat) ? <Muted style={{ marginTop: space.sm }}>{t('They are handed back when you end your shift.')}</Muted> : null}
    </Card>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  icon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  number: { color: colors.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  sub: { color: colors.textDim, fontSize: 13 },
  link: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  box: { gap: space.sm, marginTop: space.sm },
  label: { color: colors.textDim, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  input: {
    minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.panelBorder, backgroundColor: colors.bgSoft,
    color: colors.text, paddingHorizontal: space.md, fontSize: 16,
  },
  mono: { fontWeight: '800', letterSpacing: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.panelBorder, paddingHorizontal: space.md, paddingVertical: 8 },
  chipText: { color: colors.text, fontWeight: '800' },
  choices: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  choice: { flex: 1, alignItems: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.panelBorder, paddingVertical: 10 },
  choiceOn: { borderColor: colors.accent, backgroundColor: `${colors.accent}22` },
  choiceText: { color: colors.text, fontWeight: '800' },
  pairTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
}));
