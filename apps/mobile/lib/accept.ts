import { Alert } from 'react-native';
import { tNow } from './translator';
import { departmentOf } from './department';

/**
 * Accepting an incident puts the officer en route and tells dispatch, so it is
 * asked once before it is done. Resolves true when the officer accepts.
 * Disaster Management is called out from standby, often from home: accepting
 * the call-out is also saying they are fit to go.
 */
export function confirmAccept(incidentNumber?: string | null, silo?: string | null): Promise<boolean> {
  const standby = departmentOf(silo) === 'disaster';
  return new Promise((resolve) => {
    Alert.alert(
      standby
        ? (incidentNumber ? tNow('Accept call-out {number}', { number: incidentNumber }) : tNow('Accept call-out'))
        : (incidentNumber ? tNow('Accept {number}', { number: incidentNumber }) : tNow('Accept incident')),
      standby
        ? tNow('You are fit and ready to go now?')
        : tNow('Are you sure you want to accept this incident?'),
      [
        { text: tNow('Cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: tNow('Accept'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
