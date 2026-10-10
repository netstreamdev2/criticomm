import { ServiceHome, type ServiceHomeContent } from './service-home';

const DISASTER: ServiceHomeContent = {
  eyebrow: 'DISASTER MANAGEMENT',
  icon: 'warning-outline',
  unitLabel: 'YOUR SHIFT',
  unitIcon: 'shield-checkmark-outline',
  noUnit: 'Off duty',
  unitA11y: 'View your start of shift',
  noVehicle: true,
};

/** The Disaster Management officer's home: the same layout as the other services. */
export function DisasterHome() {
  return <ServiceHome content={DISASTER} />;
}
