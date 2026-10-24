import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useHatPairedNote } from '@/lib/hat-pairing';
import { colors, makeStyles } from '@/lib/theme';

/**
 * On the hard hat's small screen, for a few seconds after its button paired
 * it (0105): "Paired to Const. Khumalo · HH-0042", large. It never takes a tap.
 */
export function HatPairedBanner() {
  const styles = useStyles();
  const note = useHatPairedNote();
  if (!note) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.box} accessibilityLiveRegion="assertive">
        <Ionicons name="checkmark-circle" size={44} color="#ffffff" />
        <Text style={styles.text}>{note}</Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24 },
  box: { alignItems: 'center', gap: 12, borderRadius: 20, paddingHorizontal: 24, paddingVertical: 28, backgroundColor: colors.low },
  text: { color: '#ffffff', fontSize: 24, fontWeight: '900', textAlign: 'center' },
}));
