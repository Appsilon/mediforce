import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Node.js ≥22 ships a built-in localStorage stub that requires --localstorage-file to function;
// its stub doesn't implement the Storage interface (no clear/key), breaking tests that call
// localStorage.clear(). Replace it with a plain in-memory implementation before jsdom loads.
const _localStore: Record<string, string> = {};
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (key: string) => _localStore[key] ?? null,
    setItem: (key: string, value: string) => { _localStore[key] = String(value); },
    removeItem: (key: string) => { delete _localStore[key]; },
    clear: () => { for (const k in _localStore) delete _localStore[k]; },
    get length() { return Object.keys(_localStore).length; },
    key: (index: number) => Object.keys(_localStore)[index] ?? null,
  } as Storage,
});

vi.mock('@/hooks/use-handle-from-path', () => ({
  useHandleFromPath: () => 'test-org',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
