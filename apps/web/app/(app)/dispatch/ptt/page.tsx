import { listPersonnel } from '@criticom/api';
import { getSession, siloFilter } from '@/lib/session';
import { PttConsole } from './ptt-console';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PTT Radio Console · Criticom' };

export default async function PttPage() {
  const { supabase, silo } = await getSession();
  const personnel = await listPersonnel(supabase, siloFilter(silo));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">PTT radio console</h1>
        <p className="text-muted-foreground">
          Send text-to-radio messages and review recent voice traffic (RealPTT).
          Unit accounts default to badge numbers.
        </p>
      </header>
      <PttConsole
        units={personnel.map((p) => ({
          label: `${p.first_name} ${p.last_name} (${p.badge_number})${p.is_on_duty ? ' · on duty' : ''}`,
          account: p.badge_number,
        }))}
      />
    </div>
  );
}
