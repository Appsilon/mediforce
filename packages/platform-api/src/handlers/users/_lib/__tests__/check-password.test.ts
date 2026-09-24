import { describe, it, expect } from 'vitest';
import { hash } from 'bcryptjs';
import { InMemoryCredentialsRepository } from '@mediforce/platform-core/testing';
import { checkPassword } from '../check-password';
import { createTestScope, userCaller } from '../../../../repositories/__tests__/create-test-scope';

describe('checkPassword', () => {
  it('compares a presented password with the stored hash, and says when there is nothing to compare', async () => {
    const credentialsRepo = new InMemoryCredentialsRepository();
    await credentialsRepo.setPasswordHash('alice', await hash('correct horse', 4));
    const scope = createTestScope({ credentialsRepo, caller: userCaller('alice', []) });

    expect(await checkPassword(scope, 'alice', 'correct horse')).toBe('correct');
    expect(await checkPassword(scope, 'alice', 'wrong')).toBe('incorrect');
    expect(await checkPassword(scope, 'alice', undefined)).toBe('not_given');
    expect(await checkPassword(scope, 'bob', 'anything')).toBe('no_password');
  });
});
