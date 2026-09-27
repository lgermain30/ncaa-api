import { Image } from 'expo-image';
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

function Story({ item, lead }: { item: V1NewsItem; lead: boolean }) {
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const meta = [when(item.publishedAt), item.category].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={() => WebBrowser.openBrowserAsync(item.link)}
      style={({ pressed }) => [
        lead ? styles.lead : styles.story,
        { borderBottomColor: border },
        pressed && { opacity: 0.6 },
      ]}
      accessibilityRole="link">
      {item.image ? (
        <Image
          source={{ uri: item.image }}
          style={lead ? styles.leadImage : styles.thumb}
          contentFit="cover"
          cachePolicy="disk"
        />
      ) : null}
      <RNView style={[styles.body, lead && styles.leadBody]}>
        <Text style={lead ? styles.leadTitle : styles.title} numberOfLines={lead ? 3 : 2}>
          {item.title}
        </Text>
        {lead && item.excerpt ? (
          <Text style={[styles.excerpt, { color: muted }]} numberOfLines={2}>
            {item.excerpt}
          </Text>
        ) : null}
        <Text style={[styles.meta, { color: muted }]} numberOfLines={1}>
          {meta}
        </Text>
      </RNView>
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
        renderItem={({ item, index }) => <Story item={item} lead={index === 0} />}
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
  lead: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 10 },
  leadImage: { width: '100%', aspectRatio: 16 / 9 },
  leadTitle: { fontSize: 18, fontWeight: '700', lineHeight: 23 },
  excerpt: { fontSize: 13, lineHeight: 18 },
  story: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 96, height: 64, borderRadius: 4 },
  body: { flex: 1, gap: 3 },
  leadBody: { paddingHorizontal: 10, paddingTop: 6 },
  title: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  meta: { fontSize: 11 },
  note: { fontSize: 12, textAlign: 'center', marginVertical: 12 },
});
