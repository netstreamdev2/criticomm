import { Alert } from 'react-native';
import { tNow } from './translator';

/**
 * Accepting an incident puts the officer en route and tells dispatch, so it is
 * asked once before it is done. Resolves true when the officer accepts.
 */
export function confirmAccept(incidentNumber?: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      incidentNumber ? tNow('Accept {number}', { number: incidentNumber }) : tNow('Accept incident'),
      tNow('Are you sure you want to accept this incident?'),
      [
        { text: tNow('Cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: tNow('Accept'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
