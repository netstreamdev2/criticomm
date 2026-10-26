'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileText } from 'lucide-react';
import { RELIEF_ITEMS, type CoordinationLevel } from '@criticom/db/disaster-plan';
import { DESK_POST_MORTEM_SECTIONS, durationHours, saStamp } from '@criticom/db/post-mortem';
import { useT } from '@/components/i18n';
import { cn } from '@/lib/utils';
import { fileDeskPostMortemAction } from '../../actions';
import { LevelChip } from '../call-facts';

/**
 * The Official After-Action Report from the Disaster desk, laid out as on
 * the phone: what the record already says at the top, the report's
 * sections with Now for the times, the timeline at the bottom, one button to
 * file. Criti drafts the cause and the lessons from the timeline.
 */

type Props = {
  incidentId: string; number: string; title: string; location: string;
  facts: { hazard: string | null; level: CoordinationLevel; municipalities: string[]; docActivated: boolean; scgConvened: boolean; fcp: string | null; eoc: string | null };
  callouts: Array<{ name: string; type: string | null; status: string; calledAt: string; onSceneAt: string | null; leftAt: string | null }>;
  shelters: Array<{ name: string; peak: number; households: number; relief: Record<string, number> }>;
  timeline: Array<{ at: string; text: string }>;
  initial: Record<string, string>;
};

const clock = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const at = (iso: string | null) => (iso ? clock.format(new Date(iso)) : '—');

