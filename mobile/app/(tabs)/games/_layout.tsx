import { Stack } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function GamesLayout() {
  const colorScheme = useColorScheme();
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: Colors[colorScheme].card },
      headerTintColor: Colors[colorScheme].tint,
      headerTitleStyle: { fontWeight: '700' },
    }}>
      <Stack.Screen name="index" options={{ title: 'College Lacrosse News' }} />
      <Stack.Screen name="[id]" options={{ headerBackTitle: 'Games' }} />
    </Stack>
  );
}
