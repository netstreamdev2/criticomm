import { FormSection, TextField, TextAreaField, SelectField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { createFirearmAction } from '../../actions';

export const metadata = { title: 'Issue Firearm · Criticom' };

export default async function NewFirearmPage() {
  const { fullName } = await getSession();
  const now = new Date();
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const end = new Date(now.getTime() + 12 * 3600 * 1000);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Firearm authorization</h1>
        <p className="text-muted-foreground">Issue register entry — V4 FirearmChecklist parity.</p>
      </header>

      <form action={createFirearmAction} className="space-y-4">
        <FormSection title="Employee">
          <TextField name="employee_name" label="Employee name" required />
          <TextField name="company_number" label="Company / force number" />
          <TextField name="id_number" label="ID number" required />
          <TextField name="posted_location" label="Posted location" />
        </FormSection>

        <FormSection title="Firearm">
          <TextField name="form_number" label="Form number" placeholder="Auto-generated if blank" />
          <TextField name="firearm_number" label="Firearm serial number" required />
          <TextField name="make" label="Make / model" />
          <TextField name="rounds_ammunition" label="Rounds issued" type="number" defaultValue={15} required />
          <SelectField name="chamber_status" label="Chamber status" options={['Cleared', 'Loaded', 'Unknown']} defaultValue="Cleared" />
        </FormSection>

        <FormSection title="Authorization window">
          <TextField name="from_date" label="From" type="datetime-local" defaultValue={local(now)} required />
          <TextField name="to_date" label="To" type="datetime-local" defaultValue={local(end)} required />
          <TextField name="issued_by" label="Issued by" defaultValue={fullName} />
          <TextAreaField name="notes" label="Notes" className="sm:col-span-2 lg:col-span-3" />
        </FormSection>

        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          Issue firearm
        </button>
      </form>
    </div>
  );
}
