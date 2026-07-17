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

/**
 * Convert a `#rrggbb` hex color to a CSS HSL triple (`"H S% L%"`), the shape
 * the design tokens expect. Returns `null` for anything that is not a valid
 * 6-digit hex color (including the empty "cleared" state).
 */
export function hexToHslTriple(hex: string | undefined | null): string | null {
  if (hex === undefined || hex === null) return null;
  const rgb = parseHex(hex);
  if (rgb === null) return null;

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

  const h = Math.round(hue);
  const s = Math.round(saturation * 100);
  const l = Math.round(lightness * 100);
  return `${h} ${s}% ${l}%`;
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
  const perceived = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return perceived > 150 ? '222 47% 11%' : '0 0% 100%';
}
