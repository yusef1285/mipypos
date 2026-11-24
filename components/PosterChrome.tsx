import { ArrowUpRight } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BrandMark } from '@/components/BrandMark';
import { LinearGradient } from '@/components/ui/primitives/LinearGradient';
import { Path, Svg } from '@/components/ui/primitives/Svg';
import { poster } from '@/lib/branding';

const moduleColors = {
  blue: { colors: ['#1058C5', '#082E80'], detail: '#AEE8FF', border: '#4385E7' },
  green: { colors: ['#167546', '#095138'], detail: '#C2F9A4', border: '#3D9C70' },
  orange: { colors: ['#A84207', '#7C2A09'], detail: '#FFE4A8', border: '#DC8548' },
  purple: { colors: ['#6536B7', '#402084'], detail: '#EBDEFF', border: '#9C74DD' },
} as const;

export type PosterTone = keyof typeof moduleColors;

export function PosterBackdrop({ variant = 'panel' }: { variant?: 'panel' | 'full' }) {
  const full = variant === 'full';
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <LinearGradient
        colors={full ? ['#061332', '#123E88', '#081B43'] : ['#071735', '#102E72', '#174BA0']}
        start={{ x: 0, y: 0.22 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 840 420"
        preserveAspectRatio="none"
        style={StyleSheet.absoluteFill}
      >
        <Path
          d="M-36 115C96 92 99 5 237-18"
          fill="none"
          stroke="#2767D6"
          strokeWidth={30}
          opacity={0.3}
        />
        <Path
          d="M-22 92C91 69 117-16 207-22"
          fill="none"
          stroke="#65DBFF"
          strokeWidth={2}
          opacity={0.55}
        />
        <Path
          d="M367 450C553 401 624 292 721 238C778 206 805 184 864 151"
          fill="none"
          stroke="#137BF0"
          strokeWidth={55}
          opacity={0.34}
        />
        <Path
          d="M426 439C587 405 624 335 726 283C788 250 822 223 872 189"
          fill="none"
          stroke="#31CAFF"
          strokeWidth={4}
          opacity={0.68}
        />
        <Path
          d="M559 441C677 401 761 330 865 288"
          fill="none"
          stroke="#B3F4FF"
          strokeWidth={1.3}
          opacity={0.32}
        />
      </Svg>
    </View>
  );
}

export function PosterBrand({ large = false }: { large?: boolean }) {
  return (
    <View style={styles.brand} accessible accessibilityLabel="MipyPOS">
      <BrandMark size={large ? 54 : 42} />
      <View>
        <Text style={[styles.wordmark, large && styles.wordmarkLarge]}>
          <Text>Mipy</Text>
          <Text style={styles.wordmarkAccent}>POS</Text>
        </Text>
        <View style={styles.brandRule} />
      </View>
    </View>
  );
}

export function PosterModule({
  label,
  description,
  icon: Icon,
  tone,
  onPress,
}: {
  label: string;
  description: string;
  icon: LucideIcon;
  tone: PosterTone;
  onPress: () => void;
}) {
  const { colors, detail, border } = moduleColors[tone];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      onPress={onPress}
      style={({ pressed }) => [styles.module, { borderColor: border }, pressed && styles.pressed]}
    >
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.moduleTop}>
        <View style={styles.moduleIcon}>
          <Icon color={poster.white} strokeWidth={2.1} size={23} />
        </View>
        <ArrowUpRight color={detail} size={17} />
      </View>
      <View style={styles.moduleCopy}>
        <Text style={styles.moduleTitle}>{label}</Text>
        <Text style={[styles.moduleDescription, { color: detail }]}>{description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  wordmark: {
    color: poster.white,
    fontSize: 29,
    fontStyle: 'italic',
    fontWeight: '900',
    letterSpacing: -1.05,
    paddingRight: 3,
    includeFontPadding: false,
  },
  wordmarkLarge: { fontSize: 38, letterSpacing: -1.65 },
  wordmarkAccent: { color: poster.cyan },
  brandRule: {
    marginTop: 3,
    height: 3,
    width: 36,
    borderRadius: 2,
    backgroundColor: poster.yellow,
    transform: [{ skewX: '-21deg' }],
  },
  module: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 17,
    borderWidth: 1,
    minHeight: 116,
    flex: 1,
    padding: 12,
    gap: 10,
    justifyContent: 'space-between',
  },
  pressed: { opacity: 0.82 },
  moduleTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  moduleIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: '#FFFFFF22',
    borderColor: '#FFFFFF3B',
    borderWidth: 1,
  },
  moduleCopy: { gap: 2 },
  moduleTitle: { color: poster.white, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  moduleDescription: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
});
