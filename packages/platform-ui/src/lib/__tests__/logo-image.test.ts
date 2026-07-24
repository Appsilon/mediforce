import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WORKSPACE_LOGO_MAX_CHARS } from '@mediforce/platform-core';
import {
  fileToLogoDataUrl,
  LogoTooLargeError,
  LOGO_MAX_EDGE_PX,
  LOGO_SOURCE_MAX_BYTES,
} from '../logo-image';

/**
 * jsdom decodes no bitmaps and has no canvas backend, so `Image` and the 2d
 * context are stubbed. `FileReader` is jsdom's real one — the data: URL the
 * function reads out of the File is genuine.
 */

/** Natural size the stubbed `Image` reports, set per test. */
let decodedSize: { width: number; height: number } | 'undecodable' = { width: 100, height: 100 };
/** Canvas size at the moment `drawImage` ran — what downscaling actually produced. */
let drawnAt: { width: number; height: number } | null = null;
/** Stand-in for the encoded PNG; length is what the size cap is checked against. */
let encodedPng = 'data:image/png;base64,AAAA';
/** Emulates a browser refusing a 2d context (out of memory, blocked canvas). */
let contextAvailable = true;

class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;

  set src(_value: string) {
    queueMicrotask(() => {
      if (decodedSize === 'undecodable') {
        this.onerror?.();
        return;
      }
      this.naturalWidth = decodedSize.width;
      this.naturalHeight = decodedSize.height;
      this.onload?.();
    });
  }
}

function pngFile(bytes: number, type = 'image/png'): File {
  return new File([new Uint8Array(bytes)], 'logo.png', { type });
}

beforeEach(() => {
  decodedSize = { width: 100, height: 100 };
  drawnAt = null;
  encodedPng = 'data:image/png;base64,AAAA';
  contextAvailable = true;

  vi.stubGlobal('Image', StubImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    if (contextAvailable === false) return null;
    return {
      drawImage: (_image: unknown, _x: number, _y: number, width: number, height: number) => {
        drawnAt = { width, height };
      },
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => encodedPng);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fileToLogoDataUrl', () => {
  it('re-encodes a raster as PNG', async () => {
    await expect(fileToLogoDataUrl(pngFile(64))).resolves.toBe(encodedPng);
  });

  it('downscales the longest edge to LOGO_MAX_EDGE_PX, preserving aspect ratio', async () => {
    decodedSize = { width: 2000, height: 1000 };

    await fileToLogoDataUrl(pngFile(64));

    expect(drawnAt).toEqual({ width: LOGO_MAX_EDGE_PX, height: LOGO_MAX_EDGE_PX / 2 });
  });

  it('scales against the taller edge for portrait images', async () => {
    decodedSize = { width: 500, height: 1000 };

    await fileToLogoDataUrl(pngFile(64));

    expect(drawnAt).toEqual({ width: LOGO_MAX_EDGE_PX / 2, height: LOGO_MAX_EDGE_PX });
  });

  it('never upscales an image already under the budget', async () => {
    decodedSize = { width: 48, height: 32 };

    await fileToLogoDataUrl(pngFile(64));

    expect(drawnAt).toEqual({ width: 48, height: 32 });
  });

  it('passes an SVG through untouched rather than rasterising it', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>';
    const file = new File([svg], 'logo.svg', { type: 'image/svg+xml' });

    const result = await fileToLogoDataUrl(file);

    expect(result.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(atob(result.split(',')[1])).toBe(svg);
    expect(drawnAt).toBeNull();
  });

  it('rejects a source file above LOGO_SOURCE_MAX_BYTES without decoding it', async () => {
    const oversized = pngFile(0);
    Object.defineProperty(oversized, 'size', { value: LOGO_SOURCE_MAX_BYTES + 1 });

    await expect(fileToLogoDataUrl(oversized)).rejects.toBeInstanceOf(LogoTooLargeError);
    expect(drawnAt).toBeNull();
  });

  it('rejects a result that still exceeds the schema cap after downscaling', async () => {
    encodedPng = `data:image/png;base64,${'A'.repeat(WORKSPACE_LOGO_MAX_CHARS)}`;

    await expect(fileToLogoDataUrl(pngFile(64))).rejects.toBeInstanceOf(LogoTooLargeError);
  });

  it('rejects an SVG that exceeds the schema cap, since it skips downscaling', async () => {
    const huge = new File(['<svg>'.padEnd(WORKSPACE_LOGO_MAX_CHARS, ' ')], 'logo.svg', {
      type: 'image/svg+xml',
    });

    await expect(fileToLogoDataUrl(huge)).rejects.toBeInstanceOf(LogoTooLargeError);
  });

  it('rejects a file the browser cannot decode as an image', async () => {
    decodedSize = 'undecodable';

    await expect(fileToLogoDataUrl(pngFile(64))).rejects.toThrow('Image could not be decoded');
  });

  it('falls back to the source data URL when no 2d context is available', async () => {
    contextAvailable = false;

    const result = await fileToLogoDataUrl(pngFile(64));

    expect(result.startsWith('data:image/png;base64,')).toBe(true);
    expect(result).not.toBe(encodedPng);
  });
});
