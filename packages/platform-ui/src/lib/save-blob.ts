/**
 * Trigger the browser's "save file" flow for an in-memory blob via a
 * transient object URL. Shared by every authenticated download that fetches
 * bytes with a Bearer token first (run-report deliverable, run Output Files)
 * — a bare `<a href>` would not carry the Authorization header.
 */
export function saveBlobToDevice(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
