import * as WebBrowser from 'expo-web-browser';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View as RNView } from 'react-native';

import { Text, View, useThemeColor } from '@/components/Themed';
import { API_BASE } from '@/lib/api';

const LINKS: { label: string; url: string }[] = [
  { label: 'College Lacrosse News', url: 'https://collegelacrossenews.com' },
  { label: 'Rankings', url: 'https://collegelacrossenews.com/rankings/' },
  { label: 'Transfers', url: 'https://collegelacrossenews.com/transfers/' },
  { label: 'Camps & Showcases', url: 'https://collegelacrossenews.com/camps/' },
];

export default function MoreScreen() {
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  return (
    <View style={styles.screen}>
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
            style={[styles.row, { borderTopColor: border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <Text style={styles.label}>{l.label}</Text>
            <Text style={{ color: muted }}>›</Text>
          </Pressable>
        ))}
      </RNView>
      <Text style={[styles.note, { color: muted }]}>
        Scores, box scores and play-by-play are official NCAA data served by the CLN data API ({API_BASE.replace('https://', '')}).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 12 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  label: { fontSize: 16 },
  note: { fontSize: 12, marginTop: 16, textAlign: 'center' },
});
