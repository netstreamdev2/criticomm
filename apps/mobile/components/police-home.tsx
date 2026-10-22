import { ServiceHome, type ServiceHomeContent } from './service-home';

const POLICE: ServiceHomeContent = {
  unitIcon: 'car-outline',
  showTeamOnDuty: false,
};

/**
 * Police Home (and Ethekwini field officers): the same home as the other
 * services. Fines have their own tab; My performance is on the profile.
 */
export function PoliceHome() {
  return <ServiceHome content={POLICE} />;
}
