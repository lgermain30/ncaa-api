import { ScrollView, StyleSheet } from 'react-native';

import { Chips } from '@/components/Chips';

/** Horizontal year picker, newest first (same chips as the team page). */
export function SeasonChips({
  seasons,
  value,
  onChange,
}: {
  seasons: string[];
  value: string;
  onChange: (season: string) => void;
}) {
  if (seasons.length < 2) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.content}>
      <Chips options={seasons.map((s) => ({ key: s, label: s }))} value={value} onChange={onChange} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, flexShrink: 0 },
  content: { paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
});
