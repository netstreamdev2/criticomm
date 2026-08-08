import { ChatClient } from './chat-client';
import { requireFeaturePage } from '@/lib/features';

export const metadata = { title: 'Criti Assistant · Criticom' };

export default async function AssistantPage() {
  await requireFeaturePage('web.assistant');
  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Criti — operations assistant</h1>
        <p className="text-muted-foreground">
          Ask how to run any workflow: dispatching, reports, shift checks, rosters, admin.
        </p>
      </header>
      <ChatClient />
    </div>
  );
}
