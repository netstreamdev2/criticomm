import { CaseRegister, type CaseSearch } from '../case-ui';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Closed Cases · HikTech' };

export default async function ClosedCasesPage({ searchParams }: { searchParams: Promise<CaseSearch> }) {
  const { t } = await requestT();
  return (
    <CaseRegister
      view="closed"
      basePath="/case-manager/closed"
      title={t('Closed cases')}
      description={t('Every closed case: reviewed after its report, or closed without one by the desk, with who and why.')}
      params={await searchParams}
    />
  );
}
