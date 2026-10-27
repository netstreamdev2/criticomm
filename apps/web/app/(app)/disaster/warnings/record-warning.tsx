'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, RefreshCw } from 'lucide-react';
import { WARNING_HAZARDS, colourFor } from '@criticom/db/disaster-warnings';
import { Modal } from '@/components/ui/modal';
import { useT } from '@/components/i18n';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { checkSawsNowAction, recordWarningAction } from './actions';

/** "YYYY-MM-DDTHH:MM" in South African time, for a datetime field. */
function localNow(addHours = 0) {
  const d = new Date(Date.now() + addHours * 3600_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}

/**
 * Record a SA Weather Service warning that came by email or PDF: hazard,
 * level, colour (matches the level unless the warning says otherwise),
 * validity, areas and the expected impacts, as SAWS wrote them.
 */
export function RecordWarning() {
  const { t } = useT();
  const router = useRouter();
  const ref = useRef(crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const blank = () => ({ hazard: 'Disruptive rain', level: '4', colour: '', valid_from: localNow(), valid_until: localNow(12), areas: '', impacts: '', instructions: '' });
  const [v, setV] = useState(blank);
  const set = (k: keyof ReturnType<typeof blank>, x: string) => setV((cur) => ({ ...cur, [k]: x }));
  const level = Number(v.level);
  const levelOk = Number.isInteger(level) && level >= 1 && level <= 10;

  const save = () => start(async () => {
    setError(null);
    const res = await recordWarningAction(ref.current, v);
    if ('error' in res) { setError(res.error); return; }
    ref.current = crypto.randomUUID();
    setOpen(false);
    setV(blank());
    router.push(`/disaster/warnings/${res.id}`);
  });

  const field = 'mt-1 h-11 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';
  return (
    <>
      <button type="button" data-guide="warnings.record" onClick={() => { setOpen(true); setError(null); }}
        className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground">
        <Plus className="h-4 w-4" aria-hidden />{t('Record a warning')}
      </button>
      {open ? (
        <Modal title={t('Record a SA Weather Service warning')} onClose={() => setOpen(false)} busy={pending} wide
          confirmClose={v.areas || v.impacts ? { title: t('Close without saving?'), body: t('The warning typed so far is not kept.') } : null}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className="h-11 rounded-md border border-border px-5 text-sm font-semibold hover:bg-muted">{t('Cancel')}</button>
              <button type="button" onClick={save} disabled={pending || !levelOk || !v.areas.trim() || !v.valid_until}
                className="h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {pending ? t('Saving…') : t('Record warning')}
              </button>
            </div>
          )}>
          <div className="space-y-4">
            {error ? <p role="alert" className="rounded-md border border-severity-critical px-3 py-2 text-sm font-medium text-severity-critical-ink">{error}</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">{t('Hazard')}
                <select value={v.hazard} onChange={(e) => set('hazard', e.target.value)} className={field}>
                  {WARNING_HAZARDS.map((h) => <option key={h} value={h}>{t(h)}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">{t('Impact level (1 to 10)')}
                <input type="number" inputMode="numeric" min={1} max={10} value={v.level} onChange={(e) => set('level', e.target.value)}
                  className={cn(field, !levelOk && 'border-severity-critical')} />
              </label>
              <label className="block text-sm font-medium">{t('Colour')}
                <select value={v.colour} onChange={(e) => set('colour', e.target.value)} className={field}>
                  <option value="">{levelOk ? t('Match the level ({colour})', { colour: t(colourFor(level)) }) : t('Match the level')}</option>
                  <option value="Yellow">{t('Yellow')}</option>
                  <option value="Orange">{t('Orange')}</option>
                  <option value="Red">{t('Red')}</option>
                </select>
              </label>
              <span className="hidden sm:block" />
              <label className="block text-sm font-medium">{t('Valid from')}
                <input type="datetime-local" value={v.valid_from} onChange={(e) => set('valid_from', e.target.value)} className={field} />
              </label>
              <label className="block text-sm font-medium">{t('Valid until')}
                <input type="datetime-local" value={v.valid_until} onChange={(e) => set('valid_until', e.target.value)} className={field} />
              </label>
            </div>
            <label className="block text-sm font-medium">{t('Affected areas')}
              <input value={v.areas} onChange={(e) => set('areas', e.target.value)} maxLength={2000} placeholder={t('For example: eThekwini, KwaDukuza, Ndwedwe')} className={field} />
            </label>
            <label className="block text-sm font-medium">{t('Expected impacts')}
              <textarea value={v.impacts} onChange={(e) => set('impacts', e.target.value)} rows={4} maxLength={4000} placeholder={t('As stated in the warning')}
                className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
            </label>
            <label className="block text-sm font-medium">{t('What people should do (if the warning says)')}
              <textarea value={v.instructions} onChange={(e) => set('instructions', e.target.value)} rows={2} maxLength={4000}
                className="mt-1 w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-[15px]" />
            </label>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Ask the SA Weather Service now. */
export function CheckSawsNow() {
  const { t } = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      onClick={() => start(async () => {
        const res = await checkSawsNowAction();
        if ('error' in res) toast.push({ title: res.error, tone: 'warning' });
        else toast.push({ title: res.forUs ? t('{n} new warning file(s) for eThekwini.', { n: res.forUs }) : t('Nothing new from the SA Weather Service.'), tone: 'success' });
        router.refresh();
      })}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50">
      <RefreshCw className={cn('h-3.5 w-3.5', pending && 'animate-spin')} aria-hidden />{pending ? t('Checking…') : t('Check now')}
    </button>
  );
}
