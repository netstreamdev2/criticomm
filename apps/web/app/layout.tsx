import type { Metadata } from 'next';
import { Rubik } from 'next/font/google';
import './globals.css';
import { THEME_INIT_SCRIPT } from '@/lib/themes';

const rubik = Rubik({ subsets: ['latin'], display: 'swap', variable: '--font-rubik' });

export const metadata: Metadata = {
  title: 'HIKTECH — eThekwini Emergency Services',
  description: 'All in One EMS Dispatch Software — eThekwini Emergency Services Command Centre',
  icons: { icon: '/hiktech-icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${rubik.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint so there's no flash of
            the default palette. Must stay inline and synchronous. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, self-authored string */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
