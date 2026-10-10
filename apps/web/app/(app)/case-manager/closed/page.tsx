import { CaseRegister, type CaseSearch } from '../case-ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Closed Cases · HikTech' };

export default async function ClosedCasesPage({ searchParams }: { searchParams: Promise<CaseSearch> }) {
  return (
    <CaseRegister
      view="closed"
      basePath="/case-manager/closed"
      title="Closed cases"
      description="Every closed case: reviewed after its report, or closed without one by the desk, with who and why."
      params={await searchParams}
    />
  );
}
