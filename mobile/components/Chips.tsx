import { Pressable, StyleSheet, View as RNView } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';

/** Compact pill selector for a small set of options (sport, division). */
export function Chips<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const tint = useThemeColor({}, 'tint');
  const muted = useThemeColor({}, 'muted');
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
            style={[styles.chip, active && { backgroundColor: tint }]}>
            <Text style={[styles.label, { color: active ? '#fff' : muted }]}>{o.label}</Text>
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
