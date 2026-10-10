'use client';

import { useState } from 'react';
import { MapPin } from 'lucide-react';
import type { OnDutyOfficer } from '@criticom/api';
import { DispatchMapModal, type MapIncident } from '@/components/dispatch-map-modal';
import { cn } from '@/lib/utils';

/** Opens the live dispatch map for one incident. */
export function DispatchMapButton({
  incident, officers, canAssign, children, className, title = 'Show on the live map',
}: {
  incident: MapIncident;
  officers: OnDutyOfficer[];
  canAssign: boolean;
  children?: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title={title}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className={cn('inline-flex items-center gap-1.5 text-left hover:text-accent', className)}
      >
        {children ?? (
          <>
            <MapPin className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
            Live map
          </>
        )}
      </button>
      {open ? (
        <DispatchMapModal incident={incident} initialOfficers={officers} canAssign={canAssign} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
