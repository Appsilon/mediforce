import type { AuthService, AuthUser } from '../interfaces/auth-service.js';

export class RbacError extends Error {
  override name = 'RbacError';

  constructor(
    public readonly userId: string,
    public readonly stepId: string,
    public readonly requiredRoles: string[],
    public readonly userRoles: string[],
  ) {
    super(
      `User '${userId}' lacks required role for step '${stepId}'. ` +
      `Required: [${requiredRoles.join(', ')}]. Has: [${userRoles.join(', ')}]`,
    );
  }
}

export class RbacService {
  constructor(private readonly authService: AuthService) {}

  /**
   * Verify current user has at least one of the required roles for a step.
   * If allowedRoles is empty or undefined, step is open to any authenticated user.
   * Throws RbacError on failure (caller should catch and log to audit trail).
   */
  async requireStepAccess(
    allowedRoles: string[] | undefined,
    stepId: string,
  ): Promise<AuthUser> {
    const user = await this.authService.requireAuth();

    if (!allowedRoles || allowedRoles.length === 0) {
      // Step is unrestricted — any authenticated user may proceed
      return user;
    }

    const hasRole = allowedRoles.some((role) => user.roles.includes(role));
    if (!hasRole) {
      throw new RbacError(user.uid, stepId, allowedRoles, user.roles);
    }

    return user;
  }
}
