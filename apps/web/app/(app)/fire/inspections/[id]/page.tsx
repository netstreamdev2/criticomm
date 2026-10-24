import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FileText, RotateCcw } from 'lucide-react';
import { getFireInspection, listPremisesInspections } from '@criticom/api';
import { FIRE_INSPECTION_GROUPS, daysWords } from '@criticom/db/fire-inspection';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Site Inspection · HikTech' };

const TONE: Record<string, string> = {
  Compliant: 'text-severity-low-ink', 'Compliance notice': 'text-severity-high-ink', Instruction: 'text-severity-critical-ink',
};
const ANSWER: Record<string, string> = { yes: 'Yes', no: 'No', na: 'N/A' };

/** A filed site inspection (0106), as it is on record, with the site's other visits. */
export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await requestT();
  const { supabase } = await getSession();
  const { id } = await params;
  const row = /^[0-9a-f-]{36}$/i.test(id) ? await getFireInspection(supabase, id).catch(() => null) : null;
  if (!row) notFound();
  const visits = row.premises_id ? await listPremisesInspections(supabase, row.premises_id).catch(() => []) : [];
  const outcome = row.outcome ?? (row.result === 'PASS' ? 'Compliant' : 'Compliance notice');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-accent">{row.inspection_ref}</p>
          <h1 className="text-2xl font-bold">{row.business_name}</h1>
          <p className="text-muted-foreground">{row.address}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {outcome !== 'Compliant' ? (
            <a href={`/fire/inspections/${row.id}/notice`} target="_blank" rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold">
              <FileText className="h-4 w-4" /> {t('Print the notice')}</a>
          ) : null}
          {row.premises_id ? (
            <Link href={`/fire/inspections/new?premises=${row.premises_id}`}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm hover:bg-muted">
              <RotateCcw className="h-4 w-4" /> {t('Inspect again')}</Link>
          ) : null}
        </div>
      </header>

      <Card>
        <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-xs uppercase text-muted-foreground">{t('Outcome')}</p><p className={`text-lg font-bold ${TONE[outcome] ?? ''}`}>{t(outcome)}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">{t('Inspected')}</p><p>{formatSaTime(row.inspected_at)}</p><p className="text-xs text-muted-foreground">{row.inspector_name}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">{t('Put right by')}</p><p>{row.comply_by ?? '—'}</p></div>
          <div><p className="text-xs uppercase text-muted-foreground">{t('Back to check on')}</p><p>{row.reinspect_on ?? '—'}</p></div>
          {row.kind ? <div><p className="text-xs uppercase text-muted-foreground">{t('Why')}</p><p>{t(row.kind)}</p></div> : null}
          {row.person_in_charge ? <div><p className="text-xs uppercase text-muted-foreground">{t('Person in charge')}</p><p>{row.person_in_charge}</p></div> : null}
          {row.served ? <div><p className="text-xs uppercase text-muted-foreground">{t('Notice')}</p><p>{t(row.served)}</p></div> : null}
          {row.lat !== null && row.lng !== null ? <div><p className="text-xs uppercase text-muted-foreground">{t('Inspector\'s position')}</p><p className="font-mono text-xs">{row.lat.toFixed(5)}, {row.lng.toFixed(5)}</p></div> : null}
        </CardContent>
      </Card>

      {row.repeat_failure ? (
        <p className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">
          {t('A fault on the last notice was still there. Consider a fine or court (s.79).')}</p>
      ) : null}
      {row.instruction ? (
        <Card><CardHeader><CardTitle className="text-severity-critical-ink">{t(row.instruction)}</CardTitle></CardHeader>
          <CardContent className="text-sm">{row.instruction_reason}</CardContent></Card>
      ) : null}

      {row.notice_items.length ? (
        <Card>
          <CardHeader><CardTitle>{t('Faults to put right')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {row.notice_items.map((n) => (
                <li key={n.key} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div><p className="font-semibold">{t(n.label)}</p><p className="text-muted-foreground">{n.section} · {t(n.remedy)}</p></div>
                  <span className="font-semibold text-severity-high-ink">{t(daysWords(n.days))}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {Object.keys(row.checklist ?? {}).length ? (
        <Card>
          <CardHeader><CardTitle>{t('Checks')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {FIRE_INSPECTION_GROUPS.map((g) => (
              <div key={g.id}>
                <p className="mb-1 text-xs font-bold uppercase text-muted-foreground">{t(g.title)}</p>
                <ul className="space-y-1 text-sm">
                  {g.items.map((i) => {
                    const a = row.checklist[i.key];
                    return (
                      <li key={i.key} className="flex justify-between gap-3">
                        <span>{t(i.label)}</span>
                        <span className={a === 'no' ? 'font-bold text-severity-critical-ink' : a === 'yes' ? 'text-severity-low-ink' : 'text-muted-foreground'}>{a ? t(ANSWER[a] ?? a) : '—'}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {row.notes ? <Card><CardHeader><CardTitle>{t('Notes')}</CardTitle></CardHeader><CardContent className="whitespace-pre-wrap text-sm">{row.notes}</CardContent></Card> : null}

      {visits.length > 1 ? (
        <Card>
          <CardHeader><CardTitle>{t('Visits to this site')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {visits.map((v) => (
                <li key={v.id} className="flex justify-between gap-3 px-5 py-2 text-sm">
                  <Link href={`/fire/inspections/${v.id}`} className={v.id === row.id ? 'font-bold' : 'text-accent hover:underline'}>{v.inspection_ref}</Link>
                  <span className={TONE[v.outcome ?? ''] ?? ''}>{t(v.outcome ?? v.result)}</span>
                  <span className="text-muted-foreground">{formatSaTime(v.inspected_at)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
