import { ServiceHome, type ServiceHomeContent } from './service-home';

const EMS: ServiceHomeContent = {
  unitIcon: 'medkit-outline',
  showTeamOnDuty: false,
};

/** The paramedic home: the same layout as Police and Fire, with EMS content. */
export function EmsHome() {
  return <ServiceHome content={EMS} />;
}
