import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LANGUAGES } from '@criticom/db/i18n';
import { colors, radius, space, makeStyles } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { Muted } from '@/components/ui';

/**
 * The app's language (docs/23, item 1): each language in its own name, so a
 * person finds theirs whatever the screen is in. Kept on the phone and on the
 * profile; with no signal the phone remembers it and the profile follows.
 */
export function LanguagePicker() {
  const { t, lang, setLang } = useT();
  const styles = useStyles();
  return (
    <View>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('Language')}>
        {LANGUAGES.map((l) => {
          const on = l.code === lang;
          return (
            <Pressable
              key={l.code}
              onPress={() => { if (!on) void setLang(l.code); }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.chip, on && styles.chipActive, pressed && { opacity: 0.8 }]}
            >
              <Text style={[styles.chipText, on && { color: '#fff' }]}>{l.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <Muted style={{ marginTop: space.sm }}>
        {t('Words not translated yet show in English. What people type, names and incident numbers stay as written.')}
      </Muted>
    </View>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: space.md, paddingVertical: 7,
    backgroundColor: colors.bgSoft,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
}));
