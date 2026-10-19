'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Car, Check, ChevronLeft, ChevronRight, CloudLightning, Crosshair, FileText, Flame, Hand, HeartPulse,
  PawPrint, Plus, Trash2, Truck, Wrench, X,
} from 'lucide-react';
import { rowCount, rowLabel, rowsKey, sectionFields, type ReportSection } from '@criticom/api';
import { cn } from '@/lib/utils';
import type { DeskField, DeskForm, DeskSection } from '@/lib/radio-forms';
import { useT } from '@/components/i18n';

const ICONS = {
  hand: Hand, car: Car, wrench: Wrench, crosshair: Crosshair, alert: AlertTriangle, truck: Truck, paw: PawPrint,
  file: FileText, flame: Flame, heart: HeartPulse, storm: CloudLightning,
} as const;

export function FormIcon({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  const Icon = ICONS[name as keyof typeof ICONS] ?? FileText;
  return <Icon className={className} style={style} aria-hidden />;
}

/** Readable text on a form's colour: dark on the light hues (yellow), white on the rest. */
export function onTone(hex: string) {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 165 ? '#111827' : '#ffffff';
}

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const now = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

const input = 'mt-1 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm';

/** How many of a form's asked fields are answered: "5 of 12". */
export function answered(form: DeskForm, answers: Record<string, string>) {
  let done = 0;
  let total = 0;
  for (const s of form.sections) {
    for (const { key, field } of sectionFields(s as ReportSection, answers)) {
      if (!form.shown(field as DeskField, answers)) continue;
      total += 1;
      if ((answers[key] ?? '').trim()) done += 1;
    }
  }
  return { done, total };
}

/**
 * One form, one section per step, as the crew's phone fills it: a bar in the
 * form's colour across the top (click a step to jump to it), Next checks the
 * step, Done checks the whole form and jumps to anything missing. Wider than
 * the phone: the fields sit two and three to a row.
 */
export function FormWizard({ form, answers, set, onDone, onClose, onRemove }: {
  form: DeskForm;
  answers: Record<string, string>;
  set: (key: string, value: string) => void;
  onDone: () => void;
  onClose: () => void;
  onRemove?: () => void;
}) {
  const { t } = useT();
  const [step, setStep] = useState(0);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const sections = form.sections;
  const section = sections[Math.min(step, sections.length - 1)]!;
  const last = step >= sections.length - 1;
  const tone = form.tone;
  const ink = onTone(tone);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const fieldsOf = (s: DeskSection) => sectionFields(s as ReportSection, answers)
    .filter(({ field }) => form.shown(field as DeskField, answers));
  const stepKeys = (s: DeskSection) => new Set(fieldsOf(s).map((f) => f.key));

  // A fixed answer stops glowing red.
  const stillBad = useMemo(() => {
    if (!bad.size) return bad;
    const now = new Set(form.problems(answers).map((p) => p.key));
    return new Set([...bad].filter((k) => now.has(k)));
  }, [bad, form, answers]);

  const next = () => {
    const keys = stepKeys(section);
    const here = form.problems(answers).filter((p) => keys.has(p.key));
    if (here.length) { setBad(new Set(here.map((p) => p.key))); return; }
    if (!last) { setStep(step + 1); return; }
    const all = form.problems(answers);
    if (all.length) {
      const k = new Set(all.map((p) => p.key));
      setBad(k);
      const first = sections.findIndex((s) => [...stepKeys(s)].some((key) => k.has(key)));
      if (first >= 0) setStep(first);
      return;
    }
    onDone();
  };

  const rows = section.repeat ? rowCount(section as ReportSection, answers) : 1;
  const fields = fieldsOf(section);
  const stepTitle = section.title.startsWith(`${form.code} · `) ? section.title.slice(form.code.length + 3) : section.title;
  const addRow = () => set(rowsKey(section as ReportSection), String(rows + 1));
  const removeRow = () => {
    set(rowsKey(section as ReportSection), String(rows - 1));
    for (const f of fields) if (f.row === rows) set(f.key, '');
  };
  const stepProblems = fields.filter((f) => stillBad.has(f.key)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`${form.code} ${form.title}`}>
      <div className="flex h-full w-full max-w-4xl flex-col overflow-hidden border-border bg-bg shadow-2xl sm:h-[88vh] sm:rounded-2xl sm:border">
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: tone }}>
            <FormIcon name={form.icon} className="h-5 w-5" style={{ color: ink }} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] font-black tracking-widest" style={{ color: tone }}>{form.code}</p>
            <h2 className="truncate text-lg font-bold">{form.title}</h2>
          </div>
          {onRemove ? (
            <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-severity-critical-ink hover:bg-severity-critical/10">
              <Trash2 className="h-4 w-4" /> {' '}{t('Remove')}</button>
          ) : null}
          <button type="button" onClick={onClose} aria-label={t('Close, keep answers')} className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="px-5 pt-4">
          <ol className="flex gap-1.5" aria-label={t('Steps')}>
            {sections.map((s, i) => (
              <li key={s.key ?? s.title} className="flex-1">
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  aria-label={`Step ${i + 1}: ${s.title}`}
                  aria-current={i === step ? 'step' : undefined}
                  className={cn('block h-1.5 w-full rounded-full transition-colors', i > step && 'bg-border')}
                  style={i <= step ? { backgroundColor: tone } : undefined}
                />
              </li>
            ))}
          </ol>
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            {t('Step {value} of {length} ·', { value: step + 1, length: sections.length })}{' '}<span className="text-fg">{stepTitle}</span>
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {Array.from({ length: rows }, (_, i) => i + 1).map((row) => (
            <div key={row} className={cn(section.repeat && 'rounded-lg border border-border bg-bg-card p-4')}>
              {section.repeat ? (
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-black tracking-wide" style={{ color: tone }}>{rowLabel(section as ReportSection, row)}</p>
                  {row === rows && rows > section.repeat.min ? (
                    <button type="button" onClick={removeRow} className="text-xs font-semibold text-severity-critical-ink hover:underline">{t('Remove')}</button>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {fields.filter((f) => (section.repeat ? f.row === row : true)).map(({ key, field }) => (
                  <WizardField
                    key={key}
                    id={key}
                    field={field as DeskField}
                    value={answers[key] ?? ''}
                    tone={tone}
                    invalid={stillBad.has(key)}
                    onChange={(v) => set(key, v)}
                  />
                ))}
              </div>
            </div>
          ))}
          {section.repeat && rows < section.repeat.max ? (
            <button
              type="button"
              onClick={addRow}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm font-bold"
              style={{ borderColor: `${tone}88`, color: tone }}
            >
              <Plus className="h-4 w-4" /> {' '}{t('Add {lowerCase}', { lowerCase: section.repeat.noun.toLowerCase() })}
            </button>
          ) : null}
        </div>

        <footer className="space-y-2 border-t border-border bg-bg-soft px-5 py-4">
          {stepProblems ? (
            <p className="text-center text-xs font-bold text-severity-critical-ink">
              {t('{value}: marked in red.', { value: stepProblems === 1 ? 'One answer needs fixing' : `${stepProblems} answers need fixing` })}</p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
              className="inline-flex h-12 items-center gap-1 rounded-lg border border-border bg-bg-card px-5 text-sm font-bold hover:bg-muted"
            >
              <ChevronLeft className="h-4 w-4" /> {step === 0 ? 'Close' : 'Back'}
            </button>
            <button
              type="button"
              onClick={next}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-lg text-base font-black transition-opacity hover:opacity-90"
              style={{ backgroundColor: tone, color: ink }}
            >
              {last ? <>{t('Done')}{' '}<Check className="h-5 w-5" /></> : <>{t('Next')}{' '}<ChevronRight className="h-5 w-5" /></>}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function WizardField({ id, field, value, tone, invalid, onChange }: {
  id: string; field: DeskField; value: string; tone: string; invalid: boolean; onChange: (v: string) => void;
}) {
  const { t } = useT();
  const label = (
    <span className="text-sm font-medium">
      {field.label}{field.required ? <span className="text-severity-critical-ink"> *</span> : null}
    </span>
  );
  const ring = invalid ? 'border-severity-critical ring-1 ring-severity-critical' : '';
  const wide = field.kind === 'multiline' || field.kind === 'multi';
  const wrap = cn(wide && 'sm:col-span-2 lg:col-span-3', invalid && 'rounded-md bg-severity-critical/5 p-2 -m-2');

  if (field.kind === 'multiline') {
    return (
      <div className={wrap}>
        <label htmlFor={id}>{label}</label>
        <textarea id={id} rows={4} value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)}
          className={cn('mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-sm', ring)} aria-invalid={invalid || undefined} />
      </div>
    );
  }

  if (field.kind === 'flag') {
    const on = value === 'true';
    return (
      <div className={wrap}>
        <button type="button" role="checkbox" aria-checked={on} onClick={() => onChange(on ? 'false' : 'true')}
          className="mt-6 inline-flex items-center gap-2 text-left text-sm font-medium">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border" style={on ? { backgroundColor: tone, borderColor: tone, color: onTone(tone) } : undefined}>
            {on ? <Check className="h-3.5 w-3.5" /> : null}
          </span>
          {field.label}
        </button>
      </div>
    );
  }

  if (field.kind === 'yesno' || field.kind === 'check' || field.kind === 'choice' || field.kind === 'multi') {
    const options = field.kind === 'yesno' ? ['Yes', 'No'] : field.kind === 'check' ? ['OK', 'Fault', 'NIL'] : (field.options ?? []);
    const multi = field.kind === 'multi';
    const picked = multi ? (value ? value.split('; ').filter(Boolean) : []) : (value ? [value] : []);
    const toggle = (o: string) => (multi
      ? onChange((picked.includes(o) ? picked.filter((p) => p !== o) : [...picked, o]).join('; '))
      : onChange(value === o ? '' : o));

    // A long list is a dropdown, not a wall of buttons.
    if (!multi && options.length > 4) {
      return (
        <div className={wrap}>
          <label htmlFor={id}>{label}</label>
          <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(input, ring)} aria-invalid={invalid || undefined}>
            <option value="">{t('Choose…')}</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    }
    if (multi && options.length > 6) {
      return (
        <fieldset className={wrap}>
          <legend>{label}</legend>
          <div className={cn('mt-1 grid max-h-48 gap-1 overflow-y-auto rounded-md border border-border bg-bg-soft p-2 sm:grid-cols-2', ring)}>
            {options.map((o) => {
              const on = picked.includes(o);
              return (
                <button key={o} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(o)}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border" style={on ? { backgroundColor: tone, borderColor: tone, color: onTone(tone) } : undefined}>
                    {on ? <Check className="h-3 w-3" /> : null}
                  </span>
                  {o}
                </button>
              );
            })}
          </div>
        </fieldset>
      );
    }
    return (
      <fieldset className={wrap}>
        <legend>{label}</legend>
        <div className={cn('mt-1 flex flex-wrap gap-1.5 rounded-md', invalid && 'ring-1 ring-severity-critical')}>
          {options.map((o) => {
            const on = picked.includes(o);
            return (
              <button key={o} type="button" aria-pressed={on} onClick={() => toggle(o)}
                className={cn('h-9 rounded-md border px-3 text-sm font-semibold', !on && 'border-border bg-bg-soft text-muted-foreground hover:bg-muted')}
                style={on ? { backgroundColor: tone, borderColor: tone, color: onTone(tone) } : undefined}>
                {o}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }

  const htmlType = field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : field.kind === 'time' ? 'time'
    : field.kind === 'datetime' ? 'datetime-local' : 'text';
  const quick = field.kind === 'date' ? [['Today', today()]] : field.kind === 'time' ? [['Now', now()]]
    : field.kind === 'datetime' ? [['Now', `${today()}T${now()}`]] : [];
  return (
    <div className={wrap}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id}>{label}</label>
        {quick.map(([text, v]) => (
          <button key={text} type="button" onClick={() => onChange(v as string)} className="text-xs font-bold hover:underline" style={{ color: tone }}>
            {text}
          </button>
        ))}
      </div>
      <input id={id} type={htmlType} value={value} placeholder={field.placeholder} min={field.kind === 'number' ? 0 : undefined}
        onChange={(e) => onChange(e.target.value)} className={cn(input, ring)} aria-invalid={invalid || undefined} />
    </div>
  );
}
