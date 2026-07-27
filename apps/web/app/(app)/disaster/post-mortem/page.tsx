import { listPostMortems } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SimpleTable, Tr, Td } from '@/components/simple-table';
import { FormSection, TextField, TextAreaField, SelectField } from '@/components/fields';
import { getSession } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { postMortemAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Post-Mortem Reports · Criticom' };

export default async function PostMortemPage() {
  const { supabase, fullName } = await getSession();
  const reports = await listPostMortems(supabase);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">After-action (post-mortem) reports</h1>
        <p className="text-muted-foreground">Filed at incident close-out — root cause and lessons learned.</p>
      </header>

      <form action={postMortemAction} className="space-y-4">
        <FormSection title="File new post-mortem">
          <TextField name="incident_number" label="Incident number" required />
          <SelectField name="incident_type" label="Disaster type"
            options={['Flood', 'Storm', 'Fire', 'Landslide', 'Building collapse', 'Civil unrest', 'Other']} />
          <TextField name="location" label="Location" />
          <TextField name="start_time" label="Start" type="datetime-local" />
          <TextField name="end_time" label="End" type="datetime-local" />
          <TextField name="reporting_officer" label="Reporting officer" defaultValue={fullName} />
          <TextField name="injuries" label="Injuries" type="number" defaultValue={0} />
          <TextField name="fatalities" label="Fatalities" type="number" defaultValue={0} />
          <TextField name="displaced_people" label="Displaced people" type="number" defaultValue={0} />
          <TextAreaField name="root_cause" label="Root cause" className="sm:col-span-2 lg:col-span-3" />
          <TextAreaField name="lessons_learned" label="Lessons learned" className="sm:col-span-2 lg:col-span-3" />
        </FormSection>
        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          File post-mortem & close incident
        </button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{reports.length} filed</CardTitle>
          <CardDescription>Historical after-action record.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SimpleTable
            headers={['Incident #', 'Type', 'Duration (h)', 'Injuries', 'Fatalities', 'Displaced', 'Officer', 'Filed']}
            empty="No post-mortems filed."
          >
            {reports.map((r) => (
              <Tr key={r.id}>
                <Td className="font-mono">{r.incident_number}</Td>
                <Td>{r.incident_type ?? '—'}</Td>
                <Td className="font-mono">{r.total_duration_hours ?? '—'}</Td>
                <Td className="font-mono">{r.injuries}</Td>
                <Td className="font-mono">{r.fatalities}</Td>
                <Td className="font-mono">{r.displaced_people}</Td>
                <Td>{r.reporting_officer ?? '—'}</Td>
                <Td className="text-muted-foreground">{formatSaTime(r.report_filed_at)}</Td>
              </Tr>
            ))}
          </SimpleTable>
        </CardContent>
      </Card>
    </div>
  );
}
