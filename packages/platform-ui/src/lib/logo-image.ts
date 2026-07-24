import { WORKSPACE_LOGO_MAX_CHARS } from '@mediforce/platform-core';

/**
 * Longest edge, in CSS pixels, a stored workspace logo is downscaled to. The
 * largest on-screen render is 40px, so 256 covers 2x displays with headroom
 * while keeping the encoded string in the single-digit KB range.
 */
export const LOGO_MAX_EDGE_PX = 256;

/**
 * Upper bound on the file a user may pick, before decoding. Downscaling makes
 * the stored size independent of the source, so this only exists to stop the
 * browser decoding an absurdly large bitmap into memory.
 */
export const LOGO_SOURCE_MAX_BYTES = 10 * 1024 * 1024;

export class LogoTooLargeError extends Error {}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be decoded'));
    image.src = dataUrl;
  });
}

/**
 * Turn a user-picked image file into the base64 `data:` URL stored on the
 * workspace record, downscaling rasters so the encoded string stays small
 * regardless of how large the source was.
 *
 * SVGs are passed through untouched — rasterising a vector to fit a pixel
 * budget would make it *worse* on high-DPI screens, and they are already tiny.
 * Rasters are re-encoded as PNG to preserve logo transparency.
 *
 * An animated GIF is therefore **flattened to its first frame**: `drawImage`
 * paints one frame and the PNG re-encode cannot carry animation. This is
 * intended — an animating workspace logo in the sidebar would be a distraction,
 * and the alternative (pass GIFs through like SVGs) skips downscaling on the
 * format most likely to be multi-megabyte.
 *
 * Throws `LogoTooLargeError` when the result still exceeds the schema cap.
 */
export async function fileToLogoDataUrl(file: File): Promise<string> {
  if (file.size > LOGO_SOURCE_MAX_BYTES) {
    throw new LogoTooLargeError('Image file is too large.');
  }

  const sourceDataUrl = await readAsDataUrl(file);
  const encoded =
    file.type === 'image/svg+xml' ? sourceDataUrl : await downscaleToDataUrl(sourceDataUrl);

  if (encoded.length > WORKSPACE_LOGO_MAX_CHARS) {
    throw new LogoTooLargeError('Image is too large even after downscaling.');
  }
  return encoded;
}

async function downscaleToDataUrl(sourceDataUrl: string): Promise<string> {
  const image = await loadImage(sourceDataUrl);
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
  // Only ever shrink — upscaling a small logo would inflate the payload for no
  // visual gain.
  const scale = longestEdge > LOGO_MAX_EDGE_PX ? LOGO_MAX_EDGE_PX / longestEdge : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);

  const context = canvas.getContext('2d');
  if (context === null) return sourceDataUrl;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/png');
}
