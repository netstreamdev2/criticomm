import { DEPARTMENT_NAMES } from '@criticom/db';
import { tx } from '@criticom/db/i18n';
import { getOperationsSheet, listSectionDetails, saDay } from '@criticom/api';
import { OfficeHeader } from '@/components/office/office-header';
import { ox } from '@/components/office/styles';
import { InfoTip } from '@/components/ui/info-tip';
import { openModule } from '@/lib/office';
import { cn } from '@/lib/utils';
import { requestT } from '@/lib/i18n';
import { PrintButton } from '../../roster/duty-sheet/print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Duty Sheet · HikTech' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const hm = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '';
const oracleDate = (day: string) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`)).toUpperCase().replace(/ /g, '/');

/**
 * Duties for Operation (Oracle DCPDUTY): the daily sheet for parade. Rank,
 * force, W/E, service number, time and duty, then on, off and overtime with a
 * space to sign. A member who signed on or off in the app has the time filled.
 */
export default async function DutyOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; section?: string; date?: string; op?: string; by?: string }>;
}) {
  const { t } = await requestT();
  const p = await searchParams;
  const ctx = await openModule('DUTR', p.dept);
  const { supabase, target, fullName } = ctx;
  const date = DAY.test(p.date ?? '') ? p.date! : saDay();
  const sections = await listSectionDetails(supabase, target);
  const section = sections.find((s) => s.code === p.section) ?? null;
  const sheet = await getOperationsSheet(supabase, { silo: target, date, sector: section?.code ?? null });
  const op = sheet.operations.find((o) => o.code === p.op) ?? sheet.operations[0] ?? null;
  const runBy = (p.by?.trim() || fullName).toUpperCase();
  const dept = (DEPARTMENT_NAMES[target] ?? target).toUpperCase();
  const stamp = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());

  return (
    <div className="space-y-4">
      <OfficeHeader title={tx('Duty Sheet')}
        steps={[tx('Choose the day and the section.'), tx('Press Print. Each call sign is listed with its members, vehicle and area.'), tx('On parade, members sign on, sign off and sign for overtime on the paper.')]} info={tx('The daily duty sheet for parade. Choose the section, the date and the operation, then print. Times members signed on or off in the app fill in.')}
        target={target} global={ctx.global} canEdit={ctx.canEdit} path="/modules/duty-operations" />

      <section className={cn(ox.card, 'no-print')}>
        <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Report parameters')}</h2></div>
        <form method="get" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.2fr_1fr_auto_auto] lg:items-end">
          {ctx.global ? <input type="hidden" name="dept" value={target} /> : null}
          <label><span className={ox.label}>{t('Section')}</span>
            <select name="section" defaultValue={section?.code ?? ''} className={ox.input}>
              <option value="">{t('Whole department')}</option>
              {sections.map((s) => <option key={s.id} value={s.code}>{s.name}</option>)}
            </select></label>
          <label><span className={ox.label}>{t('Duty date')}</span>
            <input name="date" type="date" defaultValue={date} className={ox.input} /></label>
          <label><span className={ox.label}>{t('Operation')} <InfoTip text={t('The heading the sheet prints under. The list is kept in Configuration.')} /></span>
            <select name="op" defaultValue={op?.code ?? ''} className={ox.input}>
              {sheet.operations.map((o) => <option key={o.id} value={o.code ?? ''}>{o.code} — {o.name}</option>)}
            </select></label>
          <label><span className={ox.label}>{t('Run by')}</span>
            <input name="by" defaultValue={p.by ?? fullName} className={ox.input} /></label>
          <button type="submit" className={ox.primary}>{t('Generate report')}</button>
          <PrintButton />
        </form>
      </section>

      <div className="overflow-x-auto rounded-lg border border-border bg-white p-6 text-black print:overflow-visible print:border-0 print:p-0" id="duty-sheet">
        <div className="flex flex-wrap justify-between gap-2 border-b-2 border-black pb-2 text-xs">
          <div>
            <p className="text-lg font-bold">{dept}</p>
            <p><strong>{t('Duty For:')}</strong> {oracleDate(date)} &nbsp; {section ? section.name.toUpperCase() : t('ALL SECTIONS')}</p>
            <p><strong>{t('Operation')}</strong> &nbsp; DCPDUTY &nbsp; {op ? `${op.code} ${(op.name ?? '').toUpperCase()}` : ''}</p>
          </div>
          <div className="text-right">
            <p><strong>{t('Report:')}</strong> {t('Duties for Operation')}</p>
            <p><strong>{t('Run by:')}</strong> {runBy}</p>
            <p><strong>{t('Report date:')}</strong> {stamp}</p>
            <p><strong>{t('Members:')}</strong> {sheet.lines.length}</p>
          </div>
        </div>

        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-black text-left">
              <th className="px-1.5 py-1">{t('Rank')}</th>
              <th className="px-1.5 py-1">{t('Force')}</th>
              <th className="px-1.5 py-1">{t('W/E')}</th>
              <th className="px-1.5 py-1">{t('Service no.')}</th>
              <th className="px-1.5 py-1">{t('Time')}</th>
              <th className="px-1.5 py-1">{t('Name')}</th>
              <th className="px-1.5 py-1">{t('Duty / Special instructions')}</th>
              <th className="border-l border-gray-400 px-1.5 py-1">{t('O/N Time')}</th>
              <th className="px-1.5 py-1">{t('O/N Sign')}</th>
              <th className="border-l border-gray-400 px-1.5 py-1">{t('OFF Time')}</th>
              <th className="px-1.5 py-1">{t('OFF Sign')}</th>
              <th className="border-l border-gray-400 px-1.5 py-1">{t('OT Time')}</th>
              <th className="px-1.5 py-1">{t('OT Sign')}</th>
            </tr>
          </thead>
          <tbody>
            {sheet.lines.map((l) => {
              const away = l.status !== 'Present';
              return (
                <tr key={l.id} className={cn('border-b border-gray-300', away && 'text-gray-500')}>
                  <td className="px-1.5 py-1.5">{l.rank ?? ''}</td>
                  <td className="px-1.5 py-1.5">{l.force ?? ''}</td>
                  <td className="px-1.5 py-1.5">{l.weekend ?? ''}</td>
                  <td className="px-1.5 py-1.5">{l.serviceNo ?? ''}</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5">{hm(l.start)}–{hm(l.end)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1.5 font-semibold">{l.name.toUpperCase()}</td>
                  <td className="px-1.5 py-1.5">{away ? <strong>{l.status.toUpperCase()} · </strong> : null}{l.duty}</td>
                  <td className="border-l border-gray-300 px-1.5 py-1.5">{hm(l.signedOn)}</td>
                  <td className="w-16 px-1.5 py-1.5">{l.signedOn ? <span className="text-[9px] text-gray-500">{t('app')}</span> : null}</td>
                  <td className="border-l border-gray-300 px-1.5 py-1.5">{hm(l.signedOff)}</td>
                  <td className="w-16 px-1.5 py-1.5">{l.signedOff ? <span className="text-[9px] text-gray-500">{t('app')}</span> : null}</td>
                  <td className="w-12 border-l border-gray-300 px-1.5 py-1.5" />
                  <td className="w-16 px-1.5 py-1.5" />
                </tr>
              );
            })}
            {sheet.lines.length === 0 ? (
              <tr><td colSpan={13} className="py-8 text-center text-gray-500">{t('Nobody is on duty for this section on this date.')}</td></tr>
            ) : null}
          </tbody>
        </table>

        {sheet.onLeave.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-bold uppercase">{t('On leave ({length})', { length: sheet.onLeave.length })}</p>
            <ul className="mt-1 grid gap-x-6 text-[11px] sm:grid-cols-2">
              {sheet.onLeave.map((l, i) => (
                <li key={`${l.name}-${i}`}>{l.name.toUpperCase()} — {l.absence} ({l.from} → {l.to})</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-10 flex justify-between text-xs">
          <div className="w-56 border-t border-black pt-1">{t('Compiled by: {fullName}', { fullName: runBy })}</div>
          <div className="w-56 border-t border-black pt-1">{t('Officer in charge')}</div>
        </div>
      </div>
    </div>
  );
}
