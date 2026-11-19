import { Pressable, StyleSheet, View as RNView } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';

/** Compact pill selector for a small set of options (sport, division). */
export function Chips<K extends string>({
  options,
  value,
  onChange,
  color,
  inactiveColor,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  /** Selected pill fill (default: theme tint). */
  color?: string;
  /** Unselected label color (default: muted gray). */
  inactiveColor?: string;
}) {
  const tint = useThemeColor({}, 'tint');
  const muted = useThemeColor({}, 'muted');
  const fill = color ?? tint;
  const idle = inactiveColor ?? muted;
  return (
    <RNView style={styles.row}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && { backgroundColor: fill }]}>
            <Text style={[styles.label, { color: active ? '#fff' : idle }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </RNView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  label: { fontSize: 13, fontWeight: '700' },
});
