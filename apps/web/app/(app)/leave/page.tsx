import { listLeaveEntries, listActiveConfig } from '@criticom/api';
import { ADMIN_ROLES } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, SelectField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { applyLeaveAction, setLeaveStatusAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leave · Criticom' };

const FALLBACK_TYPES = ['Annual', 'Sick', 'Family Responsibility', 'Study', 'Maternity/Paternity', 'Unpaid', 'Special'];

export default async function LeavePage() {
  const { supabase, role, userId } = await getSession();
  const isApprover = ADMIN_ROLES.includes(role) || role === 'Supervisor';
  const [entries, leaveTypes] = await Promise.all([
    listLeaveEntries(supabase, isApprover ? undefined : userId),
    listActiveConfig(supabase, 'LeaveType').catch(() => []),
  ]);
  const absenceTypes = leaveTypes.length > 0 ? leaveTypes.map((t) => t.name ?? '').filter(Boolean) : FALLBACK_TYPES;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Leave</h1>
        <p className="text-muted-foreground">
          {isApprover ? 'All requests — approve or reject pending ones.' : 'Your leave requests.'}
        </p>
      </header>

      <form action={applyLeaveAction} className="space-y-4">
        <FormSection title="Apply for leave">
          <SelectField name="absence" label="Type" options={absenceTypes} required />
          <TextField name="eff_from" label="From" type="date" required />
          <TextField name="eff_to" label="To" type="date" required />
          <TextField name="rank" label="Rank" />
          <TextField name="service_no" label="Service number" />
        </FormSection>
        <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">Submit request</button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{entries.length} requests</CardTitle>
          <CardDescription>Backed by the real leave_entries table — V4's mock data is gone.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Type', 'From', 'To', 'Rank', 'Service #', 'Status', isApprover ? 'Action' : '']}
            empty="No leave requests."
          >
            {entries.map((l) => (
              <Tr key={l.id}>
                <Td>{l.absence ?? '—'}</Td>
                <Td className="font-mono">{l.eff_from}</Td>
                <Td className="font-mono">{l.eff_to}</Td>
                <Td>{l.rank ?? '—'}</Td>
                <Td className="font-mono">{l.service_no ?? '—'}</Td>
                <Td>
                  <span className={
                    l.status === 'Approved' ? 'text-severity-low'
                    : l.status === 'Rejected' ? 'text-severity-critical'
                    : 'text-severity-medium'
                  }>
                    {l.status}
                  </span>
                </Td>
                <Td>
                  {isApprover && l.status === 'Pending' && (
                    <div className="flex gap-1">
                      <form action={setLeaveStatusAction}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="status" value="Approved" />
                        <button type="submit" className="rounded bg-severity-low/20 px-2 py-1 text-xs text-severity-low hover:bg-severity-low/30">Approve</button>
                      </form>
                      <form action={setLeaveStatusAction}>
                        <input type="hidden" name="id" value={l.id} />
                        <input type="hidden" name="status" value="Rejected" />
                        <button type="submit" className="rounded bg-severity-critical/20 px-2 py-1 text-xs text-severity-critical hover:bg-severity-critical/30">Reject</button>
                      </form>
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
