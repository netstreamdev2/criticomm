import { CaseRegister, type CaseSearch } from '../case-ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live Cases · HikTech' };

export default async function LiveCasesPage({ searchParams }: { searchParams: Promise<CaseSearch> }) {
  return (
    <CaseRegister
      view="live"
      basePath="/case-manager/open"
      title="Live cases"
      description="Calls still being worked. Each comes to review once its report is filed; the dispatch desk closes any that will never have one."
      params={await searchParams}
    />
  );
}
