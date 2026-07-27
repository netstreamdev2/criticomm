import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

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
        // Criticom V4 dark palette + a few extras
        bg: { DEFAULT: '#050510', soft: '#0b0b1a', card: '#11112a' },
        border: { DEFAULT: '#1f1f3a' },
        primary: { DEFAULT: '#dc3545', foreground: '#ffffff' },
        accent: { DEFAULT: '#3b82f6', foreground: '#ffffff' },
        muted: { DEFAULT: '#1a1a2e', foreground: '#9ca3af' },
        // Severity colours
        severity: {
          low: '#10b981',
          medium: '#f59e0b',
          high: '#f97316',
          critical: '#ef4444',
        },
      },
      borderRadius: { lg: '0.75rem', md: '0.5rem', sm: '0.375rem' },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] },
    },
  },
  plugins: [animate],
};
export default config;
