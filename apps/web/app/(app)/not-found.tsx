import Link from 'next/link';
import { requestT } from '@/lib/i18n';

export default async function NotFound() {
  const { t } = await requestT();
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">404</p>
      <h1 className="mt-3 text-2xl font-bold">{t('Not found')}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('The record you\'re looking for doesn\'t exist or you don\'t have access to it.')}</p>
      <Link
        href="/dashboard"
        className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold"
      >
        {t('Back to dashboard')}</Link>
    </div>
  );
}
