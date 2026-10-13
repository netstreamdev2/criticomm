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
 *
 * Alongside it, the municipality the platform serves (the control room's
 * row, eThekwini): its crest sits quietly on report screens and the profile.
 * HikTech's own mark is never replaced. Like every crest here it is uploaded
 * by an administrator, never shipped with the app.
 */

export type DeptIdentity = DepartmentBranding & { logoUrl: string | null };

const ORG_SILO: Silo = 'Ethekwini';

const Ctx = createContext<{ dept: DeptIdentity; org: DeptIdentity }>({
  dept: { ...fallbackBranding(ORG_SILO), logoUrl: null },
  org: { ...fallbackBranding(ORG_SILO), logoUrl: null },
});

async function load(silo: Silo): Promise<DeptIdentity> {
  const sb = getSupabase();
  const row = await getDepartmentBranding(sb, silo);
  const logoUrl = row.logo_path
    ? sb.storage.from('department-logos').getPublicUrl(row.logo_path).data.publicUrl || null
    : null;
  return { ...row, logoUrl };
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { silo, session } = useAuth();
  const [loaded, setLoaded] = useState<DeptIdentity | null>(null);
  const [org, setOrg] = useState<DeptIdentity | null>(null);
  const builtIn = useMemo<DeptIdentity>(() => ({ ...fallbackBranding(silo), logoUrl: null }), [silo]);
  const builtInOrg = useMemo<DeptIdentity>(() => ({ ...fallbackBranding(ORG_SILO), logoUrl: null }), []);

  useEffect(() => {
    setLoaded(null);
    setOrg(null);
    if (!session) return;

    let live = true;
    // Each on its own: either failing keeps the built-in identity.
    void load(silo as Silo).then((d) => { if (live) setLoaded(d); }).catch(() => {});
    void load(ORG_SILO).then((d) => { if (live) setOrg(d); }).catch(() => {});
    return () => { live = false; };
  }, [silo, session]);

  const value = useMemo(() => ({
    dept: loaded && loaded.silo === silo ? loaded : builtIn,
    org: org ?? builtInOrg,
  }), [loaded, silo, builtIn, org, builtInOrg]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The signed-in department's identity. */
export const useDept = () => useContext(Ctx).dept;

/** The municipality the platform serves (eThekwini): crest and official name. */
export const useOrg = () => useContext(Ctx).org;
