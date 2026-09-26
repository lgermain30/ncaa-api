import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View as RNView } from 'react-native';

import { Segmented } from '@/components/Segmented';
import { Text, View, useThemeColor } from '@/components/Themed';
import { useV1 } from '@/hooks/useV1';
import { fetchNews, SPORTS } from '@/lib/api';
import type { NewsFeed, NewsItem, Sport, V1Envelope } from '@/lib/types';

function when(pubDate: string): string {
  const d = new Date(pubDate);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Story({ item }: { item: NewsItem }) {
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  return (
    <Pressable
      onPress={() => WebBrowser.openBrowserAsync(item.link)}
      style={({ pressed }) => [styles.story, { backgroundColor: card, borderColor: border }, pressed && { opacity: 0.7 }]}>
      {item.image ? <Image source={{ uri: item.image }} style={styles.thumb} contentFit="cover" cachePolicy="disk" /> : null}
      <RNView style={styles.storyBody}>
        <Text style={styles.title} numberOfLines={3}>
          {item.title}
        </Text>
        <Text style={[styles.meta, { color: muted }]} numberOfLines={1}>
          {[when(item.pubDate), item.category].filter(Boolean).join(' · ')}
        </Text>
      </RNView>
    </Pressable>
  );
}

export default function NewsScreen() {
  const muted = useThemeColor({}, 'muted');
  const [sport, setSport] = useState<Sport>('lacrosse-men');
  const q = useV1<NewsFeed>(
    `news/${sport}`,
    useCallback(
      async (signal: AbortSignal): Promise<V1Envelope<NewsFeed>> => ({
        data: await fetchNews(sport, 'd1', signal),
        meta: { updatedAt: new Date().toISOString(), stale: false },
      }),
      [sport],
    ),
    5 * 60_000,
  );

  return (
    <View style={styles.screen}>
      <RNView style={styles.controls}>
        <Segmented options={SPORTS} value={sport} onChange={setSport} />
      </RNView>
      <FlatList
        data={q.data?.items ?? []}
        keyExtractor={(i) => i.link}
        renderItem={({ item }) => <Story item={item} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={false} onRefresh={q.refresh} />}
        ListEmptyComponent={
          <Text style={[styles.note, { color: muted }]}>
            {q.loading ? 'Loading…' : q.error ? `Couldn't load news (${q.error})` : 'No stories.'}
          </Text>
        }
        ListFooterComponent={<Text style={[styles.note, { color: muted }]}>Stories from NCAA.com</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  controls: { padding: 12, paddingBottom: 4 },
  list: { paddingHorizontal: 12, paddingBottom: 32, gap: 10 },
  story: { flexDirection: 'row', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  thumb: { width: 120, minHeight: 80 },
  storyBody: { flex: 1, padding: 10, justifyContent: 'center', gap: 4 },
  title: { fontSize: 14, fontWeight: '700' },
  meta: { fontSize: 11 },
  note: { fontSize: 12, textAlign: 'center', marginVertical: 12 },
});
