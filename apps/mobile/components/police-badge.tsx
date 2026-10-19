import { Image, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { HikTechLogo } from './hiktech-logo';

/** The Durban Metropolitan Police Service star badge, as V4 showed it. */
export function PoliceBadge({ size = 22 }: { size?: number }) {
  const { t } = useT();
  return (
    <Image
      source={require('../assets/dmps-badge.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel={t('Durban Metropolitan Police Service')}
    />
  );
}

/** On the police side: the badge goes beside HikTech. */
export function usePoliceSide(): boolean {
  return useAuth().silo === 'MetroPolice';
}

/** HikTech's mark, with the police badge beside it for police users. Never in its place. */
export function BrandMarks({ height = 14 }: { height?: number }) {
  const police = usePoliceSide();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <HikTechLogo height={height} />
      {police ? <PoliceBadge size={Math.round(height * 2.2)} /> : null}
    </View>
  );
}
