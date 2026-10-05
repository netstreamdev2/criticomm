'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DEPARTMENT_NAMES, type Silo } from '@criticom/db';
import { TextField } from '@/components/fields';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/toast';
import { createPersonnelAction } from './actions';

/**
 * One person into the staff register, for someone joining between staff-list
 * imports. Their work email or cellphone is what their invitation will use.
 */
export function AddPersonForm({ departments }: { departments: Silo[] }) {
  const router = useRouter();
  const toast = useToast();
  const form = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = (fd: FormData) => {
    setError(null);
    start(async () => {
      const res = await createPersonnelAction(fd);
      if (!res.ok) { setError(res.error); return; }
      toast.push({ title: `${fd.get('first_name')} ${fd.get('last_name')} added to the register`, tone: 'success', duration: 4000 });
      form.current?.reset();
      router.refresh();
    });
  };

  return (
    <form ref={form} action={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="silo">Department<span className="text-severity-critical-ink"> *</span></Label>
          <select id="silo" name="silo" required defaultValue={departments[0]} className="mt-1 h-10 w-full rounded-md border border-border bg-bg-soft px-3 text-sm">
            {departments.map((d) => <option key={d} value={d}>{DEPARTMENT_NAMES[d]}</option>)}
          </select>
        </div>
        <TextField name="first_name" label="First names" required />
        <TextField name="last_name" label="Surname" required />
        <TextField name="badge_number" label="Badge number" required placeholder="As on their ID card" />
        <TextField name="rank" label="Rank" required />
        <TextField name="station" label="Station" />
        <TextField name="work_email" label="Work email" type="email" placeholder="Their invitation goes here" />
        <TextField name="work_cellphone" label="Work cellphone" type="tel" placeholder="082 123 4567" />
        <TextField name="unit" label="Unit" />
        <TextField name="platoon" label="Platoon" />
        <TextField name="emergency_contact" label="Emergency contact" />
      </div>
      {error ? (
        <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">{error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add to the register'}</Button>
    </form>
  );
}
