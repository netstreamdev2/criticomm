import { Image, StyleSheet, Text, View } from 'react-native';
import type { DeptIdentity } from '@/lib/branding';
import { radius, type as typography } from '@/lib/theme';

/**
 * The department crest. Uses the uploaded logo when Admin → Departments has
 * one; otherwise a monogram badge in the department's colours — the app never
 * ships fabricated official insignia.
 */
export function DeptBadge({
  dept, size = 40,
}: {
  dept: DeptIdentity;
  size?: number;
}) {
  if (dept.logoUrl) {
    return (
      <View style={[styles.logoWrap, { width: size, height: size, borderRadius: radius.md }]}>
        <Image
          source={{ uri: dept.logoUrl }}
          style={{ width: size - 4, height: size - 4 }}
          resizeMode="contain"
          accessibilityLabel={`${dept.short_name} crest`}
        />
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={`${dept.short_name} badge`}
      style={[
        styles.monogram,
        {
          width: size,
          height: size,
          borderRadius: radius.md,
          backgroundColor: dept.primary_color,
          borderColor: dept.accent_color,
        },
      ]}
    >
      <Text style={[styles.monogramText, { fontSize: size * 0.32 }]}>{dept.monogram}</Text>
    </View>
  );
}

/** Crest + names, for headers and the profile screen. */
export function DeptHeader({ dept }: { dept: DeptIdentity }) {
  return (
    <View style={styles.header}>
      <DeptBadge dept={dept} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.short} numberOfLines={1}>{dept.short_name}</Text>
        <Text style={styles.official} numberOfLines={1}>{dept.official_name}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  logoWrap: {
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)',
  },
  monogram: {
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
  },
  monogramText: {
    color: '#fff', fontWeight: '800', letterSpacing: 0.5,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  short: { ...typography.h2, color: '#fff' },
  official: { ...typography.small, color: '#9ca3af', marginTop: 1 },
});
