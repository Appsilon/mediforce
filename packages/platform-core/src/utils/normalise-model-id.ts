export function normaliseModelId(raw: string): string {
  if (raw.includes('/')) return raw;
  const idx = raw.indexOf('__');
  return idx < 0 ? raw : `${raw.slice(0, idx)}/${raw.slice(idx + 2)}`;
}
