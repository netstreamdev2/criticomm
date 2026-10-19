'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Minus, Plus } from 'lucide-react';
import {
  composeReportType, getReportForm, POLICE_REPORT_FORMS, rowCount, rowLabel, rowsKey, sectionFields, validateReportAnswers,
  type ReportField, type ReportSection,
} from '@criticom/api';
import { cn } from '@/lib/utils';
import { fileConsoleReportAction, type ConsoleReportInput } from '../../actions';
import { useT } from '@/components/i18n';

type Header = ConsoleReportInput['header'];

const input = 'mt-1 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function ConsoleReportForm({ initialForms, officerName, bodycamOn }: {
  initialForms: string[];
  officerName: string;
  bodycamOn: boolean;
}) {
  const { t } = useT();
  const router = useRouter();
  const [forms, setForms] = useState<string[]>(initialForms);
  const [header, setHeader] = useState<Header>({
    case_number: '', date_of_offense: today(), time_of_offense: '', location: '', station: '',
    officer_name: officerName, badge_number: '',
  });
  const [answers, setAnswers] = useState<Record<string, string>>({ bodycam_active: bodycamOn ? 'Yes' : 'No' });
  const [problems, setProblems] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [pending, start] = useTransition();

  const type = useMemo(() => (forms.length ? composeReportType(forms) : null), [forms]);
  const set = (key: string, value: string) => setAnswers((a) => ({ ...a, [key]: value }));
  const toggleForm = (id: string) => setForms((cur) => {
    const next = cur.includes(id) ? cur.filter((f) => f !== id) : [...cur, id];
    return POLICE_REPORT_FORMS.map((f) => f.id).filter((f) => next.includes(f));
  });
  const addRow = (s: ReportSection) => set(rowsKey(s), String(rowCount(s, answers) + 1));
  const removeRow = (s: ReportSection) => setAnswers((cur) => {
    const n = rowCount(s, cur);
    const next = { ...cur, [rowsKey(s)]: String(n - 1) };
    for (const { key, row } of sectionFields(s, cur)) if (row === n) delete next[key];
    return next;
  });

  const invalid = useMemo(() => {
    const out = new Set<string>();
    if (!tried || !type) return out;
    for (const s of type.sections) {
      for (const { key, field, row } of sectionFields(s, answers)) {
        const v = (answers[key] ?? '').trim();
        if (field.required && !row && !v) out.add(key);
      }
    }
    if ((answers.officer_narrative ?? '').trim().length < 20) out.add('officer_narrative');
    return out;
  }, [tried, type, answers]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!type) { setProblems(['Choose at least one form.']); return; }
    const found = [
      ...(!header.location.trim() ? ['Location is required.'] : []),
      ...validateReportAnswers(type, answers),
    ];
    setProblems(found);
    if (found.length) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    start(async () => {
      const res = await fileConsoleReportAction({ forms, header, answers });
      if (!res.ok) { setProblems([res.error]); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      router.push(`/police/reports/${res.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {problems.length ? (
        <div role="alert" className="rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-4 py-3 text-sm text-severity-critical-ink">
          <p className="font-semibold">{t('The report cannot be filed yet:')}</p>
          <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ) : null}

      <section className="rounded-lg border border-border bg-bg-card p-4">
        <h2 className="font-semibold">{t('Forms')}{' '}<span className="text-severity-critical-ink">*</span></h2>
        <p className="text-sm text-muted-foreground">{t('Choose every form this report needs. Each has its own colour on the report and the PDF.')}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {POLICE_REPORT_FORMS.map((f) => {
            const on = forms.includes(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => toggleForm(f.id)}
                aria-pressed={on}
                className={cn(
                  'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  on ? '' : 'border-border bg-bg-soft hover:bg-muted',
                )}
                style={{ borderLeft: `4px solid ${f.tone}`, ...(on ? { borderColor: f.tone, backgroundColor: `${f.tone}1f` } : {}) }}
              >
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-white"
                  style={on ? { backgroundColor: f.tone, borderColor: f.tone } : { borderColor: `${f.tone}88` }}
                >
                  {on ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block font-mono text-[11px] font-bold" style={{ color: f.tone }}>{f.code}</span>
                  <span className="block text-sm font-semibold">{f.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-bg-card p-4">
        <h2 className="font-semibold">{t('Report')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <HeaderField label={t('Case number')} value={header.case_number} placeholder={t('Given automatically if blank')} onChange={(v) => setHeader({ ...header, case_number: v })} />
          <HeaderField label={t('Date of offence')} type="date" required value={header.date_of_offense} onChange={(v) => setHeader({ ...header, date_of_offense: v })} />
          <HeaderField label={t('Time of offence')} type="time" value={header.time_of_offense} onChange={(v) => setHeader({ ...header, time_of_offense: v })} />
          <HeaderField label={t('Location')} required className="sm:col-span-2" value={header.location} invalid={tried && !header.location.trim()} onChange={(v) => setHeader({ ...header, location: v })} />
          <HeaderField label={t('Station')} value={header.station} onChange={(v) => setHeader({ ...header, station: v })} />
          <HeaderField label={t('Officer')} required value={header.officer_name} onChange={(v) => setHeader({ ...header, officer_name: v })} />
          <HeaderField label={t('Force number')} value={header.badge_number} onChange={(v) => setHeader({ ...header, badge_number: v })} />
        </div>
      </section>

      {type?.sections.map((s) => (
        <Section key={s.key ?? s.title} section={s} answers={answers} invalid={invalid} set={set} addRow={addRow} removeRow={removeRow} />
      ))}

      <button type="submit" disabled={pending || !type} className="h-11 w-full rounded-md bg-primary text-sm font-semibold disabled:opacity-60">
        {pending ? 'Filing…' : 'File report'}
      </button>
    </form>
  );
}

function HeaderField({ label, value, onChange, type = 'text', required, placeholder, className, invalid }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
  placeholder?: string; className?: string; invalid?: boolean;
}) {
  const id = `h-${label.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <div className={className}>
      <label htmlFor={id} className="text-sm font-medium">{label}{required ? <span className="text-severity-critical-ink"> *</span> : null}</label>
      <input id={id} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className={cn(input, invalid && 'border-severity-critical')} aria-invalid={invalid || undefined} />
    </div>
  );
}

function Section({ section, answers, invalid, set, addRow, removeRow }: {
  section: ReportSection;
  answers: Record<string, string>;
  invalid: Set<string>;
  set: (k: string, v: string) => void;
  addRow: (s: ReportSection) => void;
  removeRow: (s: ReportSection) => void;
}) {
  const { t } = useT();
  const tone = section.form ? getReportForm(section.form)?.tone : undefined;
  if (!section.repeat) {
    return (
      <section className="rounded-lg border border-border bg-bg-card p-4" style={tone ? { borderLeft: `4px solid ${tone}` } : undefined}>
        <h2 className="font-semibold">{section.title}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {section.fields.map((f) => (
            <Field key={f.key} field={f} id={f.key} value={answers[f.key] ?? ''} invalid={invalid.has(f.key)} onChange={(v) => set(f.key, v)} />
          ))}
        </div>
      </section>
    );
  }
  const rows = rowCount(section, answers);
  const fields = sectionFields(section, answers);
  return (
    <section className="rounded-lg border border-border bg-bg-card p-4" style={tone ? { borderLeft: `4px solid ${tone}` } : undefined}>
      <h2 className="font-semibold">{section.title}</h2>
      <div className="mt-3 space-y-3">
        {Array.from({ length: rows }, (_, i) => i + 1).map((n) => (
          <div key={n} className="rounded-md border border-border/70 bg-bg-soft p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">{rowLabel(section, n)}</p>
              {n === rows && rows > section.repeat!.min ? (
                <button type="button" onClick={() => removeRow(section)} className="inline-flex items-center gap-1 text-xs font-semibold text-severity-critical-ink hover:underline">
                  <Minus className="h-3.5 w-3.5" /> {' '}{t('Remove')}</button>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.filter((x) => x.row === n).map(({ key, field }) => (
                <Field key={key} field={field} id={key} value={answers[key] ?? ''} invalid={invalid.has(key)} onChange={(v) => set(key, v)} />
              ))}
            </div>
          </div>
        ))}
        {rows < section.repeat.max ? (
          <button type="button" onClick={() => addRow(section)} className="inline-flex items-center gap-1.5 rounded-md border border-accent/50 px-3 py-1.5 text-sm font-semibold text-accent hover:bg-accent/10">
            <Plus className="h-4 w-4" /> {' '}{t('Add {noun}', { noun: section.repeat.noun })}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Field({ field, id, value, invalid, onChange }: {
  field: ReportField; id: string; value: string; invalid: boolean; onChange: (v: string) => void;
}) {
  const label = (
    <span className="text-sm font-medium">
      {field.label}{field.required ? <span className="text-severity-critical-ink"> *</span> : null}
    </span>
  );
  const ring = invalid ? 'border-severity-critical' : '';
  if (field.kind === 'multiline') {
    return (
      <div className="sm:col-span-2 lg:col-span-3">
        <label htmlFor={id}>{label}</label>
        <textarea id={id} rows={field.key === 'officer_narrative' ? 6 : 3} value={value} placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn('mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-sm', ring)} aria-invalid={invalid || undefined} />
      </div>
    );
  }
  if (field.kind === 'yesno' || field.kind === 'check' || field.kind === 'choice') {
    const options = field.kind === 'yesno' ? ['Yes', 'No'] : field.kind === 'check' ? ['OK', 'Fault', 'NIL'] : (field.options ?? []);
    if (field.kind === 'choice' && options.length > 4) {
      return (
        <div>
          <label htmlFor={id}>{label}</label>
          <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(input, ring)} aria-invalid={invalid || undefined}>
            <option value="">—</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    }
    return (
      <fieldset>
        <legend>{label}</legend>
        <div className={cn('mt-1 flex flex-wrap gap-1.5 rounded-md', invalid && 'ring-1 ring-severity-critical')}>
          {options.map((o) => (
            <button
              key={o} type="button" aria-pressed={value === o}
              onClick={() => onChange(value === o ? '' : o)}
              className={cn('h-9 rounded-md border px-3 text-sm font-semibold', value === o ? 'border-accent bg-accent/15 text-fg' : 'border-border bg-bg-soft text-muted-foreground hover:bg-muted')}
            >
              {o}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }
  if (field.kind === 'multi') {
    const picked = value ? value.split('; ').filter(Boolean) : [];
    const toggle = (o: string) => onChange((picked.includes(o) ? picked.filter((p) => p !== o) : [...picked, o]).join('; '));
    return (
      <div className="sm:col-span-2 lg:col-span-3">
        <p>{label}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {(field.options ?? []).map((o) => (
            <button key={o} type="button" aria-pressed={picked.includes(o)} onClick={() => toggle(o)}
              className={cn('rounded-full border px-3 py-1 text-xs font-semibold', picked.includes(o) ? 'border-accent bg-accent/15 text-fg' : 'border-border bg-bg-soft text-muted-foreground hover:bg-muted')}>
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const htmlType = field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : field.kind === 'time' ? 'time' : 'text';
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={htmlType} value={value} placeholder={field.placeholder} min={field.kind === 'number' ? 0 : undefined}
        onChange={(e) => onChange(e.target.value)} className={cn(input, ring)} aria-invalid={invalid || undefined} />
    </div>
  );
}
