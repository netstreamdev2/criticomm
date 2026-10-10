import Link from 'next/link';
import { Check, Circle, Smartphone } from 'lucide-react';
import { getMyPersonnel, getShiftGateProgress } from '@criticom/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Start of Shift · HikTech' };

/** What each department inspects before going on duty. */
const VEHICLE_STEP: Record<string, string> = {
  MetroPolice: 'Vehicle inspection (DMPS 187(c)) and signature',
  Ethekwini: 'Vehicle inspection (DMPS 187(c)) and signature',
  MetroFire: 'Appliance and fire equipment checks, and signature',
  Medical: 'Ambulance checks, stock and cleaning',
};

/**
 * Start of shift on the console.
 *
 * The start of shift is done in the HikTech Responder app: readiness, the
 * vehicle inspection with a signature, then the firearm and bodycam for
 * Metro Police. The database will not put an officer on duty without all of
 * it. The console used to carry an older three-step form whose vehicle check
 * the duty gate no longer accepts, so it dead-ended with an error and left a
 * vehicle reserved. This page shows where the officer is instead.
 */
export default async function StartOfShiftPage() {
  const { supabase, userId, silo } = await getSession();
  const [progress, me] = await Promise.all([
    getShiftGateProgress(supabase).catch(() => null),
    getMyPersonnel(supabase, userId).catch(() => null),
  ]);

  const steps = progress ? [
    { label: 'Readiness check', done: progress.readiness },
    { label: VEHICLE_STEP[silo] ?? 'Vehicle inspection and signature', done: progress.vehicle },
    ...(progress.requiresFirearm ? [{ label: 'Firearm booked out, or none declared', done: progress.firearm }] : []),
    ...(progress.requiresBodycam ? [{ label: 'Bodycam booked out, or none declared', done: progress.bodycam }] : []),
    { label: 'On duty', done: Boolean(me?.is_on_duty) },
  ] : [];
  const cleared = steps.length > 0 && steps.every((s) => s.done);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Start of shift</h1>
        <p className="text-muted-foreground">Done in the HikTech Responder app. This page shows how far you are today.</p>
      </header>

      <Card>
        <CardContent className="flex items-start gap-3 p-4 text-sm">
          <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
          <p className="text-muted-foreground">
            Open the app and go to <strong className="text-fg">Shift</strong>. Each step is saved as you finish it,
            so you can stop and pick up where you left off. Your supervisor sees the result on Today&apos;s shift.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{cleared ? 'Cleared and on duty' : 'Today'}</CardTitle>
          <CardDescription>
            {!me ? 'No personnel record is linked to your account. Ask your supervisor to link it before you start.'
              : !progress ? 'The shift checks could not be read just now. Try again in a moment.'
              : cleared ? 'Calls sent to your department reach you in the app.'
              : 'Calls reach you once every step is done.'}
          </CardDescription>
        </CardHeader>
        {steps.length > 0 ? (
          <CardContent>
            <ol className="space-y-2">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-3 rounded-lg border border-border bg-bg-soft px-3 py-2.5 text-sm">
                  {s.done
                    ? <Check className="h-4 w-4 shrink-0 text-severity-low-ink" aria-hidden />
                    : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className={s.done ? 'font-medium' : 'text-muted-foreground'}>{s.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{s.done ? 'Done' : 'To do in the app'}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        ) : null}
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link href="/responder" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold">My calls</Link>
        <Link href="/roster/mine" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">My schedule</Link>
      </div>
    </div>
  );
}
