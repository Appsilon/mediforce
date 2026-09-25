import { compare } from 'bcryptjs';
import type { CallerScope } from '../../../repositories/index';

/**
 * How a password a user presents to re-authenticate compares with the one
 * stored for them: `no_password` when the account has none to compare with.
 */
export type PasswordCheck = 'no_password' | 'not_given' | 'incorrect' | 'correct';

export async function checkPassword(scope: CallerScope, uid: string, password: string | undefined): Promise<PasswordCheck> {
  const passwordHash = await scope.credentials.getPasswordHash(uid);
  if (passwordHash === null) return 'no_password';
  if (password === undefined) return 'not_given';
  return (await compare(password, passwordHash)) === true ? 'correct' : 'incorrect';
}
