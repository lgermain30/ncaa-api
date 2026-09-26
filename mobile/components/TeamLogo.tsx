import { Image } from 'expo-image';
import { StyleSheet, View as RNView } from 'react-native';

import { Text } from '@/components/Themed';
import { logoUrl } from '@/lib/api';

/** Team crest from the API's /logo route; falls back to the team's initials. */
export function TeamLogo({
  seoName,
  fallback,
  size = 32,
}: {
  seoName: string | null | undefined;
  fallback: string;
  size?: number;
}) {
  if (!seoName) {
    return (
      <RNView style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[styles.initials, { fontSize: size * 0.36 }]}>{fallback.slice(0, 3).toUpperCase()}</Text>
      </RNView>
    );
  }
  return (
    <Image
      source={{ uri: logoUrl(seoName) }}
      style={{ width: size, height: size }}
      contentFit="contain"
      cachePolicy="disk"
      transition={100}
      accessibilityLabel={`${fallback} logo`}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: '#d1d5db', alignItems: 'center', justifyContent: 'center' },
  initials: { fontWeight: '700', color: '#374151' },
});
