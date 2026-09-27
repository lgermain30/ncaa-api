import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ClnLogo } from '@/components/ClnLogo';
import { Text } from '@/components/Themed';
import { brand } from '@/constants/Colors';
import { conferenceInfo, conferenceLogoUrl } from '@/lib/conferences';

/**
 * CHN-style section band: conference color as background, conference logo on a
 * white tile at the right. Unknown groups (Non-conference, tournament rounds,
 * Independent) fall back to CLN navy + the CLN logo.
 */
export function ConferenceBand({ title, conference }: { title: string; conference?: string | null }) {
  const info = conferenceInfo(conference ?? title);
  const logo = conferenceLogoUrl(conference ?? title);
  return (
    <View style={[styles.band, { backgroundColor: info?.color ?? brand.navy }]}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {logo ? (
        <View style={styles.tile}>
          <Image source={{ uri: logo }} style={styles.logo} contentFit="contain" accessibilityLabel={info?.name ?? title} />
        </View>
      ) : (
        <ClnLogo size={18} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 3,
    minHeight: 26,
  },
  title: { color: '#fff', fontWeight: '600', fontSize: 14, flex: 1, marginRight: 8 },
  tile: { backgroundColor: '#fff', borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1 },
  logo: { width: 34, height: 18 },
});
