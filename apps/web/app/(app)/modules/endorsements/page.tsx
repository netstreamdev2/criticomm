import Link from 'next/link';
import { tx } from '@criticom/db/i18n';
import { ENDORSEMENT_TYPES, listEndorsementRegister, listTeamMembers, saDay } from '@criticom/api';
import { ActionForm } from '@/components/office/action-form';
import { MemberInput } from '@/components/office/member-input';
import { OfficeHeader } from '@/components/office/office-header';
import { ox } from '@/components/office/styles';
import { InfoTip } from '@/components/ui/info-tip';
import { openModule } from '@/lib/office';
import { cn, formatSaTime } from '@/lib/utils';
import { requestT } from '@/lib/i18n';
import { issueEndorsementAction, withdrawEndorsementAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Endorsements · HikTech' };

/** Endorsement Maintenance (Oracle DCPENTM): numbered instructions that print on the duty sheet. */
export default async function EndorsementsPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; q?: string; by?: string; all?: string }>;
}) {
  const { t } = await requestT();
  const p = await searchParams;
  const ctx = await openModule('ENTM', p.dept);
  const { supabase, target } = ctx;
  const [register, people] = await Promise.all([
    listEndorsementRegister(supabase, { silo: target, search: p.q, issuer: p.by, includeInactive: p.all === '1' }),
    listTeamMembers(supabase, target).catch(() => []),
  ]);
  const issuers = [...new Set(register.map((e) => e.issued_by_name).filter(Boolean) as string[])].sort();
  const month = saDay().slice(0, 7);
  const thisMonth = register.filter((e) => e.created_at.slice(0, 7) === month).length;

  return (
    <div className="space-y-4">
      <OfficeHeader title={tx('Endorsements')}
        steps={[tx('An endorsement is a note for one member for some days, such as court.'), tx('It prints on the duty sheet beside their name.')]} info={tx('An endorsement is an instruction for one member: court, a special event, a briefing. Active ones print on the duty sheet; court keeps the member off duty that day.')}
        target={target} global={ctx.global} canEdit={ctx.canEdit} path="/modules/endorsements" />

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <section className={ox.card}>
          <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Endorsement register')}</h2></div>
          <form method="get" className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
            {ctx.global ? <input type="hidden" name="dept" value={target} /> : null}
            <input name="q" defaultValue={p.q} placeholder={t('Search by name, code or instruction…')} className={cn(ox.input, 'w-64')} />
            <select name="by" defaultValue={p.by ?? ''} className={cn(ox.input, 'w-44')} aria-label={t('Issued by')}>
              <option value="">{t('All users')}</option>
              {issuers.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <button type="submit" className={ox.secondary}>{t('Show')}</button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className={ox.th}>{t('Ent seq')}</th>
                <th className={ox.th}>{t('Code')}</th>
                <th className={ox.th}>{t('Member')}</th>
                <th className={ox.th}>{t('Comment / instruction')}</th>
                <th className={ox.th}>{t('Dates')}</th>
                <th className={ox.th}>{t('User')}</th>
                <th className={ox.th}>{t('Timestamp')}</th>
                {ctx.canEdit ? <th className={ox.th} /> : null}
              </tr></thead>
              <tbody>
                {register.map((e) => (
                  <tr key={e.id} className={cn(ox.row, !e.is_active && 'opacity-50')}>
                    <td className={cn(ox.td, 'font-mono')}>{e.seq ?? ''}</td>
                    <td className={cn(ox.td, 'font-mono')}>{e.code ?? ''}</td>
                    <td className={ox.td}>{e.employee_name}<div className="text-xs text-muted-foreground">{e.badge_number}</div></td>
                    <td className={ox.td}>
                      <span className="uppercase">{e.details}</span>
                      <div className="text-xs text-muted-foreground">{t(e.type)}</div>
                    </td>
                    <td className={cn(ox.td, 'whitespace-nowrap font-mono text-xs')}>{e.start_date}{e.end_date && e.end_date !== e.start_date ? ` → ${e.end_date}` : ''}</td>
                    <td className={ox.td}>{e.issued_by_name ?? e.created_by ?? ''}</td>
                    <td className={cn(ox.td, 'whitespace-nowrap font-mono text-xs')}>{e.created_at.slice(0, 10)} {formatSaTime(e.created_at)}</td>
                    {ctx.canEdit ? (
                      <td className={ox.td}>
                        {e.is_active ? (
                          <ActionForm action={withdrawEndorsementAction} success={t('Endorsement withdrawn')} confirm={t('Withdraw this endorsement? It stays on record.')}>
                            <input type="hidden" name="id" value={e.id} />
                            <button type="submit" className="text-xs font-semibold text-severity-critical hover:underline">{t('Withdraw')}</button>
                          </ActionForm>
                        ) : <span className="text-xs text-muted-foreground">{t('Withdrawn')}</span>}
                      </td>
                    ) : null}
                  </tr>
                ))}
                {register.length === 0 ? <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">{t('No endorsements.')}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-2 text-xs">
            <Link href={`/modules/endorsements?${new URLSearchParams({ ...(ctx.global ? { dept: target } : {}), ...(p.all === '1' ? {} : { all: '1' }) })}`} className="text-primary hover:underline">
              {p.all === '1' ? t('Hide withdrawn') : t('Show withdrawn')}</Link>
          </p>
        </section>

        <aside className="space-y-4">
          {ctx.canEdit ? (
            <section className={ox.card}>
              <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Add endorsement')}</h2></div>
              <ActionForm action={issueEndorsementAction} success={t('Endorsement added')} reset className="grid grid-cols-2 gap-3 p-4">
                <input type="hidden" name="silo" value={target} />
                <label className="col-span-2" htmlFor="end-member"><span className={ox.label}>{t('Staff no.')}</span>
                  <MemberInput id="end-member" people={people} placeholder={t('Enter staff number…')} /></label>
                <label><span className={ox.label}>{t('Type')} <InfoTip text={t('Court Attendance keeps the member off duty that day.')} /></span>
                  <select name="type" className={ox.input} defaultValue="Special Instruction">
                    {ENDORSEMENT_TYPES.map((ty) => <option key={ty} value={ty}>{t(ty)}</option>)}
                  </select></label>
                <label><span className={ox.label}>{t('Endorsement code')}</span>
                  <input name="code" maxLength={6} placeholder={t('e.g. 222')} className={cn(ox.input, 'font-mono')} /></label>
                <label className="col-span-2"><span className={ox.label}>{t('Comment / instruction')}</span>
                  <textarea name="details" required maxLength={500} placeholder={t('ATTEND DURBAN COURT 21')} className={cn(ox.area, 'uppercase')} /></label>
                <label><span className={ox.label}>{t('Date')}</span>
                  <input name="start" type="date" required defaultValue={saDay()} className={ox.input} /></label>
                <label><span className={ox.label}>{t('Until')} <InfoTip text={t('Leave empty for one day (court) or until withdrawn.')} /></span>
                  <input name="end" type="date" className={ox.input} /></label>
                <div className="col-span-2 flex gap-2">
                  <button type="submit" className={ox.primary}>{t('Save endorsement')}</button>
                </div>
              </ActionForm>
            </section>
          ) : null}
          <section className={ox.card}>
            <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Summary')}</h2></div>
            <dl className="space-y-1.5 p-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('Total endorsements')}</dt><dd className="font-semibold">{register.length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('This month')}</dt><dd className="font-semibold">{thisMonth}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('Court dates')}</dt><dd className="font-semibold">{register.filter((e) => e.type === 'Court Attendance' && e.is_active).length}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
