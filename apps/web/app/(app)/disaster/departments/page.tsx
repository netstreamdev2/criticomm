import { listDepartmentContacts, listDepartmentPlans } from '@criticom/api';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { DepartmentContacts } from './contacts';
import { PageGuide } from '@/components/office/page-guide';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Departments · HikTech' };

/**
 * The line functions and who represents each at the DOC (0113): the Plan's
 * staff resources database of Heads, Deputy Heads and Senior Managers, kept
 * here so the desk can call them out and their details fill in the forms.
 */
export default async function DepartmentsPage() {
  const { t } = await requestT();
  const { supabase, role } = await getSession();
  const [contacts, plans] = await Promise.all([listDepartmentContacts(supabase), listDepartmentPlans(supabase)]);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Departments')}</h1>
        <p className="max-w-3xl text-muted-foreground">
          {t('Each line function and who represents it at the JOC. Picking a person on an incident fills in their name, post and number.')}
        </p>
      </header>
      <PageGuide id="disaster.departments" steps={[
        t('Each City department, its role on an incident, and its contacts. Mark one contact as the JOC representative.'),
        t('Record the date each department last reviewed its disaster plan. Every plan is reviewed each year.'),
      ]} />
      <DepartmentContacts canEdit={role !== 'Viewer'} plans={Object.fromEntries(plans.map((p) => [p.department, p.plan_reviewed_on]))}
        contacts={contacts.map((c) => ({ id: c.id, department: c.department, name: c.name, post: c.post, phone: c.phone, email: c.email, docRep: c.doc_rep }))} />
    </div>
  );
}
