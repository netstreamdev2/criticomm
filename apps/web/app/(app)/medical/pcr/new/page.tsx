import { PcrFormSections } from '../pcr-form';
import { PcrFormShell } from '../pcr-form-shell';
import { createPcrAction } from '../../actions';
import { requestT } from '@/lib/i18n';

export const metadata = { title: 'New PCR · HikTech' };

export default async function NewPcrPage() {
  const { t } = await requestT();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t('ePCR: Medical Incident Report')}</h1>
        <p className="text-muted-foreground">{t('Manual entry, not linked to a dispatched call.')}</p>
      </header>
      <PcrFormShell action={createPcrAction} submitLabel="Submit final ePCR report">
        <PcrFormSections />
      </PcrFormShell>
    </div>
  );
}
