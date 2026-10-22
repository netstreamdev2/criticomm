import Link from 'next/link';
import { tx } from '@criticom/db/i18n';
import { Plus } from 'lucide-react';
import { listSectionDetails, listStations } from '@criticom/api';
import { ActionForm } from '@/components/office/action-form';
import { OfficeHeader } from '@/components/office/office-header';
import { ox } from '@/components/office/styles';
import { InfoTip } from '@/components/ui/info-tip';
import { openModule } from '@/lib/office';
import { cn } from '@/lib/utils';
import { requestT } from '@/lib/i18n';
import { saveSectionAction, saveStationAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sections · HikTech' };

const ZONES = ['North', 'South', 'Inner West', 'Central'];

/** Section Details (Oracle DCPSTFM): the units duty is allocated to, and their stations. */
export default async function SectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; id?: string; q?: string; zone?: string; station?: string; all?: string; st?: string }>;
}) {
  const { t } = await requestT();
  const p = await searchParams;
  const ctx = await openModule('SECM', p.dept);
  const { supabase, target } = ctx;
  const [sections, stations] = await Promise.all([
    listSectionDetails(supabase, target, { includeInactive: p.all === '1' }),
    listStations(supabase, target, { includeInactive: true }),
  ]);
  const q = (p.q ?? '').trim().toUpperCase();
  const shown = sections.filter((s) =>
    (!q || s.name.toUpperCase().includes(q) || (s.short_desc ?? '').toUpperCase().includes(q) || s.code.includes(q))
    && (!p.zone || s.region === p.zone)
    && (!p.station || s.station_code === p.station));
  const creating = p.id === 'new';
  const editing = creating ? null : sections.find((s) => s.id === p.id) ?? null;
  const editingStation = p.st === 'new' ? null : stations.find((s) => s.id === p.st) ?? null;
  const zones = [...new Set([...ZONES, ...stations.map((s) => s.zone).filter(Boolean) as string[]])];
  const keep = (extra: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (ctx.global) sp.set('dept', target);
    for (const [k, v] of Object.entries({ q: p.q ?? '', zone: p.zone ?? '', station: p.station ?? '', ...extra })) if (v) sp.set(k, v);
    return `/modules/sections?${sp}`;
  };

  return (
    <div className="space-y-4">
      <OfficeHeader title={tx('Sections')}
        steps={[tx('A section is a unit duty is given to, such as Bylaws Unit A.'), tx('Give it its station and region.'), tx('Then add its call signs on Call Signs.')]} info={tx('A section is a unit staff are allocated to, such as Hawkers Enforcement. Each works from a station (NR, DR, B …).')}
        target={target} global={ctx.global} canEdit={ctx.canEdit} path="/modules/sections" />

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <section className={ox.card}>
          <div className={ox.cardHead}>
            <h2 className={ox.cardTitle}>{t('All sections')}</h2>
            {ctx.canEdit ? <Link href={keep({ id: 'new' })} className={ox.secondary}><Plus className="h-4 w-4" aria-hidden /> {t('Add section')}</Link> : null}
          </div>
          <form method="get" className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
            {ctx.global ? <input type="hidden" name="dept" value={target} /> : null}
            <input name="q" defaultValue={p.q} placeholder={t('Search section…')} className={cn(ox.input, 'w-48')} />
            <select name="zone" defaultValue={p.zone ?? ''} className={cn(ox.input, 'w-36')} aria-label={t('Zone')}>
              <option value="">{t('All zones')}</option>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
            <select name="station" defaultValue={p.station ?? ''} className={cn(ox.input, 'w-36')} aria-label={t('Station')}>
              <option value="">{t('All stations')}</option>
              {stations.map((s) => <option key={s.id} value={s.code}>{s.code}</option>)}
            </select>
            <button type="submit" className={ox.secondary}>{t('Show')}</button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className={ox.th}>{t('Description')}</th>
                <th className={ox.th}>{t('Short desc')}</th>
                <th className={ox.th}>{t('Code')}</th>
                <th className={ox.th}>{t('Station')}</th>
                <th className={ox.th}>{t('Zone')}</th>
                <th className={ox.th}>{t('Division')}</th>
                <th className={ox.th}>
                  <span className="inline-flex items-center gap-1">{t('Overtime')} <InfoTip text={t('The overtime code this section books overtime against.')} /></span>
                </th>
              </tr></thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} className={cn(ox.row, s.id === editing?.id && 'bg-primary/10', !s.active && 'opacity-50')}>
                    <td className={cn(ox.td, 'font-medium')}><Link href={keep({ id: s.id })} className="hover:underline">{s.name}</Link></td>
                    <td className={ox.td}>{s.short_desc ?? ''}</td>
                    <td className={cn(ox.td, 'font-mono')}>{s.code}</td>
                    <td className={cn(ox.td, 'font-mono')}>{s.station_code ?? '—'}</td>
                    <td className={ox.td}>{s.region ?? '—'}</td>
                    <td className={ox.td}>{s.division ?? '—'}</td>
                    <td className={cn(ox.td, 'font-mono')}>{s.overtime_code ?? '—'}</td>
                  </tr>
                ))}
                {shown.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{t('No sections yet.')}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {t('{count} sections shown', { count: shown.length })} ·{' '}
            <Link href={keep({ all: p.all === '1' ? '' : '1' })} className="text-primary hover:underline">
              {p.all === '1' ? t('Hide retired') : t('Show retired')}</Link>
          </p>
        </section>

        <aside className="space-y-4">
          {ctx.canEdit && (creating || editing) ? (
            <section className={ox.card}>
              <div className={ox.cardHead}><h2 className={ox.cardTitle}>{editing ? `${t('Edit section')} — ${editing.code}` : t('Add section')}</h2></div>
              <ActionForm key={editing?.id ?? 'new'} action={saveSectionAction} success={t('Section saved')} reset={!editing} className="grid grid-cols-2 gap-3 p-4">
                <input type="hidden" name="silo" value={target} />
                {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
                <label className="col-span-2"><span className={ox.label}>{t('Description')}</span>
                  <input name="name" required maxLength={80} defaultValue={editing?.name ?? ''} placeholder="HAWKERS ENFORCEMENT" className={cn(ox.input, 'uppercase')} /></label>
                <label><span className={ox.label}>{t('Code')} <InfoTip text={t('Short and permanent, e.g. V for Bylaws Unit A.')} /></span>
                  <input name="code" required maxLength={6} defaultValue={editing?.code ?? ''} className={cn(ox.input, 'font-mono uppercase')} /></label>
                <label><span className={ox.label}>{t('Short desc')}</span>
                  <input name="short" maxLength={20} defaultValue={editing?.short_desc ?? ''} className={cn(ox.input, 'uppercase')} /></label>
                <label><span className={ox.label}>{t('Station')}</span>
                  <select name="station" defaultValue={editing?.station_code ?? ''} className={ox.input}>
                    <option value="">—</option>
                    {stations.filter((s) => s.active).map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
                  </select></label>
                <label><span className={ox.label}>{t('Zone')}</span>
                  <input name="zone" list="sec-zones" defaultValue={editing?.region ?? ''} className={ox.input} />
                  <datalist id="sec-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist></label>
                <label><span className={ox.label}>{t('Division')}</span>
                  <input name="division" maxLength={6} defaultValue={editing?.division ?? ''} className={cn(ox.input, 'uppercase')} /></label>
                <label><span className={ox.label}>{t('Overtime')}</span>
                  <input name="overtime" maxLength={10} defaultValue={editing?.overtime_code ?? ''} className={cn(ox.input, 'font-mono')} /></label>
                <label className="col-span-2"><span className={ox.label}>{t('In use')}</span>
                  <select name="active" defaultValue={editing && !editing.active ? 'off' : 'on'} className={ox.input}>
                    <option value="on">{t('Yes')}</option><option value="off">{t('No, retired')}</option>
                  </select></label>
                <div className="col-span-2 flex gap-2">
                  <button type="submit" className={ox.primary}>{t('Save')}</button>
                  <Link href={keep({})} className={ox.secondary}>{t('Cancel')}</Link>
                </div>
              </ActionForm>
            </section>
          ) : null}

          <section className={ox.card}>
            <div className={ox.cardHead}>
              <h2 className={ox.cardTitle}>{t('Stations')} <InfoTip text={t('Where sections and call signs work from. They appear as Patrol area on call signs.')} /></h2>
              {ctx.canEdit ? <Link href={keep({ st: 'new' })} className="text-xs font-semibold text-primary hover:underline">+ {t('Add')}</Link> : null}
            </div>
            <ul className="divide-y divide-border text-sm">
              {stations.map((s) => (
                <li key={s.id} className={cn('flex items-center justify-between px-4 py-2', !s.active && 'opacity-50')}>
                  <span><span className="font-mono font-bold">{s.code}</span> — {s.name}</span>
                  <span className="flex items-center gap-3 text-xs text-muted-foreground">
                    {s.zone ?? ''}
                    {ctx.canEdit ? <Link href={keep({ st: s.id })} className="text-primary hover:underline">{t('Edit')}</Link> : null}
                  </span>
                </li>
              ))}
              {stations.length === 0 ? <li className="px-4 py-4 text-muted-foreground">{t('No stations yet.')}</li> : null}
            </ul>
            {ctx.canEdit && (p.st === 'new' || editingStation) ? (
              <ActionForm key={editingStation?.id ?? 'new-st'} action={saveStationAction} success={t('Station saved')} reset={!editingStation}
                className="grid grid-cols-2 gap-3 border-t border-border p-4">
                <input type="hidden" name="silo" value={target} />
                {editingStation ? <input type="hidden" name="id" value={editingStation.id} /> : null}
                <label><span className={ox.label}>{t('Code')}</span>
                  <input name="code" required maxLength={6} defaultValue={editingStation?.code ?? ''} className={cn(ox.input, 'font-mono uppercase')} /></label>
                <label><span className={ox.label}>{t('Zone')}</span>
                  <input name="zone" list="sec-zones" defaultValue={editingStation?.zone ?? ''} className={ox.input} /></label>
                <label className="col-span-2"><span className={ox.label}>{t('Name')}</span>
                  <input name="name" required maxLength={60} defaultValue={editingStation?.name ?? ''} className={ox.input} /></label>
                <label className="col-span-2"><span className={ox.label}>{t('In use')}</span>
                  <select name="active" defaultValue={editingStation && !editingStation.active ? 'off' : 'on'} className={ox.input}>
                    <option value="on">{t('Yes')}</option><option value="off">{t('No, retired')}</option>
                  </select></label>
                <div className="col-span-2 flex gap-2">
                  <button type="submit" className={ox.primary}>{t('Save')}</button>
                  <Link href={keep({})} className={ox.secondary}>{t('Cancel')}</Link>
                </div>
              </ActionForm>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
