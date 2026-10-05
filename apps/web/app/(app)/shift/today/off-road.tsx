'use client';

import { useState } from 'react';
import type { ShiftBoard } from '@criticom/api';
import { VehicleStatusDialog } from '@/app/(app)/admin/vehicles/fleet-table';
import { Button } from '@/components/ui/button';

type Vehicle = ShiftBoard['offRoad'][number];

/** "Return to service" for a vehicle off the road, with a reason. */
export function ReturnToService({ vehicle }: { vehicle: Vehicle }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Change status</Button>
      {open ? (
        <VehicleStatusDialog
          vehicle={{ id: vehicle.id, unit_number: vehicle.unit_number, name: vehicle.name, status: vehicle.status, status_note: vehicle.status_note, driver: null }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
