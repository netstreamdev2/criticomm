import { Alert } from 'react-native';

/**
 * Accepting an incident puts the officer en route and tells dispatch, so it is
 * asked once before it is done. Resolves true when the officer accepts.
 */
export function confirmAccept(incidentNumber?: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      incidentNumber ? `Accept ${incidentNumber}` : 'Accept incident',
      'Are you sure you want to accept this incident?',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Accept', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
