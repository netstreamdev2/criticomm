import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · Criticom' };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden bg-gradient-to-br from-bg-soft via-bg-card to-bg p-12 lg:flex lg:flex-col lg:justify-between">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/criticomm-logo.png" alt="CRITICOMM — All in One EMS Dispatch Software" className="h-16 w-auto" />
          <h1 className="mt-8 text-4xl font-bold">eThekwini Emergency Services Command Centre</h1>
          <p className="mt-4 max-w-md text-muted-foreground">
            Unified dispatch, responder operations, and incident reporting across Metro Police, Fire & Rescue,
            EMS, and Disaster Management.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Authorised personnel only. All access is audited.
        </p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Logo for mobile (left panel hidden below lg) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/criticomm-logo.png" alt="CRITICOMM" className="mb-6 h-10 w-auto lg:hidden" />
          <h2 className="text-2xl font-bold">Sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">Use your departmental email and password.</p>
          <div className="mt-8">
            {/* LoginForm reads ?next= via useSearchParams — needs a Suspense boundary to prerender */}
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </div>
    </main>
  );
}
