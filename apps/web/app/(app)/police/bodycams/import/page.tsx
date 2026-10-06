import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AssetImportWizard } from '@/components/register/asset-import';
import { bodycamRolesFor } from '@/lib/assets/roles';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Import bodycam list · HikTech' };

/** Import the bodycam register from a spreadsheet (migration 0054). */
export default async function ImportBodycamsPage() {
  const { role, silo } = await getSession();
  if (!bodycamRolesFor(role, silo).canManage) redirect('/police/bodycams');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <Link href="/police/bodycams" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Bodycams
        </Link>
        <h1 className="text-2xl font-bold">Import bodycam list</h1>
        <p className="max-w-3xl text-muted-foreground">
          Adds bodycams to the register and updates the ones already there, matched by serial number. Who has a bodycam
          right now never changes by import; that happens only when it is booked out or handed back.
        </p>
      </header>
      <AssetImportWizard kind="bodycams" />
    </div>
  );
}
