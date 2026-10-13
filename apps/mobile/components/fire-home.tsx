import { ServiceHome, type ServiceHomeContent } from './service-home';

const FIRE: ServiceHomeContent = {
  unitIcon: 'bus-outline',
};

export function FireHome() {
  return <ServiceHome content={FIRE} />;
}
