/**
 * Pure viewer selection for Output File preview — given a file name and its
 * byte size, decide which in-browser viewer renders it (or fall back to
 * download). No I/O, no React: the switch that the OutputFilePreview modal
 * drives its render off.
 *
 * Text-family viewers (markdown, html, csv, text) parse the whole file in the
 * browser, so they are size-guarded. Binary viewers (image, svg-as-image,
 * pdf) hand a blob straight to the browser and stream natively — no cap.
 */
import { extensionOf } from './file-extension';

/** Terminal viewer the preview modal renders. `download` = no in-browser preview. */
export type ViewerKind =
  | 'markdown'
  | 'html'
  | 'image'
  | 'svg'
  | 'csv'
  | 'text'
  | 'pdf'
  | 'download';

/** Why a file resolved to `download` instead of an in-browser viewer. */
export type DownloadReason = 'unsupported' | 'too-large';

export interface ViewerSelection {
  viewer: ViewerKind;
  /** Set only when `viewer === 'download'`. */
  reason?: DownloadReason;
}

/**
 * Text-family previews are parsed/rendered in JS, so a huge file hangs the
 * tab. Above this size we degrade to download. Images/PDF are exempt — the
 * browser streams the blob.
 */
export const TEXT_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Rows rendered in the CSV table preview. Above this the table degrades to a
 * "showing first N of M" notice — the full file is one download away, and a
 * capped table stays responsive and quicker to scan than the raw dataframe.
 */
export const CSV_PREVIEW_ROW_LIMIT = 100;

/** Text-family viewers parse the file in JS — size-guarded by TEXT_PREVIEW_MAX_BYTES. */
const TEXT_FAMILY_VIEWERS: ReadonlySet<ViewerKind> = new Set(['markdown', 'html', 'csv', 'text']);

const EXTENSION_VIEWERS: Readonly<Record<string, ViewerKind>> = {
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'svg',
  csv: 'csv',
  tsv: 'csv',
  txt: 'text',
  text: 'text',
  log: 'text',
  json: 'text',
  pdf: 'pdf',
};

export function selectViewer(fileName: string, size: number): ViewerSelection {
  const viewer = EXTENSION_VIEWERS[extensionOf(fileName)];
  if (viewer === undefined) return { viewer: 'download', reason: 'unsupported' };
  if (TEXT_FAMILY_VIEWERS.has(viewer) && size > TEXT_PREVIEW_MAX_BYTES) {
    return { viewer: 'download', reason: 'too-large' };
  }
  return { viewer };
}
