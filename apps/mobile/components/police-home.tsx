import { ServiceHome, type ServiceHomeContent } from './service-home';

const POLICE: ServiceHomeContent = {
  unitIcon: 'car-outline',
  showTeamOnDuty: false,
  fines: true,
};

/**
 * Police Home (and Ethekwini field officers): the same minimal home as the
 * other services, with Issue a fine under the card. The fines figures and
 * My performance are on the profile.
 */
export function PoliceHome() {
  return <ServiceHome content={POLICE} />;
}
