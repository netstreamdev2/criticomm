import { ServiceHome, type ServiceHomeContent } from './service-home';

const FIRE: ServiceHomeContent = {
  eyebrow: 'FIRE & RESCUE',
  icon: 'flame',
  unitLabel: 'YOUR APPLIANCE',
  unitIcon: 'bus-outline',
  noUnit: 'No appliance assigned',
  unitA11y: 'View your Fire shift and appliance checks',
};

export function FireHome() {
  return <ServiceHome content={FIRE} />;
}
