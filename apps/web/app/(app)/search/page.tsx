import Link from 'next/link';
import { requireFeaturePage } from '@/lib/features';
import { Search } from 'lucide-react';
import { groupSearchHits, searchEverything, MIN_SEARCH_LENGTH, SEARCH_KIND_LABELS } from '@criticom/api';
import { Card, CardContent } from '@/components/ui/card';
import { getServerSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Search · Criticom' };

/**
 * The full-page counterpart to ⌘K.
 *
 * The palette is for the operator who knows what they are after and wants it in
 * two keystrokes. This is for the other cases: a result set worth reading
 * through, a search someone wants to bookmark or paste to a colleague, and
 * anyone not working keyboard-first. Same RPC, same RLS, more room.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireFeaturePage('web.search');
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const supabase = await getServerSupabase();

  const hits = query.length >= MIN_SEARCH_LENGTH
    ? await searchEverything(supabase, query, 50).catch(() => [])
    : [];
  const grouped = groupSearchHits(hits);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Search</h1>
        <p className="text-muted-foreground">
          Incidents, personnel, fleet and reports — everything your department can see.
        </p>
      </header>

      {/* A GET form, so the query lives in the URL and the result is shareable. */}
      <form action="/search" method="get">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-card px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            name="q"
            defaultValue={query}
            placeholder="Incident number, plate, badge, surname, case number…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="my-2 inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground"
          >
            Search
          </button>
        </div>
      </form>

      {query.length > 0 && query.length < MIN_SEARCH_LENGTH ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Type at least {MIN_SEARCH_LENGTH} characters — a single character matches most of the
            database and tells you nothing.
          </CardContent>
        </Card>
      ) : null}

      {query.length >= MIN_SEARCH_LENGTH && hits.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nothing matches &ldquo;{query}&rdquo;. Partial identifiers work — try fewer characters,
            or the surname on its own.
          </CardContent>
        </Card>
      ) : null}

      {grouped.map(([kind, group]) => (
        <section key={kind} className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            {SEARCH_KIND_LABELS[kind]}{' '}
            <span className="font-normal tabular-nums">({group.length})</span>
          </h2>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {group.map((hit) => (
                  <li key={`${hit.kind}:${hit.id}`}>
                    <Link
                      href={hit.href}
                      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-muted"
                    >
                      <span className="font-medium">{hit.title}</span>
                      {hit.subtitle ? (
                        <span className="text-sm text-muted-foreground">{hit.subtitle}</span>
                      ) : null}
                      {hit.meta ? (
                        <span className="ml-auto text-xs text-muted-foreground">{hit.meta}</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}
