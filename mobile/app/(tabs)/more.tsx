import * as WebBrowser from 'expo-web-browser';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';
import { API_BASE } from '@/lib/api';
import { useFollows } from '@/lib/favorites';

const LINKS: { label: string; url: string }[] = [
  { label: 'CLN Website', url: 'https://collegelacrossenews.com' },
  { label: 'TV Schedule', url: 'https://collegelacrossenews.com/tv-schedule/' },
  { label: 'Streaming Guide', url: 'https://collegelacrossenews.com/streaming-guide/' },
];

const HOW_TO: { title: string; body: string }[] = [
  {
    title: 'Games',
    body: 'Live scores for every NCAA men’s and women’s game in DI, DII and DIII. Use the Men’s/Women’s and DI/DII/DIII pills to switch boards, the arrows or Calendar to change the day, and tap a game for the box score, goals and rosters. Games in progress update in real time.',
  },
  {
    title: 'Favorite team & watch list',
    body: 'Open any team page (tap a team name anywhere) and tap ☆ Make favorite or + Watch. Your teams appear in a “My Teams” band at the top of Games and Teams, and the app opens to your favorite’s board.',
  },
  {
    title: 'Teams',
    body: 'Every program grouped by conference. A team page has its schedule and results, roster, season stats, and past seasons.',
  },
  {
    title: 'Standings',
    body: 'Conference standings ranked by conference record, with the overall record under each team.',
  },
  {
    title: 'Statistics',
    body: 'Player and team leaders by category — top 5 shown, tap a category for the top 30.',
  },
  {
    title: 'News',
    body: 'The latest from College Lacrosse News, inside the app.',
  },
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
        {LINKS.map((l) => (
          <Pressable
            key={l.url}
            onPress={() => WebBrowser.openBrowserAsync(l.url)}
            style={[styles.row, rowBorder]}>
            <Text style={styles.label}>{l.label}</Text>
            <Text style={[styles.ext, { color: muted }]}>opens website ›</Text>
          </Pressable>
        ))}
      </RNView>

      <Text style={[styles.heading, { color: muted }]}>MY TEAMS</Text>
      <RNView style={[styles.card, { backgroundColor: card, borderColor: border }]}>
        <RNView style={styles.row}>
          <Text style={styles.label}>Favorite</Text>
          <Text style={{ color: muted }}>{follows.favorite?.name ?? 'None yet'}</Text>
        </RNView>
        <RNView style={[styles.row, rowBorder]}>
          <Text style={styles.label}>Watching</Text>
          <Text style={[styles.value, { color: muted }]} numberOfLines={2}>
            {follows.watching.length ? follows.watching.map((t) => t.name).join(', ') : 'None yet'}
          </Text>
        </RNView>
        <Text style={[styles.hint, { color: muted }]}>
          Pick teams from any team page with ☆ Make favorite or + Watch.
        </Text>
      </RNView>

      <Text style={[styles.heading, { color: muted }]}>ABOUT THE APP</Text>
      <RNView style={[styles.card, { backgroundColor: card, borderColor: border }]}>
        <Text style={styles.about}>
          CLN Lacrosse is the College Lacrosse News app for NCAA men’s and women’s lacrosse: live scores, box scores, play-by-play, rosters, standings and stat leaders for all three divisions, plus CLN news.
        </Text>
        {HOW_TO.map((h) => (
          <RNView key={h.title} style={[styles.howRow, rowBorder]}>
            <Text style={styles.howTitle}>{h.title}</Text>
            <Text style={[styles.howBody, { color: muted }]}>{h.body}</Text>
          </RNView>
        ))}
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
