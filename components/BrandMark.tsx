import {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Svg,
} from '@/components/ui/primitives/Svg';

type BrandMarkProps = {
  size?: number;
};

export function BrandMark({ size = 48 }: BrandMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityLabel="MipyPOS">
      <Defs>
        <LinearGradient id="brand-bg" x1="8" y1="4" x2="56" y2="60">
          <Stop offset="0" stopColor="#0F766E" />
          <Stop offset="1" stopColor="#064E3B" />
        </LinearGradient>
        <LinearGradient id="brand-coin" x1="38" y1="14" x2="54" y2="30">
          <Stop offset="0" stopColor="#FDE68A" />
          <Stop offset="1" stopColor="#D97706" />
        </LinearGradient>
      </Defs>
      <Rect width="64" height="64" rx="15" fill="#071A2A" />
      <Path d="M13 25.5h38v24a5 5 0 0 1-5 5H18a5 5 0 0 1-5-5v-24Z" fill="url(#brand-bg)" />
      <Path d="M18 13h20a6 6 0 0 1 6 6v7H18V13Z" fill="#34D399" />
      <Path d="M23 18h16v8H23z" fill="#ECFDF5" opacity={0.9} />
      <Circle cx="47" cy="18" r="9" fill="url(#brand-coin)" stroke="#FEF3C7" strokeWidth="2" />
      <Path
        d="M47 13.2v9.6M50.2 15.2h-4.8a2 2 0 1 0 0 4h3.2a2 2 0 1 1 0 4h-4.8"
        fill="none"
        stroke="#78350F"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <Path d="M20 34h24M20 41h8m5 0h11" stroke="#D1FAE5" strokeWidth="3.2" strokeLinecap="round" />
    </Svg>
  );
}
