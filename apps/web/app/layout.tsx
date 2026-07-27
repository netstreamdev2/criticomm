import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CRITICOMM — eThekwini Emergency Services',
  description: 'All in One EMS Dispatch Software — eThekwini Emergency Services Command Centre',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
