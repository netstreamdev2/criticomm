import type { Silo } from '@criticom/db/types';
import type { VehicleDetails } from './actions';

/** An empty vehicle form, in this department. Shared by the page (server) and the form (client). */
export const blankVehicle = (silo: Silo): VehicleDetails => ({
  unit_number: '', name: '', type: '', silo, make: '', model: '', year: '', license_plate: '', vin: '',
  station_number: '', fuel_type: '', disc_expiry: '',
});
