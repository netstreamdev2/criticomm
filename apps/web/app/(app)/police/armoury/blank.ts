import type { Silo } from '@criticom/db/types';
import type { FirearmDetails } from './actions';

/** An empty firearm form, in this department. Shared by the page (server) and the form (client). */
export const blankFirearm = (silo: Silo): FirearmDetails => ({
  serial_number: '', make: '', model: '', calibre: '', firearm_type: '', silo, station: '', notes: '',
});
