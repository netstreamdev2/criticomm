import Link from 'next/link';
import { listAllProfiles } from '@criticom/api';
import type { Silo, UserRole } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { setRoleAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin · HikTech' };

const ROLES: UserRole[] = [
  'SystemAdmin', 'SuperAdmin', 'Admin', 'Supervisor', 'Dispatcher', 'Operator', 'ControlRoom',
  'IncidentLogger', 'Viewer', 'Captain', 'Police', 'Officer', 'Metro', 'Security', 'Chief',
  'FireChief', 'Firefighter', 'Paramedic', 'Doctor', 'Disaster', 'CaseManager', 'Responder', 'Staff',
  'SystemController',
];
const SILOS: Silo[] = ['Ethekwini', 'MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ silo?: string }>;
}) {
  const { supabase } = await getSession();
  const params = await searchParams;
  const profiles = await listAllProfiles(supabase, params.silo as Silo | undefined);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Administration</h1>
          <p className="text-muted-foreground">Users, vehicles, devices and the audit trail.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/admin/personnel" className="rounded-md border border-border px-4 py-2 hover:bg-muted">Personnel</Link>
          <Link href="/admin/operators" className="rounded-md border border-border px-4 py-2 hover:bg-muted">Operators</Link>
          <Link href="/admin/vehicles" className="rounded-md border border-border px-4 py-2 hover:bg-muted">Vehicles</Link>
          <Link href="/admin/devices" className="rounded-md border border-border px-4 py-2 hover:bg-muted">Devices</Link>
          <Link href="/case-manager/audit" className="rounded-md border border-border px-4 py-2 hover:bg-muted">Audit log</Link>
        </div>
      </header>

      <form method="get" className="flex items-end gap-3">
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="silo">Silo</label>
          <select id="silo" name="silo" defaultValue={params.silo ?? ''} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
            <option value="">All</option>
            {SILOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Filter</button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{profiles.length} users</CardTitle>
          <CardDescription>
            Role changes take effect on the user's next token refresh. New users sign up via Supabase Auth invite.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Name', 'Silo', 'Badge', 'Call sign', 'On duty', 'Role']} empty="No users.">
            {profiles.map((p) => (
              <Tr key={p.id}>
                <Td>
                  {p.full_name ?? '—'}
                  <div className="text-xs text-muted-foreground">{p.email ?? ''}</div>
                </Td>
                <Td>{p.silo}</Td>
                <Td className="font-mono">{p.badge_number ?? '—'}</Td>
                <Td className="font-mono">{p.call_sign ?? '—'}</Td>
                <Td>{p.is_on_duty ? <span className="text-severity-low-ink">Yes</span> : 'No'}</Td>
                <Td>
                  <form action={setRoleAction} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <select name="role" defaultValue={p.role} className="h-8 rounded-md border border-border bg-bg-soft px-2 text-xs">
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button type="submit" className="h-8 rounded-md bg-accent px-3 text-xs font-semibold">Set</button>
                  </form>
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
