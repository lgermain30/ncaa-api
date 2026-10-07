import { Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Switch, View as RNView } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { REMINDER_OPTIONS, TEXT_SIZE_OPTIONS, updateSettings, useSettings, type Settings } from '@/lib/settings';

type BoolKey = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

const IN_APP: { key: BoolKey; label: string; hint?: string }[] = [
  { key: 'boldColors', label: 'Bolder Fav/Watched Team Colors' },
  { key: 'inAppGoalAlerts', label: 'In-app Goal Alerts', hint: 'Banner when a team you follow scores while the app is open' },
];

const PUSH: { key: BoolKey; label: string }[] = [
  { key: 'watchedGoals', label: 'Watched Team Goals' },
  { key: 'watchedFinal', label: 'Watched Team Final Score' },
  { key: 'favoriteGoals', label: 'Favorite Team Goals' },
  { key: 'favoriteFinal', label: 'Favorite Team Final Score' },
];

export default function SettingsScreen() {
  const s = useSettings();
  const card = useThemeColor({}, 'card');
  const border = useThemeColor({}, 'border');
  const muted = useThemeColor({}, 'muted');
  const rowBorder = { borderTopColor: border, borderTopWidth: StyleSheet.hairlineWidth };

  const Row = ({ item, i }: { item: { key: BoolKey; label: string; hint?: string }; i: number }) => (
    <RNView style={[styles.row, i > 0 && rowBorder]}>
      <RNView style={styles.labelWrap}>
        <Text style={styles.label}>{item.label}</Text>
        {item.hint ? <Text style={[styles.hint, { color: muted }]}>{item.hint}</Text> : null}
      </RNView>
      <Switch
        value={s[item.key]}
        onValueChange={(v) => updateSettings({ [item.key]: v })}
        trackColor={{ true: brand.navy }}
      />
    </RNView>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Settings', presentation: 'modal' }} />
      <Text style={[styles.heading, { color: muted }]}>DISPLAY</Text>
      <RNView style={[styles.card, { backgroundColor: card, borderColor: border }]}>
        {IN_APP.map((item, i) => (
          <Row key={item.key} item={item} i={i} />
        ))}
        <RNView style={[styles.row, rowBorder, styles.reminderRow]}>
          <Text style={styles.label}>Text Size</Text>
          <RNView style={styles.chips}>
            {TEXT_SIZE_OPTIONS.map((o) => {
              const on = s.textSize === o.value;
              return (
                <Pressable
                  key={o.value}
                  onPress={() => updateSettings({ textSize: o.value })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.chip, { borderColor: border }, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </RNView>
        </RNView>
      </RNView>

      <Text style={[styles.heading, { color: muted }]}>ALERTS & REMINDERS</Text>
      <RNView style={[styles.card, { backgroundColor: card, borderColor: border }]}>
        {PUSH.map((item, i) => (
          <Row key={item.key} item={item} i={i} />
        ))}
        <RNView style={[styles.row, rowBorder, styles.reminderRow]}>
          <Text style={styles.label}>Favorite Team Game Alert</Text>
          <RNView style={styles.chips}>
            {REMINDER_OPTIONS.map((o) => {
              const on = s.favoriteReminderMin === o.value;
              return (
                <Pressable
                  key={o.label}
                  onPress={() => updateSettings({ favoriteReminderMin: o.value })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[styles.chip, { borderColor: border }, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {o.value === null ? o.label : `${o.label} before`}
                  </Text>
                </Pressable>
              );
            })}
          </RNView>
        </RNView>
      </RNView>
      <Text style={[styles.note, { color: muted }]}>
        Alerts are saved now and will be delivered once the CLN app is installed from the App Store / Google Play.
        In the Expo Go preview, only in-app alerts are shown.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 12, paddingBottom: 32 },
  heading: { fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 6, marginLeft: 4, letterSpacing: 0.5 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
  labelWrap: { flex: 1, gap: 2 },
  label: { fontSize: 15 },
  hint: { fontSize: 12 },
  reminderRow: { flexDirection: 'column', alignItems: 'flex-start', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipOn: { backgroundColor: brand.navy, borderColor: brand.navy },
  chipText: { fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  note: { fontSize: 12, lineHeight: 17, marginTop: 14, textAlign: 'center' },
});
