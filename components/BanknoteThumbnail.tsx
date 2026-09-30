import { useState } from 'react';
import { Image, View } from 'react-native';
import { Typography } from 'heroui-native';

const BANKNOTE_SERIES: Record<number, string> = {
  5: 'cup-5-2014',
  10: 'cup-10-2002',
  20: 'cup-20-2002',
  50: 'cup-50-1999',
  100: 'cup-100-2014',
  200: 'cup-200-2015',
  500: 'cup-500-2015',
  1000: 'cup-1000-2015',
  2000: 'cup-2000-2026',
  5000: 'cup-5000-2026',
  10000: 'cup-10000-2026',
  20000: 'cup-20000-2026',
};

type BanknoteThumbnailProps = {
  denomination: number;
};

export function BanknoteThumbnail({ denomination }: BanknoteThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const series = BANKNOTE_SERIES[denomination];
  const uri = series
    ? `https://www.bc.gob.cu/images/billetes/CUP/${series}/obverse.webp`
    : undefined;

  return (
    <View className="bg-default border-border h-14 overflow-hidden rounded-lg border">
      {!failed && uri ? (
        <Image
          source={{ uri }}
          accessibilityLabel={`Billete cubano de ${denomination} CUP`}
          resizeMode="cover"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: 56 }}
        />
      ) : (
        <View className="bg-accent-soft h-full flex-row items-center justify-between px-3">
          <Typography.Heading type="h4" className="text-accent">
            {denomination}
          </Typography.Heading>
          <Typography.Paragraph type="body-sm" className="text-accent">
            CUP
          </Typography.Paragraph>
        </View>
      )}
    </View>
  );
}
