import '@testing-library/jest-dom';
import { vi } from 'vitest';

vi.mock('@/hooks/use-handle-from-path', () => ({
  useHandleFromPath: () => 'test-org',
}));
