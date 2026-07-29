import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  assignVehicle, hasCompletedShiftStartToday, listAvailableVehicles,
  submitMentalCheck, submitVehicleChecklist, toggleDuty,
} from '@criticom/api';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors, radius, space, type } from '@/lib/theme';
import {
  Banner, Button, Card, CheckRow, Input, Muted, Segmented, Stepper, Title,
} from '@/components/ui';

type Vehicle = Database['public']['Tables']['apparatus']['Row'];
type Step = 'done' | 'mental' | 'failed' | 'vehicle' | 'checklist';

const MENTAL_ITEMS = [
  ['memory_recall', 'Memory recall — callsign, unit and standing orders'],
  ['judgment', 'Judgment — sound decisions under pressure'],
  ['situational_awareness', 'Situational awareness'],
  ['not_under_influence', 'NOT under the influence of any substance'],
  ['anger_check', 'Emotionally regulated, fit for public contact'],
  ['reflexes', 'Reflexes — normal reaction time'],
] as const;

const CHECKLIST_ITEMS = [
  ['lights_functional', 'Emergency lights + siren functional'],
  ['tires_condition_ok', 'Tyres — tread and pressure OK'],
  ['equipment_stocked', 'Equipment stocked and secured'],
  ['comms_working', 'Radio / MDT comms working'],
  ['brakes_responsive', 'Brakes responsive'],
] as const;

const FUEL_LEVELS = ['1/4', '1/2', '3/4', 'Full'] as const;
const WIZARD_STEPS = ['Readiness', 'Vehicle', 'Inspection'];

const STEP_INDEX: Record<Step, number> = {
  mental: 0, failed: 0, vehicle: 1, checklist: 2, done: 3,
};

