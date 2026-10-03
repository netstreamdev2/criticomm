import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Mobile design tokens — dark mirrors the web app's `criticom-dark` theme
 * (apps/web/app/themes.css) so both surfaces read as one product; light is
 * its daytime counterpart, chosen with the toggle in the header.
 *
 * How the switch works, and why it is safe:
 *   • `colors` and `paper` are single objects whose values are swapped in
 *     place, so every `colors.x` read at render time is the current theme.
 *   • Every stylesheet is built through `makeStyles`, which rebuilds it when
 *     the theme changes and re-renders the component using it — the whole app
 *     changes at once, in place, without a reload (a half-filled shift form
 *     keeps its answers).
 *   • Each light value was picked against its partner background, so text
 *     never ends up white-on-white or dark-on-dark: text sits on bg/bgCard/
 *     panel; `onColor` (white) only ever sits on a saturated fill.
 */

const dark = {
  bg: '#050510',
  bgSoft: '#0b0b1a',
  bgCard: '#11112a',
  bgElevated: '#181838',
  border: '#1f1f3a',
  borderStrong: '#2e2e52',
  text: '#ffffff',
  textDim: '#c9cdd8',
  muted: '#9ca3af',
  primary: '#dc3545',
  primarySoft: 'rgba(220, 53, 69, 0.16)',
  accent: '#3b82f6',
  accentSoft: 'rgba(59, 130, 246, 0.16)',
  low: '#10b981',
  lowSoft: 'rgba(16, 185, 129, 0.16)',
  medium: '#f59e0b',
  mediumSoft: 'rgba(245, 158, 11, 0.16)',
  high: '#f97316',
  highSoft: 'rgba(249, 115, 22, 0.16)',
  critical: '#ef4444',
  criticalSoft: 'rgba(239, 68, 68, 0.16)',
  /** Home cards: frosted panel over the earth-at-night backdrop. */
  panel: 'rgba(14,15,24,0.92)',
  panelBorder: 'rgba(255,255,255,0.07)',
  /** Thin separators inside panels. */
  divider: 'rgba(255,255,255,0.10)',
  hairline: 'rgba(255,255,255,0.06)',
  /** Empty part of progress tracks and bars. */
  track: 'rgba(255,255,255,0.08)',
  /** Text and icons on a saturated fill (buttons, pills) — white in both themes. */
  onColor: '#ffffff',
  /** "Idle" on the home activity chip. */
  idle: '#bae6fd',
  /** Cyan accents (map, backup tags) — readable on the theme's background. */
  cyan: '#22d3ee',
  /** Light-blue accent text (section titles). */
  accentInk: '#93c5fd',
  /** Purple accent text (backup, transporting). */
  purple: '#a855f7',
};

export type Palette = { [K in keyof typeof dark]: string };

const light: Palette = {
  bg: '#f2f4f9',
  bgSoft: '#ffffff',
  bgCard: '#ffffff',
  bgElevated: '#e9edf5',
  border: '#dfe4ee',
  borderStrong: '#c6cedd',
  text: '#0f172a',
  textDim: '#334155',
  muted: '#5f6b7e',
  primary: '#dc3545',
  primarySoft: 'rgba(220, 53, 69, 0.10)',
  accent: '#2563eb',
  accentSoft: 'rgba(37, 99, 235, 0.10)',
  low: '#059669',
  lowSoft: 'rgba(5, 150, 105, 0.12)',
  medium: '#d97706',
  mediumSoft: 'rgba(217, 119, 6, 0.12)',
  high: '#ea580c',
  highSoft: 'rgba(234, 88, 12, 0.12)',
  critical: '#dc2626',
  criticalSoft: 'rgba(220, 38, 38, 0.10)',
  panel: '#ffffff',
  panelBorder: '#dfe4ee',
  divider: '#e5e9f1',
  hairline: '#edf0f5',
  track: '#e6eaf1',
  onColor: '#ffffff',
  idle: '#0369a1',
  cyan: '#0891b2',
  accentInk: '#1d4ed8',
  purple: '#7c3aed',
};

/**
 * Start-of-shift paperwork (components/shift-form.tsx): shaded dark slate, or
 * the white sheet of the paper 187(c) in light mode.
 */
const paperDark = {
  /** Panels: groups, headers, footers. */
  sheet: '#161d2f',
  /** Behind the panels. */
  canvas: '#0f1424',
  /** Inputs and wells, a step darker than the panel they sit on. */
  field: '#0c1120',
  /** Buttons, item rows and chips, a step lighter than the panel. */
  raised: '#1d2539',
  /** The crest band. */
  head: '#121a2e',
  ink: '#eef2f8',
  inkDim: '#c5ccda',
  muted: '#8d97ab',
  faint: '#5f6a80',
  line: '#253049',
  lineStrong: '#33405e',
  blue: '#3b82f6',
  blueSoft: 'rgba(59,130,246,0.16)',
  /** Blue text (section titles, Next): light blue on dark, deep blue on white. */
  blueInk: '#93c5fd',
  green: '#10b981',
  greenSoft: 'rgba(16,185,129,0.15)',
  red: '#ef4444',
  redSoft: 'rgba(239,68,68,0.14)',
  amber: '#f59e0b',
  amberSoft: 'rgba(245,158,11,0.14)',
  lime: '#84cc16',
  limeSoft: 'rgba(132,204,22,0.14)',
};

