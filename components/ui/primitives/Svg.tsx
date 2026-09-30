import type { ComponentProps } from 'react';
import { Platform } from 'react-native';
import RNSvg, {
  Circle as RNCircle,
  Defs as RNDefs,
  LinearGradient as RNLinearGradient,
  Path as RNPath,
  Rect as RNRect,
  Stop as RNStop,
} from 'react-native-svg';
import { withUniwind } from 'uniwind';

const colorMapping = {
  fill: {
    fromClassName: 'fillClassName',
    styleProperty: 'accentColor',
  },
  stroke: {
    fromClassName: 'strokeClassName',
    styleProperty: 'accentColor',
  },
} as const;

// Uniwind maps these class props to SVG paint props for native shapes.
type PaintClassProps = {
  fillClassName?: string;
  strokeClassName?: string;
};

function WebCircle({
  fillClassName: _fillClassName,
  strokeClassName: _strokeClassName,
  ...props
}: ComponentProps<typeof RNCircle> & PaintClassProps) {
  return <RNCircle {...props} />;
}

function WebPath({
  fillClassName: _fillClassName,
  strokeClassName: _strokeClassName,
  ...props
}: ComponentProps<typeof RNPath> & PaintClassProps) {
  return <RNPath {...props} />;
}

export const Svg = RNSvg;
export const Defs = RNDefs;
export const LinearGradient = RNLinearGradient;
export const Rect = RNRect;
export const Stop = RNStop;
export const Circle = withUniwind(Platform.OS === 'web' ? WebCircle : RNCircle, colorMapping);
export const Path = withUniwind(Platform.OS === 'web' ? WebPath : RNPath, colorMapping);
