import { SymbolView } from 'expo-symbols';
import { Tabs } from 'expo-router';

import Colors, { brand } from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        tabBarPosition: 'bottom',
        tabBarLabelPosition: 'below-icon',
        headerShown: useClientOnlyValue(false, true),
        headerStyle: { backgroundColor: brand.navy },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '800', color: '#fff' },
      }}>
      <Tabs.Screen
        name="index"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="games"
        options={{
          title: 'Games',
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }} tintColor={color} size={26} />
          ),
        }}
      />
      <Tabs.Screen
        name="teams"
        options={{
          title: 'Teams',
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'flag', android: 'outlined_flag', web: 'outlined_flag' }} tintColor={color} size={26} />
          ),
        }}
      />
      <Tabs.Screen
        name="standings"
        options={{
          title: 'Standings',
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'trophy', android: 'emoji_events', web: 'emoji_events' }} tintColor={color} size={26} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Statistics',
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' }} tintColor={color} size={26} />
          ),
        }}
      />
      <Tabs.Screen
        name="news"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'line.3.horizontal', android: 'menu', web: 'menu' }} tintColor={color} size={26} />
          ),
        }}
      />
    </Tabs>
  );
}
