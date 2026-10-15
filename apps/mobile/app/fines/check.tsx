import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { canIssueFines, canViewAllFines } from '@criticom/db/roles';
import { isValidRsaId, normaliseReg } from '@criticom/db/fines';
import { useAuth } from '@/lib/auth';
import { colors, space, makeStyles } from '@/lib/theme';
import { Button, Card, EmptyState, Input, Muted, Segmented } from '@/components/ui';
import { OwingPanel } from '@/components/owing-check';
import { tx } from '@criticom/db/i18n';
import { useT } from '@/lib/i18n';

const MODES = [tx('ID number'), tx('Registration')] as const;

/**
 * Check what is owed — before or instead of writing a fine: does this person
 * or vehicle have unpaid fines on the register? A summary from every
 * officer's fines; every check is audited.
 */
export default function CheckOwingScreen() {
  const { t } = useT();
  const styles = useStyles();
  const router = useRouter();
  const { role, silo } = useAuth();
  const [mode, setMode] = useState<(typeof MODES)[number]>('Registration');
  const [value, setValue] = useState('');
  const [checked, setChecked] = useState<{ idNumber?: string; vehicleReg?: string } | null>(null);

  if (!canIssueFines({ role, silo }) && !canViewAllFines({ role, silo })) {
    return (
      <View style={styles.center}>
        <EmptyState icon="search-outline" title={t('Not for your role')} body={t('Metro Police officers and command staff check what is owed.')} />
      </View>
    );
  }

  const id = value.replace(/\s/g, '').toUpperCase();
  const reg = normaliseReg(value);
  const ready = mode === 'ID number' ? id.length >= 6 : reg.length >= 3;
  const warn = mode === 'ID number' && id.length === 13 && /^\d+$/.test(id) && !isValidRsaId(id);

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Segmented options={MODES} value={mode} onChange={(m) => { setMode(m); setValue(''); setChecked(null); }} />
      <Card style={{ marginTop: space.md }}>
        <Input
          label={mode}
          value={value}
          onChangeText={(v) => { setValue(v.toUpperCase()); setChecked(null); }}
          placeholder={mode === 'ID number' ? t('13-digit ID or passport number') : t('e.g. ND 123-456')}
          autoCapitalize="characters"
          autoCorrect={false}
          icon={mode === 'ID number' ? 'id-card-outline' : 'car-outline'}
          hint={warn ? t('That is not a valid South African ID number — check the digits.') : undefined}
          onSubmitEditing={() => { if (ready) setChecked(mode === 'ID number' ? { idNumber: id } : { vehicleReg: reg }); }}
          returnKeyType="search"
        />
        <View style={{ marginTop: space.md }}>
          <Button
            label={t('Check')}
            icon="search"
            disabled={!ready}
            onPress={() => setChecked(mode === 'ID number' ? { idNumber: id } : { vehicleReg: reg })}
          />
        </View>
        {checked ? <OwingPanel {...checked} /> : null}
      </Card>
      <Muted>
        {t('Shows unpaid fines on the city’s register from every officer: fine numbers, offences, amounts and where each stands. Names and addresses on other officers’ fines are not shown. Every check is recorded.')}
      </Muted>
      {checked && canIssueFines({ role, silo }) ? (
        <View style={{ marginTop: space.lg }}>
          <Button label={t('Issue a fine')} icon="receipt-outline" variant="outline" onPress={() => router.push('/fines/new')} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
}));
