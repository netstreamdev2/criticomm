import { ShieldCheck } from 'lucide-react';

/**
 * The frame around every public onboarding page: the invitation, the
 * activation code and the POPIA notice. Calm, branded, and clear about whose
 * system this is.
 */
export function OnboardingShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-4 py-10 sm:py-14">
      <header className="mb-6 flex w-full max-w-lg items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-bg-card">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
        </span>
        <div className="leading-tight">
          <p className="font-bold tracking-wide">HikTech</p>
          <p className="text-xs text-muted-foreground">eThekwini Municipality · emergency services</p>
        </div>
      </header>
      <section className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-2xl border border-border bg-bg-card p-6 shadow-xl sm:p-8`}>
        {children}
      </section>
      <p className="mt-6 max-w-lg text-center text-xs text-muted-foreground">
        Authorised personnel only. Every step is recorded.
      </p>
    </main>
  );
}

/** A dead end explained: what happened and what to do next. */
export function OnboardingNotice({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return (
    <div className="space-y-3" role="status">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}
