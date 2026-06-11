import '@testing-library/jest-dom';
import { vi } from 'vitest';

// jsdom picks up --localstorage-file from process.argv (set by the Claude Code
// runner) and replaces localStorage with a NoOpStorage that omits `clear`.
// Replace it unconditionally with a working in-memory implementation.
const _lsStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
  get length() { return _lsStore.size; },
  clear: () => { _lsStore.clear(); },
  getItem: (key: string) => _lsStore.get(key) ?? null,
  key: (i: number) => [..._lsStore.keys()][i] ?? null,
  removeItem: (key: string) => { _lsStore.delete(key); },
  setItem: (key: string, v: string) => { _lsStore.set(key, String(v)); },
} satisfies Storage);

vi.mock('@/hooks/use-handle-from-path', () => ({
  useHandleFromPath: () => 'test-org',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
