import { redirect } from 'next/navigation';
import { getDutySheet } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession, siloFilter } from '@/lib/session';
import { formatSaTime } from '@/lib/utils';
import { PrintButton } from './print-button';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Duty Sheet · HikTech' };

const SILOS: Silo[] = ['MetroPolice', 'MetroFire', 'Medical', 'EthekwiniDisaster'];

export default async function DutySheetPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; dept?: string; section?: string; operation?: string }>;
}) {
  // Moved to Duty Operations in the duty office (0085).
  redirect('/modules/duty-operations');
  const { t } = await requestT();
  const { supabase, silo, fullName } = await getSession();
  const params = await searchParams;
  const date = params.date ?? new Date().toISOString().slice(0, 10);
  const dept = (params.dept as Silo) ?? (siloFilter(silo) ?? 'MetroPolice');
  const section = params.section ?? 'BYLAWS UNIT A';
  const operation = params.operation ?? 'X1 — Bylaws Enforcement';

  const sheet = await getDutySheet(supabase, { silo: dept, date });

  return (
    <div className="space-y-4">
      {/* Controls — hidden on print */}
      <form method="get" className="no-print flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="date">{t('Date')}</label>
          <input id="date" name="date" type="date" defaultValue={date} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="dept">{t('Department')}</label>
          <select id="dept" name="dept" defaultValue={dept} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
            {SILOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="section">{t('Section')}</label>
          <input id="section" name="section" defaultValue={section} className="mt-1 block h-10 rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground" htmlFor="operation">{t('Operation')}</label>
          <input id="operation" name="operation" defaultValue={operation} className="mt-1 block h-10 w-64 rounded-md border border-border bg-bg-soft px-3 text-sm" />
        </div>
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-sm font-semibold">{t('Generate')}</button>
        <PrintButton />
      </form>

      {/* The printable sheet */}
      <div className="rounded-lg border border-border bg-white p-6 text-black print:border-0" id="duty-sheet">
        <div className="border-b-2 border-black pb-3">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold">{t('DUTY SHEET — {dept}', { dept })}</h1>
              <p className="text-sm">{t('DCPDUTY Ver 3 · {upperCase}', { upperCase: operation.toUpperCase() })}</p>
            </div>
            <div className="text-right text-sm">
              <p><strong>{t('Date:')}</strong> {date}</p>
              <p><strong>{t('Section:')}</strong> {section}</p>
              <p><strong>{t('Run by:')}</strong> {fullName}</p>
              <p><strong>{t('Total members:')}</strong> {sheet.totalMembers}</p>
            </div>
          </div>
        </div>

        {sheet.shifts.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">{t('No members rostered for this date.')}</p>
        )}

        {sheet.shifts.map((block) => (
          <div key={block.shiftName} className="mt-4">
            <h2 className="bg-gray-100 px-2 py-1 text-sm font-bold uppercase">
              {block.shiftName}
              {block.start ? ` · ${formatSaTime(block.start)}` : ''}{block.end ? ` – ${formatSaTime(block.end)}` : ''}
              {block.activityType ? ` · ${block.activityType}` : ''}
            </h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-black text-left">
                  <th className="px-2 py-1">{t('Rank')}</th>
                  <th className="px-2 py-1">{t('Name')}</th>
                  <th className="px-2 py-1">{t('Force')}</th>
                  <th className="px-2 py-1">{t('Service no.')}</th>
                  <th className="px-2 py-1">{t('Call sign')}</th>
                  <th className="px-2 py-1">{t('Vehicle')}</th>
                  <th className="px-2 py-1">{t('Sector')}</th>
                  <th className="px-2 py-1">{t('Duty')}</th>
                  <th className="px-2 py-1">{t('On')}</th>
                  <th className="px-2 py-1">{t('Off')}</th>
                  <th className="px-2 py-1">O/T</th>
                </tr>
              </thead>
              <tbody>
                {block.members.map((m) => (
                  <tr key={m.id} className="border-b border-gray-300">
                    <td className="px-2 py-1">{(m as { rank?: string }).rank ?? ''}</td>
                    <td className="px-2 py-1 font-medium">{m.user_name}</td>
                    <td className="px-2 py-1" />
                    <td className="px-2 py-1">{m.badge_number ?? ''}</td>
                    <td className="px-2 py-1">{m.call_sign ?? ''}</td>
                    <td className="px-2 py-1">{m.vehicle ?? ''}</td>
                    <td className="px-2 py-1">{m.sector ?? ''}</td>
                    <td className="px-2 py-1">{m.activity_type}{m.special_instructions ? ` — ${m.special_instructions}` : ''}</td>
                    <td className="border-l border-gray-300 px-2 py-1" />
                    <td className="border-l border-gray-300 px-2 py-1" />
                    <td className="border-l border-gray-300 px-2 py-1" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {sheet.specialEvents.length > 0 && (
          <div className="mt-4">
            <h2 className="text-sm font-bold uppercase">{t('Special events / operations')}</h2>
            <ul className="ml-4 list-disc text-xs">
              {sheet.specialEvents.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}

        {sheet.onLeave.length > 0 && (
          <div className="mt-4">
            <h2 className="text-sm font-bold uppercase">{t('On leave ({length})', { length: sheet.onLeave.length })}</h2>
            <table className="w-full border-collapse text-xs">
              <tbody>
                {sheet.onLeave.map((l) => (
                  <tr key={l.id} className="border-b border-gray-300">
                    <td className="px-2 py-1">{l.service_no ?? ''}</td>
                    <td className="px-2 py-1">{l.absence ?? 'Leave'}</td>
                    <td className="px-2 py-1">{l.eff_from} → {l.eff_to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-8 flex justify-between text-xs">
          <div className="border-t border-black pt-1">{t('Compiled by: {fullName}', { fullName })}</div>
          <div className="border-t border-black pt-1">{t('Approved by: __________________')}</div>
        </div>
      </div>
    </div>
  );
}
