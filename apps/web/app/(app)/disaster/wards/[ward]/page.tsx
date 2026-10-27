import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Baby, Droplets, Flame, History, Home, HandHeart, Siren, UserRound, Users, Waves } from 'lucide-react';
import { listCouncillors, listPastEvents, listWardIncidentFacts, listWardReliefForWard } from '@criticom/api';
import { CallButton } from '@/components/disaster/call-button';
import { Fold } from '@/components/disaster/fold';
import { InfoTile } from '@/components/disaster/info-tile';
import { ShapesMap } from '@/components/disaster/shapes-map';
import { areaRings } from '@/lib/maps/geo';
import { wardFacts } from '@/lib/maps/wards';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { formatSaTime } from '@/lib/utils';
import { DmStatusChip } from '../../desk/[id]/after-tile';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ward Profile · HikTech' };

const day = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * One ward: its outline and councillor, its people and their needs (2011
 * Census), its flood and fire risk, the disasters on record there, the April
 * 2022 damage, the incidents the desk placed in it and the relief given.
 */
export default async function WardProfilePage({ params }: { params: Promise<{ ward: string }> }) {
  const { ward: raw } = await params;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 111) notFound();
  const { t } = await requestT();
  const { supabase } = await getSession();
  const [{ wards, missing }, councillors, past, facts, relief] = await Promise.all([
    wardFacts(), listCouncillors(supabase), listPastEvents(supabase, { ward: n }), listWardIncidentFacts(supabase, n), listWardReliefForWard(supabase, n),
  ]);
  const w = wards.find((x) => x.ward === n);
  const c = councillors.find((x) => x.is_active && x.ward === n);
  const numbers = facts.length
    ? new Map(((await supabase.from('incidents').select('id, incident_number').in('id', facts.map((f) => f.incident_id))).data ?? [])
      .map((i) => [i.id as string, i.incident_number as string]))
    : new Map<string, string>();
  const pct = (v: number | null | undefined) => (v == null ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`);
  const deaths = past.reduce((s, e) => s + (e.deaths ?? 0), 0);
  const helped = relief.reduce((s, r) => s + r.people, 0);
  const icon = (I: typeof Users) => <I className="h-5 w-5" aria-hidden />;

  return (
    <div className="space-y-6">
      <Link href="/disaster/wards" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden />{t('All wards')}
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-bg-card p-5 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold">{t('Ward {w}', { w: n })}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
            <UserRound className="h-4 w-4" aria-hidden />
            {c ? <><span className="font-semibold text-fg">{c.name}</span>{t('(ward councillor)')}</> : (
              <Link href="/disaster/councillors" className="font-semibold text-accent hover:underline">{t('Add this ward’s councillor')}</Link>
            )}
          </p>
        </div>
        {c?.phone ? <CallButton number={c.phone} label={t('Call the councillor')} /> : null}
      </header>
      {missing.length ? (
        <p className="rounded-lg border border-severity-medium/40 bg-bg-card px-4 py-2 text-sm text-severity-medium-ink">
          {t('Some figures could not be fetched just now: {what}.', { what: missing.join(', ') })}
        </p>
      ) : null}

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <InfoTile label={t('People')} value={w?.people?.toLocaleString('en-ZA') ?? '—'} icon={icon(Users)} tone="plain"
          explain={t('About how many people live here, from the 2011 Census fitted to the 2016 wards.')} />
        <InfoTile label={t('Informal homes')} value={pct(w?.informal)} icon={icon(Home)} tone={(w?.informal ?? 0) >= 30 ? 'warn' : 'plain'}
          explain={t('The share of homes that are informal dwellings: shacks and backyard rooms. Fire and flood hit them hardest.')} />
        <InfoTile label={t('No piped water')} value={pct(w?.water)} icon={icon(Droplets)} tone={(w?.water ?? 0) >= 10 ? 'warn' : 'plain'}
          explain={t('The share of people with no piped water. Water tankers are needed here first when supply fails.')} />
        <InfoTile label={t('Children (16 and under)')} value={pct(w?.children)} icon={icon(Baby)} tone="plain"
          explain={t('The share of people aged 16 or under. Families with children need nappies, formula and schooling when displaced.')} />
        <InfoTile label={t('Flood risk')} value={w?.floodRisk ? t(w.floodRisk) : '—'} icon={icon(Waves)} tone={/high/i.test(w?.floodRisk ?? '') ? 'critical' : 'plain'}
          explain={t('The NDMC’s flood risk class for this season where the ward’s middle lies: hazard, vulnerability and capacity combined.')} />
        <InfoTile label={t('Fire risk')} value={w?.fireRisk ? t(w.fireRisk) : '—'} icon={icon(Flame)} tone={/high/i.test(w?.fireRisk ?? '') ? 'critical' : 'plain'} align="right"
          explain={t('The NDMC’s fire risk class for this season where the ward’s middle lies.')} />
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-5">
          {w ? (
            <Fold id="ward.map" title={t('The ward')} bodyClassName="p-3" info={t('The ward’s boundary as the Municipal Demarcation Board drew it for 2021.')}>
              <ShapesMap shapes={areaRings(w.geometry as { type?: string; coordinates?: unknown }).map((points) => ({ points, colour: '#38bdf8', label: t('Ward {w}', { w: n }) }))}
                height={320} className="overflow-hidden rounded-lg" />
            </Fold>
          ) : null}
          <Fold id="ward.damage2022" icon={Waves} title={t('April 2022 floods ({n} damage points)', { n: w?.damage2022 ?? 0 })} bodyClassName="p-5"
            info={t('Damage observed after the floods of 11 and 12 April 2022 and filed by ward.')}>
            {w && w.damage2022 ? (
              <ul className="space-y-1 text-sm">
                {Object.entries(w.damageByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                  <li key={type} className="flex justify-between gap-3"><span>{type}</span><span className="font-semibold tabular-nums">{count}</span></li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{t('No damage recorded in this ward.')}</p>}
          </Fold>
        </div>

        <div className="space-y-6 xl:col-span-7">
          <Fold id="ward.incidents" icon={Siren} title={t('Incidents placed here ({n})', { n: facts.length })}
            info={t('Incidents the desk logged with this ward number.')}>
            {facts.length ? (
              <ul className="divide-y divide-border">
                {facts.map((f) => (
                  <li key={f.incident_id}>
                    <Link href={`/disaster/desk/${f.incident_id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-muted">
                      <span className="font-mono text-xs text-muted-foreground">{numbers.get(f.incident_id)}</span>
                      <span className="font-semibold">{f.short_title || f.hazard || t('Incident')}</span>
                      <DmStatusChip status={f.dm_status ?? 'Active'} />
                      <span className="ml-auto text-xs text-muted-foreground">{formatSaTime(f.updated_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="p-5 text-sm text-muted-foreground">{t('No incident placed in this ward yet.')}</p>}
          </Fold>
          <Fold id="ward.relief" icon={HandHeart} title={t('Relief given here ({n} people)', { n: helped })}
            info={t('People helped and items issued in this ward on every incident, through the ward councillor.')}>
            {relief.length ? (
              <ul className="divide-y divide-border text-sm">
                {relief.map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-x-4 gap-y-1 px-5 py-3">
                    <Link href={`/disaster/desk/${r.incident_id}`} className="font-semibold text-accent hover:underline">{formatSaTime(r.recorded_at)}</Link>
                    <span>{t('{p} people in {h} households', { p: r.people, h: r.households })}</span>
                    <span className="text-muted-foreground">{t('{b} blankets, {m} mattresses, {f} food hampers, {k} start-house kits', {
                      b: r.blankets, m: r.mattresses, f: r.food_hampers, k: r.start_house_kits })}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="p-5 text-sm text-muted-foreground">{t('No relief recorded in this ward yet.')}</p>}
          </Fold>
          <Fold id="ward.past" icon={History} title={t('Disasters on record ({n}, {d} deaths)', { n: past.length, d: deaths })}
            info={t('Past disasters from the records whose map point falls in this ward. Older records often give only the town, so a few may belong nearby.')}>
            {past.length ? (
              <ul className="divide-y divide-border text-sm">
                {past.map((e) => (
                  <li key={e.id} className="px-5 py-3">
                    <p className="flex flex-wrap gap-x-3"><span className="font-semibold">{e.event}</span>
                      <span className="text-muted-foreground">{e.occurred_on ? day.format(new Date(e.occurred_on)) : e.year}</span>
                      {e.deaths ? <span className="font-semibold text-severity-critical-ink">{t('{n} died', { n: e.deaths })}</span> : null}</p>
                    {e.place || e.notes ? <p className="text-muted-foreground">{[e.place, e.notes].filter(Boolean).join(' · ')}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-sm text-muted-foreground">
                {t('Nothing on record here.')} <Link href="/disaster/records" className="font-semibold text-accent hover:underline">{t('Load the records')}</Link>
              </p>
            )}
          </Fold>
        </div>
      </div>
    </div>
  );
}
