'use client';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { cleanupOnLogout } from '@criticom/api';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const supabase = getBrowserSupabase();
          try { await cleanupOnLogout(supabase); } catch { /* even if cleanup fails we still sign out */ }
          await supabase.auth.signOut();
          router.push('/login');
          router.refresh();
        })
      }
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
