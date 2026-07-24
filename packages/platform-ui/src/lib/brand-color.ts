/**
 * Brand-color helpers. Workspace brand colors are stored as `#rrggbb` hex
 * strings; the design tokens in `globals.css` are bare HSL triples consumed as
 * `hsl(var(--token))`. These pure functions bridge the two so a workspace's
 * chosen colors can override `--primary` / `--accent` at runtime.
 */

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb | null {
  const match = HEX_COLOR.exec(hex.trim());
  if (match === null) return null;
  const int = Number.parseInt(match[1]!, 16);
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff };
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;

  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === r) {
      hue = ((g - b) / delta) % 6;
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return {
    h: Math.round(hue),
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = lightness - chroma / 2;

  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = (
    [
      [chroma, secondary, 0],
      [secondary, chroma, 0],
      [0, chroma, secondary],
      [0, secondary, chroma],
      [secondary, 0, chroma],
      [chroma, 0, secondary],
    ] as const
  )[sector]!;

  return {
    r: Math.round((r + match) * 255),
    g: Math.round((g + match) * 255),
    b: Math.round((b + match) * 255),
  };
}

function foregroundForRgb(rgb: Rgb): string {
  const perceived = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return perceived > 150 ? '222 47% 11%' : '0 0% 100%';
}

/**
 * Convert a `#rrggbb` hex color to a CSS HSL triple (`"H S% L%"`), the shape
 * the design tokens expect. Returns `null` for anything that is not a valid
 * 6-digit hex color (including the empty "cleared" state).
 */
export function hexToHslTriple(hex: string | undefined | null): string | null {
  if (hex === undefined || hex === null) return null;
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  const { h, s, l } = rgbToHsl(rgb);
  return `${h} ${s}% ${l}%`;
}

/**
 * Bounds a brand color must respect to work in the slot it is overriding. The
 * defaults in `globals.css` differ per mode — dark `--primary` is deliberately
 * lighter than its light counterpart, and dark `--accent` is a near-black
 * low-saturation hover surface — so a raw brand color cannot be dropped into
 * both.
 */
export interface BrandTokenBounds {
  minLightness?: number;
  maxLightness?: number;
  maxSaturation?: number;
}

/**
 * Fit a brand color into one token slot, returning the HSL triple to emit and a
 * readable foreground for it. The foreground is derived from the *adjusted*
 * color, not the input, so a brand color that was lightened for dark mode still
 * gets legible text on top.
 */
export function brandTokenTriples(
  hex: string | undefined | null,
  bounds: BrandTokenBounds = {},
): { color: string; foreground: string } | null {
  if (hex === undefined || hex === null) return null;
  const rgb = parseHex(hex);
  if (rgb === null) return null;

  const hsl = rgbToHsl(rgb);
  const s = Math.min(hsl.s, bounds.maxSaturation ?? 100);
  const l = Math.min(Math.max(hsl.l, bounds.minLightness ?? 0), bounds.maxLightness ?? 100);
  const adjusted = { h: hsl.h, s, l };

  return {
    color: `${adjusted.h} ${adjusted.s}% ${adjusted.l}%`,
    foreground: foregroundForRgb(hslToRgb(adjusted)),
  };
}

/**
 * Pick a readable foreground HSL triple (near-white or near-black) for text /
 * icons placed on top of the given brand color, using perceived luminance.
 * Returns `null` when the input is not a valid hex color.
 */
export function readableForegroundTriple(hex: string | undefined | null): string | null {
  if (hex === undefined || hex === null) return null;
  const rgb = parseHex(hex);
  if (rgb === null) return null;
  return foregroundForRgb(rgb);
}
