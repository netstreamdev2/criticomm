import { cn } from '@/lib/utils';

/** Decorative artwork only: location, status and progress come from the tracker. */
export function responseVehicleSrc(silo: string) {
  const name = silo === 'MetroFire' ? 'fire' : silo === 'Medical' ? 'ambulance'
    : silo === 'EthekwiniDisaster' ? 'disaster' : 'police';
  return `/images/dispatch/${name}-${name === 'police' ? 'v1' : 'v2'}.png`;
}

export function ResponseVehicle({ silo, className }: { silo: string; className?: string }) {
  return <img src={responseVehicleSrc(silo)} alt="" aria-hidden="true" draggable={false}
    width={160} height={96} className={cn('pointer-events-none select-none object-contain', className)} />;
}
