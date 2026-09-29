import { getRoleKpis } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getSession } from '@/lib/session';
import { PerfNav, cycleWindow } from '../perf-nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Role KPIs · HikTech' };

const CONTROL_ROOM_ROLES = ['Dispatcher', 'Operator', 'ControlRoom', 'IncidentLogger', 'CaseManager', 'Supervisor'];

export default async function RoleKpisPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; from?: string; to?: string }>;
}) {
  const { supabase } = await getSession();
  const params = await searchParams;
  const role = params.role && CONTROL_ROOM_ROLES.includes(params.role) ? params.role : 'Dispatcher';
  const { from, to } = cycleWindow(params.from, params.to);

  const members = await getRoleKpis(supabase, { role, from, to });
  const totalCalls = members.reduce((s, m) => s + m.callsTaken, 0);
  const totalDispatched = members.reduce((s, m) => s + m.dispatched, 0);

  return (
    <div className="space-y-6">
      <PerfNav active="/performance/role-kpis" />
      <header>
        <h1 className="text-2xl font-bold">User-role KPIs</h1>
        <p className="text-muted-foreground">
          Throughput for a control-room role's members — distinct from field-officer scoring.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue={role} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
            {CONTROL_ROOM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">Apply</button>
      </form>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Members</p>
          <p className="mt-2 text-3xl font-bold">{members.length}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Total calls taken</p>
          <p className="mt-2 text-3xl font-bold">{totalCalls}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Total dispatched</p>
          <p className="mt-2 text-3xl font-bold">{totalDispatched}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Role</p>
          <p className="mt-2 text-2xl font-bold text-accent">{role}</p>
        </CardContent></Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{role} members</CardTitle>
          <CardDescription>Ranked by calls taken.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable headers={['Member', 'Calls taken', 'Dispatched', 'Closed', 'Avg response (m)', 'Logons']} empty="No members with this role.">
            {members.map((m) => (
              <Tr key={m.email || m.name}>
                <Td className="font-semibold">{m.name}<div className="text-xs font-normal text-muted-foreground">{m.email}</div></Td>
                <Td className="font-mono">{m.callsTaken}</Td>
                <Td className="font-mono">{m.dispatched}</Td>
                <Td className="font-mono">{m.closed}</Td>
                <Td className="font-mono">{m.avgResponseMinutes}</Td>
                <Td className="font-mono">{m.logons}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
