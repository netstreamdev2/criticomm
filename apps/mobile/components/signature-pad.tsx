import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { makeStyles } from '@/lib/theme';
import { useT } from '@/lib/i18n';

/**
 * Finger signature for the 187(c) sign-off. Strokes are kept as SVG path data
 * so the signature is stored as a few KB of vector text and prints sharply on
 * the PDF, instead of as a bitmap.
 *
 * The parent ScrollView must stop scrolling while the officer signs, or the
 * first stroke turns into a scroll — `onDrawingChange` reports that.
 */

const INK = '#1e293b';

type Point = [number, number];

export function toSignatureSvg(strokes: Point[][], width: number, height: number) {
  const d = strokesToPath(strokes);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}" width="${Math.round(width)}" height="${Math.round(height)}"><path d="${d}" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function strokesToPath(strokes: Point[][]) {
  return strokes
    .filter((s) => s.length > 0)
    .map((s) => {
      const [first, ...rest] = s as [Point, ...Point[]];
      // A tap leaves a single point; draw it as a dot.
      const tail = rest.length ? rest.map(([x, y]) => `L${x} ${y}`).join('') : `L${first[0] + 0.1} ${first[1]}`;
      return `M${first[0]} ${first[1]}${tail}`;
    })
    .join('');
}

export function SignaturePad({
  onChange, onDrawingChange, disabled,
}: {
  /** SVG markup, or null once cleared. */
  onChange: (svg: string | null) => void;
  onDrawingChange?: (drawing: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const styles = useStyles();
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const size = useRef({ width: 0, height: 0 });
  const live = useRef<Point[][]>([]);

  const commit = (next: Point[][]) => {
    live.current = next;
    setStrokes(next);
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      onDrawingChange?.(true);
      const { locationX, locationY } = e.nativeEvent;
      commit([...live.current, [[round(locationX), round(locationY)]]]);
    },
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      const all = live.current.slice();
      const last = all[all.length - 1];
      if (!last) return;
      all[all.length - 1] = [...last, [round(locationX), round(locationY)]];
      commit(all);
    },
    onPanResponderRelease: () => {
      onDrawingChange?.(false);
      const { width, height } = size.current;
      onChange(live.current.length ? toSignatureSvg(live.current, width, height) : null);
    },
    onPanResponderTerminate: () => onDrawingChange?.(false),
  }), [disabled, onChange, onDrawingChange]);

  const clear = () => {
    commit([]);
    onChange(null);
  };

  return (
    <View>
      <View
        style={[styles.pad, disabled && { opacity: 0.6 }]}
        onLayout={(e: LayoutChangeEvent) => { size.current = e.nativeEvent.layout; }}
        {...responder.panHandlers}
        accessibilityLabel={t('Signature pad. Sign with your finger.')}
      >
        <Svg width="100%" height="100%">
          <Path
            d={strokesToPath(strokes)}
            stroke={INK}
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        {strokes.length === 0 ? (
          <View style={styles.hint} pointerEvents="none">
            <Text style={styles.hintText}>{t('Sign here')}</Text>
          </View>
        ) : null}
        <View style={styles.baseline} pointerEvents="none" />
      </View>
      {strokes.length > 0 && !disabled ? (
        <Text onPress={clear} style={styles.clear} accessibilityRole="button">{t('✕ Clear')}</Text>
      ) : null}
    </View>
  );
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

const useStyles = makeStyles(() => StyleSheet.create({
  pad: {
    height: 180, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc', overflow: 'hidden',
  },
  hint: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  hintText: { color: '#94a3b8', fontSize: 14 },
  baseline: {
    position: 'absolute', left: 24, right: 24, bottom: 36,
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0', borderStyle: 'dashed',
  },
  clear: { color: '#ef4444', fontWeight: '700', marginTop: 8, alignSelf: 'flex-start', padding: 4 },
}));
