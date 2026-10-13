import { ServiceHome, type ServiceHomeContent } from './service-home';

const DISASTER: ServiceHomeContent = {
  unitIcon: 'business-outline',
  noVehicle: true,
};

/** The Disaster Management officer's home: the same layout as the other services. */
export function DisasterHome() {
  return <ServiceHome content={DISASTER} />;
}
