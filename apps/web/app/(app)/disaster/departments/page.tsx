import { listDepartmentContacts } from '@criticom/api';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';
import { DepartmentContacts } from './contacts';

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
  const contacts = await listDepartmentContacts(supabase);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t('Departments')}</h1>
        <p className="max-w-3xl text-muted-foreground">
          {t('Each line function and who represents it at the DOC. Picking a person on an incident fills in their name, post and number.')}
        </p>
      </header>
      <DepartmentContacts canEdit={role !== 'Viewer'}
        contacts={contacts.map((c) => ({ id: c.id, department: c.department, name: c.name, post: c.post, phone: c.phone, email: c.email, docRep: c.doc_rep }))} />
    </div>
  );
}
