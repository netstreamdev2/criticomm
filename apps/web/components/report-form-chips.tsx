import { Check } from 'lucide-react';
import { getReportForm, getReportType, type PoliceReportForm } from '@criticom/api';

/** The case report's own colour, beside the DMPS forms' (the phone uses the same). */
export const CASE_TONE = '#3b82f6';

/**
 * The forms a police report carries, each in its own colour with a tick, as
 * the officer ticked them on the phone: the case report, then the DMPS forms.
 */
export function ReportFormChips({ forms, withCase = true }: { forms: readonly PoliceReportForm[]; withCase?: boolean }) {
  const items = [
    ...(withCase ? [{ key: 'case', text: 'Case report', tone: CASE_TONE }] : []),
    ...forms.map((f) => ({ key: f.id, text: `${f.code} · ${f.label}`, tone: f.tone })),
  ];
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Forms filed">
      {items.map((i) => (
        <li
          key={i.key}
          className="inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-2.5 text-xs font-semibold"
          style={{ borderColor: `${i.tone}66`, backgroundColor: `${i.tone}14` }}
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full text-white" style={{ backgroundColor: i.tone }}>
            <Check className="h-3 w-3" aria-hidden />
          </span>
          {i.text}
        </li>
      ))}
    </ul>
  );
}

/** A readout section's heading, with a bar in its form's colour (none for the case report's own). */
export function FormSectionTitle({ title, form }: { title: string; form?: string }) {
  const tone = form ? getReportForm(form)?.tone : undefined;
  return (
    <p className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
      {tone ? <span className="inline-block h-3 w-1 rounded-full" style={{ backgroundColor: tone }} aria-hidden /> : null}
      {title}
    </p>
  );
}

/** A report's forms as short coloured codes, for tables ("12A", "211A"); older reports by their label. */
export function FormCodes({ reportType, fallback }: { reportType: string | null; fallback?: string | null }) {
  const type = reportType ? getReportType(reportType) : null;
  if (!type?.forms?.length) return <>{type?.label ?? fallback ?? '—'}</>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {type.forms.map((f) => (
        <span
          key={f.id}
          title={f.label}
          className="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
          style={{ backgroundColor: `${f.tone}22`, boxShadow: `inset 0 0 0 1px ${f.tone}66` }}
        >
          {f.code}
        </span>
      ))}
    </span>
  );
}
