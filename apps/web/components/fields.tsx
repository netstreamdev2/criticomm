/**
 * Uncontrolled form fields for server-action <form>s.
 * All V4 report forms (metro, fire, PCR, disaster…) are built from these.
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export function TextField({
  label, name, type = 'text', required, defaultValue, placeholder, step, className,
}: {
  label: string; name: string; type?: string; required?: boolean;
  defaultValue?: string | number | null; placeholder?: string; step?: string; className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={name}>{label}{required && <span className="text-severity-critical-ink"> *</span>}</Label>
      <Input
        id={name} name={name} type={type} required={required} step={step}
        defaultValue={defaultValue ?? undefined} placeholder={placeholder} className="mt-1"
      />
    </div>
  );
}

export function TextAreaField({
  label, name, required, defaultValue, placeholder, rows = 3, className,
}: {
  label: string; name: string; required?: boolean;
  defaultValue?: string | null; placeholder?: string; rows?: number; className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={name}>{label}{required && <span className="text-severity-critical-ink"> *</span>}</Label>
      <Textarea
        id={name} name={name} required={required} rows={rows}
        defaultValue={defaultValue ?? undefined} placeholder={placeholder} className="mt-1"
      />
    </div>
  );
}

export function SelectField({
  label, name, options, required, defaultValue, className,
}: {
  label: string; name: string; options: Array<string | { value: string; label: string }>;
  required?: boolean; defaultValue?: string | null; className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={name}>{label}{required && <span className="text-severity-critical-ink"> *</span>}</Label>
      <select
        id={name} name={name} required={required} defaultValue={defaultValue ?? undefined}
        className="mt-1 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm"
      >
        {options.map((o) => {
          const opt = typeof o === 'string' ? { value: o, label: o } : o;
          return <option key={opt.value} value={opt.value}>{opt.label}</option>;
        })}
      </select>
    </div>
  );
}

export function CheckField({
  label, name, defaultChecked, className,
}: {
  label: string; name: string; defaultChecked?: boolean; className?: string;
}) {
  return (
    <label className={cn('flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted', className)}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} value="on" />
      {label}
    </label>
  );
}

/** Section wrapper for the long V4 report forms. */
export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-border bg-bg-card p-5">
      <legend className="px-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}
