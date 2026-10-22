import { ScrollView, StyleSheet } from 'react-native';
import { FieldKitCard } from '@/components/field-kit-card';
import { colors, space, makeStyles } from '@/lib/theme';

/** My radio and hard hat (0101): what is booked to me, take a hard hat, report a problem. */
export default function KitScreen() {
  const styles = useStyles();
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <FieldKitCard />
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  container: { padding: space.lg, gap: space.md },
}));
