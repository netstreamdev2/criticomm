import { addDays, punctualitySummary, saDay } from '@criticom/api';
import { canManageRoster, departmentName, type Silo, type UserRole } from '@criticom/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { getServerSupabase } from '@/lib/supabase';
import { requestT } from '@/lib/i18n';

/** The last 30 days of shifts in the department: who started on time, late, or not at all. */
export async function Punctuality({ viewerRole: role, silo }: { viewerRole: UserRole; silo: Silo }) {
  const { t } = await requestT();
  if (!canManageRoster(role, silo)) return null;
  const supabase = await getServerSupabase();
  const to = saDay();
  const from = addDays(to, -30);
  const rows = await punctualitySummary(supabase, { silo, from, to }).catch(() => []);
  const sorted = [...rows].sort((a, b) => (b.late + b.not_started) - (a.late + a.not_started) || a.user_name.localeCompare(b.user_name));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Punctuality · last 30 days')}</CardTitle>
        <CardDescription>{t('{departmentName} · issued shifts that have started, and how each was started.', { departmentName: departmentName(silo) })}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <SimpleTable headers={['Member', 'Shifts', 'Started', 'Late', 'Minutes late', 'Not started', 'Excused', 'Sick', 'Absent']} empty={t('No shifts in the last 30 days.')}>
          {sorted.map((r) => (
            <Tr key={r.user_id}>
              <Td className="font-medium">{r.user_name}</Td>
              <Td className="font-mono">{r.shifts}</Td>
              <Td className="font-mono">{r.started}</Td>
              <Td className={`font-mono ${r.late ? 'text-severity-high-ink' : ''}`}>{r.late}</Td>
              <Td className="font-mono">{r.late_minutes}</Td>
              <Td className={`font-mono ${r.not_started ? 'text-severity-critical-ink' : ''}`}>{r.not_started}</Td>
              <Td className="font-mono">{r.excused}</Td>
              <Td className="font-mono">{r.sick}</Td>
              <Td className={`font-mono ${r.absent ? 'text-severity-critical-ink' : ''}`}>{r.absent}</Td>
            </Tr>
          ))}
        </SimpleTable>
      </CardContent>
    </Card>
  );
}
