/** Human-readable byte count: 1024-based, B/KB/MB/GB, one decimal above bytes. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, exponent);
  return `${size.toFixed(exponent > 0 ? 1 : 0)} ${units[exponent]}`;
}
