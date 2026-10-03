import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getMyAppraisal, listMyResponses } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { periodStart, type ResponseRow } from '@/lib/performance';

type Appraisal = Awaited<ReturnType<typeof getMyAppraisal>>;

/**
 * The signed-in officer's response history for this cycle plus their
 * appraisal, loaded on every visit. Every period (today, month, cycle) is
 * worked out from the one cycle-long list.
 */
export function usePerformance() {
  const { session } = useAuth();
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [appraisal, setAppraisal] = useState<Appraisal | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    const sb = getSupabase();
    // Each part on its own: a failed appraisal must not blank the figures.
    await Promise.all([
      listMyResponses(sb, session.user.id, periodStart('This cycle').toISOString())
        .then((r) => setRows(r as ResponseRow[])).catch(() => {}),
      getMyAppraisal(sb, session.user.id).then(setAppraisal).catch(() => {}),
    ]);
    setLoading(false);
  }, [session]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  return { rows, appraisal, loading, refresh };
}
