import Link from 'next/link';
import { Download, FileUp } from 'lucide-react';
import { discState, listAssetImports, listFleet, type AssetImport } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fleetRolesFor } from '@/lib/assets/roles';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { FleetTable, type FleetFilter, type FleetRow } from './fleet-table';
import { blankVehicle } from './blank';
import { VehicleForm } from './vehicle-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Fleet · HikTech' };

const FILTERS: FleetFilter[] = ['current', 'Available', 'with-officer', 'off-road', 'failed', 'disc', 'Decommissioned', 'all'];

/**
 * The fleet register (migration 0051): every vehicle, who is driving it, its
 * last inspection and licence disc. A vehicle that fails its start-of-shift
 * inspection comes off the road by itself and shows here until fleet control
 * returns it to service.
 */
export default async function AdminVehiclesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { supabase, role, silo } = await getSession();
  const { status } = await searchParams;
  const { global, canManage, departments } = fleetRolesFor(role, silo);

  let vehicles: FleetRow[] = [];
  let loadError: string | null = null;
  let setupError: string | null = null;
  let latest: AssetImport | null = null;
  try {
    const now = new Date();
    vehicles = (await listFleet(supabase, { silo: global ? undefined : silo })).map((v) => ({ ...v, disc: discState(v.disc_expiry, now) }));
  } catch (e) {
    loadError = invitationErrorMessage(e, 'The fleet could not be loaded.');
  }
  try {
    latest = (await listAssetImports(supabase, 'vehicles', 1))[0] ?? null;
  } catch (e) {
    setupError = invitationErrorMessage(e, '');
  }

  const live = vehicles.filter((v) => v.status !== 'Decommissioned');
  const offRoad = live.filter((v) => v.status === 'Out of Service' || v.status === 'Maintenance').length;
  const failed = live.filter((v) => v.last_inspection_result === 'fail').length;
  const disc = live.filter((v) => v.disc === 'expired' || v.disc === 'soon').length;
  const initialFilter = FILTERS.includes(status as FleetFilter) ? (status as FleetFilter) : 'current';
  const homeSilo: Silo = global ? 'MetroPolice' : silo;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Fleet</h1>
          <p className="max-w-2xl text-muted-foreground">
            Every vehicle, who is driving it, its last inspection and licence disc. Officers choose a vehicle in the app
            at the start of a shift; one that fails its inspection comes off the road until it is returned to service here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {canManage ? (
            <>
              <Link href="/admin/vehicles/import" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground hover:bg-primary/90">
                <FileUp className="h-4 w-4" /> Import fleet list
              </Link>
              <a href="/admin/vehicles/template" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 hover:bg-muted">
                <Download className="h-4 w-4" /> Template
              </a>
            </>
          ) : null}
          <Link href="/shift/today" className="rounded-md border border-border px-4 py-2 hover:bg-muted">Today’s shift</Link>
        </div>
      </header>

      {setupError ? (
        <p role="alert" className="rounded-lg border border-severity-medium/50 bg-severity-medium/10 px-4 py-3 text-sm">{setupError}</p>
      ) : null}

      {loadError ? (
        <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{loadError}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {([
              ['Available', live.filter((v) => v.status === 'Available').length, 'Available', ''],
              ['With an officer', live.filter((v) => v.status === 'In Use' || v.status === 'En Route' || v.status === 'On Scene' || v.driver).length, 'with-officer', ''],
              ['Off the road', offRoad, 'off-road', offRoad ? 'text-severity-high-ink' : ''],
              ['Failed last inspection', failed, 'failed', failed ? 'text-severity-high-ink' : ''],
              ['Disc expired or due', disc, 'disc', disc ? 'text-severity-medium-ink' : ''],
            ] as const).map(([label, n, filter, tone]) => (
              <Link key={filter} href={`/admin/vehicles?status=${filter}`} className="rounded-lg border border-border bg-bg-card px-3 py-2 hover:border-primary/50">
                <dd className={`text-2xl font-bold tabular-nums ${tone}`}>{n}</dd>
                <dt className="text-xs text-muted-foreground">{label}</dt>
              </Link>
            ))}
          </dl>

          {latest ? (
            <p className="text-sm text-muted-foreground">
              Last fleet import: <b className="text-fg">{latest.file_name}</b>, {formatSaTime(latest.imported_at)} by {latest.imported_by_name ?? 'an administrator'}.{' '}
              {latest.added} added, {latest.updated} updated.
            </p>
          ) : null}

          <FleetTable vehicles={vehicles} canManage={canManage} departments={departments} initialFilter={initialFilter} />
        </>
      )}

      {canManage && !loadError ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a vehicle</CardTitle>
            <CardDescription>One at a time. For the whole fleet, use the import with the template.</CardDescription>
          </CardHeader>
          <CardContent>
            <VehicleForm initial={blankVehicle(homeSilo)} departments={departments} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
