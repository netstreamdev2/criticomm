'use client';

import { useActionState } from 'react';
import { Radio } from 'lucide-react';
import { setTalkServerAction } from './actions';
import { useT } from '@/components/i18n';

const field = 'mt-1 block h-10 w-full rounded-md border border-border bg-bg-soft/80 px-3 text-sm';
const label = 'text-xs font-semibold uppercase text-muted-foreground';

/** The voice server HikTech Talk uses. The secret goes into the database and is never shown again. */
export function VoiceServerForm({ status }: { status: { configured: boolean; url: string | null; updatedAt: string | null } }) {
  const { t } = useT();
  const [state, action, pending] = useActionState(setTalkServerAction, null);
  return (
    <form id="voice" action={action} className="frost space-y-3 rounded-xl border border-orange-500/40 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500 text-white"><Radio className="h-4 w-4" /></span>
        <div>
          <h2 className="text-base font-bold leading-tight">{t('Voice server (HikTech Talk)')}</h2>
          <p className="text-xs text-muted-foreground">
            {status.configured ? <>{t('Set:')}{' '}<span className="font-mono">{status.url}</span></> : 'Not set yet. Paste the LiveKit project details.'}
          </p>
        </div>
      </div>
      <div>
        <label className={label} htmlFor="talk-url">{t('Server address')}</label>
        <input id="talk-url" name="url" required placeholder={t('wss://your-project.livekit.cloud')} defaultValue={status.url ?? ''} className={field} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="talk-key">{t('API key')}</label>
          <input id="talk-key" name="api_key" required autoComplete="off" className={field} />
        </div>
        <div>
          <label className={label} htmlFor="talk-secret">{t('API secret')}</label>
          <input id="talk-secret" name="api_secret" type="password" required autoComplete="new-password" className={field} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('Kept in the database only. Radios and consoles get a 2-hour pass, never the secret.')}</p>
      {state?.error ? <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-500">{state.error}</p> : null}
      {state?.done ? <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500">{state.done}</p> : null}
      <button type="submit" disabled={pending} className="h-10 w-full rounded-md bg-orange-500 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? 'Saving…' : status.configured ? 'Replace the voice server' : 'Save the voice server'}
      </button>
    </form>
  );
}
