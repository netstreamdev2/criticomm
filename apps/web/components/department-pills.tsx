import { DEPARTMENT_NAMES, type Silo } from '@criticom/db';
import { readPatients, type CallPatient } from '@criticom/db/call-facts';
import { requestT } from '@/lib/i18n';

/** Each department in its own colour: the same as the dots on the call form. */
const TONE: Record<string, string> = {
  MetroPolice: '#3b82f6',
  MetroFire: '#f59e0b',
  Medical: '#dc3545',
  EthekwiniDisaster: '#8b5cf6',
};

/** The departments on a call, one coloured pill each; the control room when none. */
export async function DepartmentPills({ silos }: { silos: readonly Silo[] }) {
  const { t } = await requestT();
  const list = silos.filter((s) => s !== 'Ethekwini');
  if (!list.length) {
    return <span className="inline-flex rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold">{t('Control room')}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {list.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
          style={{ borderColor: `${TONE[s]}99`, background: `${TONE[s]}26`, color: 'rgb(var(--c-fg))' }}>
          <span className="h-2 w-2 rounded-full" style={{ background: TONE[s] }} aria-hidden />
          {DEPARTMENT_NAMES[s]}
        </span>
      ))}
    </span>
  );
}

const SEVERITY_PILL: Record<string, string> = {
  Critical: 'bg-severity-critical text-white',
  High: 'bg-severity-high text-white',
  Medium: 'bg-severity-medium text-black',
  Low: 'bg-severity-low text-white',
  Unknown: 'bg-muted text-fg',
};

/** Each patient and their own severity, apart from the incident's (0080). */
export async function PatientList({ patients }: { patients: unknown }) {
  const { t } = await requestT();
  const list: CallPatient[] = readPatients(patients);
  if (!list.length) return <span className="text-muted-foreground">{t('Not recorded')}</span>;
  return (
    <ul className="space-y-1">
      {list.map((p, i) => (
        <li key={`${p.name ?? 'patient'}-${i}`} className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_PILL[p.severity] ?? SEVERITY_PILL.Unknown}`}>{p.severity}</span>
          <span>{p.name ?? 'Name not given'}{p.caller ? <span className="text-muted-foreground"> {' '}{t('(the caller)')}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}
