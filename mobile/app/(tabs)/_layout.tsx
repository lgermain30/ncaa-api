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
        name="standings"
        options={{
          title: 'Standings',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'list.number', android: 'format_list_numbered', web: 'format_list_numbered' }} tintColor={color} size={26} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Statistics',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' }} tintColor={color} size={26} />
          ),
        }}
      />
      <Tabs.Screen
        name="news"
        options={{
          title: 'News',
          tabBarIcon: ({ color }) => (
            <SymbolView name={{ ios: 'newspaper', android: 'newspaper', web: 'newspaper' }} tintColor={color} size={26} />
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
