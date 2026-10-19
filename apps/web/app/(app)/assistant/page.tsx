import { departmentName, roleName } from '@criticom/db';
import { ChatClient } from './chat-client';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { requestT } from '@/lib/i18n';

export const metadata = { title: 'Criti · HikTech' };

export default async function AssistantPage() {
  const { t } = await requestT();
  await requireFeaturePage('web.assistant');
  const { fullName, role, silo } = await getSession();
  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Criti</h1>
        <p className="text-muted-foreground">
          {t('{departmentName} · {roleName}. Ask about the live board or how something works, or tell Criti what to do. It prepares the task and nothing changes until you confirm.', { departmentName: departmentName(silo), roleName: roleName(role) })}</p>
      </header>
      <ChatClient fullName={fullName} role={role} />
    </div>
  );
}
