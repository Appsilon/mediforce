import '@testing-library/jest-dom';
import { vi } from 'vitest';

vi.mock('@/hooks/use-handle-from-path', () => ({
  useHandleFromPath: () => 'test-org',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
