import { Circle, Path, Svg } from '@/components/ui/primitives/Svg';
import { poster } from '@/lib/branding';

type BrandMarkProps = {
  size?: number;
};

export function BrandMark({ size = 48 }: BrandMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessible={false}>
      <Path
        d="M5 9h9l8 35h29l7-25H16"
        fill="none"
        stroke={poster.white}
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M23 27h27M25 35h22" stroke={poster.cyan} strokeWidth={3.6} strokeLinecap="round" />
      <Circle cx={27} cy={54} r={4.5} fill={poster.yellow} />
      <Circle cx={47} cy={54} r={4.5} fill={poster.yellow} />
    </Svg>
  );
}
