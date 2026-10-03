import * as WebBrowser from 'expo-web-browser';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';
import { API_BASE } from '@/lib/api';
import { favoriteFor, useFollows } from '@/lib/favorites';

const LINKS: { label: string; url: string }[] = [
  { label: 'CLN Website', url: 'https://collegelacrossenews.com' },
  { label: 'TV Schedule', url: 'https://collegelacrossenews.com/tv-schedule/' },
  { label: 'Streaming Guide', url: 'https://collegelacrossenews.com/streaming-guide/' },
];

export default function MoreScreen() {
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const follows = useFollows();
  const rowBorder = { borderTopColor: border, borderTopWidth: StyleSheet.hairlineWidth };
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <RNView style={[styles.card, { backgroundColor: card, borderColor: border }]}>
        <Link href="/news" asChild>
          <Pressable style={styles.row}>
            <Text style={styles.label}>News</Text>
            <Text style={{ color: muted }}>›</Text>
          </Pressable>
        </Link>
        <Link href="/settings" asChild>
          <Pressable style={[styles.row, rowBorder]}>
            <Text style={styles.label}>Settings</Text>
            <Text style={{ color: muted }}>›</Text>
          </Pressable>
        </Link>
        <Link href="/help" asChild>
          <Pressable style={[styles.row, rowBorder]}>
            <Text style={styles.label}>Help & About</Text>
            <Text style={{ color: muted }}>›</Text>
          </Pressable>
        </Link>
      </RNView>

      <Text style={[styles.heading, { color: muted }]}>COLLEGE LACROSSE NEWS</Text>
      <RNView style={[styles.card, { backgroundColor: card, borderColor: border }]}>
        {LINKS.map((l, i) => (
          <Pressable
            key={l.url}
            onPress={() => WebBrowser.openBrowserAsync(l.url)}
            style={[styles.row, i > 0 && rowBorder]}>
            <Text style={styles.label}>{l.label}</Text>
            <Text style={[styles.ext, { color: muted }]}>opens website ›</Text>
          </Pressable>
        ))}
      </RNView>

      <Text style={[styles.heading, { color: muted }]}>MY TEAMS</Text>
      <RNView style={[styles.card, { backgroundColor: card, borderColor: border }]}>
        {(["lacrosse-men", "lacrosse-women"] as const).map((sp, i) => {
          const fav = favoriteFor(follows, sp);
          const watching = follows.watching.filter((t) => t.sport === sp);
          return (
            <RNView key={sp} style={i > 0 ? rowBorder : undefined}>
              <RNView style={styles.row}>
                <Text style={styles.label}>{sp === "lacrosse-men" ? "Men’s favorite" : "Women’s favorite"}</Text>
                <Text style={{ color: muted }}>{fav?.name ?? "None yet"}</Text>
              </RNView>
              <RNView style={[styles.row, { paddingTop: 0 }]}>
                <Text style={styles.label}>Watching</Text>
                <Text style={[styles.value, { color: muted }]} numberOfLines={2}>
                  {watching.length ? watching.map((t) => t.name).join(", ") : "None yet"}
                </Text>
              </RNView>
            </RNView>
          );
        })}
        <Text style={[styles.hint, { color: muted }]}>
          Pick teams from any team page with ☆ Make favorite or + Watch.
        </Text>
      </RNView>

      <Text style={[styles.note, { color: muted }]}>
        Scores, box scores and play-by-play are official NCAA data served by the CLN data API ({API_BASE.replace('https://', '')}).
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 12, paddingBottom: 32 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, gap: 12 },
  label: { fontSize: 16 },
  value: { flex: 1, textAlign: 'right', fontSize: 14 },
  ext: { fontSize: 12 },
  heading: { fontSize: 12, fontWeight: '700', marginTop: 18, marginBottom: 6, marginLeft: 4, letterSpacing: 0.5 },
  hint: { fontSize: 12, paddingHorizontal: 14, paddingBottom: 12 },
  about: { fontSize: 14, lineHeight: 20, padding: 14 },
  howRow: { padding: 14, gap: 3 },
  howTitle: { fontSize: 14, fontWeight: '700' },
  howBody: { fontSize: 13, lineHeight: 18 },
  note: { fontSize: 12, marginTop: 16, textAlign: 'center' },
});
