import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, makeStyles, useTheme } from '@/lib/theme';
import { useT } from '@/lib/i18n';

const TRACK_W = 52;
const THUMB = 22;
const PAD = 3;
const TRAVEL = TRACK_W - THUMB - PAD * 2;

/**
 * Light / dark slide in the header. Switches the whole app at once, in place
 * (lib/theme.ts), and is remembered on the phone.
 */
export function ThemeToggle() {
  const { t } = useT();
  const styles = useStyles();
  const { isDark, toggle } = useTheme();
  const light = !isDark;
  const x = useRef(new Animated.Value(light ? TRAVEL : 0)).current;

  // Follow the theme wherever it changed from, including the saved choice.
  useEffect(() => {
    Animated.spring(x, { toValue: light ? TRAVEL : 0, useNativeDriver: true, bounciness: 6, speed: 18 }).start();
  }, [light, x]);

  return (
    <Pressable
      onPress={toggle}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: light }}
      accessibilityLabel={t('Light mode')}
      style={styles.wrap}
    >
      <View style={[styles.track, light && styles.trackLight]}>
        <Ionicons name="moon" size={11} color={light ? colors.muted : 'transparent'} style={styles.leftIcon} />
        <Ionicons name="sunny" size={12} color={light ? 'transparent' : colors.muted} style={styles.rightIcon} />
        <Animated.View style={[styles.thumb, light && styles.thumbLight, { transform: [{ translateX: x }] }]}>
          <Ionicons name={light ? 'sunny' : 'moon'} size={13} color={light ? '#f59e0b' : '#bae6fd'} />
        </Animated.View>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  wrap: { marginRight: 6, height: 36, justifyContent: 'center' },
  track: {
    width: TRACK_W, height: THUMB + PAD * 2, borderRadius: 999, padding: PAD, justifyContent: 'center',
    backgroundColor: colors.bgElevated, borderWidth: 1, borderColor: colors.borderStrong,
  },
  trackLight: { backgroundColor: '#e0f2fe', borderColor: '#7dd3fc' },
  leftIcon: { position: 'absolute', left: 7 },
  rightIcon: { position: 'absolute', right: 7 },
  thumb: {
    width: THUMB, height: THUMB, borderRadius: THUMB / 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.borderStrong,
  },
  thumbLight: { backgroundColor: '#ffffff', borderColor: '#fbbf24' },
}));
