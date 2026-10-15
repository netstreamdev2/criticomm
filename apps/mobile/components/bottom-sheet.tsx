import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, useWindowDimensions, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, makeStyles } from '@/lib/theme';
import { useT } from '@/lib/i18n';

/**
 * A swipeable bottom drawer, built on React Native's own Animated and
 * PanResponder so it needs no new native module.
 *
 * Opens at half height. Drag the handle/header up for full height, down to
 * shrink or dismiss; a flick does the same. Tapping the backdrop or the
 * Android back button closes it. Only `header` is draggable, so the body
 * scrolls freely. `footer` (the call's action) stays pinned to the bottom of
 * the screen at either height.
 */
export function BottomSheet({
  visible, onClose, header, children, footer,
}: {
  visible: boolean;
  onClose: () => void;
  /** Drag area, under the handle. */
  header?: React.ReactNode;
  /** Scrolling body. */
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { t } = useT();
  const styles = useStyles();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const full = Math.round(height * 0.92);
  const half = Math.round(height * 0.6);
  // translateY: 0 = full height, HALF_Y = half height, full = hidden.
  const HALF_Y = full - half;
  const y = useRef(new Animated.Value(full)).current;
  const rest = useRef(HALF_Y);
  const closing = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [footerH, setFooterH] = useState(0);

  const settle = (to: number, done?: () => void) => {
    rest.current = to;
    setExpanded(to === 0);
    Animated.spring(y, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 16 }).start(done);
  };

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(y, { toValue: full, duration: 180, useNativeDriver: true }).start(() => {
      closing.current = false;
      onClose();
    });
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  const settleRef = useRef(settle);
  settleRef.current = settle;

  useEffect(() => {
    if (!visible) return;
    closing.current = false;
    y.setValue(full);
    settleRef.current(HALF_Y);
  }, [visible, y, full, HALF_Y]);

  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
    onPanResponderMove: (_, g) => {
      y.setValue(Math.min(full, Math.max(0, rest.current + g.dy)));
    },
    onPanResponderRelease: (_, g) => {
      const at = rest.current + g.dy;
      if (g.vy > 1.2 || at > HALF_Y + (full - HALF_Y) * 0.35) closeRef.current();
      else if (g.vy < -1.2 || at < HALF_Y / 2) settleRef.current(0);
      else settleRef.current(HALF_Y);
    },
    onPanResponderTerminate: () => settleRef.current(rest.current),
  }), [y, full, HALF_Y]);

  const backdrop = y.interpolate({ inputRange: [0, full], outputRange: [0.6, 0], extrapolate: 'clamp' });
  // The pinned footer leaves with the sheet.
  const footerY = y.interpolate({ inputRange: [HALF_Y, full], outputRange: [0, 240], extrapolate: 'clamp' });

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdrop }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={t('Close details')} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { height: full, transform: [{ translateY: y }] }]}>
        <View {...pan.panHandlers} style={styles.dragArea}>
          <View style={styles.handle} />
          {header}
        </View>
        <ScrollView
          style={styles.body}
          // At half height the lower part of the sheet is below the screen:
          // pad so the end of the content can still be scrolled into view.
          contentContainerStyle={{ paddingBottom: footerH + 16 + (expanded ? 0 : HALF_Y) }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </Animated.View>

      {footer ? (
        <Animated.View
          onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12), transform: [{ translateY: footerY }] }]}
        >
          {footer}
        </Animated.View>
      ) : null}
    </Modal>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bgSoft, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    borderWidth: 1, borderColor: colors.borderStrong, borderBottomWidth: 0,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 24,
  },
  dragArea: { paddingTop: 8, paddingBottom: 4 },
  handle: {
    alignSelf: 'center', width: 42, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: 8,
  },
  body: { flex: 1 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.bgSoft,
    elevation: 25,
  },
}));
