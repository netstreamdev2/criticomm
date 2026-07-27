import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  assignVehicle, hasCompletedShiftStartToday, listAvailableVehicles,
  submitMentalCheck, submitVehicleChecklist, toggleDuty,
} from '@criticom/api';
import type { Database } from '@criticom/db/types';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { colors } from '@/lib/theme';
import { Button, Card, CheckRow, Input, Muted, Title } from '@/components/ui';

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

export default function ShiftScreen() {
  const { silo } = useAuth();
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

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      {error && <Text style={styles.error}>{error}</Text>}

      {step === null && <Muted>Checking today's shift status…</Muted>}

      {step === 'done' && (
        <Card>
          <Title>✅ Start-of-shift complete</Title>
          <Muted>
            Your readiness check and vehicle inspection are logged for today.
            You're on duty — incidents will appear under My Incidents.
          </Muted>
        </Card>
      )}

      {step === 'failed' && (
        <Card>
          <Title>Readiness check not passed</Title>
          <Muted>
            You have not been placed on duty and your supervisor has been notified via the audit log.
            Speak to them, then retake the check when your situation changes.
          </Muted>
          <View style={{ marginTop: 12 }}>
            <Button label="Retake check" onPress={() => setStep('mental')} />
          </View>
        </Card>
      )}

      {step === 'mental' && (
        <Card>
          <Title>Step 1 of 3 — mental readiness</Title>
          <Muted>All six checks must pass before you can select a vehicle.</Muted>
          <View style={{ marginTop: 12 }}>
            {MENTAL_ITEMS.map(([key, label]) => (
              <CheckRow
                key={key}
                label={label}
                checked={Boolean(mental[key])}
                onToggle={() => setMental((m) => ({ ...m, [key]: !m[key] }))}
              />
            ))}
            <Input
              placeholder="Comments (optional)"
              value={comments}
              onChangeText={setComments}
              style={{ marginBottom: 12 }}
            />
            <Button label="Submit readiness check" busy={busy} onPress={() => void submitMental()} />
          </View>
        </Card>
      )}

      {step === 'vehicle' && (
        <Card>
          <Title>Step 2 of 3 — select your vehicle</Title>
          <Muted>{vehicles.length} available in your silo. Selecting marks it In Use.</Muted>
          <View style={{ marginTop: 12, gap: 8 }}>
            {vehicles.length === 0 && <Muted>No vehicles available — contact fleet control.</Muted>}
            {vehicles.map((v) => (
              <View key={v.id} style={styles.vehicleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.vehicleName}>{v.unit_number} — {v.name}</Text>
                  <Muted>{v.type}{v.license_plate ? ` · ${v.license_plate}` : ''}</Muted>
                </View>
                <Button label="Select" busy={busy} onPress={() => void pickVehicle(v.id)} />
              </View>
            ))}
          </View>
        </Card>
      )}

      {step === 'checklist' && (
        <Card>
          <Title>Step 3 of 3 — vehicle inspection</Title>
          <Muted>Completing this places you on duty.</Muted>
          <View style={{ marginTop: 12 }}>
            <Text style={styles.label}>Fuel level</Text>
            <View style={styles.fuelRow}>
              {FUEL_LEVELS.map((f) => (
                <Button
                  key={f}
                  label={f}
                  variant={fuel === f ? 'primary' : 'outline'}
                  onPress={() => setFuel(f)}
                />
              ))}
            </View>
            {CHECKLIST_ITEMS.map(([key, label]) => (
              <CheckRow
                key={key}
                label={label}
                checked={Boolean(checks[key])}
                onToggle={() => setChecks((c) => ({ ...c, [key]: !c[key] }))}
              />
            ))}
            <Button label="Complete inspection & go on duty" busy={busy} onPress={() => void submitChecklist()} />
          </View>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 32 },
  error: {
    color: colors.critical, backgroundColor: `${colors.critical}22`,
    borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13,
  },
  vehicleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: colors.border, borderRadius: 10,
    padding: 12, backgroundColor: colors.bgSoft,
  },
  vehicleName: { color: colors.text, fontWeight: '700' },
  label: { color: colors.muted, fontSize: 12, textTransform: 'uppercase', marginBottom: 8 },
  fuelRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
});