export function DeskPostMortemForm(p: Props) {
  const { t } = useT();
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>(p.initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<'idle' | 'busy' | 'none'>('idle');
  const [pending, start] = useTransition();
  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));
  const hours = durationHours(answers.start_time ?? '', answers.end_time ?? '');

  const draft = async () => {
    setDrafting('busy');
    try {
      const res = await fetch('/api/disaster/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ incidentId: p.incidentId, mode: 'post-mortem' }) });
      const j = (await res.json()) as { draft?: { injuries: number | null; fatalities: number | null; displacedPeople: number | null; rootCause: string; lessonsLearned: string } | null };
      const d = j.draft;
      if (!d) { setDrafting('none'); return; }
      setAnswers((a) => ({
        ...a,
        ...(!(a.root_cause ?? '').trim() && d.rootCause ? { root_cause: d.rootCause } : {}),
        ...(!(a.lessons_learned ?? '').trim() && d.lessonsLearned ? { lessons_learned: d.lessonsLearned } : {}),
      }));
      setDrafting('idle');
    } catch {
      setDrafting('none');
    }
  };
  const file = () => {
    if (!window.confirm(t('File the Official Report? It resolves {number}.', { number: p.number }))) return;
    setProblem(null);
    start(async () => {
      const res = await fileDeskPostMortemAction(p.incidentId, answers);
      if ('error' in res) { setProblem(res.error); return; }
      router.push(`/incidents/${p.incidentId}`);
    });
  };
  const field = 'mt-1 w-full rounded-md border border-border bg-bg-soft px-3 text-[15px]';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href={`/disaster/desk/${p.incidentId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden />{t('Back to the call')}
      </Link>

      <section className="rounded-xl border border-t-4 border-border border-t-primary bg-bg-card p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Official After-Action Report')}</p>
        <h1 className="mt-1 text-2xl font-bold">{p.title}</h1>
        <p className="text-sm text-muted-foreground"><span className="font-mono">{p.number}</span> · {p.location}</p>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <KV label={t('Hazard')} value={p.facts.hazard ?? t('Not set')} />
          <div><dt className="text-xs text-muted-foreground">{t('Highest level')}</dt><dd className="mt-0.5"><LevelChip level={p.facts.level} /></dd></div>
          <KV label={t('Municipalities affected')} value={p.facts.municipalities.join(', ') || '—'} />
          <KV label={t('DOC activated · SCG in session')} value={`${p.facts.docActivated ? t('Yes') : t('No')} · ${p.facts.scgConvened ? t('Yes') : t('No')}`} />
          {p.facts.fcp ? <KV label={t('Forward Control Point (FCP)')} value={p.facts.fcp} /> : null}
          {p.facts.eoc ? <KV label={t('Emergency Operations Centre (EOC)')} value={p.facts.eoc} /> : null}
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-bg-card p-6 shadow-sm">
        <h2 className="font-semibold">{t('Response')}</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {p.callouts.length === 0 ? <li className="text-muted-foreground">{t('Nobody called out.')}</li> : null}
          {p.callouts.map((c, i) => (
            <li key={`${c.name}${i}`} className="flex flex-wrap justify-between gap-2 rounded-lg border border-border bg-bg-soft px-3 py-2">
              <span className="font-semibold">{c.name}{c.type ? <span className="ml-2 font-normal text-muted-foreground">{c.type}</span> : null}</span>
              <span className="text-muted-foreground">{t('called {a} · on scene {b} · left {c}', { a: at(c.calledAt), b: at(c.onSceneAt), c: at(c.leftAt) })}</span>
            </li>
          ))}
        </ul>
        {p.shelters.length ? (
          <ul className="mt-4 space-y-2 text-sm">
            {p.shelters.map((s, i) => (
              <li key={`${s.name}${i}`} className="rounded-lg border border-border bg-bg-soft px-3 py-2">
                <span className="font-semibold">{s.name}</span>
                <span className="ml-2 text-muted-foreground">
                  {t('most at once {n} · {h} households', { n: s.peak, h: s.households })}
                  {RELIEF_ITEMS.filter((r) => (s.relief[r.key] ?? 0) > 0).map((r) => ` · ${s.relief[r.key]} ${r.label.toLowerCase()}`).join('')}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {DESK_POST_MORTEM_SECTIONS.map((s) => (
        <section key={s.id} className="rounded-xl border border-border bg-bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">{t(s.title)}</h2>
            {s.id === 'analysis' ? (
              <button type="button" onClick={draft} disabled={drafting === 'busy'}
                className="h-10 rounded-md border border-accent/50 bg-accent/10 px-4 text-sm font-semibold text-accent hover:bg-accent/20 disabled:opacity-60">
                {drafting === 'busy' ? t('Criti is writing…') : t('Draft with Criti')}
              </button>
            ) : null}
          </div>
          {drafting === 'none' && s.id === 'analysis' ? <p className="mt-2 text-sm text-muted-foreground">{t('Criti could not draft it now. Write it yourself.')}</p> : null}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {s.fields.map((f) => (
              <div key={f.key} className={cn('text-sm font-medium', f.kind === 'multiline' && 'sm:col-span-2')}>
                <label htmlFor={`pm-${f.key}`}>{t(f.label)}{f.required ? <span className="text-severity-critical-ink"> *</span> : null}</label>
                {f.kind === 'multiline' ? (
                  <textarea id={`pm-${f.key}`} rows={4} value={answers[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder ? t(f.placeholder) : undefined}
                    className={cn(field, 'py-2')} />
                ) : (
                  <span className="flex gap-2">
                    <input id={`pm-${f.key}`} value={answers[f.key] ?? ''} onChange={(e) => set(f.key, f.kind === 'count' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)}
                      inputMode={f.kind === 'count' ? 'numeric' : undefined} placeholder={f.kind === 'datetime' ? 'YYYY-MM-DD HH:MM' : undefined}
                      className={cn(field, 'h-11')} />
                    {f.kind === 'datetime' ? (
                      <button type="button" onClick={() => set(f.key, saStamp(new Date()))} className="mt-1 h-11 shrink-0 rounded-md border border-border px-3 text-sm font-semibold hover:bg-muted">{t('Now')}</button>
                    ) : null}
                  </span>
                )}
              </div>
            ))}
          </div>
          {s.id === 'overview' && hours !== null ? <p className="mt-3 text-sm font-semibold">{t('Duration: {hours} hours', { hours })}</p> : null}
          {s.id === 'impact' ? (
            <div className="mt-4">
              <p className="text-sm font-medium">{t('Recommend declaring a local state of disaster?')}</p>
              <div className="mt-2 flex gap-2">
                {(['no', 'yes'] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={answers.local_disaster_recommended === v} onClick={() => set('local_disaster_recommended', v)}
                    className={cn('h-10 rounded-md border px-5 text-sm font-semibold',
                      answers.local_disaster_recommended === v ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted-foreground hover:bg-muted')}>
                    {v === 'yes' ? t('Yes') : t('No')}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ))}

      <section className="rounded-xl border border-border bg-bg-card p-6 shadow-sm">
        <h2 className="font-semibold">{t('Timeline')}</h2>
        <ol className="mt-3 max-h-[24rem] space-y-2 overflow-y-auto text-sm">
          {p.timeline.length === 0 ? <li className="text-muted-foreground">{t('No updates yet.')}</li> : null}
          {p.timeline.map((e, i) => (
            <li key={`${e.at}${i}`} className="flex gap-3"><span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{at(e.at)}</span><span>{e.text}</span></li>
          ))}
        </ol>
      </section>

      {problem ? (
        <p role="alert" className="rounded-lg border border-severity-critical bg-bg-card px-4 py-3 text-sm font-medium text-severity-critical-ink">{problem}</p>
      ) : null}
      <button type="button" onClick={file} disabled={pending}
        className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-severity-low text-base font-bold text-severity-low-fg disabled:opacity-60">
        <FileText className="h-5 w-5" aria-hidden />{pending ? t('Filing…') : t('File Official Report')}
      </button>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-semibold">{value}</dd></div>;
}
