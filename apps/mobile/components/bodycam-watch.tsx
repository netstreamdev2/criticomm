import { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getBodycamWatchStatus } from '@criticom/api';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { makeStyles } from '@/lib/theme';

/** Checked often while a bodycam is booked out; rarely otherwise. */
const WITH_CAMERA_MS = 15_000;
const WITHOUT_CAMERA_MS = 60_000;

/**
 * Tells the officer when the control room is viewing their bodycam live
 * (migration 0054) — never who. It sits above every screen and never takes
 * a tap, so it cannot get in the way of the work.
 */
export function BodycamWatchNotice() {
  const styles = useStyles();
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    if (!session) {
      setWatching(false);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (timer) clearTimeout(timer);
      let next = WITHOUT_CAMERA_MS;
      try {
        const s = await getBodycamWatchStatus(getSupabase());
        if (alive) setWatching(s.watching);
        if (s.serial_number) next = WITH_CAMERA_MS;
      } catch {
        // Offline, or bodycams not set up on this server: say nothing.
        if (alive) setWatching(false);
      }
      if (alive) timer = setTimeout(() => void poll(), next);
    };
    void poll();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void poll();
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [session]);

  if (!watching) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 4 }]}>
      <View style={styles.pill} accessibilityLiveRegion="polite" accessibilityLabel="The control room is viewing your bodycam">
        <View style={styles.dot} />
        <Text style={styles.text}>Control room is viewing your camera</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 120 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.92)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12,
    borderWidth: 1, borderColor: 'rgba(248, 113, 113, 0.6)',
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  text: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
}));
