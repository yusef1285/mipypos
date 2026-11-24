import { Image } from 'react-native';

const appIcon = require('@/assets/logo_mipypos_512.png');

type BrandMarkProps = {
  size?: number;
};

export function BrandMark({ size = 48 }: BrandMarkProps) {
  return (
    <Image
      accessible={false}
      source={appIcon}
      resizeMode="contain"
      style={{ width: size, height: size }}
    />
  );
}
