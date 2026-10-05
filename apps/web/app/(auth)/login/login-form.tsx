'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInEmailFor } from '@criticom/db';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const DEACTIVATED = 'This account has been deactivated. If you think this is a mistake, speak to your system administrator.';
const NO_MATCH = 'That email or badge number and password do not match an account.';

/** Only somewhere on this site: `?next=` must never send a person elsewhere after signing in. */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/dashboard';
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [entry, setEntry] = useState('');
  const [password, setPassword] = useState('');
  // Turned away by the middleware because the account was deactivated (0048).
  const [error, setError] = useState<string | null>(
    params.get('reason') === 'deactivated' ? DEACTIVATED : null,
  );
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        // Staff without email sign in with their badge number (0049).
        const email = signInEmailFor(entry);
        const supabase = getBrowserSupabase();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(
            error.code === 'user_banned' || /banned/i.test(error.message) ? DEACTIVATED
              : error.code === 'invalid_credentials' || /invalid login/i.test(error.message) ? NO_MATCH
                : error.message,
          );
          return;
        }
        router.push(next);
        router.refresh();
      } catch (e) {
        // e.g. Supabase not configured on the deployment — show the message
        // instead of white-screening with a client-side exception.
        setError((e as Error).message);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="hik-login-form space-y-4">
      <div>
        <Label htmlFor="email">Email or badge number</Label>
        <Input
          id="email"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          className="mt-2"
        />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2"
        />
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-severity-critical/40 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical-ink">
          {error}
        </p>
      )}
      <Button type="submit" className="hik-login-submit w-full" disabled={isPending}>
        {isPending ? 'Signing in…' : 'Sign in'}
      </Button>
      <p className="text-center text-sm">
        <Link href="/activate" className="font-semibold text-primary hover:underline">I have an activation code</Link>
      </p>
      <p className="text-center text-xs text-muted-foreground">
        Forgot your password? Speak to your system administrator. Accounts are created by invitation only.
      </p>
    </form>
  );
}
