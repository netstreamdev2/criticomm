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
        severity: {
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
      fontFamily: { sans: ['var(--c-font)', 'Inter', 'ui-sans-serif', 'system-ui'] },
    },
  },
  plugins: [animate],
};
export default config;
