'use client';
import { useT } from '@/components/i18n';

export function PrintButton() {
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="h-10 rounded-md border border-border px-4 text-sm font-semibold hover:bg-muted"
    >
      {t('🖨 Print')}</button>
  );
}
