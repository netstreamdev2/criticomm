import { addDays, listAvailableStaff, listCallSigns, listDutyRecords, listSectionDetails, saDay } from '@criticom/api';
import { tx } from '@criticom/db/i18n';
import { OfficeHeader } from '@/components/office/office-header';
import { ox } from '@/components/office/styles';
import { InfoTip } from '@/components/ui/info-tip';
import { openModule } from '@/lib/office';
import { cn } from '@/lib/utils';
import { requestT } from '@/lib/i18n';
import { AssignWizard } from './assign-wizard';
import { EditDuty } from './edit-duty';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Duty Maintenance · HikTech' };

const saStamp = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '';
const saHm = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) : '';

/** Duty Maintenance (Oracle DCPDUTM): the call sign's history, the assign wizard, and every duty record. */
export default async function DutyMaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; sign?: string; q?: string; section?: string }>;
}) {
  const { t } = await requestT();
  const p = await searchParams;
  const ctx = await openModule('DUTM', p.dept);
  const { supabase, target } = ctx;
  const today = saDay();
  const [signs, sections, records, history, staff] = await Promise.all([
    listCallSigns(supabase, { silo: target }),
    listSectionDetails(supabase, target),
    listDutyRecords(supabase, { silo: target, search: p.q, sector: p.section || null, limit: 100 }),
    p.sign ? listDutyRecords(supabase, { silo: target, postId: p.sign, limit: 60 }) : Promise.resolve([]),
    listAvailableStaff(supabase, { silo: target, from: today, to: addDays(today, 30) }),
  ]);
  const chosen = signs.find((s) => s.id === p.sign) ?? null;
  const signList = signs.map((s) => ({ id: s.id, callSign: s.call_sign ?? s.name }));
  const people = staff.map((s) => ({ userId: s.userId, label: `${s.badge} — ${s.name}` }));
  const now = Date.now();

  return (
    <div className="space-y-4">
      <OfficeHeader title={tx('Duty Maintenance')} info={tx('See who worked a call sign and when, book a single duty, or change one. A duty that has started keeps its member and hours.')}
        target={target} global={ctx.global} canEdit={ctx.canEdit} path="/modules/duty-maintenance" />

      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <section className={ox.card}>
          <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Call sign history')}</h2></div>
          <form method="get" className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
            {ctx.global ? <input type="hidden" name="dept" value={target} /> : null}
            <select name="sign" defaultValue={p.sign ?? ''} className={cn(ox.input, 'w-auto min-w-[16rem]')} aria-label={t('Call sign')}>
              <option value="">{t('Choose a call sign…')}</option>
              {signs.map((s) => <option key={s.id} value={s.id}>{s.call_sign}{s.description ? ` — ${s.description}` : ''}</option>)}
            </select>
            <button type="submit" className={ox.secondary}>{t('Show')}</button>
          </form>
          <div className="max-h-[22rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-bg-card"><tr>
                <th className={ox.th}>{t('Call sign')}</th><th className={ox.th}>{t('Duty from')}</th><th className={ox.th}>{t('Duty to')}</th>
                <th className={ox.th}>{t('Section')}</th><th className={ox.th}>{t('Rank / Force / Staff')}</th>
              </tr></thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} className={ox.row}>
                    <td className={cn(ox.td, 'font-mono font-bold')}>{r.call_sign}</td>
                    <td className={cn(ox.td, 'font-mono')}>{saStamp(r.start_at)}</td>
                    <td className={cn(ox.td, 'font-mono')}>{saStamp(r.end_at)}</td>
                    <td className={ox.td}>{r.sector ?? ''}</td>
                    <td className={ox.td}>{[r.rank, r.force, r.badge_number].filter(Boolean).join(' / ')} {r.user_name}</td>
                  </tr>
                ))}
                {chosen && history.length === 0 ? <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">{t('No duties on this call sign yet.')}</td></tr> : null}
                {!chosen ? <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">{t('Choose a call sign to see who worked it.')}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className={ox.card}>
          <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Assign / Update Duty')} <InfoTip text={t('Book one member on one call sign for a date range, with its own hours if needed.')} /></h2></div>
          {ctx.canEdit && ctx.modules.DUTA === 'Edit' ? (
            <AssignWizard signs={signs.map((s) => ({ id: s.id, callSign: s.call_sign ?? s.name, sectionId: s.section_id, start: s.start_time?.slice(0, 5) ?? '', stop: s.stop_time?.slice(0, 5) ?? '' }))}
              sections={sections.map((s) => ({ id: s.id, code: s.code, name: s.name }))} staff={staff} today={today} />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t('Booking needs Duty Allocation access.')}</p>
          )}
        </section>
      </div>

      <section className={ox.card}>
        <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('All duty records')}</h2></div>
        <form method="get" className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
          {ctx.global ? <input type="hidden" name="dept" value={target} /> : null}
          {p.sign ? <input type="hidden" name="sign" value={p.sign} /> : null}
          <input name="q" defaultValue={p.q} placeholder={t('Search call sign or staff…')} className={cn(ox.input, 'w-56')} />
          <select name="section" defaultValue={p.section ?? ''} className={cn(ox.input, 'w-52')} aria-label={t('Section')}>
            <option value="">{t('All sections')}</option>
            {sections.map((s) => <option key={s.id} value={s.code}>{s.name}</option>)}
          </select>
          <button type="submit" className={ox.secondary}>{t('Show')}</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className={ox.th}>{t('Call sign')}</th><th className={ox.th}>{t('Staff / Name')}</th><th className={ox.th}>{t('Rank')}</th>
              <th className={ox.th}>{t('Force')}</th><th className={ox.th}>{t('Section')}</th><th className={ox.th}>{t('Duty from')}</th>
              <th className={ox.th}>{t('Duty to')}</th><th className={ox.th}>{t('Status')}</th>{ctx.canEdit ? <th className={ox.th} /> : null}
            </tr></thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className={ox.row}>
                  <td className={cn(ox.td, 'font-mono font-bold')}>{r.call_sign}</td>
                  <td className={ox.td}>{r.badge_number ? `${r.badge_number} ` : ''}{r.user_name}</td>
                  <td className={ox.td}>{r.rank ?? ''}</td>
                  <td className={cn(ox.td, 'font-mono')}>{r.force ?? ''}</td>
                  <td className={ox.td}>{r.sector ?? ''}</td>
                  <td className={cn(ox.td, 'whitespace-nowrap font-mono')}>{saStamp(r.start_at)}</td>
                  <td className={cn(ox.td, 'whitespace-nowrap font-mono')}>{saStamp(r.end_at)}</td>
                  <td className={ox.td}>{t(r.status)}</td>
                  {ctx.canEdit ? (
                    <td className={ox.td}>
                      <EditDuty
                        line={{ id: r.id, postId: r.post_id, userId: r.user_id, day: r.duty_date ?? today, start: saHm(r.start_at), end: saHm(r.end_at) }}
                        signs={signList}
                        people={people.some((x) => x.userId === r.user_id) || !r.user_id ? people : [{ userId: r.user_id, label: r.user_name }, ...people]}
                        started={r.start_at ? Date.parse(r.start_at) <= now : false}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
              {records.length === 0 ? <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">{t('No duty records.')}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
