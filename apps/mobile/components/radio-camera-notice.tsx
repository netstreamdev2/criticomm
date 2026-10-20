import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRadioCameraLive } from '@/lib/radio-camera';
import { makeStyles } from '@/lib/theme';
import { useT } from '@/lib/i18n';

/**
 * Tells the officer, on every screen, while the control room has their
 * radio's camera open (0091): a red, pulsing pill. Never who. It never takes
 * a tap, so it cannot get in the way (as the bodycam notice).
 */
export function RadioCameraNotice() {
  const { t } = useT();
  const styles = useStyles();
  const live = useRadioCameraLive();
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!live) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [live, pulse]);

  if (!live) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 4 }]}>
      <View style={styles.pill} accessibilityLiveRegion="assertive" accessibilityLabel={t('Control room is viewing your camera')}>
        <Animated.View style={[styles.dot, { opacity: pulse }]} />
        <Ionicons name="videocam" size={14} color="#ffffff" />
        <Text style={styles.text}>{t('Control room is viewing your camera')}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 121 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(185, 28, 28, 0.95)', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14,
    borderWidth: 1, borderColor: 'rgba(254, 202, 202, 0.8)',
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#ffffff' },
  text: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
}));
