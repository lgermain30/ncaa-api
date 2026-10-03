import * as WebBrowser from 'expo-web-browser';
import { FlatList, Pressable, RefreshControl, StyleSheet, View as RNView } from 'react-native';

import { ClnLogo } from '@/components/ClnLogo';
import { Text, View, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { useV1 } from '@/hooks/useV1';
import { fetchNews } from '@/lib/api';
import type { V1NewsItem } from '@/lib/types';

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function Story({ item }: { item: V1NewsItem }) {
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  return (
    <Pressable
      onPress={() => WebBrowser.openBrowserAsync(item.link)}
      style={({ pressed }) => [styles.story, { borderBottomColor: border }, pressed && { opacity: 0.6 }]}
      accessibilityRole="link">
      <Text style={styles.title}>{item.title}</Text>
      <Text style={[styles.meta, { color: muted }]} numberOfLines={1}>
        {[when(item.publishedAt), item.category].filter(Boolean).join(' · ')}
      </Text>
    </Pressable>
  );
}

export default function NewsScreen() {
  const muted = useThemeColor({}, 'muted');
  const q = useV1<V1NewsItem[]>('news', fetchNews, 5 * 60_000);

  return (
    <View style={styles.screen}>
      <RNView style={styles.band}>
        <Text style={styles.bandTitle}>Latest News</Text>
        <ClnLogo size={18} />
      </RNView>
      <FlatList
        data={q.data ?? []}
        keyExtractor={(i) => String(i.id)}
        renderItem={({ item }) => <Story item={item} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={q.refresh} />}
        ListEmptyComponent={
          <Text style={[styles.note, { color: muted }]}>
            {q.loading ? 'Loading…' : q.error ? `Couldn't load news (${q.error})` : 'No stories yet.'}
          </Text>
        }
        ListFooterComponent={
          <Text style={[styles.note, { color: muted }]}>
            From collegelacrossenews.com{q.stale ? ' · showing last saved copy' : ''}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: brand.navy,
  },
  bandTitle: { color: '#fff', fontWeight: '600', fontSize: 14 },
  list: { paddingBottom: 32 },
  story: { paddingHorizontal: 14, paddingVertical: 9, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 15, fontWeight: '600', lineHeight: 20, color: brand.navy },
  meta: { fontSize: 12 },
  note: { fontSize: 12, textAlign: 'center', marginVertical: 12 },
});
