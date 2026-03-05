import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryAuthService } from '@mediforce/platform-core';
import type { AuthUser } from '@mediforce/platform-core';

function createTestUser(
  overrides: Partial<AuthUser> = {},
): AuthUser {
  return {
    uid: 'user-001',
    email: 'test@example.com',
    displayName: 'Test User',
    roles: ['reviewer'],
    ...overrides,
  };
}

describe('InMemoryAuthService', () => {
  let service: InMemoryAuthService;

  beforeEach(() => {
    service = new InMemoryAuthService();
  });

  describe('getCurrentUser', () => {
    it('returns null when no user set', async () => {
      const user = await service.getCurrentUser();
      expect(user).toBeNull();
    });

    it('returns user when set', async () => {
      const testUser = createTestUser();
      service.setCurrentUser(testUser);

      const user = await service.getCurrentUser();
      expect(user).toEqual(testUser);
    });
  });

  describe('requireAuth', () => {
    it('throws when no user is signed in', async () => {
      await expect(service.requireAuth()).rejects.toThrow(
        'Authentication required',
      );
    });

    it('returns user when authenticated', async () => {
      const testUser = createTestUser();
      service.setCurrentUser(testUser);

      const user = await service.requireAuth();
      expect(user).toEqual(testUser);
    });
  });

  describe('requireRole', () => {
    it('throws when user lacks role', async () => {
      const testUser = createTestUser({ roles: ['reviewer'] });
      service.setCurrentUser(testUser);

      await expect(service.requireRole('admin')).rejects.toThrow(
        'Authorization failed',
      );
    });

    it('throws when no user is signed in', async () => {
      await expect(service.requireRole('admin')).rejects.toThrow(
        'Authentication required',
      );
    });

    it('returns user when user has role', async () => {
      const testUser = createTestUser({ roles: ['admin', 'reviewer'] });
      service.setCurrentUser(testUser);

      const user = await service.requireRole('admin');
      expect(user).toEqual(testUser);
    });
  });

  describe('onAuthStateChanged', () => {
    it('calls callback with current user immediately', () => {
      const testUser = createTestUser();
      service.setCurrentUser(testUser);

      let receivedUser: AuthUser | null = null;
      service.onAuthStateChanged((user) => {
        receivedUser = user;
      });

      expect(receivedUser).toEqual(testUser);
    });

    it('calls callback with null when no user', () => {
      let receivedUser: AuthUser | null | undefined = undefined;
      service.onAuthStateChanged((user) => {
        receivedUser = user;
      });

      expect(receivedUser).toBeNull();
    });

    it('returns an unsubscribe function', () => {
      const unsubscribe = service.onAuthStateChanged(() => {});
      expect(typeof unsubscribe).toBe('function');
      // Should not throw
      unsubscribe();
    });
  });

  describe('signOut', () => {
    it('clears user', async () => {
      const testUser = createTestUser();
      service.setCurrentUser(testUser);

      expect(await service.getCurrentUser()).not.toBeNull();

      await service.signOut();
      expect(await service.getCurrentUser()).toBeNull();
    });
  });
});
