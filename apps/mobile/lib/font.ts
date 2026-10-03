import { StyleSheet, Text, TextInput, type StyleProp, type TextStyle } from 'react-native';
import { Rubik_300Light } from '@expo-google-fonts/rubik/300Light';
import { Rubik_400Regular } from '@expo-google-fonts/rubik/400Regular';
import { Rubik_400Regular_Italic } from '@expo-google-fonts/rubik/400Regular_Italic';
import { Rubik_500Medium } from '@expo-google-fonts/rubik/500Medium';
import { Rubik_600SemiBold } from '@expo-google-fonts/rubik/600SemiBold';
import { Rubik_700Bold } from '@expo-google-fonts/rubik/700Bold';
import { Rubik_800ExtraBold } from '@expo-google-fonts/rubik/800ExtraBold';
import { Rubik_900Black } from '@expo-google-fonts/rubik/900Black';

/**
 * Rubik (Google Fonts) everywhere.
 *
 * Two things stop a custom font from simply "being the default" in React
 * Native, and both are handled here:
 *
 *  1. Text does not inherit fonts, and a `defaultProps` style is thrown away
 *     the moment a component passes its own `style` — which nearly every Text
 *     in this app does. So Text and TextInput are wrapped at render time, and
 *     every instance gets Rubik whatever style it was given.
 *
 *  2. Android cannot choose a weight from a single variable font file, so
 *     `fontWeight: '800'` would render regular. Each weight is loaded as its
 *     own static family, and the wrapper swaps `fontWeight` for the matching
 *     family (Rubik_800ExtraBold and so on).
 *
 * An explicit non-Rubik family (e.g. `monospace` for references) is left alone.
 */

export const RUBIK_FONTS = {
  Rubik_300Light,
  Rubik_400Regular,
  Rubik_400Regular_Italic,
  Rubik_500Medium,
  Rubik_600SemiBold,
  Rubik_700Bold,
  Rubik_800ExtraBold,
  Rubik_900Black,
};

/** Regular weight; any `Rubik…` family is re-mapped to the style's weight. */
export const fontFamily = 'Rubik_400Regular';

const BY_WEIGHT: Record<string, keyof typeof RUBIK_FONTS> = {
  '100': 'Rubik_300Light',
  '200': 'Rubik_300Light',
  '300': 'Rubik_300Light',
  '400': 'Rubik_400Regular',
  normal: 'Rubik_400Regular',
  '500': 'Rubik_500Medium',
  '600': 'Rubik_600SemiBold',
  '700': 'Rubik_700Bold',
  bold: 'Rubik_700Bold',
  '800': 'Rubik_800ExtraBold',
  '900': 'Rubik_900Black',
};

/** The Rubik family for a weight — for places that style text outside React Native's Text. */
export function rubik(weight?: TextStyle['fontWeight'], italic = false): string {
  const family = BY_WEIGHT[String(weight ?? '400')] ?? 'Rubik_400Regular';
  return italic && family === 'Rubik_400Regular' ? 'Rubik_400Regular_Italic' : family;
}

function withRubik(style: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const flat = StyleSheet.flatten(style) ?? {};
  if (flat.fontFamily && !flat.fontFamily.startsWith('Rubik')) return style;
  const family = rubik(flat.fontWeight, flat.fontStyle === 'italic');
  return [
    style,
    {
      fontFamily: family,
      // The family carries the weight (and italic, where there is a file for
      // it). Pairing a custom family with a weight makes Android fall back to
      // the system font.
      fontWeight: 'normal',
      ...(family.endsWith('_Italic') ? { fontStyle: 'normal' as const } : null),
    },
  ];
}

type Renderable = {
  render?: (props: { style?: StyleProp<TextStyle> }, ref: unknown) => unknown;
  __rubik?: boolean;
};

// Text and TextInput are forwardRef components; wrapping `render` reaches
// every instance, including those inside navigation headers and libraries.
for (const Component of [Text, TextInput] as unknown as Renderable[]) {
  const render = Component.render;
  if (!render || Component.__rubik) continue; // already wrapped (fast refresh)
  Component.render = function renderWithRubik(this: unknown, props, ref) {
    return render.call(this, { ...props, style: withRubik(props.style) }, ref);
  };
  Component.__rubik = true;
}
