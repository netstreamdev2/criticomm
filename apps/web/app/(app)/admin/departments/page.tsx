import { redirect } from 'next/navigation';
import { ALL_SILOS } from '@criticom/api';
import { ADMIN_CONSOLE_ROLES } from '@criticom/db';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getSession } from '@/lib/session';
import { getBrandingMap } from '@/lib/branding';
import { DepartmentCard } from './department-card';
import { requestT } from '@/lib/i18n';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Departments · HikTech' };

export default async function DepartmentsPage() {
  const { t } = await requestT();
  const { role } = await getSession();
  if (!ADMIN_CONSOLE_ROLES.includes(role)) redirect('/dashboard');

  const branding = await getBrandingMap();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Departments')}</h1>
        <p className="text-muted-foreground">
          {t('Each service\'s identity — crest, colours and naming — as it appears across the platform, the responder app and printed reports.')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t('About the crests')}</CardTitle>
          <CardDescription>
            {t('Official insignia belong to the municipality and its services, so the platform ships none — upload each department\'s real crest here and it appears everywhere immediately. Until then a monogram badge renders in that department\'s colours, so nothing ever looks unfinished. PNG or SVG with a transparent background works best; square crops read cleanest at small sizes.')}</CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {ALL_SILOS.map((silo) => (
          <DepartmentCard key={silo} branding={branding[silo]} />
        ))}
      </div>
    </div>
  );
}
