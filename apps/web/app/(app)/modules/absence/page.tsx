import Link from 'next/link';
import { tx } from '@criticom/db/i18n';
import { Plus } from 'lucide-react';
import { isOfficeOnly, listAbsenceCodes, listLeaveRegister, saDay } from '@criticom/api';
import { ActionForm } from '@/components/office/action-form';
import { OfficeHeader } from '@/components/office/office-header';
import { ox } from '@/components/office/styles';
import { InfoTip } from '@/components/ui/info-tip';
import { openModule } from '@/lib/office';
import { cn } from '@/lib/utils';
import { requestT } from '@/lib/i18n';
import { saveAbsenceCodeAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Absence Codes · HikTech' };

/** Absence Codes (Oracle DCPABSM): the codes leave and absence are captured under. */
export default async function AbsencePage({ searchParams }: { searchParams: Promise<{ dept?: string; id?: string }> }) {
  const { t } = await requestT();
  const p = await searchParams;
  const ctx = await openModule('ABSM', p.dept);
  const { supabase, target } = ctx;
  const today = saDay();
  const [codes, current] = await Promise.all([
    listAbsenceCodes(supabase, { includeInactive: true }),
    listLeaveRegister(supabase, { silo: target, status: 'Approved', limit: 500 }).catch(() => []),
  ]);
  const creating = p.id === 'new';
  const editing = creating ? null : codes.find((c) => c.id === p.id) ?? null;
  const onLeaveToday = current.filter((l) => l.eff_from <= today && l.eff_to >= today);
  const month = today.slice(0, 7);
  const q = (id?: string) => `/modules/absence?${new URLSearchParams({ ...(ctx.global ? { dept: target } : {}), ...(id ? { id } : {}) })}`;

  return (
    <div className="space-y-4">
      <OfficeHeader title={tx('Absence Codes')} info={tx('Every leave or absence is captured under one of these codes. Office-only codes (AWOL, Suspended …) are never asked for by members.')}
        target={target} global={ctx.global} canEdit={ctx.canEdit} path="/modules/absence" />

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <section className={ox.card}>
          <div className={ox.cardHead}>
            <h2 className={ox.cardTitle}>{t('Absence code register')}</h2>
            {ctx.canEdit ? <Link href={q('new')} className={ox.secondary}><Plus className="h-4 w-4" aria-hidden /> {t('Add code')}</Link> : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className={ox.th}>{t('Code')}</th>
                <th className={ox.th}>{t('Description')}</th>
                <th className={ox.th}>
                  <span className="inline-flex items-center gap-1">{t('Who captures')} <InfoTip text={t('Member: members may ask for it themselves. Office: only the office captures it.')} /></span>
                </th>
                <th className={ox.th}>{t('Days a year')}</th>
                <th className={ox.th}>{t('User')}</th>
                <th className={ox.th}>{t('Timestamp')}</th>
              </tr></thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className={cn(ox.row, c.id === editing?.id && 'bg-primary/10', c.status !== 'Active' && 'opacity-50')}>
                    <td className={cn(ox.td, 'font-mono font-bold')}>
                      {ctx.canEdit ? <Link href={q(c.id)} className="hover:underline">{c.code ?? '—'}</Link> : (c.code ?? '—')}
                    </td>
                    <td className={ox.td}>{c.name}</td>
                    <td className={ox.td}>
                      <span className={cn(ox.pill, isOfficeOnly(c) ? 'bg-severity-high/15 text-severity-high-ink' : 'bg-muted')}>
                        {isOfficeOnly(c) ? t('Office') : t('Member')}
                      </span>
                    </td>
                    <td className={cn(ox.td, 'font-mono')}>{c.detail3 ?? '—'}</td>
                    <td className={ox.td}>{c.created_by ?? ''}</td>
                    <td className={cn(ox.td, 'font-mono text-xs')}>{c.created_at.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-4">
          {ctx.canEdit && (creating || editing) ? (
            <section className={ox.card}>
              <div className={ox.cardHead}><h2 className={ox.cardTitle}>{editing ? `${t('Edit code')} — ${editing.code ?? ''}` : t('Add code')}</h2></div>
              <ActionForm key={editing?.id ?? 'new'} action={saveAbsenceCodeAction} success={t('Absence code saved')} reset={!editing} className="grid grid-cols-2 gap-3 p-4">
                {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
                <label><span className={ox.label}>{t('Absence code')}</span>
                  <input name="code" required maxLength={3} defaultValue={editing?.code ?? ''} className={cn(ox.input, 'font-mono uppercase')} /></label>
                <label><span className={ox.label}>{t('Days a year')} <InfoTip text={t('The yearly entitlement shown on leave balances. Empty for none.')} /></span>
                  <input name="entitlement" type="number" min={0} max={366} defaultValue={editing?.detail3 ?? ''} className={ox.input} /></label>
                <label className="col-span-2"><span className={ox.label}>{t('Description')}</span>
                  <input name="name" required maxLength={40} defaultValue={editing?.name ?? ''} className={ox.input} /></label>
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <input name="office" type="checkbox" defaultChecked={editing ? isOfficeOnly(editing) : false} className="h-4 w-4" />
                  {t('Office only (members cannot ask for it)')}</label>
                <label className="col-span-2"><span className={ox.label}>{t('In use')}</span>
                  <select name="active" defaultValue={editing && editing.status !== 'Active' ? 'off' : 'on'} className={ox.input}>
                    <option value="on">{t('Yes')}</option><option value="off">{t('No')}</option>
                  </select></label>
                <div className="col-span-2 flex gap-2">
                  <button type="submit" className={ox.primary}>{t('Save')}</button>
                  <Link href={q()} className={ox.secondary}>{t('Cancel')}</Link>
                </div>
              </ActionForm>
            </section>
          ) : null}
          <section className={ox.card}>
            <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Leave type summary')}</h2></div>
            <dl className="space-y-1.5 p-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('Total absence types')}</dt><dd className="font-semibold">{codes.filter((c) => c.status === 'Active').length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('Members on leave today')}</dt><dd className="font-semibold">{onLeaveToday.length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('Suspended today')}</dt><dd className="font-semibold">{onLeaveToday.filter((l) => l.absence_code === 'SU').length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('AWOL this month')}</dt><dd className="font-semibold">{current.filter((l) => l.absence_code === 'AW' && l.eff_from.slice(0, 7) === month).length}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
