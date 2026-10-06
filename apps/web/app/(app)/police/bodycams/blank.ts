import type { Silo } from '@criticom/db/types';
import type { BodycamDetails } from './actions';

/** An empty bodycam form, in this department. Shared by the page (server) and the form (client). */
export const blankBodycam = (silo: Silo): BodycamDetails => ({
  serial_number: '', model: 'DS-MCW407', sim_number: '', hik_camera_code: '', silo, station: '', notes: '',
});
