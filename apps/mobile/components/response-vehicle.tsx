import { Image, type StyleProp, type ImageStyle } from 'react-native';

const VEHICLES = {
  MetroPolice: require('../assets/dispatch/police-v1.png'),
  Ethekwini: require('../assets/dispatch/police-v1.png'),
  MetroFire: require('../assets/dispatch/fire-v2.png'),
  Medical: require('../assets/dispatch/ambulance-v2.png'),
  EthekwiniDisaster: require('../assets/dispatch/disaster-v2.png'),
};

/** Bundled locally so the progress strip's artwork is available offline. */
export function ResponseVehicle({ silo, style }: { silo: string; style?: StyleProp<ImageStyle> }) {
  return <Image source={VEHICLES[silo as keyof typeof VEHICLES] ?? VEHICLES.MetroPolice}
    style={[{ width: 76, height: 46 }, style]} resizeMode="contain"
    accessible={false} accessibilityIgnoresInvertColors />;
}
