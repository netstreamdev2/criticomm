import Link from 'next/link';
import { tx } from '@criticom/db/i18n';
import { listAbsenceCodes, listLeaveRegister, listTeamMembers, saDay } from '@criticom/api';
import { ActionForm } from '@/components/office/action-form';
import { MemberInput } from '@/components/office/member-input';
import { OfficeHeader } from '@/components/office/office-header';
import { ox } from '@/components/office/styles';
import { InfoTip } from '@/components/ui/info-tip';
import { openModule } from '@/lib/office';
import { cn, formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';
import { captureLeaveAction, setLeaveFormAction } from './actions';
import { LeaveDecision } from './decide';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Maintain Leave · HikTech' };

/** Maintain Leave (Oracle DCPLEAM): approvals, the leave register and leave captured by the office. */
export default async function MaintainLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; q?: string; code?: string; form?: string }>;
}) {
  const { t } = await requestT();
  const p = await searchParams;
  const ctx = await openModule('LEAM', p.dept);
  const { supabase, target } = ctx;
  const today = saDay();
  const form = p.form === 'Y' ? true : p.form === 'N' ? false : null;
  const [pending, register, codes, people] = await Promise.all([
    listLeaveRegister(supabase, { silo: target, status: 'Pending', limit: 100 }),
    listLeaveRegister(supabase, { silo: target, code: p.code || null, form, search: p.q, limit: 200 }),
    listAbsenceCodes(supabase),
    listTeamMembers(supabase, target).catch(() => []),
  ]);
  const ids = [...new Set([...pending, ...register].map((l) => l.user_id).filter(Boolean))] as string[];
  const { data: persal } = ids.length
    ? await supabase.from('personnel').select('user_id, persal_number, badge_number').in('user_id', ids)
    : { data: [] as Array<{ user_id: string | null; persal_number: string | null; badge_number: string }> };
  const numbers = new Map((persal ?? []).map((r) => [r.user_id, r.persal_number ?? r.badge_number]));
  const codeOf = new Map(codes.map((c) => [c.name, c.code]));
  const approved = register.filter((l) => l.status === 'Approved');

  return (
    <div className="space-y-4">
      <OfficeHeader title={tx('Maintain Leave')} info={tx('Approve leave members ask for, and capture leave or absence from the form a member hands in. Captured leave marks their duty as absent.')}
        target={target} global={ctx.global} canEdit={ctx.canEdit} path="/modules/leave" />

      <section className={ox.card}>
        <div className={ox.cardHead}>
          <h2 className={ox.cardTitle}>{t('Pending leave approvals')} <InfoTip text={t('Only someone senior to the member, in their department, can approve. Nobody approves their own.')} /></h2>
          <span className={cn(ox.pill, 'bg-severity-high/15 text-severity-high-ink')}>{t('{count} pending', { count: pending.length })}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr>
              <th className={ox.th}>{t('Officer')}</th>
              <th className={ox.th}>{t('Persal')}</th>
              <th className={ox.th}>{t('Type')}</th>
              <th className={ox.th}>{t('From')}</th>
              <th className={ox.th}>{t('To')}</th>
              <th className={ox.th}>{t('Days')}</th>
              <th className={ox.th}>{t('Action')}</th>
            </tr></thead>
            <tbody>
              {pending.map((l) => (
                <tr key={l.id} className={ox.row}>
                  <td className={cn(ox.td, 'font-semibold')}>{l.applicant_name}</td>
                  <td className={cn(ox.td, 'font-mono')}>{numbers.get(l.user_id) ?? ''}</td>
                  <td className={ox.td}>{t(l.absence ?? 'Leave')}</td>
                  <td className={cn(ox.td, 'font-mono')}>{l.eff_from}</td>
                  <td className={cn(ox.td, 'font-mono')}>{l.eff_to}</td>
                  <td className={ox.td}>{l.days ?? ''}</td>
                  <td className={ox.td}><LeaveDecision id={l.id} /></td>
                </tr>
              ))}
              {pending.length === 0 ? <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">{t('Nothing waiting.')}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <section className={ox.card}>
          <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Leave register')}</h2></div>
          <form method="get" className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
            {ctx.global ? <input type="hidden" name="dept" value={target} /> : null}
            <input name="q" defaultValue={p.q} placeholder={t('Search staff or leave seq…')} className={cn(ox.input, 'w-56')} />
            <select name="code" defaultValue={p.code ?? ''} className={cn(ox.input, 'w-44')} aria-label={t('Absence')}>
              <option value="">{t('All types')}</option>
              {codes.filter((c) => c.code).map((c) => <option key={c.id} value={c.code as string}>{c.code} — {c.name}</option>)}
            </select>
            <select name="form" defaultValue={p.form ?? ''} className={cn(ox.input, 'w-48')} aria-label={t('Form submitted')}>
              <option value="">{t('All')}</option>
              <option value="Y">{t('Form submitted (Y)')}</option>
              <option value="N">{t('Not submitted (N)')}</option>
            </select>
            <button type="submit" className={ox.secondary}>{t('Show')}</button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className={ox.th}>{t('Leave seq')}</th>
                <th className={ox.th}>{t('Absence')}</th>
                <th className={ox.th}>{t('Member')}</th>
                <th className={ox.th}>{t('Dates')}</th>
                <th className={ox.th}>{t('Status')}</th>
                <th className={ox.th}>
                  <span className="inline-flex items-center gap-1">{t('Form')} <InfoTip text={t('Y when the member’s signed leave form has been handed in.')} /></span>
                </th>
                <th className={ox.th}>{t('User')}</th>
                <th className={ox.th}>{t('Timestamp')}</th>
              </tr></thead>
              <tbody>
                {register.map((l) => (
                  <tr key={l.id} className={cn(ox.row, l.status === 'Cancelled' || l.status === 'Rejected' ? 'opacity-50' : '')}>
                    <td className={cn(ox.td, 'font-mono')}>{l.leave_seq ?? '—'}</td>
                    <td className={ox.td}>
                      <span className={cn(ox.pill, 'bg-muted font-mono')}>{l.absence_code ?? codeOf.get(l.absence ?? '') ?? '—'}</span>{' '}
                      <span className="text-muted-foreground">{t(l.absence ?? '')}</span>
                    </td>
                    <td className={ox.td}>{l.applicant_name}</td>
                    <td className={cn(ox.td, 'whitespace-nowrap font-mono text-xs')}>{l.eff_from} → {l.eff_to}</td>
                    <td className={ox.td}>{t(l.status)}</td>
                    <td className={ox.td}>
                      {ctx.canEdit && l.status === 'Approved' ? (
                        <ActionForm action={setLeaveFormAction} success={t('Saved')}>
                          <input type="hidden" name="id" value={l.id} />
                          <input type="hidden" name="submitted" value={l.form_submitted ? 'N' : 'Y'} />
                          <button type="submit" title={t('Change')}
                            className={cn(ox.pill, l.form_submitted ? 'bg-severity-low/15 text-severity-low-ink' : 'bg-severity-critical/15 text-severity-critical')}>
                            {l.form_submitted ? 'Y' : 'N'}</button>
                        </ActionForm>
                      ) : (
                        <span className={cn(ox.pill, l.form_submitted ? 'bg-severity-low/15 text-severity-low-ink' : 'bg-muted')}>{l.form_submitted ? 'Y' : 'N'}</span>
                      )}
                    </td>
                    <td className={ox.td}>{l.captured_by_name ?? l.approved_by ?? ''}</td>
                    <td className={cn(ox.td, 'whitespace-nowrap font-mono text-xs')}>{l.created_at.slice(0, 10)} {formatSaTime(l.created_at)}</td>
                  </tr>
                ))}
                {register.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">{t('No leave on record.')}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-4">
          {ctx.canEdit ? (
            <section className={ox.card}>
              <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('New leave entry')} <InfoTip text={t('For leave on a form the member handed in, sick leave, or an absence such as AWOL. It is approved as captured and their duty in those dates is marked.')} /></h2></div>
              <ActionForm action={captureLeaveAction} success={t('Leave captured')} reset className="grid grid-cols-2 gap-3 p-4">
                <input type="hidden" name="silo" value={target} />
                <label className="col-span-2" htmlFor="leave-member"><span className={ox.label}>{t('Staff no.')}</span>
                  <MemberInput id="leave-member" people={people} placeholder={t('Enter staff number…')} /></label>
                <label className="col-span-2"><span className={ox.label}>{t('Absence type')}</span>
                  <select name="code" required className={ox.input} defaultValue="AL">
                    {codes.filter((c) => c.code).map((c) => <option key={c.id} value={c.code as string}>{c.code} — {c.name}</option>)}
                  </select></label>
                <label><span className={ox.label}>{t('Date from')}</span>
                  <input name="from" type="date" required defaultValue={today} className={ox.input} /></label>
                <label><span className={ox.label}>{t('Date to')}</span>
                  <input name="to" type="date" required defaultValue={today} className={ox.input} /></label>
                <label className="col-span-2"><span className={ox.label}>{t('Form submitted')}</span>
                  <select name="form" className={ox.input} defaultValue="N">
                    <option value="N">{t('N — No')}</option><option value="Y">{t('Y — Yes')}</option>
                  </select></label>
                <label className="col-span-2"><span className={ox.label}>{t('Notes')}</span>
                  <textarea name="notes" maxLength={1000} className={ox.area} /></label>
                <div className="col-span-2"><button type="submit" className={ox.primary}>{t('Submit leave')}</button></div>
              </ActionForm>
            </section>
          ) : null}
          <section className={ox.card}>
            <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Leave overview')}</h2></div>
            <dl className="space-y-1.5 p-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('Pending approvals')}</dt><dd className="font-semibold">{pending.length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('Forms outstanding')}</dt><dd className="font-semibold">{approved.filter((l) => !l.form_submitted).length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('On leave today')}</dt><dd className="font-semibold">{approved.filter((l) => l.eff_from <= today && l.eff_to >= today).length}</dd></div>
            </dl>
            <p className="border-t border-border px-4 py-2 text-xs">
              <Link href="/modules/absence" className="text-primary hover:underline">{t('Absence codes')}</Link>
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
