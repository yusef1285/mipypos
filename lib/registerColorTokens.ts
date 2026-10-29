import { Platform } from 'react-native';

const calculatedColorTokens = [
  '--color-accent-hover',
  '--color-accent-soft',
  '--color-accent-soft-foreground',
  '--color-accent-soft-hover',
  '--color-background-secondary',
  '--color-background-tertiary',
  '--color-border-secondary',
  '--color-border-tertiary',
  '--color-danger-hover',
  '--color-danger-soft',
  '--color-danger-soft-foreground',
  '--color-danger-soft-hover',
  '--color-default-hover',
  '--color-default-soft',
  '--color-default-soft-hover',
  '--color-field-border-focus',
  '--color-field-border-hover',
  '--color-field-hover',
  '--color-separator-secondary',
  '--color-separator-tertiary',
  '--color-success-hover',
  '--color-success-soft',
  '--color-success-soft-foreground',
  '--color-success-soft-hover',
  '--color-surface-hover',
  '--color-warning-hover',
  '--color-warning-soft',
  '--color-warning-soft-foreground',
  '--color-warning-soft-hover',
] as const;

/** Resolve calculated colors in browsers without seeding transparent native tokens. */
export function registerColorTokens() {
  if (Platform.OS !== 'web' || typeof CSS === 'undefined' || !CSS.registerProperty) return;
  for (const name of calculatedColorTokens) {
    try {
      CSS.registerProperty({
        name,
        syntax: '<color>',
        inherits: true,
        initialValue: 'transparent',
      });
    } catch {
      // A property may already be registered after a development reload.
    }
  }
}
