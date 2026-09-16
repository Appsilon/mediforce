import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '@/test/react-query';

const identityState = vi.hoisted(() => ({ uid: 'uid-alice' as string | null }));
const getInstructions = vi.fn<(input: { namespace: string }) => Promise<{ instructions: string }>>();

vi.mock('@/hooks/use-viewer-identity', () => ({
  useViewerIdentity: () => ({ uid: identityState.uid, role: null }),
}));

vi.mock('@/lib/mediforce', () => ({
  mediforce: {
    assistant: {
      getInstructions,
      setInstructions: vi.fn(),
    },
  },
}));

const { useAssistantInstructions } = await import('../use-assistant-instructions');

describe('useAssistantInstructions', () => {
  beforeEach(() => {
    identityState.uid = 'uid-alice';
    getInstructions.mockReset();
  });

  it('keeps each signed-in user’s cached instructions separate in a shared workspace', async () => {
    getInstructions.mockImplementation(async () => ({
      instructions: identityState.uid === 'uid-alice' ? 'Alice instructions' : 'Bob instructions',
    }));
    const { wrapper } = createQueryWrapper();
    const { result, rerender } = renderHook(
      ({ namespace }: { namespace: string }) => useAssistantInstructions(namespace),
      { wrapper, initialProps: { namespace: 'shared-workspace' } },
    );

    await waitFor(() => expect(result.current.instructions).toBe('Alice instructions'));

    identityState.uid = 'uid-bob';
    rerender({ namespace: 'shared-workspace' });

    await waitFor(() => expect(result.current.instructions).toBe('Bob instructions'));
    expect(getInstructions).toHaveBeenCalledTimes(2);
  });
});
