import Link from 'next/link';
import { getUnitCompliance } from '@criticom/api';
import { canAccess } from '@criticom/db/roles';
import { FIRE_EQUIPMENT } from '@criticom/db/fire-shift';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Unit Compliance · HikTech' };

export default async function UnitCompliancePage() {
  const { supabase, role, silo } = await getSession();
  const { mentalChecks, vehicleChecklists } = await getUnitCompliance(supabase, siloFilter(silo));

  const pass = (c: (typeof mentalChecks)[number]) =>
    c.memory_recall && c.judgment && c.situational_awareness &&
    c.not_under_influence && c.anger_check && c.reflexes;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Unit compliance — today</h1>
        <p className="text-muted-foreground">
          Start-of-shift readiness and vehicle inspections.
          {canAccess('/shift/today', role, silo) ? (
            <> Who has which vehicle and firearm is on <Link href="/shift/today" className="text-primary hover:underline">today’s shift</Link>.</>
          ) : null}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Mental readiness ({mentalChecks.length})</CardTitle>
            <CardDescription>Failed checks require supervisor follow-up.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Time', 'Result', 'Comments']} empty="No checks submitted today.">
              {mentalChecks.map((c) => (
                <Tr key={c.id}>
                  <Td className="text-muted-foreground">{formatSaTime(c.timestamp)}</Td>
                  <Td>
                    <span className={pass(c) ? 'text-severity-low-ink' : 'font-semibold text-severity-critical-ink'}>
                      {pass(c) ? 'PASS' : 'FAIL'}
                    </span>
                  </Td>
                  <Td className="max-w-[220px] truncate">{c.comments || '—'}</Td>
                </Tr>
              ))}
            </SimpleTable>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vehicle inspections ({vehicleChecklists.length})</CardTitle>
            <CardDescription>Pre-trip checklists completed today.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <SimpleTable headers={['Time', 'Unit', 'Fuel', 'Defects']} empty="No inspections today.">
              {vehicleChecklists.map((c) => {
                const defects = [
                  !c.lights_functional && 'lights',
                  !c.tires_condition_ok && 'tyres',
                  !c.equipment_stocked && 'equipment',
                  !c.comms_working && 'comms',
                  !c.brakes_responsive && 'brakes',
                  ...(c.silo === 'MetroFire' ? FIRE_EQUIPMENT.map(([key, label]) =>
                    c[key] !== true && `${label}${c[key] == null ? ' (not checked)' : ''}`) : []),
                ].filter(Boolean).join(', ');
                return (
                  <Tr key={c.id}>
                    <Td className="text-muted-foreground">{formatSaTime(c.checked_at)}</Td>
                    <Td>{(c as { apparatus?: { unit_number?: string } }).apparatus?.unit_number ?? '—'}</Td>
                    <Td>{c.fuel_level}</Td>
                    <Td className={defects ? 'text-severity-critical-ink' : 'text-severity-low-ink'}>
                      {defects || 'None'}
                    </Td>
                  </Tr>
                );
              })}
            </SimpleTable>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
