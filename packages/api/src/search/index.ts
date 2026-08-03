import type { CriticomClient } from '@criticom/db';

/**
 * Cross-module search (migration 0027).
 *
 * One string in, records out, whatever module they live in. The RPC is
 * SECURITY INVOKER, so results are scoped by RLS to the caller's department —
 * this layer adds no filtering of its own and must not be made to, or the
 * boundary would exist in two places and drift.
 */

export type SearchKind =
  | 'incident'
  | 'person'
  | 'vehicle'
  | 'police-report'
  | 'fire-report'
  | 'security-report';

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  meta: string | null;
  href: string;
  rank: number;
};

export const SEARCH_KIND_LABELS: Record<SearchKind, string> = {
  incident: 'Incident',
  person: 'Personnel',
  vehicle: 'Fleet',
  'police-report': 'Police report',
  'fire-report': 'Fire report',
  'security-report': 'Security report',
};

/**
 * Below this the result set is meaningless — a single character matches most
 * of the database. Enforced client-side so a keystroke does not become a query;
 * the server bounds cost with LIMIT regardless.
 */
export const MIN_SEARCH_LENGTH = 2;

export async function searchEverything(
  client: CriticomClient,
  query: string,
  limit = 24,
): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_SEARCH_LENGTH) return [];

  const { data, error } = await client.rpc('search_everything', {
    p_query: trimmed,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as SearchHit[];
}

/** Group hits by kind, preserving the server's ranking within each group. */
export function groupSearchHits(hits: SearchHit[]): Array<[SearchKind, SearchHit[]]> {
  const groups = new Map<SearchKind, SearchHit[]>();
  for (const hit of hits) {
    const bucket = groups.get(hit.kind);
    if (bucket) bucket.push(hit);
    else groups.set(hit.kind, [hit]);
  }
  return [...groups.entries()];
}