export default function ShiftScreen() {
  const { silo } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mental, setMental] = useState<Record<string, boolean>>({});
  const [comments, setComments] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [fuel, setFuel] = useState<(typeof FUEL_LEVELS)[number]>('Full');

  const init = useCallback(async () => {
    try {
      const done = await hasCompletedShiftStartToday(getSupabase()).catch(() => false);
      setStep(done ? 'done' : 'mental');
    } catch {
      setStep('mental');
    }
  }, []);

  useEffect(() => { void init(); }, [init]);

  const mentalDone = MENTAL_ITEMS.filter(([k]) => mental[k]).length;
  const checksDone = CHECKLIST_ITEMS.filter(([k]) => checks[k]).length;

  const submitMental = async () => {
    setBusy(true);
    setError(null);
    try {
      const sb = getSupabase();
      const { passed } = await submitMentalCheck(sb, {
        silo,
        memory_recall: Boolean(mental.memory_recall),
        judgment: Boolean(mental.judgment),
        situational_awareness: Boolean(mental.situational_awareness),
        not_under_influence: Boolean(mental.not_under_influence),
        anger_check: Boolean(mental.anger_check),
        reflexes: Boolean(mental.reflexes),
        comments,
      });
      if (!passed) {
        setStep('failed');
        return;
      }
      const list = await listAvailableVehicles(sb, silo === 'Ethekwini' ? 'MetroPolice' : silo);
      setVehicles(list);
      setStep('vehicle');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pickVehicle = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await assignVehicle(getSupabase(), id);
      setVehicleId(id);
      setStep('checklist');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitChecklist = async () => {
    if (!vehicleId) return;
    setBusy(true);
    setError(null);
    try {
      const sb = getSupabase();
      await submitVehicleChecklist(sb, {
        silo,
        apparatus_id: vehicleId,
        fuel_level: fuel,
        lights_functional: Boolean(checks.lights_functional),
        tires_condition_ok: Boolean(checks.tires_condition_ok),
        equipment_stocked: Boolean(checks.equipment_stocked),
        comms_working: Boolean(checks.comms_working),
        brakes_responsive: Boolean(checks.brakes_responsive),
      });
      await toggleDuty(sb, { onDuty: true });
      setStep('done');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
        <Muted>Checking today&apos;s shift status…</Muted>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {error ? <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner> : null}

      {step !== 'done' && step !== 'failed' ? (
        <Stepper steps={WIZARD_STEPS} current={STEP_INDEX[step]} />
      ) : null}

      {step === 'done' ? (
        <>
          <Card accent={colors.low}>
            <View style={styles.doneIcon}>
              <Ionicons name="shield-checkmark" size={26} color={colors.low} />
            </View>
            <Title>Start-of-shift complete</Title>
            <Muted>
              Your readiness check and vehicle inspection are logged for today.
              You&apos;re on duty — incidents will appear under My Incidents.
            </Muted>
            <View style={{ marginTop: space.lg }}>
              <Button
                label="View my incidents"
                icon="radio-outline"
                onPress={() => router.push('/')}
              />
            </View>
          </Card>
          <Muted style={styles.footnote}>
            Going off duty and back on is handled from the Profile tab.
          </Muted>
        </>
      ) : null}

      {step === 'failed' ? (
        <Card accent={colors.critical}>
          <View style={[styles.doneIcon, { backgroundColor: colors.criticalSoft }]}>
            <Ionicons name="alert-circle" size={26} color={colors.critical} />
          </View>
          <Title>Readiness check not passed</Title>
          <Muted>
            You have not been placed on duty and your supervisor has been notified via the audit log.
            Speak to them, then retake the check when your situation changes.
          </Muted>
          <View style={{ marginTop: space.lg }}>
            <Button label="Retake check" icon="refresh" variant="outline" onPress={() => setStep('mental')} />
          </View>
        </Card>
      ) : null}

      {step === 'mental' ? (
        <Card>
          <Title>Mental readiness</Title>
          <Muted>All six checks must pass before you can select a vehicle.</Muted>

          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${(mentalDone / MENTAL_ITEMS.length) * 100}%` }]} />
            </View>
            <Text style={styles.progressText}>{mentalDone}/{MENTAL_ITEMS.length}</Text>
          </View>

          <View style={{ marginTop: space.md }}>
            {MENTAL_ITEMS.map(([key, label]) => (
              <CheckRow
                key={key}
                label={label}
                checked={Boolean(mental[key])}
                onToggle={() => setMental((m) => ({ ...m, [key]: !m[key] }))}
              />
            ))}
            <View style={{ marginTop: space.sm, marginBottom: space.md }}>
              <Input
                label="Comments"
                placeholder="Anything your supervisor should know (optional)"
                value={comments}
                onChangeText={setComments}
                multiline
              />
            </View>
            <Button
              label="Submit readiness check"
              icon="checkmark-done"
              size="lg"
              busy={busy}
              onPress={() => void submitMental()}
            />
          </View>
        </Card>
      ) : null}

      {step === 'vehicle' ? (
        <Card>
          <Title>Select your vehicle</Title>
          <Muted>
            {vehicles.length} available in your silo. Selecting one marks it In&nbsp;Use.
          </Muted>
          <View style={{ marginTop: space.md, gap: space.sm }}>
            {vehicles.length === 0 ? (
              <View style={styles.noVehicles}>
                <Ionicons name="car-outline" size={22} color={colors.muted} />
                <Muted>No vehicles available — contact fleet control.</Muted>
              </View>
            ) : null}
            {vehicles.map((v) => (
              <Pressable
                key={v.id}
                disabled={busy}
                onPress={() => void pickVehicle(v.id)}
                accessibilityRole="button"
                accessibilityLabel={`Select ${v.unit_number} ${v.name}`}
                style={({ pressed }) => [styles.vehicleRow, pressed && { borderColor: colors.accent, opacity: 0.9 }]}
              >
                <View style={styles.vehicleIcon}>
                  <Ionicons name="car-sport" size={18} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.vehicleName}>{v.unit_number} — {v.name}</Text>
                  <Muted>{v.type}{v.license_plate ? ` · ${v.license_plate}` : ''}</Muted>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {step === 'checklist' ? (
        <Card>
          <Title>Vehicle inspection</Title>
          <Muted>Completing this places you on duty.</Muted>

          <View style={{ marginTop: space.lg }}>
            <Text style={styles.label}>FUEL LEVEL</Text>
            <Segmented options={FUEL_LEVELS} value={fuel} onChange={setFuel} />
          </View>

          <View style={styles.progressRow}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${(checksDone / CHECKLIST_ITEMS.length) * 100}%` }]} />
            </View>
            <Text style={styles.progressText}>{checksDone}/{CHECKLIST_ITEMS.length}</Text>
          </View>

          <View style={{ marginTop: space.md }}>
            {CHECKLIST_ITEMS.map(([key, label]) => (
              <CheckRow
                key={key}
                label={label}
                checked={Boolean(checks[key])}
                onToggle={() => setChecks((c) => ({ ...c, [key]: !c[key] }))}
              />
            ))}
            <View style={{ marginTop: space.sm }}>
              <Button
                label="Complete inspection & go on duty"
                icon="shield-checkmark"
                variant="success"
                size="lg"
                busy={busy}
                onPress={() => void submitChecklist()}
              />
            </View>
          </View>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, paddingBottom: space['3xl'] },
  center: {
    flex: 1, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', gap: space.md,
  },
  footnote: { textAlign: 'center', paddingHorizontal: space.lg },

  doneIcon: {
    width: 48, height: 48, borderRadius: radius.pill,
    backgroundColor: colors.lowSoft,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: space.md,
  },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  progressTrack: {
    flex: 1, height: 6, borderRadius: 3,
    backgroundColor: colors.bgElevated, overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: colors.low },
  progressText: { ...type.small, color: colors.muted, fontVariant: ['tabular-nums'], fontWeight: '700' },

  vehicleRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: space.md, backgroundColor: colors.bgSoft,
  },
  vehicleIcon: {
    width: 36, height: 36, borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  vehicleName: { color: colors.text, fontWeight: '700', fontSize: 15 },
  noVehicles: {
    alignItems: 'center', gap: space.sm, paddingVertical: space.xl,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md,
  },

  label: { ...type.label, color: colors.muted, marginBottom: space.sm },
});
