import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        headerShown: useClientOnlyValue(false, true),
        headerTitleStyle: { fontWeight: '800' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Scores',
          headerTitle: 'CLN Scores',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'sportscourt', android: 'scoreboard', web: 'scoreboard' }} tintColor={color} size={26} />
          ),
        }}
      />
      <Tabs.Screen
        name="standings"
        options={{
          title: 'Standings',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'list.number', android: 'format_list_numbered', web: 'format_list_numbered' }} tintColor={color} size={26} />
          ),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'ellipsis.circle', android: 'more_horiz', web: 'more_horiz' }} tintColor={color} size={26} />
          ),
        }}
      />
    </Tabs>
  );
}
