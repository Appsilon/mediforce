/**
 * Content-Type + Content-Disposition helpers for file-serving routes.
 * Single source for the extension → MIME map and the RFC 6266 attachment
 * header, shared by `/api/agent-output-file` and `/api/runs/[runId]/files/[...path]`.
 */

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function contentTypeForFilePath(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase() ?? '';
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * RFC 6266 `attachment` disposition: plain `filename` for legacy agents plus
 * percent-encoded `filename*` for full Unicode and special-char safety.
 */
export function attachmentContentDisposition(fileName: string): string {
  const encodedFileName = encodeURIComponent(fileName);
  return `attachment; filename="${fileName.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodedFileName}`;
}
