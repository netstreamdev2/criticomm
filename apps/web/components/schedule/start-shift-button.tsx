'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import { startShiftAction } from '@/app/(app)/roster/mine/actions';
import { useToast } from '@/components/toast';

/** Start shift at the console: a clock-in that checks you in to the shift you are due on. */
export function StartShiftButton() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => {
        const res = await startShiftAction();
        if (res.error) toast.push({ title: 'Not started', body: res.error, tone: 'critical' });
        else { toast.push({ title: res.message ?? 'Started', tone: 'success' }); router.refresh(); }
      })}
      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
    >
      <Play className="h-4 w-4" /> {pending ? 'Starting…' : 'Start shift'}
    </button>
  );
}
