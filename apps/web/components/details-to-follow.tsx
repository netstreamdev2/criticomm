import { Hourglass } from 'lucide-react';
import { detailsToFollow } from '@criticom/db';
import { cn } from '@/lib/utils';
import { requestT } from '@/lib/i18n';

/**
 * On a call sent to dispatch before the call taker finished it (0076): the
 * caller's details, the description or the patient question are still coming.
 * Gone by itself once they are in.
 */
export async function DetailsToFollow({ incident, className }: {
  incident: { intake_complete?: boolean | null };
  className?: string;
}) {
  const { t } = await requestT();
  if (!detailsToFollow(incident)) return null;
  return (
    <span
      title={t('Sent early on an urgent call. The call taker is still adding the details.')}
      className={cn(
        // Blinks until the call taker has added the rest: easy to miss otherwise.
        'inline-flex animate-pulse items-center gap-1 whitespace-nowrap rounded-full border border-severity-medium/50 bg-severity-medium/10 px-2 py-0.5 text-[11px] font-semibold text-severity-medium-ink',
        className,
      )}
    >
      <Hourglass className="h-3 w-3" /> {' '}{t('Details to follow')}</span>
  );
}
