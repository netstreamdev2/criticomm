import Link from 'next/link';
import { tx } from '@criticom/db/i18n';
import { Plus } from 'lucide-react';
import { OFFICE_MODULES, getStaffRecord, listSectionDetails, listStaff, listStations } from '@criticom/api';
import { ActionForm } from '@/components/office/action-form';
import { OfficeHeader } from '@/components/office/office-header';
import { BASE_RANKS, ox } from '@/components/office/styles';
import { InfoTip } from '@/components/ui/info-tip';
import { openModule } from '@/lib/office';
import { cn } from '@/lib/utils';
import { requestT } from '@/lib/i18n';
import { PrintButton } from '../../roster/duty-sheet/print-button';
import { addLeoAction, removeLeoAction, saveAccessAction, saveStaffAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff Maintenance · HikTech' };

const REGIONS = ['ETHEKWINI', 'CENTRAL', 'NORTH', 'SOUTH', 'INNER WEST'];

/** Staff Maintenance (Oracle DCPSTFM): find a member, keep their record, and give screen access. */
export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; id?: string; q?: string; station?: string; rank?: string }>;
}) {
  const { t } = await requestT();
  const p = await searchParams;
  const ctx = await openModule('STFM', p.dept);
  const { supabase, target } = ctx;
  const [staff, stations, sections, record] = await Promise.all([
    listStaff(supabase, { silo: target, station: p.station || null, rank: p.rank || null, search: p.q }),
    listStations(supabase, target),
    listSectionDetails(supabase, target),
    p.id && p.id !== 'new' ? getStaffRecord(supabase, p.id) : Promise.resolve(null),
  ]);
  const creating = p.id === 'new';
  const person = record?.person ?? null;
  const priv = record?.private ?? null;
  const ranks = [...new Set([...BASE_RANKS, ...staff.map((s) => s.rank).filter(Boolean)])];
  const keep = (extra: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (ctx.global) sp.set('dept', target);
    for (const [k, v] of Object.entries({ q: p.q ?? '', station: p.station ?? '', rank: p.rank ?? '', ...extra })) if (v) sp.set(k, v);
    return `/modules/staff?${sp}`;
  };
  const ro = !ctx.canEdit;
  const access = new Map((record?.access ?? []).map((a) => [a.module, a.level]));
  const input = (name: string, label: string, value: string | null | undefined, extra: { type?: string; info?: string; upper?: boolean; span?: boolean; required?: boolean } = {}) => (
    <label className={extra.span ? 'sm:col-span-2' : undefined}>
      <span className={ox.label}>{t(label)}{extra.info ? <InfoTip text={t(extra.info)} /> : null}</span>
      <input name={name} type={extra.type ?? 'text'} defaultValue={value ?? ''} readOnly={ro} required={extra.required}
        className={cn(ox.input, extra.upper && 'uppercase')} />
    </label>
  );

  return (
    <div className="space-y-4">
      <OfficeHeader title={tx('Staff Maintenance')} info={tx('Each member’s record as the old system kept it: numbers, rank, station, section, weekend group, contacts, LEO record and screen access.')}
        target={target} global={ctx.global} canEdit={ctx.canEdit} path="/modules/staff">
        {person ? <PrintButton /> : null}
      </OfficeHeader>

      <form method="get" className="no-print flex flex-wrap items-center gap-2">
        {ctx.global ? <input type="hidden" name="dept" value={target} /> : null}
        <select name="station" defaultValue={p.station ?? ''} className={cn(ox.input, 'w-48')} aria-label={t('Station')}>
          <option value="">{t('All stations')}</option>
          {stations.map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
        </select>
        <select name="rank" defaultValue={p.rank ?? ''} className={cn(ox.input, 'w-36')} aria-label={t('Rank')}>
          <option value="">{t('All ranks')}</option>
          {ranks.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input name="q" defaultValue={p.q} placeholder={t('Search by staff no., name or service no…')} className={cn(ox.input, 'w-72')} />
        <button type="submit" className={ox.secondary}>{t('Show')}</button>
        {ctx.canEdit ? <Link href={keep({ id: 'new' })} className={cn(ox.primary, 'ml-auto')}><Plus className="h-4 w-4" aria-hidden /> {t('Add New Staff')}</Link> : null}
      </form>

      <div className="grid gap-4 xl:grid-cols-[18rem_1fr]">
        <section className={cn(ox.card, 'no-print max-h-[44rem] overflow-y-auto')}>
          <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('{count} staff', { count: staff.length })}</h2></div>
          <ul className="divide-y divide-border text-sm">
            {staff.map((s) => (
              <li key={s.id}>
                <Link href={keep({ id: s.id })} className={cn('block px-4 py-2 hover:bg-muted', s.id === person?.id && 'bg-primary/10')}>
                  <span className="font-medium">{s.last_name.toUpperCase()}, {s.first_name}</span>
                  <span className="block text-xs text-muted-foreground">{[s.badge_number, s.rank, s.station].filter(Boolean).join(' · ')}</span>
                </Link>
              </li>
            ))}
            {staff.length === 0 ? <li className="px-4 py-6 text-center text-muted-foreground">{t('Nobody found.')}</li> : null}
          </ul>
        </section>

        {person || creating ? (
          <div className="space-y-4">
            <ActionForm key={person?.id ?? 'new'} action={saveStaffAction} success={t('Record saved')} className="space-y-4">
              <input type="hidden" name="silo" value={target} />
              {ctx.global ? <input type="hidden" name="dept" value={target} /> : null}
              {person ? <input type="hidden" name="id" value={person.id} /> : null}

              <section className={ox.card}>
                <div className={ox.cardHead}>
                  <h2 className={ox.cardTitle}>{t('Personal details')}</h2>
                  {person ? <span className="font-mono text-xs text-muted-foreground">{t('Staff')} #{person.badge_number}</span> : null}
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  {input('badge_number', tx('Staff no.'), person?.badge_number, { required: true, info: tx('The number this member is found by everywhere in the system.') })}
                  {input('first_name', tx('Forename'), person?.first_name, { required: true })}
                  {input('last_name', tx('Name'), person?.last_name, { required: true })}
                  {input('id_number', tx('I.D. No.'), priv?.id_number, { info: tx('Only Staff Maintenance and the member can see this.') })}
                  {input('service_number', tx('Service no.'), person?.service_number, { upper: true })}
                  {input('persal_number', tx('Persal no.'), person?.persal_number)}
                  <label><span className={ox.label}>{t('Rank')}</span>
                    <input name="rank" list="staff-ranks" defaultValue={person?.rank ?? ''} readOnly={ro} className={cn(ox.input, 'uppercase')} />
                    <datalist id="staff-ranks">{ranks.map((r) => <option key={r} value={r} />)}</datalist></label>
                  {input('force_number', tx('Force'), person?.force_number, { info: tx('The force number printed on the duty sheet.') })}
                  <label><span className={ox.label}>{t('Region')}</span>
                    <input name="region" list="staff-regions" defaultValue={person?.region ?? ''} readOnly={ro} className={cn(ox.input, 'uppercase')} />
                    <datalist id="staff-regions">{REGIONS.map((r) => <option key={r} value={r} />)}</datalist></label>
                  {input('la_code', tx('LA code'), person?.la_code)}
                  {input('department_name', tx('Dept'), person?.department_name, { upper: true })}
                  <label><span className={ox.label}>{t('Username')} <InfoTip text={t('The account this member signs in with. Accounts are made by invitation.')} /></span>
                    <input readOnly value={record?.account?.email ?? t('No account')} className={cn(ox.input, 'bg-muted/40')} tabIndex={-1} /></label>
                  {input('join_date', tx('Join date'), person?.join_date, { type: 'date' })}
                  {input('birth_date', tx('Birth date'), priv?.birth_date, { type: 'date' })}
                  {input('resign_date', tx('Resign date'), person?.resign_date, { type: 'date' })}
                  <label><span className={ox.label}>{t('Station')}</span>
                    <select name="station" defaultValue={person?.station ?? ''} disabled={ro} className={ox.input}>
                      <option value="">—</option>
                      {stations.map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
                      {person?.station && !stations.some((s) => s.code === person.station) ? <option value={person.station}>{person.station}</option> : null}
                    </select></label>
                </div>
              </section>

              <section className={ox.card}>
                <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Contact & address')}</h2></div>
                <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  {input('address_1', tx('Address 1'), priv?.address_1, { span: true })}
                  {input('address_2', tx('Address 2'), priv?.address_2, { span: true })}
                  {input('address_3', tx('Address 3'), priv?.address_3, { span: true })}
                  {input('address_4', tx('Address 4 (alt)'), priv?.address_4, { span: true })}
                  {input('phone', tx('Phone'), priv?.phone, { type: 'tel' })}
                  {input('post_code', tx('Post code'), priv?.post_code)}
                  {input('email', tx('Email'), priv?.email, { type: 'email' })}
                  {input('work_cellphone', tx('Work cellphone'), person?.work_cellphone, { type: 'tel' })}
                  <label className="sm:col-span-2"><span className={ox.label}>{t('Section')}</span>
                    <select name="section_id" defaultValue={person?.section_id ?? ''} disabled={ro} className={ox.input}>
                      <option value="">—</option>
                      {sections.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                    </select></label>
                  <label><span className={ox.label}>{t('Weekend')} <InfoTip text={t('Weekend group A or B. Prints as W/E on the duty sheet.')} /></span>
                    <select name="weekend_group" defaultValue={person?.weekend_group ?? ''} disabled={ro} className={ox.input}>
                      <option value="">—</option><option value="A">A</option><option value="B">B</option>
                    </select></label>
                  <label><span className={ox.label}>{t('Duty allocation')} <InfoTip text={t('N keeps this member out of Duty Allocation.')} /></span>
                    <select name="duty_allocation" defaultValue={person && !person.duty_allocation ? 'N' : 'Y'} disabled={ro} className={ox.input}>
                      <option value="Y">{t('Y — Yes')}</option><option value="N">{t('N — No')}</option>
                    </select></label>
                  {input('platoon', tx('Shift group'), person?.platoon, { upper: true, info: tx('The team a rotation rosters (A, B, C, D or Red, Blue, Green).') })}
                </div>
              </section>

              <section className={ox.card}>
                <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Next of kin & emergency contact')}</h2></div>
                <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
                  {input('nok_name', tx('Next of kin'), priv?.nok_name)}
                  {input('nok_relation', tx('Relationship'), priv?.nok_relation)}
                  {input('nok_phone', tx('Phone'), priv?.nok_phone, { type: 'tel' })}
                  {input('nok_email', tx('Email'), priv?.nok_email, { type: 'email' })}
                  {input('nok_address', tx('Address'), priv?.nok_address)}
                  {input('emergency_name', tx('Emergency contact'), priv?.emergency_name)}
                  {input('emergency_relation', tx('Relationship'), priv?.emergency_relation)}
                  {input('emergency_phone', tx('Phone'), priv?.emergency_phone, { type: 'tel' })}
                  {input('emergency_email', tx('Email'), priv?.emergency_email, { type: 'email' })}
                  {input('emergency_address', tx('Address'), priv?.emergency_address)}
                </div>
                <div className="px-4 pb-4">
                  <label><span className={ox.label}>{t('Comments')}</span>
                    <textarea name="comments" defaultValue={priv?.comments ?? ''} readOnly={ro} maxLength={2000} className={ox.area} /></label>
                </div>
              </section>

              {ctx.canEdit ? (
                <div className="no-print flex gap-2">
                  <button type="submit" className={ox.primary}>{creating ? t('Add staff member') : t('Save')}</button>
                  <Link href={keep({})} className={ox.secondary}>{t('Cancel')}</Link>
                </div>
              ) : null}
            </ActionForm>

            {person ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <section className={ox.card}>
                  <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Law enforcement officer record')} <InfoTip text={t('Radio, warrant area and the dates they apply.')} /></h2></div>
                  <table className="w-full text-sm">
                    <thead><tr>
                      <th className={ox.th}>{t('Radio')}</th><th className={ox.th}>{t('Eff from')}</th><th className={ox.th}>{t('Eff to')}</th>
                      <th className={ox.th}>{t('Warrant area')}</th><th className={ox.th}>{t('Region')}</th>{ctx.canEdit ? <th className={ox.th} /> : null}
                    </tr></thead>
                    <tbody>
                      {(record?.leo ?? []).map((l) => (
                        <tr key={l.id} className={ox.row}>
                          <td className={cn(ox.td, 'font-mono')}>{l.radio ?? ''}</td>
                          <td className={cn(ox.td, 'font-mono')}>{l.eff_from ?? ''}</td>
                          <td className={cn(ox.td, 'font-mono')}>{l.eff_to ?? ''}</td>
                          <td className={ox.td}>{l.warrant_area ?? ''}</td>
                          <td className={ox.td}>{l.region ?? ''}</td>
                          {ctx.canEdit ? (
                            <td className={ox.td}>
                              <ActionForm action={removeLeoAction} success={t('Removed')} confirm={t('Remove this LEO record?')}>
                                <input type="hidden" name="id" value={l.id} />
                                <button type="submit" className="no-print text-xs text-severity-critical hover:underline">{t('Remove')}</button>
                              </ActionForm>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                      {(record?.leo ?? []).length === 0 ? <tr><td colSpan={6} className="px-4 py-4 text-center text-muted-foreground">{t('No LEO record.')}</td></tr> : null}
                    </tbody>
                  </table>
                  {ctx.canEdit ? (
                    <ActionForm action={addLeoAction} success={t('LEO record added')} reset className="no-print grid grid-cols-2 gap-2 border-t border-border p-4 sm:grid-cols-5 sm:items-end">
                      <input type="hidden" name="personnel" value={person.id} />
                      <label><span className={ox.label}>{t('Radio')}</span><input name="radio" className={ox.input} /></label>
                      <label><span className={ox.label}>{t('Eff from')}</span><input name="from" type="date" className={ox.input} /></label>
                      <label><span className={ox.label}>{t('Eff to')}</span><input name="to" type="date" className={ox.input} /></label>
                      <label><span className={ox.label}>{t('Warrant area')}</span><input name="area" className={cn(ox.input, 'uppercase')} /></label>
                      <label><span className={ox.label}>{t('Region')}</span><input name="region" list="staff-regions" className={cn(ox.input, 'uppercase')} /></label>
                      <button type="submit" className={cn(ox.secondary, 'col-span-2 sm:col-span-5 sm:justify-self-start')}>+ {t('Add LEO record')}</button>
                    </ActionForm>
                  ) : null}
                </section>

                <section className={ox.card}>
                  <div className={ox.cardHead}>
                    <h2 className={ox.cardTitle}>{t('Access & permissions')} <InfoTip text={t('Which duty office screens this member may open, and whether they may change them. Only the systems controller sets this.')} /></h2>
                  </div>
                  {person.user_id ? (
                    <ActionForm action={saveAccessAction} success={t('Access saved')}>
                      <input type="hidden" name="user" value={person.user_id} />
                      <table className="w-full text-sm">
                        <thead><tr><th className={ox.th}>{t('Code')}</th><th className={ox.th}>{t('Module')}</th><th className={ox.th}>{t('Access')}</th></tr></thead>
                        <tbody>
                          {OFFICE_MODULES.map((m) => (
                            <tr key={m.code} className={ox.row}>
                              <td className={cn(ox.td, 'font-mono')}>{m.code}</td>
                              <td className={ox.td}>{t(m.label)}</td>
                              <td className={ox.td}>
                                <input type="hidden" name={`was_${m.code}`} value={access.get(m.code) ?? ''} />
                                <select name={m.code} defaultValue={access.get(m.code) ?? ''} disabled={!ctx.global} className={cn(ox.input, 'h-8 w-32')} aria-label={t(m.label)}>
                                  <option value="">{t('None')}</option>
                                  <option value="View">{t('View')}</option>
                                  <option value="Edit">{t('Edit')}</option>
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {ctx.global ? <div className="no-print border-t border-border p-4"><button type="submit" className={ox.primary}>{t('Save access')}</button></div> : null}
                    </ActionForm>
                  ) : (
                    <p className="p-4 text-sm text-muted-foreground">{t('This member has no account yet, so they cannot be given screens.')}</p>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        ) : (
          <p className={cn(ox.card, 'p-6 text-sm text-muted-foreground')}>{t('Choose a member on the left, or search.')}</p>
        )}
      </div>
    </div>
  );
}
