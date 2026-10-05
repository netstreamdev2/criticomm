import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getSession } from '@/lib/session';
import { ImportWizard } from './import-wizard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Import staff list · HikTech' };

/**
 * Import HR's staff list into the register (migration 0050). SystemAdmins
 * only: a department Admin confirms roles for their own people afterwards.
 */
export default async function ImportStaffListPage() {
  const { role } = await getSession();
  if (role !== 'SystemAdmin' && role !== 'SuperAdmin') redirect('/admin/personnel');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <Link href="/admin/personnel" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Personnel
        </Link>
        <h1 className="text-2xl font-bold">Import staff list</h1>
        <p className="max-w-3xl text-muted-foreground">
          Adds people to the staff register and updates the ones already there, matched by badge number. Nobody gets
          access: each person is invited afterwards and activates their own account.
        </p>
      </header>
      <ImportWizard />
    </div>
  );
}
