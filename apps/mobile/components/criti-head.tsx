import { Image } from 'react-native';

/** The same Criti head used for small AI marks on the web console. */
export function CritiHead({ size = 20 }: { size?: number }) {
  return (
    <Image
      source={require('../assets/criti-head.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
    />
  );
}
