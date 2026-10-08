import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listFineOffences, type FineOffence } from '@criticom/api';
import { canIssueFines } from '@criticom/db';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { CaptureForm } from './capture-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Capture a notice · HikTech' };

/**
 * Capture a notice written in a paper book. The roadside notice is the
 * phone's job; this is for the book an officer wrote by hand when a phone was
 * not to hand, so it reaches the register with its printed number.
 */
export default async function CaptureFinePage() {
  await requireFeaturePage('web.enforcement');
  const { supabase, role, silo } = await getSession();
  if (!canIssueFines({ role, silo })) redirect('/police/fines');
  const offences: FineOffence[] = await listFineOffences(supabase, { activeOnly: true }).catch(() => []);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/police/fines" className="text-sm font-semibold text-muted-foreground hover:text-fg">← Fines register</Link>
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">Metro Police · Enforcement</p>
        <h1 className="mt-1 text-2xl font-bold">Capture a paper notice</h1>
        <p className="text-sm text-muted-foreground">
          For a notice written in a notice book. Copy it exactly as written, with the printed notice number. Notices at
          the roadside are issued on the phone, where the infringer signs.
        </p>
      </header>
      <CaptureForm offences={offences} />
    </div>
  );
}
