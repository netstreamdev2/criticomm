import { CaseRegister, type CaseSearch } from '../case-ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Awaiting Review · HikTech' };

export default async function AwaitingReviewPage({ searchParams }: { searchParams: Promise<CaseSearch> }) {
  return (
    <CaseRegister
      view="review"
      basePath="/case-manager/review"
      title="Awaiting review"
      description="Resolved calls whose report is filed. Read each case file, then close it."
      params={await searchParams}
    />
  );
}
