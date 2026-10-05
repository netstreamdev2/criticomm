import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/** Every colour resolves to a CSS variable so themes can be swapped at runtime. */
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        bg: { DEFAULT: v('--c-bg'), soft: v('--c-bg-soft'), card: v('--c-bg-card') },
        border: { DEFAULT: v('--c-border') },
        primary: { DEFAULT: v('--c-primary'), foreground: v('--c-primary-fg') },
        accent: { DEFAULT: v('--c-accent'), foreground: v('--c-accent-fg') },
        muted: { DEFAULT: v('--c-muted'), foreground: v('--c-muted-fg') },
        // Foreground / body text — themeable so light themes are readable.
        fg: { DEFAULT: v('--c-fg') },
        // Positive states (active, approved, done): the theme's green, in its
        // `-ink` shade so it stays legible as text on light themes too.
        success: { DEFAULT: v('--c-low-ink') },
        severity: {
          // `-ink` variants are the same hue tuned to stay legible as *text*
          // on a tinted wash of themselves. Identical to the base colour in
          // dark themes; darkened in light ones.
          'low-ink': v('--c-low-ink'),
          'medium-ink': v('--c-medium-ink'),
          'high-ink': v('--c-high-ink'),
          'critical-ink': v('--c-critical-ink'),
          // `-fg` variants are the text colour that sits ON the solid fill.
          'low-fg': v('--c-low-fg'),
          'medium-fg': v('--c-medium-fg'),
          'high-fg': v('--c-high-fg'),
          'critical-fg': v('--c-critical-fg'),
          low: v('--c-low'),
          medium: v('--c-medium'),
          high: v('--c-high'),
          critical: v('--c-critical'),
        },
      },
      borderRadius: {
        lg: 'var(--c-radius-lg)',
        md: 'var(--c-radius-md)',
        sm: 'var(--c-radius-sm)',
        xl: 'calc(var(--c-radius-lg) + 0.25rem)',
        '2xl': 'calc(var(--c-radius-lg) + 0.5rem)',
      },
      fontFamily: { sans: ['var(--font-rubik)', 'ui-sans-serif', 'system-ui'] },
    },
  },
  plugins: [animate],
};
export default config;
