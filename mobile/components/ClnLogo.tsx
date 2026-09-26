import { Image } from 'expo-image';

const logo = require('@/assets/images/icon.png');

export function ClnLogo({ size = 28 }: { size?: number }) {
  return (
    <Image
      source={logo}
      style={{ width: size, height: size, borderRadius: size * 0.2 }}
      contentFit="contain"
      accessibilityLabel="College Lacrosse News"
    />
  );
}
