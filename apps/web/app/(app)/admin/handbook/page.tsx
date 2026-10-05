import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BookOpen } from 'lucide-react';
import { ADMIN_ROLES } from '@criticom/db';
import { HANDBOOK } from '@/lib/handbook';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Handbook · HikTech' };

/**
 * The administrators' handbook: how the platform is meant to work, written
 * once for eThekwini's administrators and the build team alike.
 */
export default async function HandbookPage() {
  const { role } = await getSession();
  if (!ADMIN_ROLES.includes(role)) redirect('/dashboard');

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-fg">← Admin</Link>
        <h1 className="text-2xl font-bold">Handbook</h1>
        <p className="max-w-2xl text-muted-foreground">
          How HikTech is designed to work, agreed between eThekwini and the build team. Visible to
          administrators only.
        </p>
      </header>

      <ul className="grid gap-4 md:grid-cols-2">
        {HANDBOOK.map((page) => (
          <li key={page.slug}>
            {/* A full page of its own, so a plain link rather than client navigation. */}
            <a
              href={`/admin/handbook/${page.slug}`}
              className="flex h-full flex-col gap-2 rounded-xl border border-border bg-bg-card p-5 transition hover:border-primary/60"
            >
              <span className="flex items-center gap-2 text-lg font-semibold">
                <BookOpen className="h-5 w-5 text-primary" aria-hidden /> {page.title}
              </span>
              <span className="text-sm text-muted-foreground">{page.summary}</span>
              <span className="mt-auto text-xs text-muted-foreground">
                {page.audience} · updated {new Date(page.updated).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
