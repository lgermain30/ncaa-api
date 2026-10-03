import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import legal from '@/content/legal.json';

type Doc = { title: string; updated: string; sections: [string, string][] };
const DOCS: Record<string, Doc> = { terms: legal.terms as Doc, privacy: legal.privacy as Doc };

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const d = DOCS[doc ?? ''] ?? DOCS.terms;
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: d.title, presentation: 'modal' }} />
      <RNView style={[styles.card, { backgroundColor: card, borderColor: border }]}>
        <Text style={[styles.updated, { color: muted }]}>
          Call Partner Group LLC d/b/a College Lacrosse News · Last updated {d.updated}
        </Text>
        {d.sections.map(([title, body]) => (
          <RNView key={title} style={[styles.section, { borderTopColor: border }]}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={[styles.body, { color: muted }]}>{body}</Text>
          </RNView>
        ))}
      </RNView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 12, paddingBottom: 32 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  updated: { fontSize: 12, padding: 14 },
  section: { padding: 14, gap: 3, borderTopWidth: StyleSheet.hairlineWidth },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: brand.navy },
  body: { fontSize: 13, lineHeight: 18 },
});
