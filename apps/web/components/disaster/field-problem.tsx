'use client';

import { useT } from '@/components/i18n';
import type { Problem } from '@/lib/disaster-checks';

/** What is wrong with a field, in one short line under it (lib/disaster-checks). */
export function FieldProblem({ problem }: { problem: Problem | null }) {
  const { t } = useT();
  if (!problem) return null;
  return <span role="alert" className="mt-1 block text-xs font-medium text-severity-critical-ink">{t(problem.text, problem.vars)}</span>;
}

/** The field's border when something is wrong with it. */
export const problemBorder = (problem: Problem | null) => (problem ? 'border-severity-critical' : '');
