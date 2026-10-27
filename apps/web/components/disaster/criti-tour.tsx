'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { CritiMascot } from '@/components/criti/mascot';
import { useT } from '@/components/i18n';
import { guideStatusAction } from '@/app/(app)/disaster/guide-actions';
import { AskCriti } from './ask-criti';

const GUIDE = 'disaster.tour';
const LATER = 'criti.disaster-tour.later';
/** Kept in the browser too, for before 0121 is run or when the answer could not be saved. */
const LOCAL = 'criti.disaster-tour.status';

type Step = { target?: string; title: string; text: string };

/** The dashboard's parts, in the order the eye should go. A step whose part is not on the page is skipped. */
const STEPS: Step[] = [
  { target: 'frame', title: 'On every Disaster screen', text: 'This strip says whether the JOC is active, shows any weather warning for eThekwini, and has the emergency number. Press a warning to open it.' },
  { target: 'home.actions', title: 'Start here', text: 'Open the Disaster desk to run the incidents, or add an incident yourself.' },
  { target: 'home.tiles', title: 'The figures now', text: 'Six figures for right now. Hover over one, or tap it, to see what is behind the number.' },
  { target: 'home.map', title: 'The live map', text: 'Open calls, halls and rain radar. Press Layers and type what you need: flood, fire, ward, school. The (i) beside a layer says what it shows.' },
  { target: 'home.calls', title: 'The open calls', text: 'Press a call to open its board: the level, the JOC, relief and the timeline, with Criti beside it.' },
  { title: 'The rest is in the menu', text: '' },
];

const PAGES: Array<{ href: string; label: string; what: string }> = [
  { href: '/disaster/warnings', label: 'Early Warnings', what: 'SAWS warnings, the steps, the SMS to councillors' },
  { href: '/disaster/incidents', label: 'Disaster Incidents', what: 'every incident, its level and status' },
  { href: '/disaster/map', label: 'Disaster Map', what: 'every layer, with a search' },
  { href: '/disaster/watch', label: 'Hazard Watch', what: 'the latest from every outside source' },
  { href: '/disaster/wards', label: 'Ward Profiles', what: 'each ward’s councillor, needs and history' },
  { href: '/disaster/readiness', label: 'Readiness and IDP', what: 'the score, relief stock, the IDP figures' },
];

/**
 * Criti's tour of the Disaster screens. The first time someone opens a
 * Disaster screen, Criti offers it: take the tour, practise an incident,
 * not now (asked again next time), or don't show this again (kept with the
 * account, 0121). The tour lights up each part of the dashboard in turn and
 * says what it does. /disaster?tour=1 starts it any time.
 */
