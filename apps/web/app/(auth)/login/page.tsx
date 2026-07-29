import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · Criticom' };

// Literal bg-* classes so Tailwind's content scanner generates each one.
const DEPARTMENTS = [
  { label: 'Metro Police', dot: 'bg-severity-high' },
  { label: 'Fire & Rescue', dot: 'bg-severity-critical' },
  { label: 'EMS', dot: 'bg-severity-low' },
  { label: 'Disaster Mgmt', dot: 'bg-accent' },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* ── Animated hero ── */}
      <section className="relative hidden overflow-hidden p-14 lg:flex lg:flex-col lg:justify-between">
        {/* background layers */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0a0f1e] via-[#0b1222] to-[#08080f]" />
        <div className="auth-aurora" style={{ width: 560, height: 560, top: -150, left: -120, background: 'radial-gradient(circle, rgba(220,53,69,0.55), transparent 65%)' }} />
        <div className="auth-aurora" style={{ width: 520, height: 520, bottom: -170, right: -110, background: 'radial-gradient(circle, rgba(59,130,246,0.5), transparent 65%)', animationDelay: '-8s' }} />
        <div className="auth-aurora" style={{ width: 380, height: 380, top: '42%', left: '44%', background: 'radial-gradient(circle, rgba(16,185,129,0.32), transparent 65%)', animationDelay: '-14s' }} />
        <div className="auth-grid absolute inset-0" />

        {/* emergency beacon pings */}
        <span className="auth-ping-dot text-severity-critical" style={{ top: '20%', left: '16%' }}><span className="auth-ping-core" /></span>
        <span className="auth-ping-dot text-accent" style={{ top: '64%', left: '26%' }}><span className="auth-ping-core" /></span>
        <span className="auth-ping-dot text-severity-low" style={{ top: '38%', left: '70%' }}><span className="auth-ping-core" /></span>
        <span className="auth-ping-dot text-severity-medium" style={{ top: '78%', left: '58%' }}><span className="auth-ping-core" /></span>

        {/* content */}
        <div className="auth-reveal relative z-10">
          <div className="auth-sheen inline-flex rounded-2xl bg-white/95 px-7 py-4 shadow-2xl shadow-black/50 ring-1 ring-white/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/criticomm-logo.png" alt="CRITICOMM — All in One EMS Dispatch Software" className="h-16 w-auto" />
          </div>
          <h1 className="mt-12 max-w-2xl text-4xl font-bold leading-tight xl:text-5xl">
            eThekwini Emergency Services <span className="text-primary">Command Centre</span>
          </h1>
          <p className="mt-5 max-w-md text-base text-muted-foreground">
            Unified dispatch, responder operations, and incident reporting across every department — in real time.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {DEPARTMENTS.map((d) => (
              <span key={d.label} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-sm backdrop-blur">
                <span className={`h-1.5 w-1.5 rounded-full ${d.dot}`} />
                {d.label}
              </span>
            ))}
          </div>
        </div>

        <p className="relative z-10 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 animate-pulse rounded-full bg-severity-low" />
          Authorised personnel only. All access is audited.
        </p>
      </section>

      {/* ── Sign-in ── */}
      <section className="relative flex items-center justify-center overflow-hidden bg-bg p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_25%,rgba(59,130,246,0.10),transparent_55%)]" />
        <div className="auth-reveal relative w-full max-w-sm" style={{ animationDelay: '0.1s' }}>
          {/* logo for mobile (hero hidden below lg) */}
          <div className="mb-8 inline-flex rounded-xl bg-white/95 px-4 py-2 shadow-lg lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/criticomm-logo.png" alt="CRITICOMM" className="h-10 w-auto" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight">Sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">Use your departmental email and password.</p>
          <div className="mt-8">
            {/* LoginForm reads ?next= via useSearchParams — needs a Suspense boundary to prerender */}
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </section>
    </main>
  );
}
