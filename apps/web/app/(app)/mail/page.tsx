import { listAllProfiles, listInbox, listSent } from '@criticom/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { requireFeaturePage } from '@/lib/features';
import { getSession } from '@/lib/session';
import { cn, formatSaTime } from '@/lib/utils';
import { markReadAction, sendMailAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mail · HikTech' };

export default async function MailPage() {
  await requireFeaturePage('web.mail');
  const { supabase, userId } = await getSession();
  const [inbox, sent, people] = await Promise.all([
    listInbox(supabase, userId),
    listSent(supabase, userId),
    listAllProfiles(supabase),
  ]);
  const unread = inbox.filter((m) => !m.read_at).length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Mail</h1>
        <p className="text-muted-foreground">
          Internal messages between operators — inside the platform, on the audit trail, never on e-mail.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Compose</CardTitle>
          <CardDescription>The recipient also gets a low-priority alert, phone included.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={sendMailAction} className="grid gap-3 md:grid-cols-3">
            <select name="to_user" required className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm">
              <option value="">Send to…</option>
              {people.filter((p) => p.id !== userId).map((p) => (
                <option key={p.id} value={p.id}>{p.full_name ?? p.email ?? p.id}</option>
              ))}
            </select>
            <input name="subject" required placeholder="Subject"
              className="h-10 rounded-md border border-border bg-bg-soft px-3 text-sm md:col-span-2" />
            <textarea name="body" required rows={3} placeholder="Message"
              className="rounded-md border border-border bg-bg-soft px-3 py-2 text-sm md:col-span-2" />
            <div className="flex items-end">
              <button type="submit" className="h-10 w-full rounded-md bg-primary px-4 text-sm font-semibold">Send</button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Inbox {unread > 0 ? `· ${unread} unread` : ''}</CardTitle>
            <CardDescription>{inbox.length} messages.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {inbox.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
            {inbox.map((m) => (
              <div key={m.id} className={cn('rounded-md border p-3', m.read_at ? 'border-border' : 'border-accent/50 bg-accent/5')}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">{m.subject}</p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatSaTime(m.sent_at)}</span>
                </div>
                <p className="text-xs text-muted-foreground">From {m.from_name ?? 'Unknown'}</p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm">{m.body}</p>
                {!m.read_at && (
                  <form action={markReadAction} className="mt-2">
                    <input type="hidden" name="id" value={m.id} />
                    <button type="submit" className="h-7 rounded-md bg-muted px-2.5 text-xs font-semibold hover:bg-accent/20">
                      Mark read
                    </button>
                  </form>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sent</CardTitle>
            <CardDescription>{sent.length} messages.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sent.length === 0 && <p className="text-sm text-muted-foreground">Nothing sent.</p>}
            {sent.map((m) => (
              <div key={m.id} className="rounded-md border border-border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">{m.subject}</p>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatSaTime(m.sent_at)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  To {m.to_name ?? 'Unknown'} · {m.read_at ? `read ${formatSaTime(m.read_at)}` : 'unread'}
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm">{m.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
