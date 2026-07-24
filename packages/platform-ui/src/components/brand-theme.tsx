'use client';

import { brandTokenTriples, type BrandTokenBounds } from '@/lib/brand-color';

/**
 * Bounds per token slot, per mode, taken from the defaults they replace in
 * `globals.css`.
 *
 * `--primary` is a foreground-ish brand surface: light mode takes the brand
 * color as-is, dark mode lifts it to at least the lightness of the default
 * `172 60% 60%` so a dark brand color stays legible on a dark background.
 *
 * `--accent` is the hover surface behind `hover:bg-accent`. Light mode's
 * default is already a saturated amber, so the brand color passes through; dark
 * mode's is the near-black `217.2 32.6% 17.5%`, so the brand color is clamped
 * into that band — a hover state should hint at the brand, not compete with the
 * content on top of it.
 */
const PRIMARY_BOUNDS: Record<'light' | 'dark', BrandTokenBounds> = {
  light: {},
  dark: { minLightness: 55 },
};

const ACCENT_BOUNDS: Record<'light' | 'dark', BrandTokenBounds> = {
  light: {},
  dark: { maxSaturation: 33, minLightness: 14, maxLightness: 20 },
};

function declarationsFor(
  mode: 'light' | 'dark',
  primaryColor?: string,
  accentColor?: string,
): string {
  const declarations: string[] = [];

  const primary = brandTokenTriples(primaryColor, PRIMARY_BOUNDS[mode]);
  if (primary !== null) {
    declarations.push(
      `--primary:${primary.color}`,
      `--ring:${primary.color}`,
      `--sidebar-primary:${primary.color}`,
      `--sidebar-ring:${primary.color}`,
      `--primary-foreground:${primary.foreground}`,
      `--sidebar-primary-foreground:${primary.foreground}`,
    );
  }

  const accent = brandTokenTriples(accentColor, ACCENT_BOUNDS[mode]);
  if (accent !== null) {
    declarations.push(`--accent:${accent.color}`, `--accent-foreground:${accent.foreground}`);
  }

  return declarations.join(';');
}

/**
 * Injects a workspace's brand colors as design-token overrides. The tokens in
 * `globals.css` are bare HSL triples consumed via `hsl(var(--token))`, so
 * recoloring `--primary` / `--accent` (plus the `--ring` / `--sidebar-*`
 * mirrors) restyles the whole app with no per-component changes.
 *
 * `:root` and `.dark` get separately derived values — next-themes toggles the
 * `.dark` class on `<html>`, whose token block would otherwise out-specify a
 * `:root`-only override, and the two modes need different bounds anyway (see
 * above). Rendering after `globals.css` in document order lets equal-specificity
 * rules win. A workspace with no (or invalid) colors renders nothing and the
 * platform defaults stand.
 */
export function BrandTheme({
  primaryColor,
  accentColor,
}: {
  primaryColor?: string;
  accentColor?: string;
}) {
  const light = declarationsFor('light', primaryColor, accentColor);
  const dark = declarationsFor('dark', primaryColor, accentColor);
  if (light === '' && dark === '') return null;

  const css = `:root{${light}}\n.dark{${dark}}`;

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
