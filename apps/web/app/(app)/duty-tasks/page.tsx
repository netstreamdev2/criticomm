import { dutyTaskCounts, listAllProfiles, listDutyTasks, listSections } from '@criticom/api';
import { SUPERVISORY_ROLES, type Silo } from '@criticom/db';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { requireFeaturePage } from '@/lib/features';
import { getSession, siloFilter } from '@/lib/session';
import { cn } from '@/lib/utils';
import { createDutyTaskAction, updateDutyTaskAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Duty Maintenance · HikTech' };

const SILOS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

export default async function DutyTasksPage() {
  await requireFeaturePage('web.duty_maintenance');
  const { supabase, silo, role, userId } = await getSession();
  const own = siloFilter(silo);
  const board = (own ?? 'MetroPolice') as Silo;

  const [tasks, people, sections] = await Promise.all([
    listDutyTasks(supabase, own ? { silo: own } : {}),
    listAllProfiles(supabase, own),
    listSections(supabase, { silo: board }),
  ]);
  const counts = dutyTaskCounts(tasks);
  const today = new Date().toISOString().slice(0, 10);
  const maySchedule = SUPERVISORY_ROLES.includes(role) || role === 'SystemController';

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Duty Maintenance</h1>
        <p className="text-muted-foreground">
          Numbered station tasks — inspections, calibrations, restocks — with owners and due dates.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([['Overdue', counts.overdue, 'text-severity-critical-ink'],
           ['In progress', counts.inProgress, 'text-severity-medium-ink'],
           ['Pending', counts.pending, 'text-fg'],
           ['Done', counts.done, 'text-severity-low-ink']] as const).map(([label, n, tone]) => (
          <Card key={label}>
            <CardContent className="p-4 text-center">
              <p className={cn('text-3xl font-bold', tone)}>{n}</p>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {maySchedule && (
        <Card>
          <CardHeader>
            <CardTitle>Schedule a task</CardTitle>
            <CardDescription>It gets the next DM- number; the assignee is alerted at once.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createDutyTaskAction} className="grid gap-3 md:grid-cols-3">
              <input name="title" required placeholder="Task — e.g. Vehicle inspection — Unit 14"
                className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm md:col-span-2" />
              <select name="silo" defaultValue={board} className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
                {SILOS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select name="assigned_user_id" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
                <option value="">Unassigned</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.email ?? p.id}</option>)}
              </select>
              <input name="unit_ref" placeholder="Unit / apparatus (optional)"
                className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
              <select name="section_code" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
                <option value="">No section</option>
                {sections.map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
              <input name="due_date" type="date" className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
              <textarea name="details" rows={2} placeholder="Detail (optional)"
                className="rounded-md border border-border bg-bg-soft px-3 py-2 text-sm md:col-span-2" />
              <div className="flex items-end">
                <button type="submit" className="h-10 w-full rounded-md bg-primary px-4 text-sm font-semibold">
                  Create task
                </button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tasks.length} tasks</CardTitle>
          <CardDescription>Assignees may advance their own; supervisors may advance any.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['#', 'Task', 'Assigned', 'Where', 'Due', 'Progress', 'Status', 'Advance']}
            empty="No tasks on the board."
          >
            {tasks.map((t) => {
              const overdue = t.due_date && t.due_date < today && t.status !== 'Completed' && t.status !== 'Cancelled';
              const mine = t.assigned_user_id === userId;
              return (
                <Tr key={t.id}>
                  <Td className="font-mono text-xs">{t.task_number}</Td>
                  <Td>
                    <span className="font-medium">{t.title}</span>
                    {t.details && <div className="text-xs text-muted-foreground">{t.details}</div>}
                  </Td>
                  <Td>{t.assigned_name ?? <span className="text-muted-foreground">—</span>}</Td>
                  <Td className="text-xs text-muted-foreground">{[t.unit_ref, t.section_code].filter(Boolean).join(' · ') || '—'}</Td>
                  <Td className={cn('text-xs', overdue ? 'font-semibold text-severity-critical-ink' : 'text-muted-foreground')}>
                    {t.due_date ?? '—'}{overdue ? ' · overdue' : ''}
                  </Td>
                  <Td>
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full', t.status === 'Completed' ? 'bg-severity-low' : 'bg-severity-medium')}
                        style={{ width: `${t.progress}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{t.progress}%</span>
                  </Td>
                  <Td className="text-xs font-semibold uppercase">{t.status}</Td>
                  <Td>
                    {(maySchedule || mine) && t.status !== 'Completed' && t.status !== 'Cancelled' ? (
                      <form action={updateDutyTaskAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={t.id} />
                        <input
                          name="progress" type="number" min={0} max={100} step={10} defaultValue={t.progress}
                          aria-label="Progress %"
                          className="h-8 w-16 rounded-md border border-border bg-bg-soft px-2 text-xs"
                        />
                        <select name="status" defaultValue={t.status} className="h-8 rounded-md border border-border bg-bg-soft px-1.5 text-xs">
                          <option>Pending</option>
                          <option>In Progress</option>
                          <option>Completed</option>
                          {maySchedule && <option>Cancelled</option>}
                        </select>
                        <button type="submit" className="h-8 rounded-md bg-accent px-2.5 text-xs font-semibold">Save</button>
                      </form>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t.completed_at ? 'Closed' : '—'}</span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
