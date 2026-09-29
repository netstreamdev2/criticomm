/** Theme catalogue. `id` must match a [data-theme] block in app/themes.css. */
export type ThemeId =
  | 'criticom-dark' | 'criticom-light' | 'midnight' | 'nord'
  | 'macos' | 'windows' | 'ubuntu' | 'high-contrast'
  | 'solarized-dark' | 'dracula' | 'gruvbox' | 'slate-pro' | 'daylight'
  | 'ethekwini';

export type ThemeMeta = {
  id: ThemeId;
  name: string;
  description: string;
  mode: 'dark' | 'light';
  /** Preview swatches: [background, surface, primary, accent]. */
  swatch: [string, string, string, string];
};

export const THEMES: ThemeMeta[] = [
  {
    id: 'criticom-dark', name: 'HikTech Dark', mode: 'dark',
    description: 'The default command-centre look — deep navy with emergency red.',
    swatch: ['#050510', '#11112a', '#dc3545', '#3b82f6'],
  },
  {
    id: 'criticom-light', name: 'HikTech Light', mode: 'light',
    description: 'Same identity, bright control-room lighting.',
    swatch: ['#f4f6fb', '#ffffff', '#cd2837', '#2563eb'],
  },
  {
    id: 'midnight', name: 'Midnight OLED', mode: 'dark',
    description: 'True black — easy on the eyes for night shift.',
    swatch: ['#000000', '#0f0f14', '#ff3b4e', '#4da3ff'],
  },
  {
    id: 'nord', name: 'Nord', mode: 'dark',
    description: 'Arctic blue-grey, low contrast for long sessions.',
    swatch: ['#2e3440', '#3b4252', '#bf616a', '#88c0d0'],
  },
  {
    id: 'macos', name: 'macOS', mode: 'light',
    description: 'Apple-style: soft greys, generous corners, system blue.',
    swatch: ['#f2f2f7', '#ffffff', '#ff3b30', '#007aff'],
  },
  {
    id: 'windows', name: 'Windows Fluent', mode: 'light',
    description: 'Fluent design: crisp edges, Segoe type, Windows blue.',
    swatch: ['#f3f3f3', '#ffffff', '#c42b1c', '#0067c0'],
  },
  {
    id: 'ubuntu', name: 'Ubuntu', mode: 'dark',
    description: 'Aubergine and orange, straight from the Linux desktop.',
    swatch: ['#1e141a', '#38152c', '#e95420', '#be7ab6'],
  },
  {
    id: 'ethekwini', name: 'eThekwini Municipal', mode: 'dark',
    description: 'Municipal green and gold — emergency red kept for dispatch actions.',
    swatch: ['#06140f', '#0d2419', '#c8102e', '#f0b323'],
  },
  {
    id: 'slate-pro', name: 'Slate Pro', mode: 'dark',
    description: 'Neutral high-legibility dark, built for wall displays.',
    swatch: ['#0f172a', '#1e293b', '#e11d48', '#38bdf8'],
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark', mode: 'dark',
    description: 'Low-glare teal — the classic choice for long night shifts.',
    swatch: ['#002b36', '#073642', '#dc322f', '#2aa198'],
  },
  {
    id: 'dracula', name: 'Dracula', mode: 'dark',
    description: 'High-saturation dark with strong panel separation.',
    swatch: ['#282a36', '#343746', '#ff5555', '#bd93f9'],
  },
  {
    id: 'gruvbox', name: 'Gruvbox', mode: 'dark',
    description: 'Warm retro palette, reduced blue light for late hours.',
    swatch: ['#282828', '#3c3836', '#fb4934', '#83a598'],
  },
  {
    id: 'daylight', name: 'Daylight', mode: 'light',
    description: 'Warm paper tones for control rooms with windows.',
    swatch: ['#faf7f2', '#ffffff', '#b91c1c', '#1d4ed8'],
  },
  {
    id: 'high-contrast', name: 'High Contrast', mode: 'dark',
    description: 'Maximum legibility for accessibility and bright control rooms.',
    swatch: ['#000000', '#000000', '#ffff00', '#00ffff'],
  },
];

export const DEFAULT_THEME: ThemeId = 'criticom-dark';
export const THEME_STORAGE_KEY = 'criticom:theme';

/**
 * Runs before first paint to prevent a flash of the default theme.
 * Kept as a string so it can be inlined via dangerouslySetInnerHTML.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var t=localStorage.getItem('${THEME_STORAGE_KEY}')||'${DEFAULT_THEME}';
document.documentElement.setAttribute('data-theme',t);
}catch(e){document.documentElement.setAttribute('data-theme','${DEFAULT_THEME}');}})();`;
