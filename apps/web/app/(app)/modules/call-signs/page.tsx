import Link from 'next/link';
import { tx } from '@criticom/db/i18n';
import { Plus } from 'lucide-react';
import { listCallSigns, listSectionDetails, listStations } from '@criticom/api';
import { ActionForm } from '@/components/office/action-form';
import { OfficeHeader } from '@/components/office/office-header';
import { BASE_RANKS, ox } from '@/components/office/styles';
import { InfoTip } from '@/components/ui/info-tip';
import { openModule } from '@/lib/office';
import { cn } from '@/lib/utils';
import { requestT } from '@/lib/i18n';
import { saveCallSignAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Call Signs · HikTech' };

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

/** Call Sign Maintenance (Oracle BCPCSM): call sign, patrol area, start, stop, break, rank. */
export default async function CallSignsPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; id?: string; q?: string; area?: string; rank?: string; section?: string; all?: string }>;
}) {
  const { t } = await requestT();
  const p = await searchParams;
  const ctx = await openModule('CSNM', p.dept);
  const { supabase, target } = ctx;
  const [signs, stations, sections] = await Promise.all([
    listCallSigns(supabase, { silo: target, includeInactive: p.all === '1' }),
    listStations(supabase, target),
    listSectionDetails(supabase, target),
  ]);
  const q = (p.q ?? '').trim().toUpperCase();
  const shown = signs.filter((s) =>
    (!q || (s.call_sign ?? '').includes(q) || (s.description ?? '').toUpperCase().includes(q))
    && (!p.area || s.station === p.area)
    && (!p.rank || s.rank === p.rank)
    && (!p.section || s.section_id === p.section));
  const creating = p.id === 'new';
  const editing = creating ? null : signs.find((s) => s.id === p.id) ?? null;
  const ranks = [...new Set([...BASE_RANKS, ...signs.map((s) => s.rank).filter(Boolean) as string[]])];
  const stationName = new Map(stations.map((s) => [s.code, s.name]));
  const sectionName = new Map(sections.map((s) => [s.id, s.name]));
  const keep = (extra: Record<string, string>) => {
    const sp = new URLSearchParams();
    if (ctx.global) sp.set('dept', target);
    for (const [k, v] of Object.entries({ q: p.q ?? '', area: p.area ?? '', rank: p.rank ?? '', section: p.section ?? '', ...extra })) if (v) sp.set(k, v);
    return `/modules/call-signs?${sp}`;
  };
  const byRank = ranks.map((r) => [r, shown.filter((s) => s.rank === r).length] as const).filter(([, n]) => n > 0);

  return (
    <div className="space-y-4">
      <OfficeHeader title={tx('Call Signs')}
        steps={[tx('A call sign is one patrol post, such as ALPHA 12.'), tx('Give it its section, area, hours and the rank it needs.'), tx('You use call signs when you give out duties.')]} info={tx('Each call sign is one duty slot: where it patrols, its hours, its break and the rank it needs. Duty Allocation books staff onto these.')}
        target={target} global={ctx.global} canEdit={ctx.canEdit} path="/modules/call-signs" />

      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <section className={ox.card}>
          <div className={ox.cardHead}>
            <h2 className={ox.cardTitle}>
              {t('Call signs')}{p.section && sectionName.get(p.section) ? ` — ${sectionName.get(p.section)}` : ''}
            </h2>
            {ctx.canEdit ? <Link href={keep({ id: 'new' })} className={ox.secondary}><Plus className="h-4 w-4" aria-hidden /> {t('New call sign')}</Link> : null}
          </div>
          <form method="get" className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
            {ctx.global ? <input type="hidden" name="dept" value={target} /> : null}
            <input name="q" defaultValue={p.q} placeholder={t('Search call sign…')} className={cn(ox.input, 'w-48')} />
            <select name="area" defaultValue={p.area ?? ''} className={cn(ox.input, 'w-44')} aria-label={t('Patrol area')}>
              <option value="">{t('All areas')}</option>
              {stations.map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
            </select>
            <select name="section" defaultValue={p.section ?? ''} className={cn(ox.input, 'w-48')} aria-label={t('Section')}>
              <option value="">{t('All sections')}</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select name="rank" defaultValue={p.rank ?? ''} className={cn(ox.input, 'w-32')} aria-label={t('Rank')}>
              <option value="">{t('All ranks')}</option>
              {ranks.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button type="submit" className={ox.secondary}>{t('Show')}</button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>
                <th className={ox.th}>{t('Call sign')}</th><th className={ox.th}>{t('Patrol area')}</th><th className={ox.th}>{t('Start')}</th>
                <th className={ox.th}>{t('Stop')}</th><th className={ox.th}>{t('Break')}</th><th className={ox.th}>{t('Rank')}</th><th className={ox.th}>{t('Description')}</th>
              </tr></thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} className={cn(ox.row, s.id === editing?.id && 'bg-primary/10', !s.active && 'opacity-50')}>
                    <td className={cn(ox.td, 'font-mono font-bold')}><Link href={keep({ id: s.id })} className="hover:underline">{s.call_sign}</Link></td>
                    <td className={ox.td}>{s.station ? `${s.station} — ${stationName.get(s.station) ?? ''}` : '—'}</td>
                    <td className={cn(ox.td, 'font-mono')}>{hhmm(s.start_time)}</td>
                    <td className={cn(ox.td, 'font-mono')}>{hhmm(s.stop_time)}</td>
                    <td className={cn(ox.td, 'font-mono')}>{hhmm(s.break_time) || '—'}</td>
                    <td className={ox.td}>{s.rank ? <span className={cn(ox.pill, 'bg-muted')}>{s.rank}</span> : '—'}</td>
                    <td className={cn(ox.td, 'text-muted-foreground')}>{s.description ?? ''}</td>
                  </tr>
                ))}
                {shown.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">{t('No call signs yet.')}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-4">
          {ctx.canEdit && (creating || editing) ? (
            <section className={ox.card}>
              <div className={ox.cardHead}><h2 className={ox.cardTitle}>{editing ? `${t('Edit call sign')} — ${editing.call_sign}` : t('New call sign')}</h2></div>
              <ActionForm key={editing?.id ?? 'new'} action={saveCallSignAction} success={t('Call sign saved')} reset={!editing} className="grid grid-cols-2 gap-3 p-4">
                <input type="hidden" name="silo" value={target} />
                {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
                <label className="col-span-2"><span className={ox.label}>{t('Call sign')}</span>
                  <input name="call_sign" required maxLength={20} defaultValue={editing?.call_sign ?? ''} placeholder="HAWK B1" className={cn(ox.input, 'font-mono uppercase')} /></label>
                <label><span className={ox.label}>{t('Patrol area')} <InfoTip text={t('The station the call sign works from.')} /></span>
                  <select name="station" defaultValue={editing?.station ?? ''} className={ox.input}>
                    <option value="">—</option>
                    {stations.map((s) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
                  </select></label>
                <label><span className={ox.label}>{t('Rank')} <InfoTip text={t('The rank this call sign needs, e.g. ST for the sergeant in charge.')} /></span>
                  <select name="rank" defaultValue={editing?.rank ?? ''} className={ox.input}>
                    <option value="">{t('Any rank')}</option>
                    {[...new Set([...(editing?.rank ? [editing.rank] : []), ...ranks])].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select></label>
                <label className="col-span-2"><span className={ox.label}>{t('Section')}</span>
                  <select name="section_id" defaultValue={editing?.section_id ?? p.section ?? ''} className={ox.input}>
                    <option value="">—</option>
                    {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select></label>
                <label><span className={ox.label}>{t('Start time')}</span>
                  <input name="start" type="time" required defaultValue={hhmm(editing?.start_time ?? null) || '07:00'} className={ox.input} /></label>
                <label><span className={ox.label}>{t('Stop time')}</span>
                  <input name="stop" type="time" required defaultValue={hhmm(editing?.stop_time ?? null) || '16:00'} className={ox.input} /></label>
                <label><span className={ox.label}>{t('Break time')}</span>
                  <input name="break" type="time" defaultValue={hhmm(editing?.break_time ?? null)} className={ox.input} /></label>
                <label><span className={ox.label}>{t('In use')}</span>
                  <select name="active" defaultValue={editing && !editing.active ? 'off' : 'on'} className={ox.input}>
                    <option value="on">{t('Yes')}</option><option value="off">{t('No')}</option>
                  </select></label>
                <label className="col-span-2"><span className={ox.label}>{t('Description')}</span>
                  <input name="description" maxLength={200} defaultValue={editing?.description ?? ''} placeholder={t('Hawkers Beachfront — AO')} className={ox.input} /></label>
                <div className="col-span-2 flex gap-2">
                  <button type="submit" className={ox.primary}>{t('Save')}</button>
                  <Link href={keep({})} className={ox.secondary}>{t('Cancel')}</Link>
                </div>
              </ActionForm>
            </section>
          ) : null}

          <section className={ox.card}>
            <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Summary')}</h2></div>
            <dl className="space-y-1.5 p-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">{t('Total call signs')}</dt><dd className="font-semibold">{shown.length}</dd></div>
              {byRank.map(([r, n]) => (
                <div key={r} className="flex justify-between"><dt className="text-muted-foreground">{r}</dt><dd className="font-semibold">{n}</dd></div>
              ))}
              <div className="pt-2"><Link href={keep({ all: p.all === '1' ? '' : '1' })} className="text-xs text-primary hover:underline">
                {p.all === '1' ? t('Hide call signs not in use') : t('Show call signs not in use')}</Link></div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
