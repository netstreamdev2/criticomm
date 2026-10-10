import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getDepartmentBranding, fallbackBranding, type DepartmentBranding } from '@criticom/api';
import type { Silo } from '@criticom/db/types';
import { getSupabase } from './supabase';
import { useAuth } from './auth';

/**
 * The responder's own department identity — crest, colours and naming — so
 * the app looks like the service the crew actually works for.
 *
 * Falls back to the built-in identity instantly, then swaps in whatever
 * Admin → Departments has configured. Branding never blocks a screen, and it
 * is always the signed-in department's: a row loaded for another account is
 * never shown.
 */

export type DeptIdentity = DepartmentBranding & { logoUrl: string | null };

const Ctx = createContext<DeptIdentity>({
  ...fallbackBranding('Ethekwini'),
  logoUrl: null,
});

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { silo, session } = useAuth();
  const [loaded, setLoaded] = useState<DeptIdentity | null>(null);
  const builtIn = useMemo<DeptIdentity>(() => ({ ...fallbackBranding(silo), logoUrl: null }), [silo]);

  useEffect(() => {
    setLoaded(null);
    if (!session) return;

    let live = true;
    void (async () => {
      try {
        const sb = getSupabase();
        const row = await getDepartmentBranding(sb, silo as Silo);
        const logoUrl = row.logo_path
          ? sb.storage.from('department-logos').getPublicUrl(row.logo_path).data.publicUrl || null
          : null;
        if (live) setLoaded({ ...row, logoUrl });
      } catch {
        /* keep the built-in identity */
      }
    })();
    return () => { live = false; };
  }, [silo, session]);

  const dept = loaded && loaded.silo === silo ? loaded : builtIn;
  return <Ctx.Provider value={dept}>{children}</Ctx.Provider>;
}

export const useDept = () => useContext(Ctx);
