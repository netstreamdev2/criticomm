/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { PCR_SIGNATURES, pcrReadout, type SecondaryPatient } from '@criticom/db/pcr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { defaultsFrom, signatureSrc } from '@/lib/pcr-record';
import { formatSaTime } from '@/lib/utils';

type PcrRow = Record<string, unknown> & {
  id: string; report_number: string | null; filed_at: string | null; created_at: string;
  paramedic_names: string | null; total_response_seconds: number | null; requires_cleaning: boolean;
  secondary_patients_json: unknown; time_of_arrival: string | null;
};

const minutes = (s: number | null) => (s === null || s === undefined ? null : s >= 3600
  ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)} min`);

/** A filed patient care report, read back in V4's sections. */
export function PcrCard({ pcr, showLink = false }: { pcr: PcrRow; showLink?: boolean }) {
  const answers = defaultsFrom(pcr as Parameters<typeof defaultsFrom>[0]);
  const sections = pcrReadout(answers);
  const casualties = Array.isArray(pcr.secondary_patients_json) ? (pcr.secondary_patients_json as SecondaryPatient[]) : [];
  const response = minutes(pcr.total_response_seconds);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Patient care report{pcr.report_number ? ` · ${pcr.report_number}` : ''}</CardTitle>
            <CardDescription>
              {pcr.paramedic_names ?? 'EMS crew'} · {formatSaTime(pcr.filed_at ?? pcr.created_at)}
              {response ? ` · total response ${response}` : ''}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {pcr.requires_cleaning ? (
              <span className="rounded-full border border-severity-high/50 bg-severity-high/10 px-2.5 py-1 text-[11px] font-semibold text-severity-high-ink">
                Vehicle off road for cleaning
              </span>
            ) : null}
            {showLink ? <Link href={`/medical/pcr/${pcr.id}`} className="text-sm text-accent hover:underline">Open</Link> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {pcr.time_of_arrival ? (
          <p className="text-xs text-muted-foreground">Time on scene {formatSaTime(pcr.time_of_arrival)}</p>
        ) : null}
        {sections.map((s) => (
          <div key={s.title}>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{s.title}</p>
            <dl className="grid gap-x-4 gap-y-2 rounded-md border border-border/60 bg-bg-soft p-3 sm:grid-cols-2">
              {s.items.map((i, n) => (
                <div key={`${i.label}-${n}`}>
                  <dt className="text-xs text-muted-foreground">{i.label}</dt>
                  <dd className="whitespace-pre-wrap break-words">{i.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}

        {casualties.length ? (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Multiple casualties</p>
            <div className="overflow-x-auto rounded-md border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-bg-soft text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2 text-left">Name</th><th className="px-3 py-2 text-left">Age</th><th className="px-3 py-2 text-left">Sex</th><th className="px-3 py-2 text-left">Triage</th><th className="px-3 py-2 text-left">Injuries / treatment</th></tr>
                </thead>
                <tbody>
                  {casualties.map((c, n) => (
                    <tr key={`${c.name}-${n}`} className="border-t border-border/60">
                      <td className="px-3 py-2">{c.name || '—'}</td><td className="px-3 py-2">{c.age || '—'}</td>
                      <td className="px-3 py-2">{c.gender || '—'}</td><td className="px-3 py-2">{c.triage || '—'}</td>
                      <td className="px-3 py-2">{c.injuries || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Sign Off & Handover</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {PCR_SIGNATURES.map((s) => {
              const src = signatureSrc(pcr[s.key] as string | null);
              return (
                <div key={s.key}>
                  <p className="mb-1 text-xs text-muted-foreground">{s.label}</p>
                  {src
                    ? <img src={src} alt={`${s.label} signature`} className="h-24 w-full rounded-md border border-border bg-white object-contain" />
                    : <p className="flex h-24 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">Not signed</p>}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
