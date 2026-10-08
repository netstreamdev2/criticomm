import { ServiceHome, type ServiceHomeContent } from './service-home';

const EMS: ServiceHomeContent = {
  eyebrow: 'EMERGENCY MEDICAL SERVICES',
  icon: 'pulse',
  unitLabel: 'YOUR AMBULANCE',
  unitIcon: 'medkit-outline',
  noUnit: 'No ambulance assigned',
  unitA11y: 'View your EMS shift, ambulance and stock checks',
};

/** The paramedic home: the same layout as Police and Fire, with EMS content. */
export function EmsHome() {
  return <ServiceHome content={EMS} />;
}