export type PaperPalette = { [K in keyof typeof paperDark]: string };

const paperLight: PaperPalette = {
  sheet: '#ffffff',
  canvas: '#eef2f8',
  field: '#f8fafc',
  raised: '#f3f6fb',
  head: '#ffffff',
  ink: '#1e293b',
  inkDim: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  lineStrong: '#cbd5e1',
  blue: '#2563eb',
  blueSoft: 'rgba(37,99,235,0.08)',
  blueInk: '#1d4ed8',
  green: '#059669',
  greenSoft: 'rgba(5,150,105,0.10)',
  red: '#dc2626',
  redSoft: 'rgba(220,38,38,0.08)',
  amber: '#d97706',
  amberSoft: 'rgba(217,119,6,0.10)',
  lime: '#65a30d',
  limeSoft: 'rgba(101,163,13,0.10)',
};

/** The live palettes: one object each, values swapped in place on a switch. */
export const colors: Palette = { ...dark };
export const paper: PaperPalette = { ...paperDark };

/* ── Theme state ─────────────────────────────────────────────────────────── */

export type ThemeMode = 'dark' | 'light';

const STORAGE_KEY = 'hiktech.theme';
let mode: ThemeMode = 'dark';
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getVersion = () => version;

function apply(next: ThemeMode) {
  mode = next;
  Object.assign(colors, next === 'light' ? light : dark);
  Object.assign(paper, next === 'light' ? paperLight : paperDark);
  version += 1;
  for (const l of listeners) l();
}

export function getThemeMode(): ThemeMode {
  return mode;
}

/** Switch the whole app, and remember it on this phone. */
export function setThemeMode(next: ThemeMode) {
  if (next === mode) return;
  apply(next);
  void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
}

/** Read the saved choice; call once before the first screen renders. */
export async function loadThemeMode() {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if ((saved === 'light' || saved === 'dark') && saved !== mode) apply(saved);
  } catch {
    // No storage: stay dark.
  }
}

/** The current theme; re-renders the caller when it changes. */
export function useTheme() {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return {
    mode,
    isDark: mode === 'dark',
    setMode: setThemeMode,
    toggle: () => setThemeMode(mode === 'dark' ? 'light' : 'dark'),
  };
}

/**
 * A component's stylesheet, rebuilt for the current theme. Use instead of a
 * module-level `StyleSheet.create`, whose values would be frozen at load:
 *
 *   const useStyles = makeStyles(() => StyleSheet.create({ … colors.x … }));
 *   function Thing() { const styles = useStyles(); … }
 *
 * Built once per theme and shared by every instance.
 */
export function makeStyles<T>(factory: () => T): () => T {
  let cached: T | undefined;
  let builtFor = -1;
  return function useStyles() {
    const v = useSyncExternalStore(subscribe, getVersion, getVersion);
    if (cached === undefined || builtFor !== v) {
      cached = factory();
      builtFor = v;
    }
    return cached;
  };
}

/* ── Fixed tokens ────────────────────────────────────────────────────────── */

/** 4pt grid. */
export const space = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, '3xl': 32,
} as const;

export const radius = {
  sm: 6, md: 10, lg: 14, xl: 18, pill: 999,
} as const;

export const type = {
  display: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  h1: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  h2: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '400' },
  bodyStrong: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 13, fontWeight: '400' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  mono: { fontSize: 12, fontFamily: 'monospace', letterSpacing: 0.5 },
} as const;

/** Card elevation — Android needs `elevation`, iOS the shadow* props. */
export const elevation = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  raised: {
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

export function severityColor(sev: string): string {
  switch (sev) {
    case 'Critical': return colors.critical;
    case 'High': return colors.high;
    case 'Medium': return colors.medium;
    default: return colors.low;
  }
}

export function severityTint(sev: string): string {
  switch (sev) {
    case 'Critical': return colors.criticalSoft;
    case 'High': return colors.highSoft;
    case 'Medium': return colors.mediumSoft;
    default: return colors.lowSoft;
  }
}

/** Status → accent colour, matching the web incident-status badges. */
export function statusColor(status: string): string {
  switch (status) {
    case 'Pending': return colors.muted;
    case 'Dispatched': return colors.accent;
    case 'En Route': return colors.accent;
    case 'Arrived':
    case 'On Scene': return colors.medium;
    case 'Transporting': return colors.high;
    case 'Resolved':
    case 'Closed': return colors.low;
    case 'Cancelled': return colors.muted;
    default: return colors.accent;
  }
}

/** "4 min ago" / "2 h ago" — responders care about elapsed time, not clocks. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} d ago`;
}
