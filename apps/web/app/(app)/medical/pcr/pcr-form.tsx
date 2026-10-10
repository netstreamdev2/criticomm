/**
 * The ePCR on the console: the same sections and questions as the phone,
 * from the shared spec. Used by /medical/pcr/new and /medical/pcr/[id]/edit.
 */
import { PCR_SECTIONS, PCR_SIGNATURES, type PcrField } from '@criticom/db/pcr';
import { FormSection, TextField, TextAreaField, SelectField, CheckField } from '@/components/fields';
import { SignaturePad } from '@/components/signature-pad';

export type PcrDefaults = Record<string, string>;

function Field({ f, d }: { f: PcrField; d: PcrDefaults }) {
  const v = d[f.key] ?? '';
  const label = f.label;
  const wide = f.kind === 'multiline' ? 'sm:col-span-2 lg:col-span-3' : undefined;
  switch (f.kind) {
    case 'multiline':
      return <TextAreaField name={f.key} label={label} required={f.required} defaultValue={v} placeholder={f.placeholder} className={wide} />;
    case 'select':
      return <SelectField name={f.key} label={label} required={f.required} options={[{ value: '', label: '-- Select --' }, ...(f.options ?? []).map((o) => ({ value: o, label: o }))]} defaultValue={v} />;
    case 'yesno':
      return <SelectField name={f.key} label={label} options={['No', 'Yes']} defaultValue={v || 'No'} />;
    case 'flag':
      return <CheckField name={f.key} label={label} defaultChecked={v === 'true'} />;
    case 'count':
      return <TextField name={f.key} label={label} type="number" defaultValue={v} placeholder={f.placeholder} />;
    case 'date':
      return <TextField name={f.key} label={label} type="date" defaultValue={v} />;
    case 'time':
      return <TextField name={f.key} label={label} type="time" defaultValue={v} />;
    default:
      return <TextField name={f.key} label={label} required={f.required} defaultValue={v} placeholder={f.placeholder} />;
  }
}

export function PcrFormSections({ d = {}, timeOnScene }: { d?: PcrDefaults; timeOnScene?: string | null }) {
  return (
    <>
      {PCR_SECTIONS.map((s) => (
        <FormSection key={s.id} title={s.title}>
          {s.id === 'scene' && timeOnScene ? (
            <div>
              <p className="text-sm font-medium">Time on Scene</p>
              <p className="mt-2 text-sm">{timeOnScene}</p>
            </div>
          ) : null}
          {s.fields.map((f) => (
            f.group
              ? (
                <div key={f.key} className="contents">
                  <p className="pt-2 text-xs font-bold uppercase tracking-wider text-accent sm:col-span-2 lg:col-span-3">{f.group}</p>
                  <Field f={f} d={d} />
                </div>
              )
              : <Field key={f.key} f={f} d={d} />
          ))}
        </FormSection>
      ))}

      <FormSection title="Sign Off & Handover">
        {PCR_SIGNATURES.map((s) => (
          <SignaturePad key={s.key} name={s.key} label={s.required ? `${s.label} *` : s.label} defaultValue={d[s.key] || null} />
        ))}
      </FormSection>

      <FormSection title="Post-Incident Vehicle Status">
        <CheckField name="requires_cleaning" label="Does the vehicle require cleaning?" defaultChecked={d.requires_cleaning === 'true'} />
      </FormSection>
    </>
  );
}
