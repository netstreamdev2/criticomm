import { PcrFormSections } from '../pcr-form';
import { createPcrAction } from '../../actions';

export const metadata = { title: 'New PCR · Criticom' };

export default function NewPcrPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">New patient care report</h1>
        <p className="text-muted-foreground">
          Full V4 Paramedic PCR — demographics, vitals, assessment, interventions, transport and inventory.
        </p>
      </header>

      <form action={createPcrAction} className="space-y-4">
        <PcrFormSections />
        <button type="submit" className="h-11 w-full rounded-md bg-primary text-sm font-semibold">
          Submit PCR
        </button>
      </form>
    </div>
  );
}
