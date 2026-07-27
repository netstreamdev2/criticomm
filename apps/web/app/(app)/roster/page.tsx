import Link from 'next/link';
import {
  listShifts, listRosterEntries, generatePlatoonRotation, listEndorsements, listActiveConfig,
} from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, SelectField, TextAreaField } from '@/components/fields';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import {
  createShiftAction, createRosterEntryAction, addEndorsementAction, deactivateEndorsementAction,
} from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Roster · Criticom' };

const ENDORSEMENT_TYPES = ['Court Attendance', 'Special Event', 'Special Instruction', 'Restriction'];

export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ pattern?: string }>;
}) {
  const { supabase, silo } = await getSession();
  const { pattern } = await searchParams;
  const [shifts, roster, endorsements, shiftTypes] = await Promise.all([
    listShifts(supabase, siloFilter(silo)),
    listRosterEntries(supabase),
    listEndorsements(supabase, { silo: siloFilter(silo) }).catch(() => []),
    listActiveConfig(supabase, 'ShiftType').catch(() => []),
  ]);

  const rotationPattern = pattern === '24-48' ? '24-48' : '224';
  const rotation = generatePlatoonRotation(rotationPattern, new Date(), 7);
  const byDate = new Map<string, Array<{ platoon: string; shift: string }>>();
  for (const r of rotation) {
    const list = byDate.get(r.date) ?? [];
    list.push({ platoon: r.platoon, shift: r.shift });
    byDate.set(r.date, list);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Roster & shifts</h1>
          <p className="text-muted-foreground">Platoon rotation, shift creation, duty allocation and endorsements.</p>
        </div>
        <Link
          href="/roster/duty-sheet"
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted"
        >
          🖨 Duty sheet
        </Link>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-end justify-between">
            <div>
              <CardTitle>Platoon rotation — next 7 days</CardTitle>
              <CardDescription>
                {rotationPattern === '224' ? '2 days on, 2 nights on, 4 off (platoons A–D)' : '24h on / 48h off (platoons A–C)'}
              </CardDescription>
            </div>
            <form method="get" className="flex gap-2">
              <select name="pattern" defaultValue={rotationPattern} className="h-9 rounded-md border border-border bg-bg-soft px-2 text-sm">
                <option value="224">224 pattern</option>
                <option value="24-48">24-48 pattern</option>
              </select>
              <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm font-semibold">Generate</button>
            </form>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Date', 'On duty']} empty="—">
            {[...byDate.entries()].map(([date, entries]) => (
              <Tr key={date}>
                <Td className="font-mono">{date}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {entries.map((e, i) => (
                      <span key={i} className="rounded bg-muted px-2 py-0.5 text-xs">
                        Platoon {e.platoon} — {e.shift}
                      </span>
                    ))}
                  </div>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <form action={createShiftAction} className="space-y-4">
          <FormSection title="Create shift">
            <TextField name="shift_name" label="Shift name" required />
            <SelectField name="activity_type" label="Activity" options={['Patrol', 'Station duty', 'Training', 'Special ops', 'Standby']} />
            <TextField name="department" label="Department" />
            <TextField name="start_time" label="Start" type="datetime-local" required />
            <TextField name="end_time" label="End" type="datetime-local" required />
            <TextField name="description" label="Description" />
          </FormSection>
          <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">Create shift</button>
        </form>

        <form action={createRosterEntryAction} className="space-y-4">
          <FormSection title="Assign to roster">
            <TextField name="user_name" label="Member name" required />
            <TextField name="badge_number" label="Badge number" />
            <SelectField
              name="shift_id" label="Shift"
              options={[{ value: '', label: '— none —' }, ...shifts.map((s) => ({ value: s.id, label: s.shift_name }))]}
            />
            <TextField name="station" label="Station" required />
            <SelectField name="activity_type" label="Activity" required options={['Patrol', 'Station duty', 'Training', 'Special ops', 'Standby']} />
            <TextField name="call_sign" label="Call sign" />
            <TextField name="vehicle" label="Vehicle / unit" />
            <TextField name="sector" label="Sector" />
            <TextField name="special_instructions" label="Special instructions" />
            <TextField name="description" label="Notes" />
          </FormSection>
          <button type="submit" className="h-10 w-full rounded-md bg-accent text-sm font-semibold">Assign</button>
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form action={addEndorsementAction} className="space-y-4">
          <FormSection title="Add endorsement">
            <TextField name="employee_name" label="Member name" required />
            <TextField name="badge_number" label="Badge number" />
            <SelectField name="type" label="Type" required options={ENDORSEMENT_TYPES} />
            <TextField name="start_date" label="From" type="date" required />
            <TextField name="end_date" label="To (blank = open-ended)" type="date" />
            <TextAreaField name="details" label="Details" className="sm:col-span-2 lg:col-span-3" />
          </FormSection>
          <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">Add endorsement</button>
        </form>

        <Card>
          <CardHeader>
            <CardTitle>Active endorsements ({endorsements.length})</CardTitle>
            <CardDescription>Court dates, special events, restrictions — printed on the duty sheet.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Member', 'Type', 'Period', '']} empty="No active endorsements.">
              {endorsements.map((e) => (
                <Tr key={e.id}>
                  <Td>{e.employee_name ?? '—'}<div className="text-xs text-muted-foreground">{e.badge_number ?? ''}</div></Td>
                  <Td>{e.type}<div className="max-w-[180px] truncate text-xs text-muted-foreground">{e.details ?? ''}</div></Td>
                  <Td className="font-mono text-xs">{e.start_date}{e.end_date ? ` → ${e.end_date}` : ' →'}</Td>
                  <Td>
                    <form action={deactivateEndorsementAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <button type="submit" className="rounded bg-muted px-2 py-1 text-xs hover:bg-muted/70">Remove</button>
                    </form>
                  </Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Roster entries ({roster.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Member', 'Badge', 'Shift', 'Station', 'Activity', 'By']} empty="No roster entries.">
            {roster.slice(0, 50).map((r) => (
              <Tr key={r.id}>
                <Td>{r.user_name}</Td>
                <Td className="font-mono">{r.badge_number ?? '—'}</Td>
                <Td>{(r as { shift?: { shift_name?: string } }).shift?.shift_name ?? '—'}</Td>
                <Td>{r.station}</Td>
                <Td>{r.activity_type}</Td>
                <Td className="text-muted-foreground">{r.created_by_supervisor_name ?? '—'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Shifts ({shifts.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Name', 'Activity', 'Start', 'End', 'Created by']} empty="No shifts defined.">
            {shifts.slice(0, 30).map((s) => (
              <Tr key={s.id}>
                <Td className="font-semibold">{s.shift_name}</Td>
                <Td>{s.activity_type ?? '—'}</Td>
                <Td className="text-muted-foreground">{formatSaTime(s.start_time)}</Td>
                <Td className="text-muted-foreground">{formatSaTime(s.end_time)}</Td>
                <Td>{s.created_by_supervisor_name ?? '—'}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
