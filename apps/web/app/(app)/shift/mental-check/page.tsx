import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckField, TextAreaField } from '@/components/fields';
import { mentalCheckAction } from '../actions';

export const metadata = { title: 'Mental Readiness Check · HikTech' };

const CHECKS = [
  { name: 'memory_recall', label: 'Memory recall — I can recall my callsign, unit and standing orders' },
  { name: 'judgment', label: 'Judgment — I can make sound decisions under pressure right now' },
  { name: 'situational_awareness', label: 'Situational awareness — I am fully aware of my surroundings' },
  { name: 'not_under_influence', label: 'I am NOT under the influence of alcohol, medication or other substances' },
  { name: 'anger_check', label: 'Anger check — I am emotionally regulated and fit for public contact' },
  { name: 'reflexes', label: 'Reflexes — my reaction time is normal' },
];

export default function MentalCheckPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Start of shift — mental readiness</h1>
        <p className="text-muted-foreground">
          Step 1 of 3. All six checks must pass before you can select a vehicle.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Self-assessment</CardTitle>
          <CardDescription>Answer honestly — a failed check routes you to your supervisor, not to discipline.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={mentalCheckAction} className="space-y-3">
            {CHECKS.map((c) => (
              <CheckField key={c.name} name={c.name} label={c.label} />
            ))}
            <TextAreaField name="comments" label="Comments (optional)" rows={2} />
            <button type="submit" className="h-10 w-full rounded-md bg-primary text-sm font-semibold">
              Submit readiness check
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
