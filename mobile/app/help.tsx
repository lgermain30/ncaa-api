import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, ScrollView, StyleSheet, View as RNView } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { confirm } from '@/lib/dialog';
import { clearFollows, MAX_WATCH } from '@/lib/favorites';
import { resetSettings } from '@/lib/settings';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Games',
    body: 'Live scores for every NCAA men’s and women’s game in DI, DII and DIII. Use the Men’s/Women’s and DI/DII/DIII pills to switch boards, the arrows or Calendar to change the day, and tap a game for the box score, goals and rosters. Games in progress update in real time.',
  },
  {
    title: 'Favorite Team',
    body: 'You may pick one favorite men’s team and one women’s team: open a team (tap its name anywhere in the app) and tap “Make favorite.” Setting another favorite replaces the previous one. Your favorite’s games appear first under My Teams on the Games and Teams tabs, are highlighted throughout the app, and the app opens on its board.',
  },
  {
    title: 'Watched Teams',
    body: `In addition to your favorite, you may watch up to ${MAX_WATCH} more teams per gender. On a team page tap “Watch” to toggle a team on or off. Games for all your watched teams appear under My Teams and are highlighted throughout the app.`,
  },
  {
    title: 'Notifications',
    body: 'Settings (on the More tab) lets you turn on in-app goal alerts and choose goal, final-score and pre-game alerts for your favorite and watched teams. Pushed alerts arrive once the app is installed from the App Store / Google Play.',
  },
  {
    title: 'Teams, Standings & Statistics',
    body: 'Teams lists every program by conference; a team page has its schedule, roster, season stats and past seasons. Standings rank each conference by conference record with the overall record under each team. Statistics shows player and team leaders — top 5 per category, tap for the top 30.',
  },
  {
    title: 'Having Problems?',
    body: 'If data looks wrong or is missing, pull down on any list to reload it. Reset below clears your favorite, watched teams and settings. If that does not help, delete and reinstall the app, or e-mail support.',
  },
];

export default function HelpScreen() {
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');

  const reset = () =>
    confirm(
      'Reset the app?',
      'This clears your favorite team, watched teams and settings.',
      () => {
        clearFollows();
        resetSettings();
      },
      'Reset',
    );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Help & About', presentation: 'modal' }} />
      <RNView style={[styles.card, { backgroundColor: card, borderColor: border }]}>
        <Text style={styles.about}>
          CLN Lacrosse is the College Lacrosse News app for NCAA men’s and women’s lacrosse: live scores, box scores,
          play-by-play, rosters, standings and stat leaders for all three divisions, plus CLN news. Scores and game data
          are official NCAA data served by the CLN data API.
        </Text>
        {SECTIONS.map((h) => (
          <RNView key={h.title} style={[styles.section, { borderTopColor: border }]}>
            <Text style={styles.sectionTitle}>{h.title}</Text>
            <Text style={[styles.body, { color: muted }]}>{h.body}</Text>
          </RNView>
        ))}
      </RNView>
      <RNView style={styles.actions}>
        <Pressable
          onPress={() => WebBrowser.openBrowserAsync('https://collegelacrossenews.com/contact/')}
          style={[styles.btn, { borderColor: brand.navy }]}
          accessibilityRole="button">
          <Text style={[styles.btnText, { color: brand.navy }]}>E-mail Support</Text>
        </Pressable>
        <Pressable onPress={reset} style={[styles.btn, { borderColor: brand.red }]} accessibilityRole="button">
          <Text style={[styles.btnText, { color: brand.red }]}>Reset</Text>
        </Pressable>
      </RNView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 12, paddingBottom: 32 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  about: { fontSize: 14, lineHeight: 20, padding: 14 },
  section: { padding: 14, gap: 3, borderTopWidth: StyleSheet.hairlineWidth },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: brand.navy },
  body: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  btnText: { fontSize: 14, fontWeight: '700' },
});
