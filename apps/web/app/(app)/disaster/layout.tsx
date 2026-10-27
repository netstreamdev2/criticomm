import type * as React from 'react';
import { Suspense } from 'react';
import { getGuideStatus } from '@criticom/api';
import { CritiTour } from '@/components/disaster/criti-tour';
import { DisasterFrame } from '@/components/disaster/frame';
import { getSession } from '@/lib/session';

/**
 * Every Disaster screen opens with the JOC's state, the warnings and the
 * emergency number; Criti offers its tour to anyone who has not taken it
 * or turned it off (0121).
 */
export default async function DisasterLayout({ children }: { children: React.ReactNode }) {
  const { supabase } = await getSession();
  const tour = await getGuideStatus(supabase, 'disaster.tour');
  return (
    <div className="space-y-4">
      <Suspense fallback={null}><DisasterFrame /></Suspense>
      {children}
      <Suspense fallback={null}><CritiTour status={tour} /></Suspense>
    </div>
  );
}
