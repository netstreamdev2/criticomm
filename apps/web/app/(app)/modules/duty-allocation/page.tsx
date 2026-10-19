import { addDays, listAvailableStaff, listCallSigns, listSectionDetails, saDay } from '@criticom/api';
import { tx } from '@criticom/db/i18n';
import { OfficeHeader } from '@/components/office/office-header';
import { ox } from '@/components/office/styles';
import { InfoTip } from '@/components/ui/info-tip';
import { openModule } from '@/lib/office';
import { cn } from '@/lib/utils';
import { requestT } from '@/lib/i18n';
import { AllocationBoard } from './allocation-board';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Duty Allocation · HikTech' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Duty Allocation (Oracle DCPDUTA): choose the section and the duty period,
 * then pair the section's call signs with available staff and save.
 */
export default async function DutyAllocationPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; section?: string; from?: string; to?: string }>;
}) {
  const { t } = await requestT();
  const p = await searchParams;
  const ctx = await openModule('DUTA', p.dept);
  const { supabase, target } = ctx;
  const today = saDay();
  const from = DAY.test(p.from ?? '') ? p.from! : addDays(today, 1);
  const to = DAY.test(p.to ?? '') && p.to! >= from ? p.to! : from;
  const sections = await listSectionDetails(supabase, target);
  const section = sections.find((s) => s.id === p.section) ?? null;
  const [signs, staff] = section
    ? await Promise.all([
        listCallSigns(supabase, { silo: target, sectionId: section.id }),
        listAvailableStaff(supabase, { silo: target, from, to }),
      ])
    : [[], []];

  return (
    <div className="space-y-4">
      <OfficeHeader title={tx('Duty Allocation')} info={tx('Choose a section and the dates. Tick call signs and staff, press Allocate selected to pair them in order, then Confirm & save. Each member is told once.')}
        target={target} global={ctx.global} canEdit={ctx.canEdit} path="/modules/duty-allocation" />

      <section className={ox.card}>
        <div className={ox.cardHead}><h2 className={ox.cardTitle}>{t('Section & duty period')}</h2></div>
        <form method="get" className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto] lg:items-end">
          {ctx.global ? <input type="hidden" name="dept" value={target} /> : null}
          <label><span className={ox.label}>{t('Section code')}</span>
            <select name="section" required defaultValue={section?.id ?? ''} className={ox.input}>
              <option value="" disabled>{t('Choose…')}</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select></label>
          <label><span className={ox.label}>{t('Short description')}</span>
            <input readOnly value={section?.short_desc ?? section?.name ?? ''} className={cn(ox.input, 'bg-muted/40')} tabIndex={-1} /></label>
          <label><span className={ox.label}>{t('Duty from')}</span>
            <input name="from" type="date" required min={today} defaultValue={from} className={ox.input} /></label>
          <label><span className={ox.label}>{t('Duty to')} <InfoTip text={t('Up to two months. Every day in the range is booked.')} /></span>
            <input name="to" type="date" required min={today} defaultValue={to} className={ox.input} /></label>
          <button type="submit" className={ox.primary}>{t('Load')}</button>
        </form>
        {sections.length === 0 ? (
          <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">{t('No sections yet. Add them under Sections first.')}</p>
        ) : null}
      </section>

      {section ? (
        <AllocationBoard
          key={`${section.id}-${from}-${to}`}
          sectionId={section.id}
          from={from}
          to={to}
          canEdit={ctx.canEdit}
          signs={signs.map((s) => ({ id: s.id, callSign: s.call_sign ?? s.name, start: s.start_time?.slice(0, 5) ?? '', stop: s.stop_time?.slice(0, 5) ?? '', rank: s.rank, description: s.description }))}
          staff={staff}
        />
      ) : null}
    </div>
  );
}
