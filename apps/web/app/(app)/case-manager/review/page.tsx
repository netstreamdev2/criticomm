import { CaseRegister, type CaseSearch } from '../case-ui';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Awaiting Review · HikTech' };

export default async function AwaitingReviewPage({ searchParams }: { searchParams: Promise<CaseSearch> }) {
  const { t } = await requestT();
  return (
    <CaseRegister
      view="review"
      basePath="/case-manager/review"
      title={t('Awaiting review')}
      description={t('Resolved calls whose report is filed. Read each case file, then close it.')}
      params={await searchParams}
    />
  );
}
