import { departmentName, roleName } from '@criticom/db';
import { ChatClient } from './chat-client';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';

export const metadata = { title: 'Criti · HikTech' };

export default async function AssistantPage() {
  await requireFeaturePage('web.assistant');
  const { fullName, role, silo } = await getSession();
  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Criti</h1>
        <p className="text-muted-foreground">
          {departmentName(silo)} · {roleName(role)}. Ask about the live board or how something works, or tell Criti what
          to do. It prepares the task and nothing changes until you confirm.
        </p>
      </header>
      <ChatClient fullName={fullName} role={role} />
    </div>
  );
}
