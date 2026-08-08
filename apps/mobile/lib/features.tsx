import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFeatureMap, subscribeFeatureFlags, featureEnabled, type FeatureMap } from '@criticom/api';
import { getSupabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

/**
 * Per-tenant feature flags on the phone.
 *
 * The app is modular: every module consults these flags before rendering, so
 * a SuperAdmin's toggle reshapes the app for their whole organisation — tabs
 * appear and disappear, the SOS button exists or does not — without a store
 * release.
 *
 * Three sources, in order of arrival:
 *   1. The AsyncStorage cache, synchronously-ish on launch — so a crew member
 *      opening the app in a dead zone gets their tenant's last-known shape,
 *      not the defaults and not a blank shell.
 *   2. A fresh fetch once signed in, and again on foreground.
 *   3. Realtime, so a toggle flipped mid-shift lands within moments.
 *
 * Failure bias: every read failure falls back to catalogue defaults, which
 * are all-enabled. A flags outage must never strip a working app — the cost
 * of briefly showing a disabled module is a refusal at its API; the cost of
 * hiding the SOS button wrongly is not comparable.
 */

const CACHE_KEY = 'criticom.features.v1';

type FeaturesApi = {
  features: FeatureMap;
  /** True unless the flag is explicitly off for this tenant. */
  enabled: (key: string) => boolean;
  /** Distinguishes "defaults" from "this tenant's real answer". */
  loaded: boolean;
};

const Ctx = createContext<FeaturesApi>({ features: {}, enabled: () => true, loaded: false });

export function useFeatures(): FeaturesApi {
  return useContext(Ctx);
}

/** Convenience for single-flag call sites. */
export function useFeature(key: string): boolean {
  return useFeatures().enabled(key);
}

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [features, setFeatures] = useState<FeatureMap>({});
  const [loaded, setLoaded] = useState(false);

  // 1. Cache first, before any network.
  useEffect(() => {
    void AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as FeatureMap;
        if (parsed && typeof parsed === 'object') setFeatures(parsed);
      })
      .catch(() => { /* cache is best-effort by definition */ });
  }, []);

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      const map = await getFeatureMap(getSupabase());
      setFeatures(map);
      setLoaded(true);
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(map)).catch(() => {});
    } catch {
      // Offline or flags unreachable: keep whatever we have.
    }
  }, [session]);

  // 2. Fresh on sign-in, and on returning to the app.
  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // 3. Live while running.
  useEffect(() => {
    if (!session) return;
    try {
      const off = subscribeFeatureFlags(getSupabase(), () => void refresh());
      return off;
    } catch {
      return;
    }
  }, [session, refresh]);

  const api = useMemo<FeaturesApi>(() => ({
    features,
    enabled: (key: string) => featureEnabled(features, key),
    loaded,
  }), [features, loaded]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
