'use client';

import { hexToHslTriple, readableForegroundTriple } from '@/lib/brand-color';

/**
 * Injects a workspace's brand colors as design-token overrides. The tokens in
 * `globals.css` are bare HSL triples consumed via `hsl(var(--token))`, so
 * recoloring `--primary` / `--accent` (plus their `--ring` / `--sidebar-*`
 * mirrors) restyles the whole app with no per-component changes.
 *
 * The overrides are emitted for both `:root` and `.dark` — next-themes toggles
 * the `.dark` class on `<html>`, whose token block would otherwise out-specify
 * a `:root`-only override in dark mode. Rendering after `globals.css` in
 * document order lets equal-specificity rules win. A workspace with no (or
 * invalid) colors renders nothing and the platform defaults stand.
 */
export function BrandTheme({
  primaryColor,
  accentColor,
}: {
  primaryColor?: string;
  accentColor?: string;
}) {
  const declarations: string[] = [];

  const primary = hexToHslTriple(primaryColor);
  if (primary !== null) {
    const foreground = readableForegroundTriple(primaryColor);
    declarations.push(
      `--primary:${primary}`,
      `--ring:${primary}`,
      `--sidebar-primary:${primary}`,
      `--sidebar-ring:${primary}`,
    );
    if (foreground !== null) {
      declarations.push(
        `--primary-foreground:${foreground}`,
        `--sidebar-primary-foreground:${foreground}`,
      );
    }
  }

  const accent = hexToHslTriple(accentColor);
  if (accent !== null) {
    const foreground = readableForegroundTriple(accentColor);
    declarations.push(`--accent:${accent}`, `--sidebar-accent:${accent}`);
    if (foreground !== null) {
      declarations.push(
        `--accent-foreground:${foreground}`,
        `--sidebar-accent-foreground:${foreground}`,
      );
    }
  }

  if (declarations.length === 0) return null;

  const block = declarations.join(';');
  const css = `:root{${block}}\n.dark{${block}}`;

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
