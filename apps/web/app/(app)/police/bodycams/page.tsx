import Link from 'next/link';
import { Download, FileUp } from 'lucide-react';
import {
  FIREARM_OUT_LIMIT_HOURS, firearmOverdueBefore, listAssetImports, listBodycamRegister, listRecentBodycamViews,
  type AssetImport, type BodycamViewRow, type RegisterBodycam,
} from '@criticom/api';
import { bodycamReasonLabel } from '@criticom/db/bodycams';
import type { Silo } from '@criticom/db';
import { canAccess } from '@criticom/db/roles';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { bodycamRolesFor } from '@/lib/assets/roles';
import { invitationErrorMessage } from '@/lib/onboarding/errors';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { BodycamTable, type BodycamFilter } from './bodycam-table';
import { blankBodycam } from './blank';
import { BodycamForm } from './bodycam-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bodycams · HikTech' };

const FILTERS: BodycamFilter[] = ['current', 'Available', 'Booked out', 'overdue', 'In repair', 'Lost', 'Retired', 'all'];

/**
 * The bodycam register (migration 0054): every bodycam, where it is kept, who
 * has it now, and who has watched it. Officers book one out in the app at the
 * start of a shift and hand it back at the end; the armoury's keepers keep
 * the register here.
 */
export default async function BodycamRegisterPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { supabase, role, silo } = await getSession();
  const { status } = await searchParams;
  const { global, canManage, departments } = bodycamRolesFor(role, silo);

  let cams: RegisterBodycam[] = [];
  let views: BodycamViewRow[] = [];
  let loadError: string | null = null;
  let latest: AssetImport | null = null;
  try {
    cams = await listBodycamRegister(supabase, { silo: global ? undefined : silo });
  } catch (e) {
    loadError = invitationErrorMessage(e, 'The bodycam register could not be loaded.');
  }
  if (!loadError) {
    [latest, views] = await Promise.all([
      listAssetImports(supabase, 'bodycams', 1).then((r) => r[0] ?? null).catch(() => null),
      listRecentBodycamViews(supabase, 20).catch(() => []),
    ]);
  }

  const overdueBefore = firearmOverdueBefore().toISOString();
  const tally = (pred: (c: RegisterBodycam) => boolean) => cams.filter(pred).length;
  const overdue = tally((c) => c.status === 'Booked out' && !!c.booked_at && c.booked_at < overdueBefore);
  const initialFilter = FILTERS.includes(status as BodycamFilter) ? (status as BodycamFilter) : 'current';
  const homeSilo: Silo = global ? 'MetroPolice' : silo;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bodycams</h1>
          <p className="max-w-2xl text-muted-foreground">
            Every bodycam on the register, where it is kept and who has it now. Officers book one out in the app at the
            start of their shift and hand it back before the shift can end.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {canManage ? (
            <>
              <Link href="/police/bodycams/import" className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground hover:bg-primary/90">
                <FileUp className="h-4 w-4" /> Import bodycam list
              </Link>
              <a href="/police/bodycams/template" className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 hover:bg-muted">
                <Download className="h-4 w-4" /> Template
              </a>
            </>
          ) : null}
          {canAccess('/cameras', role, silo) ? (
            <Link href="/cameras" className="rounded-md border border-border px-4 py-2 hover:bg-muted">Body cams live</Link>
          ) : null}
          <Link href="/shift/today" className="rounded-md border border-border px-4 py-2 hover:bg-muted">Today’s shift</Link>
        </div>
      </header>

      {loadError ? (
        <p role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">{loadError}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {([
              ['Available', tally((c) => c.status === 'Available'), 'Available', ''],
              ['Booked out', tally((c) => c.status === 'Booked out'), 'Booked out', ''],
              [`Out over ${FIREARM_OUT_LIMIT_HOURS} hours`, overdue, 'overdue', overdue ? 'text-severity-high-ink' : ''],
              ['In repair', tally((c) => c.status === 'In repair'), 'In repair', ''],
              ['Lost', tally((c) => c.status === 'Lost'), 'Lost', tally((c) => c.status === 'Lost') ? 'text-severity-critical-ink' : ''],
              ['Retired', tally((c) => c.status === 'Retired'), 'Retired', 'text-muted-foreground'],
            ] as const).map(([label, n, filter, tone]) => (
              <Link key={filter} href={`/police/bodycams?status=${encodeURIComponent(filter)}`} className="rounded-lg border border-border bg-bg-card px-3 py-2 hover:border-primary/50">
                <dd className={`text-2xl font-bold tabular-nums ${tone}`}>{n}</dd>
                <dt className="text-xs text-muted-foreground">{label}</dt>
              </Link>
            ))}
          </dl>

          {latest ? (
            <p className="text-sm text-muted-foreground">
              Last bodycam import: <b className="text-fg">{latest.file_name}</b>, {formatSaTime(latest.imported_at)} by {latest.imported_by_name ?? 'an administrator'}.{' '}
              {latest.added} added, {latest.updated} updated.
            </p>
          ) : null}

          <BodycamTable cams={cams} canManage={canManage} departments={departments} overdueBefore={overdueBefore} initialFilter={initialFilter} />
        </>
      )}

      {canManage && !loadError ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a bodycam</CardTitle>
            <CardDescription>One at a time. For many, use the import with the template.</CardDescription>
          </CardHeader>
          <CardContent>
            <BodycamForm initial={blankBodycam(homeSilo)} departments={departments} />
          </CardContent>
        </Card>
      ) : null}

      {!loadError ? (
        <Card>
          <CardHeader>
            <CardTitle>Who has watched</CardTitle>
            <CardDescription>The latest views of these bodycams, live or recorded, with the reason given. Every one is also in the audit log.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {views.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Nobody has opened a bodycam yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {views.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2">
                    <span>
                      <b>{v.viewer_name ?? 'Someone'}</b> {v.kind === 'live' ? 'watched' : 'played footage from'}{' '}
                      <span className="font-mono">{v.serial_number}</span>
                      {v.officer_name ? <> ({v.officer_name})</> : null}
                      <span className="text-muted-foreground">
                        {' · '}{v.reason_code === 'incident' ? v.incident_number ?? 'an incident' : bodycamReasonLabel(v.reason_code)}
                        {v.reason_note ? ` — ${v.reason_note}` : ''}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatSaTime(v.started_at)}{v.ended_at ? '' : ' · open now'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
