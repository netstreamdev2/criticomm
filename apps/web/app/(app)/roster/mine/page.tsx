import Link from 'next/link';
import { Umbrella } from 'lucide-react';
import {
  addDays, getMyLines, getMyMonth, getMyShiftNow, getWhosOn, listSwapOptions, listSwaps, monthLabel, saDay, shiftMonth,
} from '@criticom/api';
import { RESPONDER_ROLES, type Silo } from '@criticom/db';
import { DeptBadge } from '@/components/dept-badge';
import { getSession } from '@/lib/session';
import { getBrandingMap } from '@/lib/branding';
import { MySchedule } from './mine-client';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My Schedule · HikTech' };

/**
 * "When am I working?" for everyone: the shift now or next (and Start shift
 * for desk staff), the month, who is on today, and swaps. Field crews start
 * their shift in the app; that checks them in.
 */
export default async function MySchedulePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { t } = await requestT();
  const { supabase, userId, silo, fullName, role } = await getSession();
  const { m } = await searchParams;
  const today = saDay();
  const month = /^\d{4}-\d{2}$/.test(m ?? '') ? m! : today.slice(0, 7);

  const [mine, now, whosOn, swaps, options, ahead, branding] = await Promise.all([
    getMyMonth(supabase, { userId, silo: silo as Silo, month }),
    getMyShiftNow(supabase, userId).catch(() => null),
    getWhosOn(supabase, { silo: silo as Silo, day: today }).catch(() => []),
    listSwaps(supabase).catch(() => []),
    listSwapOptions(supabase, { silo: silo as Silo, userId, from: today, to: addDays(today, 45) }).catch(() => []),
    getMyLines(supabase, { userId, from: today, to: addDays(today, 45) }).catch(() => []),
    getBrandingMap(),
  ]);
  const dept = branding[silo as Silo];

  return (
    <div className="space-y-6">
      <header
        className="flex flex-wrap items-center gap-4 overflow-hidden rounded-2xl border border-border p-5"
        style={{ background: `linear-gradient(100deg, ${dept.primary_color}1f, transparent 65%)` }}
      >
        <DeptBadge branding={dept} logoUrl={dept.logoUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{t('My schedule')}</h1>
          <p className="text-sm text-muted-foreground">{fullName} · {dept.short_name}</p>
        </div>
        <Link href="/leave" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted">
          <Umbrella className="h-4 w-4" /> {' '}{t('Leave')}</Link>
      </header>

      <MySchedule
        userId={userId}
        today={today}
        month={month}
        monthName={monthLabel(month)}
        prevHref={`/roster/mine?m=${shiftMonth(month, -1)}`}
        nextHref={`/roster/mine?m=${shiftMonth(month, 1)}`}
        data={mine}
        now={now}
        whosOn={whosOn}
        swaps={swaps}
        options={options}
        ahead={ahead}
        startsAtConsole={!RESPONDER_ROLES.includes(role)}
      />
    </div>
  );
}