export function CritiTour({ status }: { status: 'done' | 'dismissed' | null | 'unknown' }) {
  const { t } = useT();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [phase, setPhase] = useState<'idle' | 'welcome' | 'tour'>('idle');
  const [steps, setSteps] = useState<Step[]>([]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const remember = useCallback((s: 'done' | 'dismissed') => {
    try { localStorage.setItem(LOCAL, s); } catch { /* the account keeps it */ }
    void guideStatusAction(GUIDE, s);
  }, []);

  const start = useCallback(() => {
    if (path !== '/disaster') {
      router.push('/disaster?tour=1');
      setPhase('idle');
      return;
    }
    const here = STEPS.filter((s) => !s.target || document.querySelector(`[data-guide="${s.target}"]`));
    setSteps(here);
    setI(0);
    setPhase('tour');
  }, [path, router]);

  // Offer it once: never to someone who took it or turned it off, on this account or in this browser.
  useEffect(() => {
    if (params.get('tour') === '1') {
      // Wait a moment for the page's parts to be drawn.
      const timer = setTimeout(start, 400);
      return () => clearTimeout(timer);
    }
    let seen = status === 'done' || status === 'dismissed';
    try {
      if (localStorage.getItem(LOCAL)) seen = true;
      if (sessionStorage.getItem(LATER)) seen = true;
    } catch { /* storage blocked: the account's answer decides */ }
    if (!seen) setPhase('welcome');
    return undefined;
  }, [params, status, start]);

  const step = phase === 'tour' ? steps[i] : undefined;

  // Light up the step's part, and keep the light on it as the page moves.
  useLayoutEffect(() => {
    if (!step?.target) { setRect(null); return; }
    const el = document.querySelector(`[data-guide="${step.target}"]`);
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRect(el.getBoundingClientRect()));
    };
    measure();
    const settle = setTimeout(measure, 450);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  useEffect(() => {
    if (phase === 'idle') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const close = () => {
    try { sessionStorage.setItem(LATER, '1'); } catch { /* fine */ }
    setPhase('idle');
    if (params.get('tour') === '1') router.replace(path);
  };
  const finish = () => {
    remember('done');
    setPhase('idle');
    if (params.get('tour') === '1') router.replace(path);
  };

  if (phase === 'welcome') {
    return (
      <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="criti-welcome">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-card p-6 shadow-2xl">
          <div className="flex items-start gap-4">
            <CritiMascot className="h-16 w-16 shrink-0" variant="full" />
            <div className="min-w-0">
              <h2 id="criti-welcome" className="text-xl font-bold">{t('Hi, I’m Criti.')}</h2>
              <p className="mt-1 text-[15px] text-muted-foreground">
                {t('New to the Disaster screens? I can show you around in two minutes, or walk you through a practice incident. Practice never reaches the desk.')}
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={start} className="h-12 rounded-md bg-primary px-4 font-semibold text-primary-foreground">{t('Take the tour')}</button>
            <button type="button" onClick={() => { setPhase('idle'); router.push('/disaster/practice'); }}
              className="h-12 rounded-md bg-accent px-4 font-semibold text-accent-foreground">{t('Practise an incident')}</button>
            <button type="button" onClick={close} className="h-12 rounded-md border border-border px-4 font-semibold hover:bg-muted">{t('Not now')}</button>
            <button type="button" onClick={() => { remember('dismissed'); setPhase('idle'); }}
              className="h-12 rounded-md border border-border px-4 text-sm font-semibold text-muted-foreground hover:bg-muted">{t('Don’t show this again')}</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase !== 'tour' || !step) return null;
  const last = i === steps.length - 1;
  const pad = 8;
  const below = rect ? rect.bottom + 260 < window.innerHeight : false;
  const bubbleTop = rect ? (below ? rect.bottom + pad + 12 : Math.max(12, rect.top - pad - 12)) : undefined;
  const bubbleLeft = rect ? Math.min(Math.max(12, rect.left), window.innerWidth - 400) : undefined;

  return (
    <div className="fixed inset-0 z-[75]" role="dialog" aria-modal="true" aria-labelledby="criti-step">
      {rect ? (
        <div aria-hidden className="pointer-events-none fixed rounded-xl ring-4 ring-accent transition-all duration-200"
          style={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.62)' }} />
      ) : <div aria-hidden className="fixed inset-0 bg-black/60" />}
      <div className="fixed w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border border-border bg-bg-card p-5 shadow-2xl"
        style={rect ? { top: bubbleTop, left: bubbleLeft, transform: below ? undefined : 'translateY(-100%)' } : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'min(34rem, calc(100vw - 1.5rem))' }}>
        <div className="flex items-start gap-3">
          <CritiMascot className="h-10 w-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-muted-foreground">{t('Step {n} of {all}', { n: i + 1, all: steps.length })}</p>
            <h2 id="criti-step" className="text-lg font-bold">{t(step.title)}</h2>
          </div>
          <button type="button" onClick={close} aria-label={t('Close the tour')} className="grid h-9 w-9 place-items-center rounded-md hover:bg-muted"><X className="h-4 w-4" aria-hidden /></button>
        </div>
        {step.text ? <p className="mt-2 text-[15px] leading-relaxed">{t(step.text)}</p> : null}
        {last ? (
          <div className="mt-2 space-y-3">
            <ul className="grid gap-1.5 text-sm">
              {PAGES.map((p) => (
                <li key={p.href}><Link href={p.href} onClick={finish} className="font-semibold text-accent hover:underline">{t(p.label)}</Link>
                  <span className="text-muted-foreground">: {t(p.what)}</span></li>
              ))}
            </ul>
            <AskCriti page="Disaster dashboard" />
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {i > 0 ? <button type="button" onClick={() => setI(i - 1)} className="h-11 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted">{t('Back')}</button> : null}
          {last ? (
            <>
              <button type="button" onClick={() => { finish(); router.push('/disaster/practice'); }}
                className="h-11 rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground">{t('Practise an incident')}</button>
              <button type="button" onClick={finish} className="ml-auto h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground">{t('Finish')}</button>
            </>
          ) : (
            <button type="button" onClick={() => setI(i + 1)} className="ml-auto h-11 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground">{t('Next')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
