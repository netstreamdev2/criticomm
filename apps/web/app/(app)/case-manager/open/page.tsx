import { CaseRegister, type CaseSearch } from '../case-ui';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live Cases · HikTech' };

export default async function LiveCasesPage({ searchParams }: { searchParams: Promise<CaseSearch> }) {
  const { t } = await requestT();
  return (
    <CaseRegister
      view="live"
      basePath="/case-manager/open"
      title={t('Live cases')}
      description={t('Calls still being worked. Each comes to review once its report is filed; the dispatch desk closes any that will never have one.')}
      params={await searchParams}
    />
  );
}
