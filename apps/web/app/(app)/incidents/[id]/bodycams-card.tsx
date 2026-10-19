'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Film, Video } from 'lucide-react';
import { BodycamViewer, type BodycamTarget } from '@/components/bodycam/bodycam-viewer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatSaTime } from '@/lib/utils';
import { useT } from '@/components/i18n';

export type IncidentBodycamPerson = {
  userId: string;
  name: string;
  role: 'lead' | 'backup' | 'assigned';
  /** The bodycam out with them now, when this viewer may watch it. */
  bodycam: { bodycamId: string; serial: string; since: string | null } | null;
};

const ROLE: Record<IncidentBodycamPerson['role'], string> = { lead: 'Lead', backup: 'Backup', assigned: 'Assigned' };

/**
 * The officers on this incident and their bodycams (0054): watch one live —
 * the incident is the reason, and it goes on the incident's history — or
 * find the recorded footage for the incident's whole span.
 */
export function IncidentBodycamsCard({ incident, people, canWatch, footageCount, canFootage, isClosed }: {
  incident: { id: string; number: string };
  people: IncidentBodycamPerson[];
  canWatch: boolean;
  footageCount: number;
  canFootage: boolean;
  isClosed: boolean;
}) {
  const { t } = useT();
  const [watching, setWatching] = useState<BodycamTarget | null>(null);
  const wearing = people.filter((p) => p.bodycam).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Body cams on this incident')}</CardTitle>
        <CardDescription>
          {isClosed
            ? 'The incident is closed: its footage stays available.'
            : `${wearing} of ${people.length} officer${people.length === 1 ? '' : 's'} on it ${wearing === 1 ? 'has' : 'have'} a bodycam on. Watching from here records this incident as the reason.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('No officer has responded to this incident yet.')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {people.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <b>{p.name}</b> <span className="text-xs text-muted-foreground">· {ROLE[p.role]}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {p.bodycam ? `${p.bodycam.serial} · on since ${formatSaTime(p.bodycam.since)}` : 'No bodycam booked out'}
                  </span>
                </span>
                {p.bodycam && canWatch && !isClosed ? (
                  <button type="button"
                    onClick={() => setWatching({ bodycamId: p.bodycam!.bodycamId, serial: p.bodycam!.serial, officer: p.name })}
                    disabled={watching?.bodycamId === p.bodycam.bodycamId}
                    className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground disabled:opacity-40">
                    <Video className="h-3.5 w-3.5" /> {' '}{t('Watch live')}</button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {watching ? (
          <BodycamViewer
            key={watching.bodycamId}
            target={watching}
            kind="live"
            incident={incident}
            onClose={() => setWatching(null)}
          />
        ) : null}

        {canFootage ? (
          <Link href={`/cameras/footage?incident=${incident.id}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            <Film className="h-4 w-4" />
            {footageCount ? `Footage for this incident (${footageCount} bodycam booking${footageCount === 1 ? '' : 's'})` : 'Look for footage for this incident'}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
